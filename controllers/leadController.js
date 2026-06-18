const asyncHandler = require("express-async-handler");
const { Types } = require("mongoose");
const AdminUser = require("../models/AdminUser");
const Campaign = require("../models/Campaign");
const Lead = require("../models/Lead");
const { notifyLeadEvent } = require("../services/notificationService");
const { getSalesScope } = require("../utils/salesScope");
const {
  CANONICAL_LEAD_STATUSES,
  DEFAULT_LEAD_SOURCE,
  DEFAULT_LEAD_STATUS,
  buildLeadAccessFilter,
  formatLeadForApi,
  isSupportedLeadStatus,
  normalizeLeadSource,
  normalizeLeadStatus,
  normalizeLeadTags,
} = require("../utils/leadSupport");

const LEAD_SOURCES = ["Nothing selected", "Campaign", "Website", "Referral", "Social Media", "Walk In", "Job Portal", "Old Data"];
const DEFAULT_COUNTRIES = ["United Arab Emirates", "Sri Lanka", "India", "Qatar", "Kuwait", "Saudi Arabia", "Germany", "Poland", "Norway"];
const DEFAULT_LANGUAGES = ["System Default", "English", "Arabic", "Hindi", "Tamil", "Sinhala"];
const LEAD_ASSIGNMENT_ACTIONS = Object.freeze({
  ASSIGNED: "assigned",
  REASSIGNED: "reassigned",
  UNASSIGNED: "unassigned",
});

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return String(value._id);
  return String(value);
};

const parseLeadValue = (value, fallback = 0) => {
  if (value === undefined) {
    return {
      valid: true,
      value: fallback,
    };
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return {
      valid: false,
      message: "leadValue must be a non-negative number",
    };
  }

  return {
    valid: true,
    value: normalized,
  };
};

const buildAssignableAdminFilter = (scope) => {
  if (scope.isMainAdmin) {
    return {
      role: { $in: ["MainAdmin", "SalesAdmin", "SalesStaff"] },
    };
  }

  if (scope.isSalesStaff) {
    return {
      $or: [{ _id: scope.actorId }, { _id: scope.managerId }],
    };
  }

  return {
    $or: [
      { _id: scope.actorId },
      { role: "SalesStaff", reportsTo: scope.managerId },
    ],
  };
};

const canManageLeadAssignments = (scope) => scope.isMainAdmin || scope.isSalesAdmin;

const parseLeadId = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized || !Types.ObjectId.isValid(normalized)) return null;
  return normalized;
};

const populateLeadQuery = (query) =>
  query
    .populate("assignedTo", "name email role")
    .populate("assignedBy", "name email role")
    .populate("ownerAdmin", "name email role")
    .populate("assignmentHistory.assignedTo", "name email role")
    .populate("assignmentHistory.previousAssignedTo", "name email role")
    .populate("assignmentHistory.assignedBy", "name email role");

const findAssignableAdmin = async (scope, assigneeId) => {
  const normalizedAssigneeId = String(assigneeId || "").trim();
  if (!normalizedAssigneeId) return null;
  if (!Types.ObjectId.isValid(normalizedAssigneeId)) {
    const error = new Error("Invalid assignee id");
    error.statusCode = 400;
    throw error;
  }

  const assignedAdmin = await AdminUser.findOne({
    _id: normalizedAssigneeId,
    ...buildAssignableAdminFilter(scope),
  }).select("_id name email role");

  if (!assignedAdmin) {
    const error = new Error("Assignee not found or not assignable in this sales scope");
    error.statusCode = 404;
    throw error;
  }

  return assignedAdmin;
};

const appendAssignmentHistory = (lead, { action, assignedTo = null, previousAssignedTo = null, assignedBy = null, assignedAt = new Date() } = {}) => {
  lead.assignmentHistory = Array.isArray(lead.assignmentHistory) ? lead.assignmentHistory : [];
  lead.assignmentHistory.push({
    action,
    assignedTo: assignedTo || null,
    previousAssignedTo: previousAssignedTo || null,
    assignedBy: assignedBy || null,
    assignedAt,
  });
};

const applyLeadAssignmentChange = async ({ lead, scope, actorId, assignedToInput, allowNoOp = true } = {}) => {
  if (!canManageLeadAssignments(scope)) {
    const error = new Error("Access denied: only MainAdmin or SalesAdmin can assign leads");
    error.statusCode = 403;
    throw error;
  }

  const nextAssignedIdRaw = String(assignedToInput || "").trim();
  const nextAssignedId = nextAssignedIdRaw || null;
  const previousAssignedId = lead?.assignedTo ? String(lead.assignedTo) : null;
  const assignedAt = new Date();

  if (!nextAssignedId) {
    if (!previousAssignedId && !allowNoOp) {
      const error = new Error("Lead is already unassigned");
      error.statusCode = 400;
      throw error;
    }

    if (previousAssignedId) {
      lead.assignedTo = null;
      lead.assignedBy = actorId || null;
      lead.assignedAt = assignedAt;
      appendAssignmentHistory(lead, {
        action: LEAD_ASSIGNMENT_ACTIONS.UNASSIGNED,
        assignedTo: null,
        previousAssignedTo: previousAssignedId,
        assignedBy: actorId || null,
        assignedAt,
      });
    }

    return {
      action: LEAD_ASSIGNMENT_ACTIONS.UNASSIGNED,
      assignedTo: null,
      assignedAt,
    };
  }

  const assignedAdmin = await findAssignableAdmin(scope, nextAssignedId);
  const isSameAssignee = previousAssignedId && previousAssignedId === String(assignedAdmin._id);

  if (!isSameAssignee) {
    lead.assignedTo = assignedAdmin._id;
    lead.assignedBy = actorId || null;
    lead.assignedAt = assignedAt;
    appendAssignmentHistory(lead, {
      action: previousAssignedId ? LEAD_ASSIGNMENT_ACTIONS.REASSIGNED : LEAD_ASSIGNMENT_ACTIONS.ASSIGNED,
      assignedTo: assignedAdmin._id,
      previousAssignedTo: previousAssignedId,
      assignedBy: actorId || null,
      assignedAt,
    });
  }

  return {
    action: previousAssignedId ? LEAD_ASSIGNMENT_ACTIONS.REASSIGNED : LEAD_ASSIGNMENT_ACTIONS.ASSIGNED,
    assignedTo: assignedAdmin._id,
    assignedAt,
    assignee: assignedAdmin,
    unchanged: Boolean(isSameAssignee),
  };
};

const buildLeadListFilter = (req) => {
  const filter = {
    ...buildLeadAccessFilter(req),
  };
  const assignedFilter = String(req.query?.assigned || "").trim().toLowerCase();

  if (assignedFilter === "assigned") {
    filter.assignedTo = { $ne: null };
  } else if (assignedFilter === "unassigned") {
    filter.assignedTo = null;
  }

  return filter;
};

const getLeadMeta = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);

  const [assignableAdmins, campaigns, tagOptions] = await Promise.all([
    AdminUser.find(buildAssignableAdminFilter(scope))
      .select("name email role whatsappInbox.allowAutoAssignment")
      .sort({ name: 1 })
      .lean(),
    Campaign.find(buildLeadAccessFilter(req)).select("campaignName campaignCode").sort({ campaignName: 1 }).lean(),
    Lead.distinct("tags", buildLeadAccessFilter(req)),
  ]);

  res.json({
    success: true,
    data: {
      statuses: CANONICAL_LEAD_STATUSES,
      sources: LEAD_SOURCES,
      countries: DEFAULT_COUNTRIES,
      languages: DEFAULT_LANGUAGES,
      tagOptions: (Array.isArray(tagOptions) ? tagOptions : [])
        .map((tag) => String(tag || "").trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
      assignableAdmins: assignableAdmins.map((admin) => ({
        ...admin,
        _id: String(admin._id),
        name: String(admin.name || "").trim(),
        role: String(admin.role || "").trim(),
        canAutoAssign: admin?.whatsappInbox?.allowAutoAssignment !== false,
      })),
      campaigns,
    },
  });
});

const listLeads = asyncHandler(async (req, res) => {
  const leads = await populateLeadQuery(Lead.find(buildLeadListFilter(req)))
    .sort({ createdAt: -1 })
    .lean();

  res.json({ success: true, data: leads.map((lead) => formatLeadForApi(lead)) });
});

const getLeadById = asyncHandler(async (req, res) => {
  const leadId = parseLeadId(req.params.id);
  if (!leadId) {
    return res.status(400).json({ message: "Invalid lead id" });
  }

  const lead = await populateLeadQuery(Lead.findOne({ _id: leadId, ...buildLeadAccessFilter(req) })).lean();

  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  res.json({ success: true, data: formatLeadForApi(lead) });
});

const createLead = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const body = req.body || {};

  if (!String(body.name || "").trim()) {
    return res.status(400).json({ message: "Lead name is required" });
  }

  if (body.status !== undefined && !isSupportedLeadStatus(body.status)) {
    return res.status(400).json({ message: "Invalid lead status" });
  }

  const parsedLeadValue = parseLeadValue(body.leadValue, 0);
  if (!parsedLeadValue.valid) {
    return res.status(400).json({ message: parsedLeadValue.message });
  }

  const assignableFilter = buildAssignableAdminFilter(scope);
  const keepUnassigned = body.keepUnassigned === true || String(body.keepUnassigned || "").toLowerCase() === "true";
  const preferredAssignee = String(body.assignedTo || "").trim();
  const fallbackAssignee = keepUnassigned ? "" : scope.actorId;
  const requestedAssignee = preferredAssignee || fallbackAssignee;
  const assignedAdmin = requestedAssignee
    ? await AdminUser.findOne({ _id: requestedAssignee, ...assignableFilter }).select("_id")
    : null;

  if (requestedAssignee && !assignedAdmin) {
    return res.status(400).json({ message: "Invalid assigned user selected" });
  }

  const nextLeadNumber = 2000 + (await Lead.countDocuments({ teamAdmin: scope.managerId })) + 1;
  const assignedAt = assignedAdmin ? new Date() : null;

  const lead = await Lead.create({
    teamAdmin: scope.managerId,
    ownerAdmin: scope.actorId,
    assignedTo: assignedAdmin?._id || null,
    assignedBy: assignedAdmin ? scope.actorId : null,
    assignedAt,
    leadNumber: nextLeadNumber,
    status: normalizeLeadStatus(body.status, DEFAULT_LEAD_STATUS),
    source: normalizeLeadSource(body.source, DEFAULT_LEAD_SOURCE),
    sourceDetails: String(body.sourceDetails || "").trim(),
    name: String(body.name || "").trim(),
    email: body.email || "",
    phone: body.phone || "",
    website: body.website || "",
    address: body.address || "",
    city: body.city || "",
    state: body.state || "",
    country: body.country || "",
    zipCode: body.zipCode || "",
    leadValue: parsedLeadValue.value,
    currency: body.currency || "AED",
    defaultLanguage: body.defaultLanguage || "System Default",
    company: body.company || "",
    description: body.description || "",
    tags: normalizeLeadTags(body.tags),
    assignmentHistory: [
      {
        action: assignedAdmin ? LEAD_ASSIGNMENT_ACTIONS.ASSIGNED : LEAD_ASSIGNMENT_ACTIONS.UNASSIGNED,
        assignedTo: assignedAdmin?._id || null,
        previousAssignedTo: null,
        assignedBy: scope.actorId,
        assignedAt: assignedAt || new Date(),
      },
    ],
    lastContactAt: body.lastContactAt ? new Date(body.lastContactAt) : new Date(),
  });

  const populated = await populateLeadQuery(Lead.findById(lead._id)).lean();
  await notifyLeadEvent({
    req,
    eventType: "lead_created",
    lead: populated,
    title: "Lead created",
    message: `${req.admin?.name || "Admin"} created lead "${populated.name}"`,
    metadata: {
      status: populated.status,
      source: populated.source,
    },
  });

  if (populated.assignedTo) {
    await notifyLeadEvent({
      req,
      eventType: "lead_assigned",
      lead: populated,
      title: "Lead assigned",
      message: `"${populated.name}" assigned to ${populated.assignedTo?.name || "selected user"}`,
      metadata: {
        assignedTo: toIdString(populated.assignedTo),
        assignedToName: populated.assignedTo?.name || "",
      },
    });
  }

  res.status(201).json({ success: true, data: formatLeadForApi(populated) });
});

const updateLead = asyncHandler(async (req, res) => {
  const leadId = parseLeadId(req.params.id);
  if (!leadId) {
    return res.status(400).json({ message: "Invalid lead id" });
  }

  const lead = await Lead.findOne({ _id: leadId, ...buildLeadAccessFilter(req) });
  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  const scope = getSalesScope(req);
  const body = req.body || {};
  const previousAssignedTo = toIdString(lead.assignedTo);
  const previousStatus = lead.status;

  if (body.status !== undefined && !isSupportedLeadStatus(body.status)) {
    return res.status(400).json({ message: "Invalid lead status" });
  }

  if (body.name !== undefined && !String(body.name || "").trim()) {
    return res.status(400).json({ message: "Lead name is required" });
  }

  const parsedLeadValue = parseLeadValue(body.leadValue, lead.leadValue);
  if (!parsedLeadValue.valid) {
    return res.status(400).json({ message: parsedLeadValue.message });
  }

  if (body.assignedTo !== undefined) {
    if (!canManageLeadAssignments(scope)) {
      return res.status(403).json({ message: "Access denied: only MainAdmin or SalesAdmin can assign leads" });
    }

    try {
      await applyLeadAssignmentChange({
        lead,
        scope,
        actorId: scope.actorId,
        assignedToInput: body.assignedTo,
      });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ message: error.message || "Failed to update lead assignment" });
    }
  }

  if (body.status !== undefined) lead.status = normalizeLeadStatus(body.status, lead.status || DEFAULT_LEAD_STATUS);
  if (body.source !== undefined) lead.source = normalizeLeadSource(body.source, DEFAULT_LEAD_SOURCE);
  if (body.sourceDetails !== undefined) lead.sourceDetails = String(body.sourceDetails || "").trim();
  if (body.name !== undefined) lead.name = String(body.name || "").trim();
  if (body.email !== undefined) lead.email = body.email;
  if (body.phone !== undefined) lead.phone = body.phone;
  if (body.website !== undefined) lead.website = body.website;
  if (body.address !== undefined) lead.address = body.address;
  if (body.city !== undefined) lead.city = body.city;
  if (body.state !== undefined) lead.state = body.state;
  if (body.country !== undefined) lead.country = body.country;
  if (body.zipCode !== undefined) lead.zipCode = body.zipCode;
  if (body.leadValue !== undefined) lead.leadValue = parsedLeadValue.value;
  if (body.currency !== undefined) lead.currency = body.currency;
  if (body.defaultLanguage !== undefined) lead.defaultLanguage = body.defaultLanguage;
  if (body.company !== undefined) lead.company = body.company;
  if (body.description !== undefined) lead.description = body.description;
  if (body.tags !== undefined) {
    lead.tags = normalizeLeadTags(body.tags);
  }
  if (body.lastContactAt !== undefined) {
    lead.lastContactAt = body.lastContactAt ? new Date(body.lastContactAt) : lead.lastContactAt;
  }

  await lead.save();

  const populated = await populateLeadQuery(Lead.findById(lead._id)).lean();
  const nextAssignedTo = toIdString(populated.assignedTo);
  if (previousAssignedTo && nextAssignedTo && previousAssignedTo !== nextAssignedTo) {
    await notifyLeadEvent({
      req,
      eventType: "lead_reassigned",
      lead: populated,
      title: "Lead reassigned",
      message: `"${populated.name}" reassigned to ${populated.assignedTo?.name || "selected user"}`,
      metadata: {
        previousAssignedTo,
        assignedTo: nextAssignedTo,
        assignedToName: populated.assignedTo?.name || "",
      },
    });
  }

  if (body.status !== undefined && previousStatus !== populated.status) {
    await notifyLeadEvent({
      req,
      eventType: "lead_status_changed",
      lead: populated,
      title: "Lead status changed",
      message: `"${populated.name}" moved from ${previousStatus || "Unknown"} to ${populated.status}`,
      metadata: {
        previousStatus,
        status: populated.status,
      },
    });
  }

  res.json({ success: true, data: formatLeadForApi(populated) });
});

const updateLeadStatus = asyncHandler(async (req, res) => {
  const leadId = parseLeadId(req.params.id);
  if (!leadId) {
    return res.status(400).json({ message: "Invalid lead id" });
  }

  const lead = await Lead.findOne({ _id: leadId, ...buildLeadAccessFilter(req) });
  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  const status = req.body?.status;
  if (!isSupportedLeadStatus(status)) {
    return res.status(400).json({ message: "Invalid lead status" });
  }

  const previousStatus = lead.status;
  lead.status = normalizeLeadStatus(status, lead.status || DEFAULT_LEAD_STATUS);
  lead.lastContactAt = new Date();
  await lead.save();

  const populated = await populateLeadQuery(Lead.findById(lead._id)).lean();
  if (previousStatus !== populated.status) {
    await notifyLeadEvent({
      req,
      eventType: "lead_status_changed",
      lead: populated,
      title: "Lead status changed",
      message: `"${populated.name}" moved from ${previousStatus || "Unknown"} to ${populated.status}`,
      metadata: {
        previousStatus,
        status: populated.status,
      },
    });
  }

  res.json({ success: true, data: formatLeadForApi(populated) });
});

const assignLead = asyncHandler(async (req, res) => {
  const leadId = parseLeadId(req.params.id);
  if (!leadId) {
    return res.status(400).json({ message: "Invalid lead id" });
  }

  const scope = getSalesScope(req);
  if (!canManageLeadAssignments(scope)) {
    return res.status(403).json({ message: "Access denied: only MainAdmin or SalesAdmin can assign leads" });
  }

  const lead = await Lead.findOne({ _id: leadId, ...buildLeadAccessFilter(req) });
  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  try {
    await applyLeadAssignmentChange({
      lead,
      scope,
      actorId: scope.actorId,
      assignedToInput: req.body?.assignedTo,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ message: error.message || "Failed to update lead assignment" });
  }

  await lead.save();

  const populated = await populateLeadQuery(Lead.findById(lead._id)).lean();
  return res.json({
    success: true,
    message: String(req.body?.assignedTo || "").trim() ? "Lead assigned successfully" : "Lead unassigned successfully",
    data: formatLeadForApi(populated),
  });
});

const bulkAssignLeads = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  if (!canManageLeadAssignments(scope)) {
    return res.status(403).json({ message: "Access denied: only MainAdmin or SalesAdmin can assign leads" });
  }

  const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
  if (!leadIds.length) {
    return res.status(400).json({ message: "leadIds must be a non-empty array" });
  }

  const normalizedLeadIds = [...new Set(leadIds.map(parseLeadId).filter(Boolean))];
  if (!normalizedLeadIds.length || normalizedLeadIds.length !== leadIds.length) {
    return res.status(400).json({ message: "Each lead id must be a valid id" });
  }

  const assignmentInput = req.body?.assignedTo;
  const results = [];
  const failures = [];

  for (const leadId of normalizedLeadIds) {
    const lead = await Lead.findOne({ _id: leadId, ...buildLeadAccessFilter(req) });
    if (!lead) {
      failures.push({ leadId, message: "Lead not found" });
      continue;
    }

    try {
      await applyLeadAssignmentChange({
        lead,
        scope,
        actorId: scope.actorId,
        assignedToInput: assignmentInput,
      });
      await lead.save();
      const populated = await populateLeadQuery(Lead.findById(lead._id)).lean();
      results.push(formatLeadForApi(populated));
    } catch (error) {
      failures.push({
        leadId,
        message: error.message || "Failed to update lead assignment",
      });
    }
  }

  return res.status(failures.length ? 207 : 200).json({
    success: failures.length === 0,
    message: String(assignmentInput || "").trim() ? "Bulk lead assignment completed" : "Bulk lead unassignment completed",
    data: {
      updated: results,
      failures,
      updatedCount: results.length,
      failureCount: failures.length,
    },
  });
});

const deleteLead = asyncHandler(async (req, res) => {
  const leadId = parseLeadId(req.params.id);
  if (!leadId) {
    return res.status(400).json({ message: "Invalid lead id" });
  }

  const lead = await Lead.findOneAndDelete({ _id: leadId, ...buildLeadAccessFilter(req) });
  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  res.json({ success: true, message: "Lead deleted successfully" });
});

module.exports = {
  getLeadMeta,
  listLeads,
  getLeadById,
  createLead,
  assignLead,
  bulkAssignLeads,
  updateLead,
  updateLeadStatus,
  deleteLead,
};


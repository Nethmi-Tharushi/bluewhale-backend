const asyncHandler = require("express-async-handler");
const { Types } = require("mongoose");
const AdminUser = require("../models/AdminUser");
const Campaign = require("../models/Campaign");
const Lead = require("../models/Lead");
const LeadReminder = require("../models/LeadReminder");
const User = require("../models/User");
const { sendPortalWelcomeEmail } = require("../services/emailService");
const { notifyLeadEvent } = require("../services/notificationService");
const { getSalesScope } = require("../utils/salesScope");
const {
  buildLeadOwnership,
  DEFAULT_PORTAL_PASSWORD,
  ensurePortalUserForLead,
  MANAGED_CANDIDATE_B2B_TAG,
  buildManagedCandidateIntegrationKey,
  normalizeEmail,
  resolveDefaultLeadOwner,
  resolveManagedCandidateAssignedStaff,
  resolveAssignedSalesStaff,
  syncLeadLinkedUserAssignment,
} = require("../services/leadAccountService");
const {
  CANONICAL_LEAD_STATUSES,
  DEFAULT_LEAD_SOURCE,
  DEFAULT_LEAD_STATUS,
  buildLeadAccessFilter,
  expandLeadStatusesForQuery,
  formatLeadForApi,
  isSupportedLeadStatus,
  normalizeLeadSource,
  normalizeLeadStatus,
  normalizeLeadTags,
} = require("../utils/leadSupport");

const LEAD_SOURCES = ["Nothing selected", "Campaign", "Website", "Referral", "Social Media", "Walk-In", "Walk In", "Job Portal", "Old Data"];
const WALK_IN_TAG = "Walk-In";
const WALK_IN_SOURCE = "Walk-In";
const WALK_IN_BRANCHES = ["UAE", "India", "UK"];
const DEFAULT_COUNTRIES = ["United Arab Emirates", "Sri Lanka", "India", "Qatar", "Kuwait", "Saudi Arabia", "Germany", "Poland", "Norway"];
const DEFAULT_LANGUAGES = ["System Default", "English", "Arabic", "Hindi", "Tamil", "Sinhala"];
const LEAD_ASSIGNMENT_ACTIONS = Object.freeze({
  ASSIGNED: "assigned",
  REASSIGNED: "reassigned",
  UNASSIGNED: "unassigned",
});
const CUSTOMER_LEAD_STATUSES = new Set(["Paid Customer"]);

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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeWalkInBranch = (value) => {
  const normalized = String(value || "").trim();
  const match = WALK_IN_BRANCHES.find((branch) => branch.toLowerCase() === normalized.toLowerCase());
  return match || "";
};

const startOfLocalDay = (date = new Date()) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
};

const startOfLocalWeek = (date = new Date()) => {
  const start = startOfLocalDay(date);
  const day = start.getDay();
  const offset = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - offset);
  return start;
};

const resolveAdminBranch = (admin) =>
  normalizeWalkInBranch(
    admin?.branch ||
      admin?.assignedBranch ||
      admin?.settings?.branch ||
      admin?.settings?.assignedBranch ||
      admin?.settings?.prefs?.branch
  );

const buildReceptionistWalkInFilter = (receptionistId, options = {}) => {
  const filter = {
    createdBy: receptionistId,
    $or: [
      { tags: WALK_IN_TAG },
      { source: WALK_IN_SOURCE },
      { source: "Walk In" },
      { "sourceMetadata.origin": "walk_in" },
    ],
  };

  if (options.branch) {
    filter.branch = options.branch;
  }

  if (options._id) {
    filter._id = options._id;
  }

  if (options.range === "today") {
    const todayStart = startOfLocalDay();
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    filter.createdAt = { $gte: todayStart, $lt: tomorrowStart };
  } else if (options.range === "week") {
    filter.createdAt = { $gte: startOfLocalWeek() };
  }

  return filter;
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
    .populate("createdBy", "name email role")
    .populate("assignedTo", "name email role")
    .populate("assignedBy", "name email role")
    .populate("statusUpdatedBy", "name email role")
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
  const statuses = String(req.query?.status || "")
    .split(",")
    .map((item) => normalizeLeadStatus(item))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);

  if (assignedFilter === "assigned") {
    filter.assignedTo = { $ne: null };
  } else if (assignedFilter === "unassigned") {
    filter.assignedTo = null;
  }

  if (statuses.length === 1) {
    filter.status = { $in: expandLeadStatusesForQuery(statuses[0]) };
  } else if (statuses.length > 1) {
    filter.status = { $in: expandLeadStatusesForQuery(statuses) };
  }

  return filter;
};

const parseLeadReminderPayload = (body = {}) => {
  const title = String(body.title || "").trim();
  const message = String(body.message || "").trim();
  const remindAtValue = String(body.remindAt || "").trim();
  const remindAt = remindAtValue ? new Date(remindAtValue) : null;

  if (!title) {
    return { error: "Reminder title is required" };
  }

  if (!remindAt || Number.isNaN(remindAt.getTime())) {
    return { error: "Valid reminder date and time are required" };
  }

  return {
    title,
    message,
    remindAt,
  };
};

const formatLeadReminderForApi = (reminder) => {
  const plain = reminder?.toObject ? reminder.toObject() : reminder;
  if (!plain) return null;

  return {
    _id: String(plain._id || plain.id || ""),
    lead: plain.lead && typeof plain.lead === "object"
      ? {
          _id: String(plain.lead._id || plain.lead.id || ""),
          name: String(plain.lead.name || ""),
          email: String(plain.lead.email || ""),
          phone: String(plain.lead.phone || ""),
        }
      : plain.lead || null,
    createdBy: plain.createdBy && typeof plain.createdBy === "object"
      ? {
          _id: String(plain.createdBy._id || plain.createdBy.id || ""),
          name: String(plain.createdBy.name || ""),
          email: String(plain.createdBy.email || ""),
        }
      : plain.createdBy || null,
    title: String(plain.title || ""),
    message: String(plain.message || ""),
    remindAt: plain.remindAt || null,
    status: String(plain.status || "Pending"),
    sentAt: plain.sentAt || null,
    emailDeliveryStatus: String(plain.emailDeliveryStatus || "Pending"),
    emailSentAt: plain.emailSentAt || null,
    emailError: String(plain.emailError || ""),
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
};

const mergeLeadTags = (...tagLists) => {
  const seen = new Set();
  return tagLists
    .flat()
    .map((tag) => String(tag || "").trim())
    .filter((tag) => {
      if (!tag) return false;
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const normalizePhoneForDuplicateCheck = (value) => String(value || "").replace(/\D/g, "");

const buildDuplicateLeadPayload = (lead) =>
  lead
    ? {
        id: String(lead._id || ""),
        name: String(lead.name || "").trim(),
        email: String(lead.email || "").trim().toLowerCase(),
        phone: String(lead.phone || "").trim(),
        status: normalizeLeadStatus(lead.status, DEFAULT_LEAD_STATUS),
        assignedTo: lead.assignedTo
          ? {
              _id: String(lead.assignedTo._id || lead.assignedTo || ""),
              name: String(lead.assignedTo.name || "").trim(),
            }
          : null,
      }
    : null;

const findPotentialDuplicateLead = async ({ leadId = null, email = "", phone = "", linkedUserId = null } = {}) => {
  const or = [];
  if (email) or.push({ email });
  if (linkedUserId) or.push({ linkedUser: linkedUserId });
  if (phone) or.push({ phone });
  if (!or.length) return null;

  const filter = { $or: or };
  if (leadId) {
    filter._id = { $ne: leadId };
  }

  const matches = await Lead.find(filter)
    .select("_id name email phone status assignedTo linkedUser")
    .populate("assignedTo", "name email role")
    .lean();

  const normalizedPhone = normalizePhoneForDuplicateCheck(phone);
  return (
    matches.find((candidate) => {
      if (email && String(candidate.email || "").trim().toLowerCase() === email) return true;
      if (linkedUserId && String(candidate.linkedUser || "") === String(linkedUserId)) return true;
      return normalizedPhone && normalizePhoneForDuplicateCheck(candidate.phone) === normalizedPhone;
    }) || null
  );
};

const getLeadMeta = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);

  const accessFilter = buildLeadAccessFilter(req);
  const [assignableAdmins, campaigns, tagOptions] = await Promise.all([
    AdminUser.find(buildAssignableAdminFilter(scope))
      .select("name email role whatsappInbox.allowAutoAssignment")
      .sort({ name: 1 })
      .lean(),
    Campaign.find(accessFilter).select("campaignName campaignCode").sort({ campaignName: 1 }).lean(),
    typeof Lead.distinct === "function" ? Lead.distinct("tags", accessFilter) : [],
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
  const normalizedBranch = body.branch !== undefined ? normalizeWalkInBranch(body.branch) : "";
  if (body.branch !== undefined && String(body.branch || "").trim() && !normalizedBranch) {
    return res.status(400).json({ message: "branch must be one of: UAE, India, UK" });
  }

  const requestedAssignee = String(body.assignedTo || "").trim();
  const assignedAdmin = await resolveAssignedSalesStaff({
    actor: req.admin,
    preferredAssigneeId: requestedAssignee,
  });
  const ownership = buildLeadOwnership({
    actor: req.admin,
    assignedStaff: assignedAdmin,
  });

  const nextLeadNumber = 2000 + (await Lead.countDocuments({ teamAdmin: ownership.teamAdmin || scope.managerId })) + 1;
  const assignedAt = assignedAdmin ? new Date() : null;
  const normalizedEmail = normalizeEmail(body.email);
  const portalAccountResult = await ensurePortalUserForLead({
    leadInput: body,
    assignedStaff: assignedAdmin,
  });
  const linkedUser = portalAccountResult?.user || null;
  if (linkedUser?._id) {
    const existingLinkedLead = await Lead.findOne({ integrationKey: `portal_user:${linkedUser._id}` }).select("_id");
    if (existingLinkedLead) {
      return res.status(400).json({ message: "A CRM lead already exists for this portal account" });
    }
  }

  if (!body.overrideDuplicate) {
    const duplicateLead = await findPotentialDuplicateLead({
      email: normalizedEmail,
      phone: body.phone,
      linkedUserId: linkedUser?._id || null,
    });

    if (duplicateLead) {
      return res.status(409).json({
        message: "Potential duplicate lead detected",
        duplicateLead: buildDuplicateLeadPayload(duplicateLead),
      });
    }
  }

  const lead = await Lead.create({
    teamAdmin: ownership.teamAdmin || scope.managerId,
    ownerAdmin: ownership.ownerAdmin || scope.actorId,
    assignedTo: ownership.assignedTo || null,
    assignedBy: ownership.assignedBy || null,
    assignedAt,
    createdBy: scope.actorId,
    leadNumber: nextLeadNumber,
    status: normalizeLeadStatus(body.status, DEFAULT_LEAD_STATUS),
    source: normalizeLeadSource(body.source, DEFAULT_LEAD_SOURCE),
    sourceDetails: String(body.sourceDetails || "").trim(),
    branch: normalizedBranch,
    integrationKey: linkedUser?._id ? `portal_user:${linkedUser._id}` : body.integrationKey,
    name: String(body.name || "").trim(),
    email: normalizedEmail,
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
    linkedUser: linkedUser?._id || null,
    portalAccountType: String(body.portalAccountType || linkedUser?.userType || "").trim(),
    sourceMetadata:
      body.sourceMetadata && typeof body.sourceMetadata === "object" && !Array.isArray(body.sourceMetadata)
        ? {
            ...body.sourceMetadata,
            ...(normalizedBranch ? { branch: normalizedBranch } : {}),
          }
        : normalizedBranch
          ? { branch: normalizedBranch }
          : null,
    tags: normalizeLeadTags(body.tags),
    assignmentHistory: [
      {
        action: assignedAdmin ? LEAD_ASSIGNMENT_ACTIONS.ASSIGNED : LEAD_ASSIGNMENT_ACTIONS.UNASSIGNED,
        assignedTo: ownership.assignedTo || null,
        previousAssignedTo: null,
        assignedBy: ownership.assignedBy || scope.actorId,
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
        createdBy: req.admin?._id || null,
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

  if (
    portalAccountResult?.created &&
    body?.sendWelcomeEmail &&
    normalizedEmail
  ) {
    try {
      await sendPortalWelcomeEmail({
        to: normalizedEmail,
        name: populated.name,
        userType: linkedUser?.userType || body?.portalAccountType || "candidate",
        password: portalAccountResult.password || DEFAULT_PORTAL_PASSWORD,
      });
    } catch (emailError) {
      console.error("Failed to send portal welcome email:", emailError);
    }
  }

  res.status(201).json({ success: true, data: formatLeadForApi(populated) });
});

const getMyWalkInLeadSummary = asyncHandler(async (req, res) => {
  const actor = req.admin;
  const receptionistId = actor?._id || null;
  if (!receptionistId) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  const filter = buildReceptionistWalkInFilter(receptionistId);

  const branchBreakdown = await Lead.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { $ifNull: ["$branch", ""] },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1, _id: 1 } },
  ]);
  const assignedBranch = resolveAdminBranch(actor);
  const selectedBranch =
    assignedBranch ||
    normalizeWalkInBranch(branchBreakdown.find((entry) => normalizeWalkInBranch(entry?._id))?._id) ||
    "";
  const branchFilter = selectedBranch ? { ...filter, branch: selectedBranch } : filter;

  const [totalWalkIns, todayWalkIns, weekWalkIns, branchWalkIns, recentWalkIns] = await Promise.all([
    Lead.countDocuments(filter),
    Lead.countDocuments(buildReceptionistWalkInFilter(receptionistId, { range: "today" })),
    Lead.countDocuments(buildReceptionistWalkInFilter(receptionistId, { range: "week" })),
    Lead.countDocuments(branchFilter),
    Lead.find(filter)
      .select("_id leadNumber name phone email branch createdAt source tags")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);

  res.json({
    success: true,
    data: {
      totalWalkIns,
      todayWalkIns,
      weekWalkIns,
      branchWalkIns,
      selectedBranch,
      branchBreakdown: branchBreakdown.map((entry) => ({
        branch: normalizeWalkInBranch(entry?._id) || "Unassigned",
        count: Number(entry?.count || 0),
      })),
      recentWalkIns: recentWalkIns.map((lead) => formatLeadForApi(lead)),
    },
  });
});

const listMyWalkInLeads = asyncHandler(async (req, res) => {
  const receptionistId = req.admin?._id || null;
  if (!receptionistId) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  const range = ["today", "week"].includes(String(req.query?.range || "").toLowerCase())
    ? String(req.query.range).toLowerCase()
    : "";
  const requestedBranch = String(req.query?.branch || "").trim();
  const branch = requestedBranch ? normalizeWalkInBranch(requestedBranch) : "";
  if (requestedBranch && !branch) {
    return res.status(400).json({ message: "branch must be one of: UAE, India, UK" });
  }

  const rawLimit = Number(req.query?.limit || 100);
  const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 100));
  const filter = buildReceptionistWalkInFilter(receptionistId, { range, branch });
  const leads = await Lead.find(filter)
    .select("_id leadNumber name phone email branch address city state country company description status source sourceDetails tags createdAt updatedAt lastContactAt")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  res.json({
    success: true,
    data: {
      leads: leads.map((lead) => formatLeadForApi(lead)),
      filters: {
        range,
        branch,
        limit,
      },
      total: leads.length,
    },
  });
});

const getMyWalkInLeadById = asyncHandler(async (req, res) => {
  const receptionistId = req.admin?._id || null;
  if (!receptionistId) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  const leadId = parseLeadId(req.params.id);
  if (!leadId) {
    return res.status(400).json({ message: "Invalid lead id" });
  }

  const lead = await Lead.findOne(buildReceptionistWalkInFilter(receptionistId, { _id: leadId }))
    .select("_id leadNumber name phone email branch address city state country company description status source sourceDetails tags createdAt updatedAt lastContactAt")
    .lean();

  if (!lead) {
    return res.status(404).json({ message: "Walk-in lead not found" });
  }

  res.json({
    success: true,
    data: formatLeadForApi(lead),
  });
});

const createWalkInLead = asyncHandler(async (req, res) => {
  const actor = req.admin;
  const actorId = actor?._id || null;
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const email = normalizeEmail(body.email);
  const branch = normalizeWalkInBranch(body.branch);

  if (!actorId) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  if (!name) {
    return res.status(400).json({ message: "Visitor name is required" });
  }

  if (!phone) {
    return res.status(400).json({ message: "Visitor phone is required" });
  }

  if (email && !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ message: "Valid visitor email is required when email is provided" });
  }

  if (!branch) {
    return res.status(400).json({ message: "Branch is required and must be one of: UAE, India, UK" });
  }

  const parsedLeadValue = parseLeadValue(body.leadValue, 0);
  if (!parsedLeadValue.valid) {
    return res.status(400).json({ message: parsedLeadValue.message });
  }

  if (!body.overrideDuplicate) {
    const duplicateLead = await findPotentialDuplicateLead({
      email,
      phone,
    });

    if (duplicateLead) {
      return res.status(409).json({
        message: "Potential duplicate lead detected",
        duplicateLead: buildDuplicateLeadPayload(duplicateLead),
      });
    }
  }

  const nextLeadNumber = 2000 + (await Lead.countDocuments({ teamAdmin: actorId })) + 1;
  const tags = mergeLeadTags([WALK_IN_TAG], body.tags);
  const sourceMetadata = {
    ...(body.sourceMetadata && typeof body.sourceMetadata === "object" && !Array.isArray(body.sourceMetadata)
      ? body.sourceMetadata
      : {}),
    origin: "walk_in",
    branch,
    receptionistId: String(actorId),
    receptionistName: String(actor?.name || actor?.email || "").trim(),
  };

  const lead = await Lead.create({
    teamAdmin: actorId,
    ownerAdmin: actorId,
    assignedTo: null,
    assignedBy: null,
    assignedAt: null,
    createdBy: actorId,
    leadNumber: nextLeadNumber,
    status: DEFAULT_LEAD_STATUS,
    source: WALK_IN_SOURCE,
    sourceDetails: String(body.sourceDetails || `Walk-in visitor - ${branch} branch`).trim(),
    branch,
    name,
    email,
    phone,
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
    linkedUser: null,
    portalAccountType: "",
    sourceMetadata,
    tags,
    assignmentHistory: [
      {
        action: LEAD_ASSIGNMENT_ACTIONS.UNASSIGNED,
        assignedTo: null,
        previousAssignedTo: null,
        assignedBy: actorId,
        assignedAt: new Date(),
      },
    ],
    lastContactAt: new Date(),
  });

  const populated = await populateLeadQuery(Lead.findById(lead._id)).lean();
  await notifyLeadEvent({
    req,
    eventType: "lead_created",
    lead: populated,
    title: "Walk-in lead created",
    message: `${actor?.name || "Receptionist"} created walk-in lead "${populated.name}"`,
    metadata: {
      status: populated.status,
      source: populated.source,
      branch,
      createdBy: actorId,
    },
  });

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
  const normalizedBranch = body.branch !== undefined ? normalizeWalkInBranch(body.branch) : lead.branch || "";
  if (body.branch !== undefined && String(body.branch || "").trim() && !normalizedBranch) {
    return res.status(400).json({ message: "branch must be one of: UAE, India, UK" });
  }

  const normalizedEmail = body.email !== undefined ? normalizeEmail(body.email) : normalizeEmail(lead.email);
  if (!body.overrideDuplicate) {
    const duplicateLead = await findPotentialDuplicateLead({
      leadId: lead._id,
      email: normalizedEmail,
      phone: body.phone !== undefined ? body.phone : lead.phone,
      linkedUserId: lead.linkedUser || null,
    });

    if (duplicateLead) {
      return res.status(409).json({
        message: "Potential duplicate lead detected",
        duplicateLead: buildDuplicateLeadPayload(duplicateLead),
      });
    }
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
  if (body.branch !== undefined) {
    lead.branch = normalizedBranch;
    const currentMetadata = lead.sourceMetadata && typeof lead.sourceMetadata === "object" && !Array.isArray(lead.sourceMetadata)
      ? lead.sourceMetadata
      : {};
    lead.sourceMetadata = {
      ...currentMetadata,
      branch: normalizedBranch,
    };
    lead.markModified("sourceMetadata");
  }
  if (body.name !== undefined) lead.name = String(body.name || "").trim();
  if (body.email !== undefined) lead.email = normalizedEmail;
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
  await syncLeadLinkedUserAssignment(lead);

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

const addLeadNote = asyncHandler(async (req, res) => {
  const leadId = parseLeadId(req.params.id);
  if (!leadId) {
    return res.status(400).json({ message: "Invalid lead id" });
  }

  const lead = await Lead.findOne({ _id: leadId, ...buildLeadAccessFilter(req) });
  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  const text = String(req.body?.text || req.body?.note || "").trim();
  if (!text) {
    return res.status(400).json({ message: "Note text is required" });
  }

  lead.internalNotes = Array.isArray(lead.internalNotes) ? lead.internalNotes : [];
  lead.internalNotes.unshift({
    text,
    authorId: req.admin?._id || null,
    authorName: String(req.admin?.name || req.admin?.email || "CRM").trim(),
    createdAt: new Date(),
  });
  await lead.save();

  const populated = await populateLeadQuery(Lead.findById(lead._id)).lean();
  return res.status(201).json({ success: true, data: formatLeadForApi(populated) });
});

const listLeadReminders = asyncHandler(async (req, res) => {
  const leadId = parseLeadId(req.params.id);
  if (!leadId) {
    return res.status(400).json({ message: "Invalid lead id" });
  }

  const lead = await Lead.findOne({ _id: leadId, ...buildLeadAccessFilter(req) }).select("_id name email phone").lean();
  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  const reminders = await LeadReminder.find({ lead: lead._id })
    .populate("lead", "_id name email phone")
    .populate("createdBy", "_id name email role")
    .sort({ remindAt: -1, createdAt: -1 })
    .lean();

  return res.json({
    success: true,
    data: reminders.map(formatLeadReminderForApi),
  });
});

const createLeadReminder = asyncHandler(async (req, res) => {
  const leadId = parseLeadId(req.params.id);
  if (!leadId) {
    return res.status(400).json({ message: "Invalid lead id" });
  }

  const lead = await Lead.findOne({ _id: leadId, ...buildLeadAccessFilter(req) }).select("_id name email phone").lean();
  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  const parsed = parseLeadReminderPayload(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const reminder = await LeadReminder.create({
    lead: lead._id,
    createdBy: req.admin?._id || null,
    title: parsed.title,
    message: parsed.message,
    remindAt: parsed.remindAt,
    status: parsed.remindAt <= new Date() ? "Pending" : "Pending",
  });

  const populated = await LeadReminder.findById(reminder._id)
    .populate("lead", "_id name email phone")
    .populate("createdBy", "_id name email role")
    .lean();

  return res.status(201).json({
    success: true,
    data: formatLeadReminderForApi(populated),
  });
});

const deleteLeadReminder = asyncHandler(async (req, res) => {
  const leadId = parseLeadId(req.params.id);
  const reminderId = String(req.params.reminderId || "").trim();

  if (!leadId || !reminderId) {
    return res.status(400).json({ message: "Invalid reminder request" });
  }

  const lead = await Lead.findOne({ _id: leadId, ...buildLeadAccessFilter(req) }).select("_id").lean();
  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  const reminder = await LeadReminder.findOneAndDelete({
    _id: reminderId,
    lead: lead._id,
  }).lean();

  if (!reminder) {
    return res.status(404).json({ message: "Reminder not found" });
  }

  return res.json({ success: true, message: "Reminder deleted successfully" });
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
  lead.statusUpdatedBy = req.admin?._id || null;
  lead.statusUpdatedAt = new Date();
  lead.lastContactAt = new Date();
  await lead.save();
  await syncLeadLinkedUserAssignment(lead);

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
        updatedBy: String(req.admin?.name || req.admin?.email || "CRM").trim(),
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
  await syncLeadLinkedUserAssignment(lead);

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
      await syncLeadLinkedUserAssignment(lead);
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

const syncPortalUsersToLeads = asyncHandler(async (req, res) => {
  const existingLeadUserIds = await Lead.distinct("linkedUser", { linkedUser: { $ne: null } });
  const existingLeadUserIdSet = new Set(existingLeadUserIds.map((value) => String(value)));
  const existingLeadIntegrationKeys = new Set(
    (await Lead.distinct("integrationKey", { integrationKey: { $ne: null } }))
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );

  const portalUsers = await User.find({
    _id: { $nin: existingLeadUserIds },
  })
    .select("_id name email phone address country location companyName companyAddress contactPerson userType assignedTo createdAt jobInterest")
    .sort({ createdAt: 1, _id: 1 });

  const created = [];
  const skipped = [];

  for (const user of portalUsers) {
    if (existingLeadUserIdSet.has(String(user._id))) {
      skipped.push({ userId: String(user._id), reason: "Lead already exists" });
      continue;
    }

    const preferredAssignedStaff = user.assignedTo
      ? await AdminUser.findOne({ _id: user.assignedTo, role: "SalesStaff" }).select("_id name email role reportsTo")
      : null;
    const assignedAdmin =
      preferredAssignedStaff ||
      (await resolveAssignedSalesStaff({
        actor: req.admin,
      }));
    const ownership = buildLeadOwnership({
      actor: req.admin,
      assignedStaff: assignedAdmin,
    });
    const teamAdminId = ownership.teamAdmin || getSalesScope(req).managerId || req.admin?._id || null;
    const ownerAdminId = ownership.ownerAdmin || req.admin?._id || null;

    if (!teamAdminId || !ownerAdminId) {
      skipped.push({ userId: String(user._id), reason: "Unable to resolve lead ownership" });
      continue;
    }

    const nextLeadNumber = 2000 + (await Lead.countDocuments({ teamAdmin: teamAdminId })) + 1;
    const assignedAt = assignedAdmin ? new Date() : null;
    const lead = await Lead.create({
      teamAdmin: teamAdminId,
      ownerAdmin: ownerAdminId,
      assignedTo: assignedAdmin?._id || null,
      assignedBy: req.admin?._id || assignedAdmin?._id || null,
      assignedAt,
      leadNumber: nextLeadNumber,
      status: DEFAULT_LEAD_STATUS,
      source: "Job Portal",
      sourceDetails: "Portal User Backfill",
      integrationKey: `portal_user:${user._id}`,
      linkedUser: user._id,
      portalAccountType: String(user.userType || "").trim(),
      name: user.userType === "agent" ? user.contactPerson || user.name : user.name,
      email: normalizeEmail(user.email),
      phone: user.phone || "",
      address: user.address || user.companyAddress || "",
      city: user.location || "",
      country: user.country || "",
      company: user.companyName || "",
      description: user.jobInterest || (user.userType === "agent" ? `Agent signup for ${user.companyName || "company"}` : ""),
      sourceMetadata: {
        origin: "job_portal_backfill",
        portalUserId: String(user._id),
        userType: user.userType,
      },
      assignmentHistory: [
        {
          action: assignedAdmin ? LEAD_ASSIGNMENT_ACTIONS.ASSIGNED : LEAD_ASSIGNMENT_ACTIONS.UNASSIGNED,
          assignedTo: assignedAdmin?._id || null,
          previousAssignedTo: null,
          assignedBy: req.admin?._id || assignedAdmin?._id || null,
          assignedAt: assignedAt || new Date(),
        },
      ],
      lastContactAt: user.createdAt || new Date(),
      createdAt: user.createdAt || undefined,
      updatedAt: user.createdAt || undefined,
    });

    await syncLeadLinkedUserAssignment(lead);
    created.push({
      userId: String(user._id),
      leadId: String(lead._id),
      name: lead.name,
    });
    existingLeadUserIdSet.add(String(user._id));
    existingLeadIntegrationKeys.add(String(lead.integrationKey || "").trim());
  }

  const agentUsers = await User.find({ userType: "agent" })
    .select("_id name email companyName assignedTo managedCandidates")
    .sort({ createdAt: 1, _id: 1 });

  for (const agent of agentUsers) {
    for (const managedCandidate of agent.managedCandidates || []) {
      const integrationKey = buildManagedCandidateIntegrationKey(agent._id, managedCandidate._id);
      if (!integrationKey) {
        skipped.push({
          candidateId: String(managedCandidate?._id || ""),
          reason: "Unable to resolve managed candidate integration key",
        });
        continue;
      }

      if (existingLeadIntegrationKeys.has(integrationKey)) {
        skipped.push({
          candidateId: String(managedCandidate._id),
          reason: "Managed candidate lead already exists",
        });
        continue;
      }

      const assignedAdmin = await resolveManagedCandidateAssignedStaff({
        agent,
        managedCandidate,
      });
      const ownershipContext = await resolveDefaultLeadOwner(assignedAdmin);

      if (!ownershipContext.teamAdminId || !ownershipContext.ownerAdminId) {
        skipped.push({
          candidateId: String(managedCandidate._id),
          reason: "Unable to resolve managed candidate ownership",
        });
        continue;
      }

      const assignedAt = assignedAdmin ? new Date() : null;
      const lead = await Lead.create({
        teamAdmin: ownershipContext.teamAdminId,
        ownerAdmin: ownershipContext.ownerAdminId,
        assignedTo: assignedAdmin?._id || null,
        assignedBy: assignedAdmin?._id || null,
        assignedAt,
        leadNumber: 2000 + (await Lead.countDocuments({ teamAdmin: ownershipContext.teamAdminId })) + 1,
        status: CUSTOMER_LEAD_STATUSES.has(normalizeLeadStatus(managedCandidate.status, ""))
          ? normalizeLeadStatus(managedCandidate.status)
          : DEFAULT_LEAD_STATUS,
        source: "Job Portal",
        sourceDetails: "Agent Managed Candidate Backfill",
        integrationKey,
        linkedUser: null,
        portalAccountType: "candidate",
        name: String(managedCandidate.name || "").trim() || normalizeEmail(managedCandidate.email) || "Managed Candidate",
        email: normalizeEmail(managedCandidate.email),
        phone: managedCandidate.phone || "",
        address: managedCandidate.address || "",
        city: managedCandidate.location || "",
        country: managedCandidate.country || "",
        company: agent.companyName || "",
        description:
          String(managedCandidate.jobInterest || "").trim() ||
          `Managed candidate under ${String(agent.companyName || agent.name || "agent").trim()}`,
        tags: mergeLeadTags(["Job Portal", MANAGED_CANDIDATE_B2B_TAG]),
        sourceMetadata: {
          origin: "agent_managed_candidate_backfill",
          candidateType: "B2B",
          agentId: String(agent._id),
          agentName: String(agent.name || "").trim(),
          companyName: String(agent.companyName || "").trim(),
          managedCandidateId: String(managedCandidate._id),
        },
        assignmentHistory: [
          {
            action: assignedAdmin ? LEAD_ASSIGNMENT_ACTIONS.ASSIGNED : LEAD_ASSIGNMENT_ACTIONS.UNASSIGNED,
            assignedTo: assignedAdmin?._id || null,
            previousAssignedTo: null,
            assignedBy: assignedAdmin?._id || null,
            assignedAt: assignedAt || new Date(),
          },
        ],
        lastContactAt: managedCandidate.lastUpdated || managedCandidate.addedAt || new Date(),
        createdAt: managedCandidate.addedAt || undefined,
        updatedAt: managedCandidate.lastUpdated || managedCandidate.addedAt || undefined,
      });

      created.push({
        candidateId: String(managedCandidate._id),
        leadId: String(lead._id),
        name: lead.name,
      });
      existingLeadIntegrationKeys.add(integrationKey);
    }
  }

  return res.json({
    success: true,
    message: `Portal user sync completed: ${created.length} leads created, ${skipped.length} skipped`,
    data: {
      created,
      skipped,
      createdCount: created.length,
      skippedCount: skipped.length,
    },
  });
});

module.exports = {
  getLeadMeta,
  listLeads,
  getLeadById,
  createLead,
  createWalkInLead,
  getMyWalkInLeadSummary,
  listMyWalkInLeads,
  getMyWalkInLeadById,
  assignLead,
  bulkAssignLeads,
  updateLead,
  updateLeadStatus,
  addLeadNote,
  listLeadReminders,
  createLeadReminder,
  deleteLeadReminder,
  deleteLead,
  syncPortalUsersToLeads,
};


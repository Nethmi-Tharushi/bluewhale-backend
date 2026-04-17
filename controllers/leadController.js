const asyncHandler = require("express-async-handler");
const AdminUser = require("../models/AdminUser");
const Campaign = require("../models/Campaign");
const Lead = require("../models/Lead");
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

const getLeadMeta = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);

  const [assignableAdmins, campaigns] = await Promise.all([
    AdminUser.find(buildAssignableAdminFilter(scope))
      .select("name email role whatsappInbox.allowAutoAssignment")
      .sort({ name: 1 })
      .lean(),
    Campaign.find(buildLeadAccessFilter(req)).select("campaignName campaignCode").sort({ campaignName: 1 }).lean(),
  ]);

  res.json({
    success: true,
    data: {
      statuses: CANONICAL_LEAD_STATUSES,
      sources: LEAD_SOURCES,
      countries: DEFAULT_COUNTRIES,
      languages: DEFAULT_LANGUAGES,
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
  const leads = await Lead.find(buildLeadAccessFilter(req))
    .populate("assignedTo", "name email role")
    .populate("ownerAdmin", "name email role")
    .sort({ createdAt: -1 })
    .lean();

  res.json({ success: true, data: leads.map((lead) => formatLeadForApi(lead)) });
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
  const preferredAssignee = String(body.assignedTo || "").trim() || scope.actorId;
  const assignedAdmin = await AdminUser.findOne({ _id: preferredAssignee, ...assignableFilter }).select("_id");

  if (!assignedAdmin) {
    return res.status(400).json({ message: "Invalid assigned user selected" });
  }

  const nextLeadNumber = 2000 + (await Lead.countDocuments({ teamAdmin: scope.managerId })) + 1;

  const lead = await Lead.create({
    teamAdmin: scope.managerId,
    ownerAdmin: scope.actorId,
    assignedTo: assignedAdmin._id,
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
    lastContactAt: body.lastContactAt ? new Date(body.lastContactAt) : new Date(),
  });

  const populated = await Lead.findById(lead._id)
    .populate("assignedTo", "name email role")
    .populate("ownerAdmin", "name email role")
    .lean();

  res.status(201).json({ success: true, data: formatLeadForApi(populated) });
});

const updateLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...buildLeadAccessFilter(req) });
  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  const scope = getSalesScope(req);
  const body = req.body || {};

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

  if (body.assignedTo !== undefined && String(body.assignedTo || "").trim()) {
    const assignedAdmin = await AdminUser.findOne({
      _id: body.assignedTo,
      ...buildAssignableAdminFilter(scope),
    }).select("_id");

    if (!assignedAdmin) {
      return res.status(400).json({ message: "Invalid assigned user selected" });
    }

    lead.assignedTo = assignedAdmin._id;
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

  const populated = await Lead.findById(lead._id)
    .populate("assignedTo", "name email role")
    .populate("ownerAdmin", "name email role")
    .lean();

  res.json({ success: true, data: formatLeadForApi(populated) });
});

const updateLeadStatus = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...buildLeadAccessFilter(req) });
  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  const status = req.body?.status;
  if (!isSupportedLeadStatus(status)) {
    return res.status(400).json({ message: "Invalid lead status" });
  }

  lead.status = normalizeLeadStatus(status, lead.status || DEFAULT_LEAD_STATUS);
  lead.lastContactAt = new Date();
  await lead.save();

  const populated = await Lead.findById(lead._id)
    .populate("assignedTo", "name email role")
    .populate("ownerAdmin", "name email role")
    .lean();

  res.json({ success: true, data: formatLeadForApi(populated) });
});

const deleteLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOneAndDelete({ _id: req.params.id, ...buildLeadAccessFilter(req) });
  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  res.json({ success: true, message: "Lead deleted successfully" });
});

module.exports = {
  getLeadMeta,
  listLeads,
  createLead,
  updateLead,
  updateLeadStatus,
  deleteLead,
};


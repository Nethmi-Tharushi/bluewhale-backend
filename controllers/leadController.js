const asyncHandler = require("express-async-handler");
const AdminUser = require("../models/AdminUser");
const Campaign = require("../models/Campaign");
const Lead = require("../models/Lead");
const { buildOwnedFilter, getSalesScope } = require("../utils/salesScope");

const LEAD_STATUSES = ["Prospects", "Not Interested", "Follow-up Required", "Leads", "Paid Client", "Paid Clients", "Converted Leads"];
const LEAD_SOURCES = ["Nothing selected", "Campaign", "Website", "Referral", "Social Media", "Walk In", "Job Portal", "Old Data"];
const DEFAULT_COUNTRIES = ["United Arab Emirates", "Sri Lanka", "India", "Qatar", "Kuwait", "Saudi Arabia", "Germany", "Poland", "Norway"];
const DEFAULT_LANGUAGES = ["System Default", "English", "Arabic", "Hindi", "Tamil", "Sinhala"];

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const buildAssignableAdminFilter = (scope) => {
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
    AdminUser.find(buildAssignableAdminFilter(scope)).select("name email role").sort({ name: 1 }).lean(),
    Campaign.find(buildOwnedFilter(req, "ownerAdmin", "teamAdmin")).select("campaignName campaignCode").sort({ campaignName: 1 }).lean(),
  ]);

  res.json({
    success: true,
    data: {
      statuses: LEAD_STATUSES,
      sources: LEAD_SOURCES,
      countries: DEFAULT_COUNTRIES,
      languages: DEFAULT_LANGUAGES,
      assignableAdmins,
      campaigns,
    },
  });
});

const listLeads = asyncHandler(async (req, res) => {
  const leads = await Lead.find(buildOwnedFilter(req, "ownerAdmin", "teamAdmin"))
    .populate("assignedTo", "name email role")
    .populate("ownerAdmin", "name email role")
    .sort({ createdAt: -1 })
    .lean();

  res.json({ success: true, data: leads });
});

const createLead = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const body = req.body || {};

  if (!body.name) {
    return res.status(400).json({ message: "Lead name is required" });
  }

  const assignableFilter = buildAssignableAdminFilter(scope);
  const preferredAssignee = body.assignedTo || scope.actorId;
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
    status: LEAD_STATUSES.includes(body.status) ? body.status : "Leads",
    source: body.source || "Nothing selected",
    sourceDetails: body.sourceDetails || "",
    name: body.name,
    email: body.email || "",
    phone: body.phone || "",
    website: body.website || "",
    address: body.address || "",
    city: body.city || "",
    state: body.state || "",
    country: body.country || "",
    zipCode: body.zipCode || "",
    leadValue: toNumber(body.leadValue, 0),
    currency: body.currency || "AED",
    defaultLanguage: body.defaultLanguage || "System Default",
    company: body.company || "",
    description: body.description || "",
    tags: Array.isArray(body.tags)
      ? body.tags.filter(Boolean)
      : String(body.tags || "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
    lastContactAt: body.lastContactAt ? new Date(body.lastContactAt) : new Date(),
  });

  const populated = await Lead.findById(lead._id)
    .populate("assignedTo", "name email role")
    .populate("ownerAdmin", "name email role")
    .lean();

  res.status(201).json({ success: true, data: populated });
});

const updateLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin") });
  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  const scope = getSalesScope(req);
  const body = req.body || {};

  if (body.assignedTo) {
    const assignedAdmin = await AdminUser.findOne({
      _id: body.assignedTo,
      ...buildAssignableAdminFilter(scope),
    }).select("_id");

    if (!assignedAdmin) {
      return res.status(400).json({ message: "Invalid assigned user selected" });
    }

    lead.assignedTo = assignedAdmin._id;
  }

  if (body.status !== undefined && LEAD_STATUSES.includes(body.status)) lead.status = body.status;
  if (body.source !== undefined) lead.source = body.source;
  if (body.sourceDetails !== undefined) lead.sourceDetails = body.sourceDetails;
  if (body.name !== undefined) lead.name = body.name;
  if (body.email !== undefined) lead.email = body.email;
  if (body.phone !== undefined) lead.phone = body.phone;
  if (body.website !== undefined) lead.website = body.website;
  if (body.address !== undefined) lead.address = body.address;
  if (body.city !== undefined) lead.city = body.city;
  if (body.state !== undefined) lead.state = body.state;
  if (body.country !== undefined) lead.country = body.country;
  if (body.zipCode !== undefined) lead.zipCode = body.zipCode;
  if (body.leadValue !== undefined) lead.leadValue = toNumber(body.leadValue, lead.leadValue);
  if (body.currency !== undefined) lead.currency = body.currency;
  if (body.defaultLanguage !== undefined) lead.defaultLanguage = body.defaultLanguage;
  if (body.company !== undefined) lead.company = body.company;
  if (body.description !== undefined) lead.description = body.description;
  if (body.tags !== undefined) {
    lead.tags = Array.isArray(body.tags)
      ? body.tags.filter(Boolean)
      : String(body.tags || "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
  }
  if (body.lastContactAt !== undefined) {
    lead.lastContactAt = body.lastContactAt ? new Date(body.lastContactAt) : lead.lastContactAt;
  }

  await lead.save();

  const populated = await Lead.findById(lead._id)
    .populate("assignedTo", "name email role")
    .populate("ownerAdmin", "name email role")
    .lean();

  res.json({ success: true, data: populated });
});

const updateLeadStatus = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin") });
  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  const status = req.body?.status;
  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Invalid lead status" });
  }

  lead.status = status;
  lead.lastContactAt = new Date();
  await lead.save();

  const populated = await Lead.findById(lead._id)
    .populate("assignedTo", "name email role")
    .populate("ownerAdmin", "name email role")
    .lean();

  res.json({ success: true, data: populated });
});

const deleteLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOneAndDelete({ _id: req.params.id, ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin") });
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

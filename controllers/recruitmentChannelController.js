const asyncHandler = require("express-async-handler");
const AdminUser = require("../models/AdminUser");
const Campaign = require("../models/Campaign");
const RecruitmentChannel = require("../models/RecruitmentChannel");
const User = require("../models/User");
const { buildOwnedFilter, getSalesScope } = require("../utils/salesScope");

const CHANNEL_STATUSES = ["Draft", "Active", "Inactive", "Archived"];
const CHANNEL_FORM_TYPES = ["Candidate Profile", "Lead Capture", "General Recruitment"];
const CHANNEL_LANGUAGES = ["English", "Arabic", "French", "Sinhala", "Tamil"];
const STAFF_ROLE_OPTIONS = ["SalesAdmin", "SalesStaff", "AgentAdmin"];

const FIELD_TYPES = ["header", "paragraph", "text", "email", "phone", "number", "date", "textarea", "select", "file"];

const PRESET_FIELDS = [
  { type: "header", label: "Header", content: "Section Title", systemField: false },
  { type: "paragraph", label: "Paragraph", content: "Helpful description", systemField: false },
  { type: "file", label: "File Upload", fieldKey: "fileUpload", systemField: false },
  { type: "text", label: "First name", fieldKey: "firstname", candidateField: "firstname", systemField: true },
  { type: "text", label: "Last name", fieldKey: "lastname", candidateField: "lastname", systemField: true },
  { type: "text", label: "Candidate code", fieldKey: "name", candidateField: "name", systemField: true },
  { type: "date", label: "Birthday", fieldKey: "dateOfBirth", candidateField: "dateOfBirth", systemField: true },
  { type: "select", label: "Gender", fieldKey: "gender", candidateField: "gender", systemField: true, options: ["Male", "Female", "Other", "Prefer not to say"] },
  { type: "text", label: "Desired salary", fieldKey: "desiredSalary", systemField: false },
  { type: "text", label: "Birthplace", fieldKey: "birthplace", systemField: false },
  { type: "text", label: "Home town", fieldKey: "homeTown", systemField: false },
  { type: "text", label: "Identification", fieldKey: "identification", systemField: false },
  { type: "text", label: "Place of issue", fieldKey: "placeOfIssue", systemField: false },
  { type: "select", label: "Marital status", fieldKey: "maritalStatus", options: ["Single", "Married", "Divorced", "Widowed"], systemField: false },
  { type: "text", label: "Nation", fieldKey: "country", candidateField: "country", systemField: true },
  { type: "text", label: "Religion", fieldKey: "religion", systemField: false },
  { type: "number", label: "Height(m)", fieldKey: "height", systemField: false },
  { type: "number", label: "Weight(kg)", fieldKey: "weight", systemField: false },
  { type: "email", label: "Email Address", fieldKey: "email", candidateField: "email", systemField: true },
  { type: "phone", label: "Phone", fieldKey: "phone", candidateField: "phone", systemField: true },
  { type: "text", label: "Company", fieldKey: "company", systemField: false },
  { type: "textarea", label: "Resident", fieldKey: "resident", systemField: false },
  { type: "text", label: "Zip Code", fieldKey: "zipCode", systemField: false },
  { type: "textarea", label: "Introduce yourself", fieldKey: "aboutMe", candidateField: "aboutMe", systemField: true },
  { type: "text", label: "Skype", fieldKey: "skype", systemField: false },
  { type: "text", label: "Facebook", fieldKey: "facebook", systemField: false },
  { type: "textarea", label: "Current accommodation", fieldKey: "currentAccommodation", systemField: false },
  { type: "text", label: "Role in the old company", fieldKey: "previousRole", systemField: false },
  { type: "text", label: "Contact person", fieldKey: "contactPerson", systemField: false },
  { type: "text", label: "Salary", fieldKey: "salary", systemField: false },
  { type: "textarea", label: "Reason for leaving job", fieldKey: "reasonForLeavingJob", systemField: false },
  { type: "textarea", label: "Job description", fieldKey: "jobDescription", systemField: false },
  { type: "text", label: "Diploma", fieldKey: "diploma", systemField: false },
  { type: "text", label: "Training places", fieldKey: "trainingPlaces", systemField: false },
  { type: "text", label: "Specialized", fieldKey: "specialized", systemField: false },
  { type: "text", label: "Percentage", fieldKey: "percentage", systemField: false },
  { type: "text", label: "Days for identity", fieldKey: "daysForIdentity", systemField: false },
  { type: "text", label: "Seniority", fieldKey: "seniority", systemField: false },
  { type: "text", label: "Skill", fieldKey: "skill", systemField: false },
  { type: "text", label: "Interests", fieldKey: "interests", systemField: false },
];

const toObjectIdList = (values = []) =>
  (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);

const normalizeField = (field = {}, index = 0) => {
  const type = FIELD_TYPES.includes(field.type) ? field.type : "text";
  const options = Array.isArray(field.options)
    ? field.options
        .map((option) => {
          if (typeof option === "string") {
            const value = option.trim();
            return value ? { label: value, value } : null;
          }
          const label = String(option?.label || option?.value || "").trim();
          const value = String(option?.value || option?.label || "").trim();
          if (!label && !value) return null;
          return { label: label || value, value: value || label };
        })
        .filter(Boolean)
    : [];

  return {
    id: String(field.id || `${type}-${index + 1}`),
    type,
    label: String(field.label || "").trim(),
    fieldKey: String(field.fieldKey || "").trim(),
    candidateField: String(field.candidateField || "").trim(),
    placeholder: String(field.placeholder || "").trim(),
    helperText: String(field.helperText || "").trim(),
    content: String(field.content || "").trim(),
    required: Boolean(field.required),
    width: field.width === "half" ? "half" : "full",
    options,
    acceptedFileTypes: Array.isArray(field.acceptedFileTypes) ? field.acceptedFileTypes.filter(Boolean) : [],
    systemField: Boolean(field.systemField),
  };
};

const normalizeChannelPayload = (body = {}) => ({
  formName: String(body.formName || "").trim(),
  formType: CHANNEL_FORM_TYPES.includes(body.formType) ? body.formType : "Candidate Profile",
  status: CHANNEL_STATUSES.includes(body.status) ? body.status : "Draft",
  language: CHANNEL_LANGUAGES.includes(body.language) ? body.language : "English",
  submitButtonText: String(body.submitButtonText || "Submit").trim() || "Submit",
  successMessage: String(body.successMessage || "Form submitted successfully").trim() || "Form submitted successfully",
  responsiblePerson: body.responsiblePerson || null,
  notificationSettings: {
    notifyWhenNewCandidates: body.notificationSettings?.notifyWhenNewCandidates !== false,
    notifyMode: ["specific_staff_members", "staff_members_with_roles", "responsible_person"].includes(body.notificationSettings?.notifyMode)
      ? body.notificationSettings.notifyMode
      : "specific_staff_members",
    specificStaffMembers: toObjectIdList(body.notificationSettings?.specificStaffMembers),
    staffRoles: Array.isArray(body.notificationSettings?.staffRoles)
      ? body.notificationSettings.staffRoles.filter((role) => STAFF_ROLE_OPTIONS.includes(role))
      : [],
    personInCharge: body.notificationSettings?.personInCharge || null,
  },
  formSchema: Array.isArray(body.formSchema) ? body.formSchema.map(normalizeField) : [],
});

const buildStaffFilter = (scope) => {
  if (scope.isMainAdmin) {
    return {
      role: { $in: ["MainAdmin", ...STAFF_ROLE_OPTIONS] },
    };
  }

  if (scope.isSalesStaff) {
    return {
      _id: { $in: [scope.actorId, scope.managerId].filter(Boolean) },
    };
  }

  return {
    $or: [
      { _id: scope.actorId },
      { role: "SalesStaff", reportsTo: scope.managerId },
    ],
  };
};

const listRecruitmentChannels = asyncHandler(async (req, res) => {
  const filter = buildOwnedFilter(req, "ownerAdmin", "teamAdmin");
  if (req.query.status && CHANNEL_STATUSES.includes(req.query.status)) {
    filter.status = req.query.status;
  }

  const channels = await RecruitmentChannel.find(filter)
    .populate("ownerAdmin", "name email role")
    .populate("responsiblePerson", "name email role")
    .populate("notificationSettings.specificStaffMembers", "name email role")
    .populate("notificationSettings.personInCharge", "name email role")
    .sort({ createdAt: -1 })
    .lean();

  const channelIds = channels.map((channel) => channel._id);
  const [campaignCounts, candidateCounts] = await Promise.all([
    Campaign.aggregate([
      { $match: { recruitmentChannelId: { $in: channelIds } } },
      { $group: { _id: "$recruitmentChannelId", count: { $sum: 1 } } },
    ]),
    User.aggregate([
      { $match: { recruitmentChannelId: { $in: channelIds } } },
      { $group: { _id: "$recruitmentChannelId", count: { $sum: 1 } } },
    ]),
  ]);

  const campaignCountMap = new Map(campaignCounts.map((item) => [String(item._id), item.count]));
  const candidateCountMap = new Map(candidateCounts.map((item) => [String(item._id), item.count]));

  res.json({
    success: true,
    data: channels.map((channel) => ({
      ...channel,
      connectedCampaigns: campaignCountMap.get(String(channel._id)) || 0,
      candidateSubmissions: candidateCountMap.get(String(channel._id)) || 0,
    })),
  });
});

const getRecruitmentChannelMeta = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const staffMembers = await AdminUser.find(buildStaffFilter(scope))
    .select("name email role")
    .sort({ name: 1 })
    .lean();

  res.json({
    success: true,
    data: {
      statuses: CHANNEL_STATUSES,
      formTypes: CHANNEL_FORM_TYPES,
      languages: CHANNEL_LANGUAGES,
      staffRoleOptions: STAFF_ROLE_OPTIONS,
      presetFields: PRESET_FIELDS,
      staffMembers,
    },
  });
});

const createRecruitmentChannel = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const payload = normalizeChannelPayload(req.body || {});

  if (!payload.formName) {
    return res.status(400).json({ message: "Form name is required" });
  }

  const channel = await RecruitmentChannel.create({
    ...payload,
    teamAdmin: scope.managerId,
    ownerAdmin: scope.actorId,
  });

  const populated = await RecruitmentChannel.findById(channel._id)
    .populate("ownerAdmin", "name email role")
    .populate("responsiblePerson", "name email role")
    .populate("notificationSettings.specificStaffMembers", "name email role")
    .populate("notificationSettings.personInCharge", "name email role")
    .lean();

  res.status(201).json({ success: true, data: populated });
});

const updateRecruitmentChannel = asyncHandler(async (req, res) => {
  const channel = await RecruitmentChannel.findOne({
    _id: req.params.id,
    ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin"),
  });

  if (!channel) {
    return res.status(404).json({ message: "Recruitment channel not found" });
  }

  const payload = normalizeChannelPayload(req.body || {});
  if (!payload.formName) {
    return res.status(400).json({ message: "Form name is required" });
  }

  channel.formName = payload.formName;
  channel.formType = payload.formType;
  channel.status = payload.status;
  channel.language = payload.language;
  channel.submitButtonText = payload.submitButtonText;
  channel.successMessage = payload.successMessage;
  channel.responsiblePerson = payload.responsiblePerson || null;
  channel.notificationSettings = payload.notificationSettings;
  channel.formSchema = payload.formSchema;

  await channel.save();

  const populated = await RecruitmentChannel.findById(channel._id)
    .populate("ownerAdmin", "name email role")
    .populate("responsiblePerson", "name email role")
    .populate("notificationSettings.specificStaffMembers", "name email role")
    .populate("notificationSettings.personInCharge", "name email role")
    .lean();

  res.json({ success: true, data: populated });
});

const deleteRecruitmentChannel = asyncHandler(async (req, res) => {
  const channel = await RecruitmentChannel.findOneAndDelete({
    _id: req.params.id,
    ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin"),
  });

  if (!channel) {
    return res.status(404).json({ message: "Recruitment channel not found" });
  }

  await Promise.all([
    Campaign.updateMany(
      { recruitmentChannelId: channel._id },
      {
        $set: {
          recruitmentChannelId: null,
          recruitmentChannel: channel.formName,
        },
      }
    ),
    User.updateMany(
      { recruitmentChannelId: channel._id },
      {
        $set: {
          recruitmentChannelId: null,
          recruitmentChannelName: channel.formName,
        },
      }
    ),
  ]);

  res.json({ success: true, message: "Recruitment channel deleted successfully" });
});

module.exports = {
  listRecruitmentChannels,
  getRecruitmentChannelMeta,
  createRecruitmentChannel,
  updateRecruitmentChannel,
  deleteRecruitmentChannel,
};


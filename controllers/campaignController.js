const asyncHandler = require("express-async-handler");
const Campaign = require("../models/Campaign");
const RecruitmentChannel = require("../models/RecruitmentChannel");
const RecruitmentSettings = require("../models/RecruitmentSettings");
const { getSalesScope, buildOwnedFilter } = require("../utils/salesScope");

const toNumOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeRequirements = (requirements = {}) => ({
  ageFrom: toNumOrNull(requirements.ageFrom),
  ageTo: toNumOrNull(requirements.ageTo),
  gender: requirements.gender || "None",
  height: {
    operator: requirements.height?.operator || ">=",
    value: toNumOrNull(requirements.height?.value),
  },
  weight: {
    operator: requirements.weight?.operator || ">=",
    value: toNumOrNull(requirements.weight?.value),
  },
  literacy: requirements.literacy || "",
  notes: requirements.notes || "",
});

const listCampaigns = asyncHandler(async (req, res) => {
  const campaigns = await Campaign.find(buildOwnedFilter(req, "ownerAdmin", "teamAdmin"))
    .populate("ownerAdmin", "name email role")
    .populate("recruitmentChannelId", "formName formType status")
    .sort({ createdAt: -1 })
    .lean();

  res.json({ success: true, data: campaigns });
});

const createCampaign = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const body = req.body || {};

  if (!body.campaignCode || !body.campaignName) {
    return res.status(400).json({ message: "Campaign code and campaign name are required" });
  }

  let recruitmentChannelId = null;
  let recruitmentChannel = body.recruitmentChannel || "None";
  if (body.recruitmentChannelId) {
    const channel = await RecruitmentChannel.findOne({
      _id: body.recruitmentChannelId,
      ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin"),
    }).select("_id formName");

    if (!channel) {
      return res.status(400).json({ message: "Selected recruitment channel is not available" });
    }

    recruitmentChannelId = channel._id;
    recruitmentChannel = channel.formName;
  }

  const settings = await RecruitmentSettings.findOne({ teamAdmin: scope.managerId }).lean();
  const selectedJobPosition = body.jobPositionId
    ? (settings?.jobPositions || []).find((item) => String(item._id) === String(body.jobPositionId))
    : null;

  const campaign = await Campaign.create({
    teamAdmin: scope.managerId,
    ownerAdmin: scope.actorId,
    campaignCode: body.campaignCode,
    campaignName: body.campaignName,
    recruitmentChannelId,
    recruitmentChannel,
    recruitmentChannelValue: body.recruitmentChannelValue || "",
    jobPositionId: selectedJobPosition?._id || null,
    jobPosition: selectedJobPosition?.jobPosition || body.jobPosition || "None",
    industryName: body.industryName || selectedJobPosition?.industryName || "None",
    companyName: body.companyName || "None",
    jobCategory: body.jobCategory || "None",
    quantityToRecruit: Number(body.quantityToRecruit || 0),
    status: body.status || "Draft",
    candidateRequirements: normalizeRequirements(body.candidateRequirements),
  });

  const populated = await Campaign.findById(campaign._id)
    .populate("ownerAdmin", "name email role")
    .populate("recruitmentChannelId", "formName formType status")
    .lean();
  res.status(201).json({ success: true, data: populated });
});

const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findOne({ _id: req.params.id, ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin") });
  if (!campaign) return res.status(404).json({ message: "Campaign not found" });

  const body = req.body || {};
  if (body.campaignCode !== undefined) campaign.campaignCode = body.campaignCode;
  if (body.campaignName !== undefined) campaign.campaignName = body.campaignName;
  const settings = await RecruitmentSettings.findOne({ teamAdmin: campaign.teamAdmin }).lean();
  const selectedJobPosition = body.jobPositionId
    ? (settings?.jobPositions || []).find((item) => String(item._id) === String(body.jobPositionId))
    : null;
  if (body.recruitmentChannelId !== undefined) {
    if (!body.recruitmentChannelId) {
      campaign.recruitmentChannelId = null;
      campaign.recruitmentChannel = body.recruitmentChannel || "None";
    } else {
      const channel = await RecruitmentChannel.findOne({
        _id: body.recruitmentChannelId,
        ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin"),
      }).select("_id formName");

      if (!channel) {
        return res.status(400).json({ message: "Selected recruitment channel is not available" });
      }

      campaign.recruitmentChannelId = channel._id;
      campaign.recruitmentChannel = channel.formName;
    }
  } else if (body.recruitmentChannel !== undefined) {
    campaign.recruitmentChannel = body.recruitmentChannel;
  }
  if (body.recruitmentChannelValue !== undefined) campaign.recruitmentChannelValue = body.recruitmentChannelValue;
  if (body.jobPositionId !== undefined) {
    campaign.jobPositionId = selectedJobPosition?._id || null;
    campaign.jobPosition = selectedJobPosition?.jobPosition || body.jobPosition || "None";
  } else if (body.jobPosition !== undefined) {
    campaign.jobPosition = body.jobPosition;
  }
  if (body.industryName !== undefined) campaign.industryName = body.industryName || selectedJobPosition?.industryName || "None";
  if (body.companyName !== undefined) campaign.companyName = body.companyName || "None";
  if (body.jobCategory !== undefined) campaign.jobCategory = body.jobCategory;
  if (body.quantityToRecruit !== undefined) campaign.quantityToRecruit = Number(body.quantityToRecruit || 0);
  if (body.status !== undefined) campaign.status = body.status;
  if (body.candidateRequirements !== undefined) {
    campaign.candidateRequirements = normalizeRequirements(body.candidateRequirements);
  }

  await campaign.save();
  const populated = await Campaign.findById(campaign._id)
    .populate("ownerAdmin", "name email role")
    .populate("recruitmentChannelId", "formName formType status")
    .lean();
  res.json({ success: true, data: populated });
});

const deleteCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin") });
  if (!campaign) return res.status(404).json({ message: "Campaign not found" });
  res.json({ success: true, message: "Campaign deleted successfully" });
});

module.exports = {
  listCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
};

const asyncHandler = require("express-async-handler");
const RecruitmentSettings = require("../models/RecruitmentSettings");
const { getSalesScope } = require("../utils/salesScope");

const SECTION_MAP = {
  jobPositions: "jobPositions",
  evaluationCriteria: "evaluationCriteria",
  evaluationForms: "evaluationForms",
  onboardingProcesses: "onboardingProcesses",
  skills: "skills",
  companies: "companies",
  industries: "industries",
};

const ensureSettingsDoc = async (req) => {
  const scope = getSalesScope(req);

  let settings = await RecruitmentSettings.findOne({ teamAdmin: scope.managerId });
  if (!settings) {
    settings = await RecruitmentSettings.create({
      teamAdmin: scope.managerId,
      ownerAdmin: scope.actorId,
    });
  }

  return settings;
};

const normalizeSectionItem = (section, body = {}) => {
  switch (section) {
    case "jobPositions":
      return {
        jobPosition: String(body.jobPosition || "").trim(),
        skillNames: Array.isArray(body.skillNames) ? body.skillNames.filter(Boolean) : [],
        industryName: String(body.industryName || "").trim(),
        description: String(body.description || "").trim(),
      };
    case "evaluationCriteria":
      return {
        criteriaType: String(body.criteriaType || "None").trim() || "None",
        criteriaName: String(body.criteriaName || "").trim(),
        description: String(body.description || "").trim(),
        scores: [1, 2, 3, 4, 5].map((score) => ({
          score,
          description: String(body.scores?.find?.((item) => Number(item.score) === score)?.description || body.scores?.[score - 1]?.description || "").trim(),
        })),
      };
    case "evaluationForms":
      return {
        formName: String(body.formName || "").trim(),
        jobPositionId: body.jobPositionId || null,
        groupCriteria: String(body.groupCriteria || "None").trim() || "None",
        criteriaItems: Array.isArray(body.criteriaItems)
          ? body.criteriaItems
              .filter((item) => item.criteriaId)
              .map((item) => ({
                criteriaId: item.criteriaId,
                proportion: Number(item.proportion || 0),
              }))
          : [],
      };
    case "onboardingProcesses":
      return {
        order: Number(body.order || 1),
        sendTo: String(body.sendTo || "").trim(),
        subject: String(body.subject || "").trim(),
        content: String(body.content || "").trim(),
        attachmentName: String(body.attachmentName || "").trim(),
      };
    case "skills":
      return {
        skillName: String(body.skillName || "").trim(),
      };
    case "companies":
      return {
        companyName: String(body.companyName || "").trim(),
        companyAddress: String(body.companyAddress || "").trim(),
        companyIndustry: String(body.companyIndustry || "").trim(),
        companyImages: Array.isArray(body.companyImages) ? body.companyImages.filter(Boolean) : [],
      };
    case "industries":
      return {
        industryName: String(body.industryName || "").trim(),
      };
    default:
      return body;
  }
};

const validateSectionItem = (section, item) => {
  switch (section) {
    case "jobPositions":
      if (!item.jobPosition) return "Job position is required";
      return null;
    case "evaluationCriteria":
      if (!item.criteriaName) return "Criteria name is required";
      return null;
    case "evaluationForms":
      if (!item.formName) return "Form name is required";
      if (!item.criteriaItems.length) return "At least one evaluation criterion is required";
      return null;
    case "onboardingProcesses":
      if (!item.order || !item.sendTo || !item.subject) return "Order, send to, and subject are required";
      return null;
    case "skills":
      if (!item.skillName) return "Skill name is required";
      return null;
    case "companies":
      if (!item.companyName || !item.companyAddress) return "Company name and address are required";
      return null;
    case "industries":
      if (!item.industryName) return "Industry name is required";
      return null;
    default:
      return "Invalid section";
  }
};

const serializeSettings = (settings) => {
  const plain = settings.toObject();
  const criteriaMap = new Map((plain.evaluationCriteria || []).map((item) => [String(item._id), item]));
  const jobPositionMap = new Map((plain.jobPositions || []).map((item) => [String(item._id), item]));

  return {
    ...plain,
    evaluationForms: (plain.evaluationForms || []).map((form) => ({
      ...form,
      jobPosition: form.jobPositionId ? jobPositionMap.get(String(form.jobPositionId)) || null : null,
      criteriaItems: (form.criteriaItems || []).map((item) => ({
        ...item,
        criteria: criteriaMap.get(String(item.criteriaId)) || null,
      })),
    })),
  };
};

const getRecruitmentSettings = asyncHandler(async (req, res) => {
  const settings = await ensureSettingsDoc(req);
  res.json({ success: true, data: serializeSettings(settings) });
});

const createSectionItem = asyncHandler(async (req, res) => {
  const section = SECTION_MAP[req.params.section];
  if (!section) {
    return res.status(400).json({ message: "Invalid section" });
  }

  const settings = await ensureSettingsDoc(req);
  const item = normalizeSectionItem(section, req.body || {});
  const error = validateSectionItem(section, item);
  if (error) {
    return res.status(400).json({ message: error });
  }

  settings[section].push(item);
  await settings.save();

  res.status(201).json({ success: true, data: serializeSettings(settings) });
});

const updateSectionItem = asyncHandler(async (req, res) => {
  const section = SECTION_MAP[req.params.section];
  if (!section) {
    return res.status(400).json({ message: "Invalid section" });
  }

  const settings = await ensureSettingsDoc(req);
  const item = settings[section].id(req.params.itemId);
  if (!item) {
    return res.status(404).json({ message: "Item not found" });
  }

  const normalized = normalizeSectionItem(section, req.body || {});
  const error = validateSectionItem(section, normalized);
  if (error) {
    return res.status(400).json({ message: error });
  }

  Object.assign(item, normalized);
  await settings.save();

  res.json({ success: true, data: serializeSettings(settings) });
});

const deleteSectionItem = asyncHandler(async (req, res) => {
  const section = SECTION_MAP[req.params.section];
  if (!section) {
    return res.status(400).json({ message: "Invalid section" });
  }

  const settings = await ensureSettingsDoc(req);
  const item = settings[section].id(req.params.itemId);
  if (!item) {
    return res.status(404).json({ message: "Item not found" });
  }

  item.deleteOne();
  await settings.save();

  res.json({ success: true, data: serializeSettings(settings) });
});

const updateOtherSettings = asyncHandler(async (req, res) => {
  const settings = await ensureSettingsDoc(req);
  settings.otherSettings.showRecruitmentPlan = req.body?.showRecruitmentPlan !== false;
  await settings.save();
  res.json({ success: true, data: serializeSettings(settings) });
});

module.exports = {
  getRecruitmentSettings,
  createSectionItem,
  updateSectionItem,
  deleteSectionItem,
  updateOtherSettings,
};

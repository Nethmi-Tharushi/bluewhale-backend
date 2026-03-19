const mongoose = require("mongoose");

const scoreDescriptionSchema = new mongoose.Schema(
  {
    score: { type: Number, required: true, min: 1, max: 5 },
    description: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const evaluationCriteriaSchema = new mongoose.Schema(
  {
    criteriaType: { type: String, default: "None", trim: true },
    criteriaName: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    scores: {
      type: [scoreDescriptionSchema],
      default: () =>
        [1, 2, 3, 4, 5].map((score) => ({
          score,
          description: "",
        })),
    },
  },
  { _id: true }
);

const evaluationFormItemSchema = new mongoose.Schema(
  {
    criteriaId: { type: mongoose.Schema.Types.ObjectId, required: true },
    proportion: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false }
);

const evaluationFormSchema = new mongoose.Schema(
  {
    formName: { type: String, required: true, trim: true },
    jobPositionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    groupCriteria: { type: String, default: "None", trim: true },
    criteriaItems: { type: [evaluationFormItemSchema], default: [] },
  },
  { _id: true }
);

const onboardingStepSchema = new mongoose.Schema(
  {
    order: { type: Number, required: true, min: 1 },
    sendTo: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    content: { type: String, default: "", trim: true },
    attachmentName: { type: String, default: "", trim: true },
  },
  { _id: true }
);

const skillSchema = new mongoose.Schema(
  {
    skillName: { type: String, required: true, trim: true },
  },
  { _id: true }
);

const industrySchema = new mongoose.Schema(
  {
    industryName: { type: String, required: true, trim: true },
  },
  { _id: true }
);

const companySchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true },
    companyAddress: { type: String, required: true, trim: true },
    companyIndustry: { type: String, default: "", trim: true },
    companyImages: { type: [String], default: [] },
  },
  { _id: true }
);

const jobPositionSchema = new mongoose.Schema(
  {
    jobPosition: { type: String, required: true, trim: true },
    skillNames: { type: [String], default: [] },
    industryName: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
  },
  { _id: true }
);

const recruitmentSettingsSchema = new mongoose.Schema(
  {
    teamAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      unique: true,
      index: true,
    },
    ownerAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },
    jobPositions: { type: [jobPositionSchema], default: [] },
    evaluationCriteria: { type: [evaluationCriteriaSchema], default: [] },
    evaluationForms: { type: [evaluationFormSchema], default: [] },
    onboardingProcesses: { type: [onboardingStepSchema], default: [] },
    skills: { type: [skillSchema], default: [] },
    companies: { type: [companySchema], default: [] },
    industries: { type: [industrySchema], default: [] },
    otherSettings: {
      showRecruitmentPlan: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RecruitmentSettings", recruitmentSettingsSchema);

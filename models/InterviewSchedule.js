const mongoose = require("mongoose");

const scheduledCandidateSchema = new mongoose.Schema(
  {
    candidateId: {
      type: String,
      required: true,
      trim: true,
    },
    candidateType: {
      type: String,
      enum: ["B2C", "B2B"],
      default: "B2C",
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      default: "",
      trim: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    agentId: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
);

const evaluationCriteriaScoreSchema = new mongoose.Schema(
  {
    criteriaId: { type: String, required: true, trim: true },
    criteriaName: { type: String, required: true, trim: true },
    criteriaType: { type: String, default: "None", trim: true },
    proportion: { type: Number, default: 0, min: 0, max: 100 },
    score: { type: Number, default: 0, min: 0, max: 5 },
    maxScore: { type: Number, default: 5, min: 1 },
    scoreDescription: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const candidateEvaluationSchema = new mongoose.Schema(
  {
    candidateId: { type: String, required: true, trim: true },
    candidateName: { type: String, required: true, trim: true },
    recommendation: {
      type: String,
      enum: ["Pending", "Recommended", "Hold", "Rejected"],
      default: "Pending",
    },
    notes: { type: String, default: "", trim: true },
    percentage: { type: Number, default: 0, min: 0 },
    totalScore: { type: Number, default: 0, min: 0 },
    maxScore: { type: Number, default: 0, min: 0 },
    totalWeight: { type: Number, default: 0, min: 0 },
    criteriaScores: { type: [evaluationCriteriaScoreSchema], default: [] },
    evaluatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },
    evaluatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const interviewScheduleSchema = new mongoose.Schema(
  {
    teamAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    ownerAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      default: null,
    },
    scheduleName: {
      type: String,
      required: true,
      trim: true,
    },
    position: {
      type: String,
      default: "None",
      trim: true,
    },
    interviewDate: {
      type: Date,
      required: true,
    },
    fromHour: {
      type: String,
      required: true,
      trim: true,
    },
    toHour: {
      type: String,
      required: true,
      trim: true,
    },
    interviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },
    evaluationFormId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    evaluationFormName: {
      type: String,
      default: "",
      trim: true,
    },
    evaluationFormSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    candidates: {
      type: [scheduledCandidateSchema],
      default: [],
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: "At least one candidate is required",
      },
    },
    status: {
      type: String,
      enum: ["Scheduled", "Completed", "Canceled"],
      default: "Scheduled",
      index: true,
    },
    evaluations: {
      type: [candidateEvaluationSchema],
      default: [],
    },
  },
  { timestamps: true }
);

interviewScheduleSchema.index({ teamAdmin: 1, ownerAdmin: 1, interviewDate: -1 });

module.exports = mongoose.model("InterviewSchedule", interviewScheduleSchema);

const mongoose = require("mongoose");

const stageHistorySchema = new mongoose.Schema(
  {
    stage: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    note: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const interviewSchema = new mongoose.Schema(
  {
    roundNumber: {
      type: Number,
      enum: [1, 2],
      required: true,
    },
    stageLabel: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    status: {
      type: String,
      enum: ["scheduled", "completed", "cancelled", "no_show"],
      default: "scheduled",
      index: true,
    },
    scheduledAt: {
      type: Date,
      required: true,
      index: true,
    },
    interviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
    locationType: {
      type: String,
      enum: ["Zoom", "Google Meet", "Microsoft Teams", "Phone", "Physical"],
      default: "Google Meet",
    },
    meetingLink: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    location: {
      type: String,
      default: "",
      trim: true,
      maxlength: 400,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 4000,
    },
    feedback: {
      type: String,
      default: "",
      trim: true,
      maxlength: 4000,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  { timestamps: true }
);

const hrRecruitmentCandidateSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HrRecruitmentCampaign",
      required: true,
      index: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    email: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
      maxlength: 180,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
      maxlength: 60,
    },
    currentLocation: {
      type: String,
      default: "",
      trim: true,
      maxlength: 160,
    },
    source: {
      type: String,
      default: "Manual",
      trim: true,
      maxlength: 120,
    },
    yearsOfExperience: {
      type: Number,
      default: 0,
      min: 0,
      max: 60,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 4000,
    },
    cvUrl: {
      type: String,
      default: "",
      trim: true,
    },
    cvFileName: {
      type: String,
      default: "",
      trim: true,
      maxlength: 240,
    },
    cvCloudinaryId: {
      type: String,
      default: "",
      trim: true,
    },
    cvMimeType: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    pipelineStage: {
      type: String,
      default: "Applied",
      trim: true,
      maxlength: 120,
      index: true,
    },
    candidateStatus: {
      type: String,
      enum: ["active", "hired", "rejected", "withdrawn"],
      default: "active",
      index: true,
    },
    interviews: {
      type: [interviewSchema],
      default: [],
    },
    stageHistory: {
      type: [stageHistorySchema],
      default: [],
    },
    linkedStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
    provisionedAdminRole: {
      type: String,
      default: "",
      trim: true,
      maxlength: 80,
    },
    accountProvisionedAt: {
      type: Date,
      default: null,
    },
    welcomeEmailSentAt: {
      type: Date,
      default: null,
    },
    hiredAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

hrRecruitmentCandidateSchema.index({ campaignId: 1, createdAt: -1 });
hrRecruitmentCandidateSchema.index({ fullName: 1, email: 1 });

module.exports = mongoose.model("HrRecruitmentCandidate", hrRecruitmentCandidateSchema);

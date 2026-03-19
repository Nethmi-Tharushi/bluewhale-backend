const mongoose = require("mongoose");

const comparatorSchema = new mongoose.Schema(
  {
    operator: {
      type: String,
      enum: [">=", "<=", "=", ">", "<"],
      default: ">=",
    },
    value: {
      type: Number,
      default: null,
    },
  },
  { _id: false }
);

const campaignSchema = new mongoose.Schema(
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
    campaignCode: { type: String, required: true, trim: true, index: true },
    campaignName: { type: String, required: true, trim: true },
    recruitmentChannelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RecruitmentChannel",
      default: null,
      index: true,
    },
    recruitmentChannel: { type: String, default: "None" },
    recruitmentChannelValue: { type: String, default: "" },
    jobPositionId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    jobPosition: { type: String, default: "None" },
    industryName: { type: String, default: "None" },
    companyName: { type: String, default: "None" },
    jobCategory: { type: String, default: "None" },
    quantityToRecruit: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["Draft", "Active", "Paused", "Completed", "Closed"],
      default: "Draft",
      index: true,
    },
    candidateRequirements: {
      ageFrom: { type: Number, default: null, min: 0 },
      ageTo: { type: Number, default: null, min: 0 },
      gender: {
        type: String,
        enum: ["None", "Male", "Female", "Other", "Prefer not to say"],
        default: "None",
      },
      height: {
        type: comparatorSchema,
        default: () => ({ operator: ">=", value: null }),
      },
      weight: {
        type: comparatorSchema,
        default: () => ({ operator: ">=", value: null }),
      },
      literacy: { type: String, default: "" },
      notes: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

campaignSchema.index({ teamAdmin: 1, ownerAdmin: 1, createdAt: -1 });

module.exports = mongoose.model("Campaign", campaignSchema);

const mongoose = require("mongoose");

const hrRecruitmentCampaignSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    positionRole: {
      type: String,
      enum: ["SalesAdmin", "SalesStaff"],
      required: true,
      index: true,
    },
    branch: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    locationLabel: {
      type: String,
      default: "",
      trim: true,
      maxlength: 160,
    },
    workMode: {
      type: String,
      enum: ["Onsite", "Remote", "Hybrid"],
      default: "Onsite",
    },
    openings: {
      type: Number,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: ["draft", "open", "on_hold", "closed", "filled"],
      default: "open",
      index: true,
    },
    pipelineStages: {
      type: [String],
      default: ["Applied", "CV Review", "First Interview", "Second Interview", "Offered", "Hired"],
    },
    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 4000,
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

hrRecruitmentCampaignSchema.index({ positionRole: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("HrRecruitmentCampaign", hrRecruitmentCampaignSchema);

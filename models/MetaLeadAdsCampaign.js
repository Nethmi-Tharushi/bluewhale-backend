const mongoose = require("mongoose");

const metaLeadAdsCampaignSchema = new mongoose.Schema(
  {
    campaignId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    adAccountId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    adAccountName: {
      type: String,
      default: "",
      trim: true,
    },
    businessId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    businessName: {
      type: String,
      default: "",
      trim: true,
    },
    pageId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    pageName: {
      type: String,
      default: "",
      trim: true,
    },
    campaignName: {
      type: String,
      default: "",
      trim: true,
    },
    objective: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    configuredStatus: {
      type: String,
      default: "",
      trim: true,
    },
    effectiveStatus: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    status: {
      type: String,
      default: "inactive",
      trim: true,
      index: true,
    },
    isLeadGeneration: {
      type: Boolean,
      default: false,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },
    crmSynchronized: {
      type: Boolean,
      default: false,
      index: true,
    },
    syncedAt: {
      type: Date,
      default: null,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    startTime: {
      type: Date,
      default: null,
    },
    stopTime: {
      type: Date,
      default: null,
    },
    sourcePayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

metaLeadAdsCampaignSchema.index({ isLeadGeneration: 1, isActive: 1, updatedAt: -1 });

module.exports = mongoose.model("MetaLeadAdsCampaign", metaLeadAdsCampaignSchema);

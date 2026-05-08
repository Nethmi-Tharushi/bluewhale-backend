const mongoose = require("mongoose");

const metaLeadAdsSubmissionSchema = new mongoose.Schema(
  {
    metaLeadId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    formId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    formName: {
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
    campaignId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    status: {
      type: String,
      default: "received",
      trim: true,
      index: true,
    },
    crmLeadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
      index: true,
    },
    teamAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    ownerAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    sourceLabel: {
      type: String,
      default: "",
      trim: true,
    },
    attempts: {
      type: Number,
      default: 1,
      min: 0,
    },
    lastEventSource: {
      type: String,
      default: "webhook",
      trim: true,
      index: true,
    },
    eventKeys: {
      type: [String],
      default: [],
    },
    fieldData: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    mappedLeadFields: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    sourceMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    rawPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    errorMessage: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

metaLeadAdsSubmissionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("MetaLeadAdsSubmission", metaLeadAdsSubmissionSchema);

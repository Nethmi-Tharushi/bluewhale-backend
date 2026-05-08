const mongoose = require("mongoose");

const metaLeadAdsEventLogSchema = new mongoose.Schema(
  {
    eventKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    metaLeadId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    pageId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    formId: {
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
    formName: {
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
    campaignName: {
      type: String,
      default: "",
      trim: true,
    },
    source: {
      type: String,
      default: "webhook",
      trim: true,
      index: true,
    },
    status: {
      type: String,
      default: "received",
      trim: true,
      index: true,
    },
    deliveryCount: {
      type: Number,
      default: 1,
      min: 0,
    },
    attempts: {
      type: Number,
      default: 1,
      min: 0,
    },
    retryable: {
      type: Boolean,
      default: false,
      index: true,
    },
    nextRetryAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastAttemptAt: {
      type: Date,
      default: Date.now,
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
    signatureVerified: {
      type: Boolean,
      default: false,
    },
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MetaLeadAdsSubmission",
      default: null,
      index: true,
    },
    headers: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    diagnostics: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    title: {
      type: String,
      default: "",
      trim: true,
    },
    summary: {
      type: String,
      default: "",
      trim: true,
    },
    errorCode: {
      type: String,
      default: "",
      trim: true,
    },
    errorMessage: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

metaLeadAdsEventLogSchema.index({ status: 1, receivedAt: -1 });

module.exports = mongoose.model("MetaLeadAdsEventLog", metaLeadAdsEventLogSchema);

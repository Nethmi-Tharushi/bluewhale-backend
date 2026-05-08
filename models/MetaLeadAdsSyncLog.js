const mongoose = require("mongoose");

const metaLeadAdsSyncLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    source: {
      type: String,
      default: "manual_sync",
      trim: true,
      index: true,
    },
    runType: {
      type: String,
      default: "lead_sync",
      trim: true,
      index: true,
    },
    status: {
      type: String,
      default: "success",
      trim: true,
      index: true,
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
    pageName: {
      type: String,
      default: "",
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
    occurredAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    diagnostics: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
  },
  { timestamps: true }
);

metaLeadAdsSyncLogSchema.index({ source: 1, occurredAt: -1 });
metaLeadAdsSyncLogSchema.index({ status: 1, occurredAt: -1 });

module.exports = mongoose.model("MetaLeadAdsSyncLog", metaLeadAdsSyncLogSchema);

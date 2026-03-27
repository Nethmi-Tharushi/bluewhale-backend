const mongoose = require("mongoose");

const whatsAppTemplateHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      default: "PENDING",
      trim: true,
    },
    rawStatus: {
      type: String,
      default: "",
      trim: true,
    },
    rejectedReason: {
      type: String,
      default: "",
      trim: true,
    },
    source: {
      type: String,
      enum: ["create", "meta_sync", "resubmit", "manual", "delete"],
      default: "meta_sync",
      trim: true,
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { _id: false }
);

const whatsAppTemplateSchema = new mongoose.Schema(
  {
    templateId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    category: {
      type: String,
      default: "",
      trim: true,
    },
    language: {
      type: String,
      default: "en_US",
      trim: true,
      index: true,
    },
    status: {
      type: String,
      default: "PENDING",
      trim: true,
      index: true,
    },
    rawStatus: {
      type: String,
      default: "",
      trim: true,
    },
    rejectedReason: {
      type: String,
      default: "",
      trim: true,
    },
    components: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    headerFormat: {
      type: String,
      enum: ["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"],
      default: "NONE",
      trim: true,
    },
    allowCategoryChange: {
      type: Boolean,
      default: true,
    },
    qualityScore: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
    metaPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
    statusHistory: {
      type: [whatsAppTemplateHistorySchema],
      default: [],
    },
  },
  { timestamps: true }
);

whatsAppTemplateSchema.index({ name: 1, language: 1 });

module.exports = mongoose.model("WhatsAppTemplate", whatsAppTemplateSchema);

const mongoose = require("mongoose");

const WHATSAPP_CAMPAIGN_STATUS_OPTIONS = Object.freeze([
  "Draft",
  "Scheduled",
  "Running",
  "Sent",
  "Failed",
  "Paused",
  "Cancelled",
]);
const WHATSAPP_CAMPAIGN_TYPE_OPTIONS = Object.freeze([
  "Broadcast",
  "Promotional",
  "Reminder",
  "Follow-up",
  "Custom",
]);
const WHATSAPP_CAMPAIGN_CHANNEL_OPTIONS = Object.freeze([
  "WhatsApp",
  "Instagram",
  "Both",
]);
const WHATSAPP_CAMPAIGN_SCHEDULE_TYPE_OPTIONS = Object.freeze([
  "draft",
  "send_now",
  "later",
]);
const WHATSAPP_CAMPAIGN_CONTENT_MODE_OPTIONS = Object.freeze([
  "template",
  "compose",
]);
const WHATSAPP_CAMPAIGN_AUDIENCE_TYPE_OPTIONS = Object.freeze([
  "all_contacts",
  "segments",
  "manual",
]);

const campaignStatsSchema = new mongoose.Schema(
  {
    sent: {
      type: Number,
      default: 0,
      min: 0,
    },
    delivered: {
      type: Number,
      default: 0,
      min: 0,
    },
    read: {
      type: Number,
      default: 0,
      min: 0,
    },
    clicked: {
      type: Number,
      default: 0,
      min: 0,
    },
    failed: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

const whatsAppCampaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    type: {
      type: String,
      enum: WHATSAPP_CAMPAIGN_TYPE_OPTIONS,
      required: true,
      trim: true,
      index: true,
    },
    channel: {
      type: String,
      enum: WHATSAPP_CAMPAIGN_CHANNEL_OPTIONS,
      required: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: WHATSAPP_CAMPAIGN_STATUS_OPTIONS,
      default: "Draft",
      trim: true,
      index: true,
    },
    audienceType: {
      type: String,
      enum: WHATSAPP_CAMPAIGN_AUDIENCE_TYPE_OPTIONS,
      required: true,
      trim: true,
      index: true,
    },
    audienceSize: {
      type: Number,
      default: 0,
      min: 0,
    },
    segmentIds: {
      type: [String],
      default: [],
    },
    manualContactIds: {
      type: [String],
      default: [],
    },
    manualPhones: {
      type: [String],
      default: [],
    },
    templateId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    templateName: {
      type: String,
      default: "",
      trim: true,
    },
    contentMode: {
      type: String,
      enum: WHATSAPP_CAMPAIGN_CONTENT_MODE_OPTIONS,
      default: "compose",
      trim: true,
    },
    contentLabel: {
      type: String,
      default: "",
      trim: true,
    },
    messageTitle: {
      type: String,
      default: "",
      trim: true,
    },
    headerText: {
      type: String,
      default: "",
      trim: true,
    },
    bodyText: {
      type: String,
      default: "",
      trim: true,
    },
    ctaText: {
      type: String,
      default: "",
      trim: true,
    },
    ctaUrl: {
      type: String,
      default: "",
      trim: true,
    },
    quickReplies: {
      type: [String],
      default: [],
    },
    templateVariables: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    scheduleType: {
      type: String,
      enum: WHATSAPP_CAMPAIGN_SCHEDULE_TYPE_OPTIONS,
      default: "draft",
      trim: true,
      index: true,
    },
    scheduledAt: {
      type: Date,
      default: null,
      index: true,
    },
    timezone: {
      type: String,
      default: "Asia/Colombo",
      trim: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    batchEnabled: {
      type: Boolean,
      default: false,
    },
    skipInactiveContacts: {
      type: Boolean,
      default: false,
    },
    stopIfTemplateMissing: {
      type: Boolean,
      default: false,
    },
    stats: {
      type: campaignStatsSchema,
      default: () => ({}),
    },
    launchedAt: {
      type: Date,
      default: null,
    },
    launchedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    pausedAt: {
      type: Date,
      default: null,
    },
    resumedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

whatsAppCampaignSchema.index({ updatedAt: -1, _id: -1 });
whatsAppCampaignSchema.index({ status: 1, scheduleType: 1, updatedAt: -1 });
whatsAppCampaignSchema.index({ channel: 1, status: 1, updatedAt: -1 });

const WhatsAppCampaign = mongoose.model("WhatsAppCampaign", whatsAppCampaignSchema);

module.exports = WhatsAppCampaign;
module.exports.WHATSAPP_CAMPAIGN_STATUS_OPTIONS = WHATSAPP_CAMPAIGN_STATUS_OPTIONS;
module.exports.WHATSAPP_CAMPAIGN_TYPE_OPTIONS = WHATSAPP_CAMPAIGN_TYPE_OPTIONS;
module.exports.WHATSAPP_CAMPAIGN_CHANNEL_OPTIONS = WHATSAPP_CAMPAIGN_CHANNEL_OPTIONS;
module.exports.WHATSAPP_CAMPAIGN_SCHEDULE_TYPE_OPTIONS = WHATSAPP_CAMPAIGN_SCHEDULE_TYPE_OPTIONS;
module.exports.WHATSAPP_CAMPAIGN_CONTENT_MODE_OPTIONS = WHATSAPP_CAMPAIGN_CONTENT_MODE_OPTIONS;
module.exports.WHATSAPP_CAMPAIGN_AUDIENCE_TYPE_OPTIONS = WHATSAPP_CAMPAIGN_AUDIENCE_TYPE_OPTIONS;

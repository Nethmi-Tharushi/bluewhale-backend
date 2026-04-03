const mongoose = require("mongoose");

const WHATSAPP_CAMPAIGN_JOB_STATUS_OPTIONS = Object.freeze([
  "pending",
  "processing",
  "paused",
  "sent",
  "delivered",
  "read",
  "failed",
  "cancelled",
]);

const whatsAppCampaignJobSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppCampaign",
      required: true,
      index: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppContact",
      required: true,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppConversation",
      default: null,
      index: true,
    },
    audienceSource: {
      type: String,
      enum: ["all_contacts", "segments", "manual"],
      required: true,
      default: "manual",
      trim: true,
    },
    recipientPhone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    recipientName: {
      type: String,
      default: "",
      trim: true,
    },
    runAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: WHATSAPP_CAMPAIGN_JOB_STATUS_OPTIONS,
      default: "pending",
      index: true,
    },
    attemptCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    externalMessageId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppMessage",
      default: null,
      index: true,
    },
    resultSummary: {
      type: String,
      default: "",
      trim: true,
    },
    errorMessage: {
      type: String,
      default: "",
      trim: true,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    readAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

whatsAppCampaignJobSchema.index({ campaignId: 1, recipientPhone: 1 }, { unique: true, name: "campaign_recipient_unique" });
whatsAppCampaignJobSchema.index({ status: 1, runAt: 1, campaignId: 1 });

const WhatsAppCampaignJob = mongoose.model("WhatsAppCampaignJob", whatsAppCampaignJobSchema);

module.exports = WhatsAppCampaignJob;
module.exports.WHATSAPP_CAMPAIGN_JOB_STATUS_OPTIONS = WHATSAPP_CAMPAIGN_JOB_STATUS_OPTIONS;

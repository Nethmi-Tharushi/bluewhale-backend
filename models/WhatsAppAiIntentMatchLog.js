const mongoose = require("mongoose");

const STATUS_OPTIONS = Object.freeze(["matched", "no_match", "skipped", "failed"]);
const DESTINATION_TYPE_OPTIONS = Object.freeze(["quick_reply", "basic_automation", "form", "workflow", ""]);
const MATCH_MODE_OPTIONS = Object.freeze(["balanced", "precise", "aggressive"]);

const whatsAppAiIntentMatchLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppConversation",
      default: null,
      index: true,
    },
    messageId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    customerPhone: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    inboundText: {
      type: String,
      default: "",
      trim: true,
    },
    normalizedText: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: STATUS_OPTIONS,
      default: "skipped",
      trim: true,
      index: true,
    },
    matchedIntentLabel: {
      type: String,
      default: "",
      trim: true,
    },
    matchedDestinationType: {
      type: String,
      enum: DESTINATION_TYPE_OPTIONS,
      default: "",
      trim: true,
    },
    matchedDestinationId: {
      type: String,
      default: "",
      trim: true,
    },
    confidence: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    matchMode: {
      type: String,
      enum: MATCH_MODE_OPTIONS,
      default: "balanced",
      trim: true,
    },
    candidateCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    provider: {
      type: String,
      default: "lexical_fallback",
      trim: true,
    },
    charged: {
      type: Boolean,
      default: false,
    },
    chargedAmountMinor: {
      type: Number,
      default: 0,
      min: 0,
    },
    notes: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

whatsAppAiIntentMatchLogSchema.index({ createdAt: -1, _id: -1 });
whatsAppAiIntentMatchLogSchema.index({ conversationId: 1, createdAt: -1 });
whatsAppAiIntentMatchLogSchema.index({ messageId: 1, createdAt: -1 });

module.exports = mongoose.model("WhatsAppAiIntentMatchLog", whatsAppAiIntentMatchLogSchema);
module.exports.STATUS_OPTIONS = STATUS_OPTIONS;
module.exports.DESTINATION_TYPE_OPTIONS = DESTINATION_TYPE_OPTIONS;
module.exports.MATCH_MODE_OPTIONS = MATCH_MODE_OPTIONS;

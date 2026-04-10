const mongoose = require("mongoose");

const AGENT_TYPE_OPTIONS = Object.freeze(["sales_agent", "faq_responder", "lead_qualifier"]);
const DIRECTION_OPTIONS = Object.freeze(["inbound", "outbound"]);
const RESPONSE_SOURCE_OPTIONS = Object.freeze([
  "ai",
  "knowledge_base",
  "catalog",
  "qualification_flow",
  "handoff",
  "fallback",
]);

const whatsAppAiAgentLogSchema = new mongoose.Schema(
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
    agentType: {
      type: String,
      enum: AGENT_TYPE_OPTIONS,
      default: "sales_agent",
      trim: true,
      index: true,
    },
    direction: {
      type: String,
      enum: DIRECTION_OPTIONS,
      default: "inbound",
      trim: true,
      index: true,
    },
    messageText: {
      type: String,
      default: "",
      trim: true,
    },
    responseText: {
      type: String,
      default: "",
      trim: true,
    },
    responseSource: {
      type: String,
      enum: RESPONSE_SOURCE_OPTIONS,
      default: "fallback",
      trim: true,
      index: true,
    },
    confidence: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    leadCaptured: {
      type: Boolean,
      default: false,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
      index: true,
    },
    handoffTriggered: {
      type: Boolean,
      default: false,
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

whatsAppAiAgentLogSchema.index({ createdAt: -1, _id: -1 });

module.exports = mongoose.model("WhatsAppAiAgentLog", whatsAppAiAgentLogSchema);
module.exports.AGENT_TYPE_OPTIONS = AGENT_TYPE_OPTIONS;
module.exports.DIRECTION_OPTIONS = DIRECTION_OPTIONS;
module.exports.RESPONSE_SOURCE_OPTIONS = RESPONSE_SOURCE_OPTIONS;

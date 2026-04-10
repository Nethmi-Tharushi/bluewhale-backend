const mongoose = require("mongoose");

const ROLLOUT_STATUS_OPTIONS = Object.freeze(["draft", "interest_collected", "pilot", "live"]);
const AGENT_TYPE_OPTIONS = Object.freeze(["sales_agent", "faq_responder", "lead_qualifier"]);

const agentModeConfigSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: false,
    },
    handoffEnabled: {
      type: Boolean,
      default: true,
    },
    fallbackMessage: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
);

const salesAgentConfigSchema = new mongoose.Schema(
  {
    ...agentModeConfigSchema.obj,
    catalogEnabled: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const faqResponderConfigSchema = new mongoose.Schema(
  {
    ...agentModeConfigSchema.obj,
    knowledgeBaseEnabled: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const leadQualifierConfigSchema = new mongoose.Schema(
  {
    ...agentModeConfigSchema.obj,
    qualificationFields: {
      type: [String],
      default: [],
    },
    crmSyncTarget: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
);

const pricingConfigSchema = new mongoose.Schema(
  {
    currency: {
      type: String,
      default: "USD",
      trim: true,
      uppercase: true,
    },
    amount: {
      type: Number,
      default: 250,
      min: 0,
    },
    conversationQuota: {
      type: Number,
      default: 2000,
      min: 0,
    },
  },
  { _id: false }
);

const whatsAppAiAgentSettingsSchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      default: "default",
      unique: true,
      index: true,
      trim: true,
    },
    enabled: {
      type: Boolean,
      default: false,
    },
    rolloutStatus: {
      type: String,
      enum: ROLLOUT_STATUS_OPTIONS,
      default: "draft",
      trim: true,
    },
    defaultAgentType: {
      type: String,
      enum: AGENT_TYPE_OPTIONS,
      default: "sales_agent",
      trim: true,
    },
    webinarUrl: {
      type: String,
      default: "",
      trim: true,
    },
    interestFormEnabled: {
      type: Boolean,
      default: true,
    },
    pricing: {
      type: pricingConfigSchema,
      default: () => ({}),
    },
    salesAgent: {
      type: salesAgentConfigSchema,
      default: () => ({}),
    },
    faqResponder: {
      type: faqResponderConfigSchema,
      default: () => ({}),
    },
    leadQualifier: {
      type: leadQualifierConfigSchema,
      default: () => ({}),
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

module.exports = mongoose.model("WhatsAppAiAgentSettings", whatsAppAiAgentSettingsSchema);
module.exports.ROLLOUT_STATUS_OPTIONS = ROLLOUT_STATUS_OPTIONS;
module.exports.AGENT_TYPE_OPTIONS = AGENT_TYPE_OPTIONS;

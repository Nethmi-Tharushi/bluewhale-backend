const mongoose = require("mongoose");

const AGENT_TYPE_OPTIONS = Object.freeze(["sales_agent", "faq_responder", "lead_qualifier"]);
const INTEREST_STATUS_OPTIONS = Object.freeze(["new", "contacted", "qualified", "closed"]);

const whatsAppAiAgentInterestSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    companyName: {
      type: String,
      required: true,
      trim: true,
    },
    contactName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    whatsappNumber: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    preferredAgentTypes: {
      type: [String],
      enum: AGENT_TYPE_OPTIONS,
      default: [],
    },
    monthlyConversationVolume: {
      type: Number,
      default: 0,
      min: 0,
    },
    useCase: {
      type: String,
      default: "",
      trim: true,
    },
    catalogNeeded: {
      type: Boolean,
      default: false,
    },
    crmIntegrationNeeded: {
      type: Boolean,
      default: false,
    },
    webinarRequested: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: INTEREST_STATUS_OPTIONS,
      default: "new",
      trim: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

whatsAppAiAgentInterestSchema.index({ createdAt: -1, _id: -1 });

module.exports = mongoose.model("WhatsAppAiAgentInterest", whatsAppAiAgentInterestSchema);
module.exports.AGENT_TYPE_OPTIONS = AGENT_TYPE_OPTIONS;
module.exports.INTEREST_STATUS_OPTIONS = INTEREST_STATUS_OPTIONS;

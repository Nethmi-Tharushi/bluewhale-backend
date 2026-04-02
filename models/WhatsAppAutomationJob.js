const mongoose = require("mongoose");

const whatsAppAutomationJobSchema = new mongoose.Schema(
  {
    automationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppAutomation",
      required: true,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppConversation",
      required: true,
      index: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppContact",
      required: true,
      index: true,
    },
    inboundMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppMessage",
      default: null,
      index: true,
    },
    triggerType: {
      type: String,
      required: true,
      trim: true,
    },
    actionIndex: {
      type: Number,
      required: false,
      min: 0,
    },
    resumeNodeId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    action: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: {},
    },
    contextSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    runAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "cancelled"],
      default: "pending",
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
    processedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

whatsAppAutomationJobSchema.index(
  { automationId: 1, conversationId: 1, inboundMessageId: 1, actionIndex: 1, runAt: 1 },
  { name: "automation_job_lookup" }
);

module.exports = mongoose.model("WhatsAppAutomationJob", whatsAppAutomationJobSchema);

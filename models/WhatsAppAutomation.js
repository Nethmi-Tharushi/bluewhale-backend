const mongoose = require("mongoose");

const automationActionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["send_text", "send_template", "send_buttons", "send_list", "add_tag", "add_note", "set_status", "assign_agent"],
      required: true,
    },
    label: {
      type: String,
      default: "",
      trim: true,
    },
    delayMinutes: {
      type: Number,
      default: 0,
      min: 0,
      max: 10080,
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: true }
);

const workflowNodeSchema = new mongoose.Schema(
  {
    nodeId: {
      type: String,
      required: true,
      trim: true,
    },
    kind: {
      type: String,
      enum: ["trigger", "condition", "delay", "send_text", "send_template", "send_buttons", "send_list", "add_tag", "add_note", "set_status", "assign_agent"],
      required: true,
    },
    label: {
      type: String,
      default: "",
      trim: true,
    },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false }
);

const workflowEdgeSchema = new mongoose.Schema(
  {
    edgeId: {
      type: String,
      required: true,
      trim: true,
    },
    source: {
      type: String,
      required: true,
      trim: true,
    },
    target: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
);

const whatsAppAutomationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    triggerType: {
      type: String,
      enum: ["new_conversation", "any_inbound_message", "keyword_match"],
      required: true,
      index: true,
    },
    triggerConfig: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    actions: {
      type: [automationActionSchema],
      default: [],
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: "At least one automation action is required",
      },
    },
    builderMode: {
      type: String,
      enum: ["linear", "visual"],
      default: "linear",
    },
    workflowGraph: {
      nodes: {
        type: [workflowNodeSchema],
        default: [],
      },
      edges: {
        type: [workflowEdgeSchema],
        default: [],
      },
    },
    allowedRoles: {
      type: [String],
      default: ["MainAdmin", "SalesAdmin"],
    },
    assignedAgentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser",
      },
    ],
    lastTriggeredAt: {
      type: Date,
      default: null,
    },
    runCount: {
      type: Number,
      default: 0,
    },
    errorCount: {
      type: Number,
      default: 0,
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
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhatsAppAutomation", whatsAppAutomationSchema);

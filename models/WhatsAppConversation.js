const mongoose = require("mongoose");

const whatsAppConversationNoteSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: true,
      trim: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
    authorName: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    _id: true,
    timestamps: { createdAt: true, updatedAt: false },
  }
);

const whatsAppAutomationStatusSchema = new mongoose.Schema(
  {
    lastSentAt: {
      type: Date,
      default: null,
    },
    lastSentMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppMessage",
      default: null,
    },
  },
  { _id: false }
);

const whatsAppDelayedResponseStateSchema = new mongoose.Schema(
  {
    pendingSince: {
      type: Date,
      default: null,
    },
    dueAt: {
      type: Date,
      default: null,
    },
    pendingMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppMessage",
      default: null,
    },
    waitingForTeamReply: {
      type: Boolean,
      default: false,
    },
    lastSentAt: {
      type: Date,
      default: null,
    },
    lastSentMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppMessage",
      default: null,
    },
    lastSentForPendingMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppMessage",
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const whatsAppAutomationStateSchema = new mongoose.Schema(
  {
    lastCustomerMessageAt: {
      type: Date,
      default: null,
    },
    lastCustomerMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppMessage",
      default: null,
    },
    lastTeamReplyAt: {
      type: Date,
      default: null,
    },
    outOfOffice: {
      type: whatsAppAutomationStatusSchema,
      default: () => ({}),
    },
    welcome: {
      type: whatsAppAutomationStatusSchema,
      default: () => ({}),
    },
    delayedResponse: {
      type: whatsAppDelayedResponseStateSchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

const whatsAppConversationSchema = new mongoose.Schema(
  {
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppContact",
      required: true,
      index: true,
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    linkedLeadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "assigned", "closed"],
      default: "open",
      index: true,
    },
    channel: {
      type: String,
      default: "whatsapp",
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastIncomingAt: {
      type: Date,
      default: null,
    },
    lastOutgoingAt: {
      type: Date,
      default: null,
    },
    lastMessagePreview: {
      type: String,
      default: "",
    },
    unreadCount: {
      type: Number,
      default: 0,
    },
    assignmentMethod: {
      type: String,
      enum: ["round_robin", "manual", "unassigned"],
      default: "unassigned",
    },
    workflowStatus: {
      type: String,
      default: "",
      trim: true,
    },
    workflowContext: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    notes: [whatsAppConversationNoteSchema],
    assignmentHistory: [
      {
        agentId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "AdminUser",
          default: null,
        },
        assignedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "AdminUser",
          default: null,
        },
        method: {
          type: String,
          enum: ["round_robin", "manual", "system"],
          default: "system",
        },
        assignedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    automationState: {
      type: whatsAppAutomationStateSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

whatsAppConversationSchema.index({ contactId: 1, channel: 1 }, { unique: true });
whatsAppConversationSchema.index({
  "automationState.delayedResponse.waitingForTeamReply": 1,
  "automationState.delayedResponse.dueAt": 1,
});

module.exports = mongoose.model("WhatsAppConversation", whatsAppConversationSchema);

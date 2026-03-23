const mongoose = require("mongoose");

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
  },
  { timestamps: true }
);

whatsAppConversationSchema.index({ contactId: 1, channel: 1 }, { unique: true });

module.exports = mongoose.model("WhatsAppConversation", whatsAppConversationSchema);

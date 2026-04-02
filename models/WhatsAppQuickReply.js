const mongoose = require("mongoose");

const QUICK_REPLY_CATEGORIES = Object.freeze([
  "Greeting",
  "Follow-up",
  "Documents",
  "Consultation",
  "Payment",
  "Job Inquiry",
  "Visa Inquiry",
  "Closing",
  "General",
]);

const whatsAppQuickReplySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    shortcut: {
      type: String,
      default: null,
      trim: true,
    },
    category: {
      type: String,
      enum: QUICK_REPLY_CATEGORIES,
      default: "General",
      trim: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    usageCount: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },
    isPinned: {
      type: Boolean,
      default: false,
      index: true,
    },
    folder: {
      type: String,
      default: "General",
      trim: true,
      index: true,
    },
    lastUsedAt: {
      type: Date,
      default: null,
      index: true,
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

whatsAppQuickReplySchema.index({ updatedAt: -1 });
whatsAppQuickReplySchema.index({ isPinned: -1, updatedAt: -1 });
whatsAppQuickReplySchema.index(
  { shortcut: 1 },
  {
    unique: true,
    partialFilterExpression: {
      shortcut: {
        $type: "string",
        $gt: "",
      },
    },
  }
);

const WhatsAppQuickReply = mongoose.model("WhatsAppQuickReply", whatsAppQuickReplySchema);

module.exports = WhatsAppQuickReply;
module.exports.QUICK_REPLY_CATEGORIES = QUICK_REPLY_CATEGORIES;

const mongoose = require("mongoose");

const leadReminderSchema = new mongoose.Schema(
  {
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      default: "",
      trim: true,
    },
    remindAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Sent", "Cancelled"],
      default: "Pending",
      index: true,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    emailDeliveryStatus: {
      type: String,
      enum: ["Pending", "Sent", "Failed", "Skipped"],
      default: "Pending",
    },
    emailSentAt: {
      type: Date,
      default: null,
    },
    emailError: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

leadReminderSchema.index({ lead: 1, status: 1, remindAt: 1 });

module.exports = mongoose.model("LeadReminder", leadReminderSchema);

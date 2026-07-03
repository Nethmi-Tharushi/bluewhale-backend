const mongoose = require("mongoose");

const adminLeaveRequestSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["SalesAdmin", "SalesStaff"],
      required: true,
      index: true,
    },
    teamAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    leaveType: {
      type: String,
      enum: ["annual", "sick", "casual", "unpaid", "other"],
      required: true,
      default: "annual",
    },
    startDate: {
      type: Date,
      required: true,
      index: true,
    },
    endDate: {
      type: Date,
      required: true,
      index: true,
    },
    reason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    attachmentUrl: {
      type: String,
      default: "",
      trim: true,
    },
    attachmentFileName: {
      type: String,
      default: "",
      trim: true,
    },
    attachmentCloudinaryId: {
      type: String,
      default: "",
      trim: true,
    },
    attachmentMimeType: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewNotes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    cancellationReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    totalDays: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  { timestamps: true }
);

adminLeaveRequestSchema.index({ adminId: 1, startDate: 1, endDate: 1, status: 1 });

module.exports = mongoose.model("AdminLeaveRequest", adminLeaveRequestSchema);

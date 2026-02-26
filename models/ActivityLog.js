const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["MainAdmin", "SalesAdmin", "AgentAdmin"],
      required: true,
    },
    type: {
      type: String,
      enum: ["lead", "task", "report", "meeting", "system"],
      default: "system",
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ActivityLog", activityLogSchema);

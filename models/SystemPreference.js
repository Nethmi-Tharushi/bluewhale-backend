const mongoose = require("mongoose");

const systemPreferenceSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "global",
      unique: true,
      index: true,
    },
    timezone: {
      type: String,
      default: "Asia/Dubai",
      trim: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SystemPreference", systemPreferenceSchema);

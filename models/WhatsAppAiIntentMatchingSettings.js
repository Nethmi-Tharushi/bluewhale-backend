const mongoose = require("mongoose");

const MATCH_MODE_OPTIONS = Object.freeze(["balanced", "precise", "aggressive"]);
const LOW_CONFIDENCE_ACTION_OPTIONS = Object.freeze(["no_match", "fallback_to_team"]);

const whatsAppAiIntentMatchingSettingsSchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      default: "default",
      unique: true,
      index: true,
      trim: true,
    },
    enabled: {
      type: Boolean,
      default: false,
    },
    matchMode: {
      type: String,
      enum: MATCH_MODE_OPTIONS,
      default: "balanced",
      trim: true,
    },
    billingEnabled: {
      type: Boolean,
      default: false,
    },
    pricePerSuccessfulMatchMinor: {
      type: Number,
      default: 20,
      min: 0,
    },
    currency: {
      type: String,
      default: "INR",
      trim: true,
      uppercase: true,
    },
    lowConfidenceAction: {
      type: String,
      enum: LOW_CONFIDENCE_ACTION_OPTIONS,
      default: "fallback_to_team",
      trim: true,
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

module.exports = mongoose.model("WhatsAppAiIntentMatchingSettings", whatsAppAiIntentMatchingSettingsSchema);
module.exports.MATCH_MODE_OPTIONS = MATCH_MODE_OPTIONS;
module.exports.LOW_CONFIDENCE_ACTION_OPTIONS = LOW_CONFIDENCE_ACTION_OPTIONS;

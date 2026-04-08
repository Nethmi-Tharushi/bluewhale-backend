const mongoose = require("mongoose");

const whatsAppBusinessProfileSchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      required: true,
      unique: true,
      default: "default",
      index: true,
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      default: "Blue Whale CRM",
    },
    businessType: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "Professional Services",
    },
    businessDescription: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    address: {
      type: String,
      trim: true,
      maxlength: 240,
      default: "",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 120,
      default: "",
    },
    website: {
      type: String,
      trim: true,
      maxlength: 240,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 60,
      default: "",
    },
    logoUrl: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    logoStorageKey: {
      type: String,
      trim: true,
      maxlength: 255,
      default: "",
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

module.exports = mongoose.model("WhatsAppBusinessProfile", whatsAppBusinessProfileSchema);

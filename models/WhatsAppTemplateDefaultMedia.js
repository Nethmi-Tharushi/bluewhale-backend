const mongoose = require("mongoose");

const whatsAppTemplateDefaultMediaSchema = new mongoose.Schema(
  {
    templateId: {
      type: String,
      required: true,
      trim: true,
      index: true,
      unique: true,
    },
    templateName: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    headerFormat: {
      type: String,
      enum: ["IMAGE", "VIDEO", "DOCUMENT"],
      required: true,
      trim: true,
    },
    mediaUrl: {
      type: String,
      required: true,
      trim: true,
    },
    fileName: {
      type: String,
      default: "",
      trim: true,
    },
    mimeType: {
      type: String,
      default: "",
      trim: true,
    },
    resourceType: {
      type: String,
      default: "",
      trim: true,
    },
    cloudinaryPublicId: {
      type: String,
      default: "",
      trim: true,
    },
    bytes: {
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

module.exports = mongoose.model("WhatsAppTemplateDefaultMedia", whatsAppTemplateDefaultMediaSchema);

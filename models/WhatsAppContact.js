const mongoose = require("mongoose");

const whatsAppContactSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      default: "",
      trim: true,
    },
    waId: {
      type: String,
      default: "",
      index: true,
    },
    source: {
      type: String,
      default: "whatsapp",
    },
    profile: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhatsAppContact", whatsAppContactSchema);

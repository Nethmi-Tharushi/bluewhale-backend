const mongoose = require("mongoose");

const whatsAppEventLogSchema = new mongoose.Schema(
  {
    direction: {
      type: String,
      enum: ["webhook", "outgoing", "system"],
      required: true,
    },
    eventType: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["received", "processed", "failed"],
      default: "received",
    },
    headers: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    errorMessage: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhatsAppEventLog", whatsAppEventLogSchema);

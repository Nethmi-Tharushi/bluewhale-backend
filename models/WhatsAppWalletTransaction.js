const mongoose = require("mongoose");

const whatsAppWalletTransactionSchema = new mongoose.Schema(
  {
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppWallet",
      required: true,
      index: true,
    },
    reservationId: {
      type: String,
      default: "",
    },
    type: {
      type: String,
      enum: ["topup", "reserve", "release", "deduct", "adjust"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "reserved", "completed", "released", "failed", "cancelled"],
      default: "completed",
      index: true,
    },
    amountMinor: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceAfterMinor: {
      type: Number,
      default: 0,
      min: 0,
    },
    reservedAfterMinor: {
      type: Number,
      default: 0,
      min: 0,
    },
    description: {
      type: String,
      default: "",
    },
    note: {
      type: String,
      default: "",
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

whatsAppWalletTransactionSchema.index(
  { reservationId: 1 },
  { unique: true, partialFilterExpression: { reservationId: { $type: "string", $ne: "" } } }
);

module.exports = mongoose.model("WhatsAppWalletTransaction", whatsAppWalletTransactionSchema);

const mongoose = require("mongoose");

const whatsAppWalletSchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      required: true,
      unique: true,
      default: "default",
      index: true,
    },
    currency: {
      type: String,
      default: "USD",
    },
    balanceMinor: {
      type: Number,
      default: 0,
      min: 0,
    },
    reservedMinor: {
      type: Number,
      default: 0,
      min: 0,
    },
    templateChargeMinor: {
      type: Number,
      default: 100,
      min: 0,
    },
    templateChargeByCategory: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lowBalanceThresholdMinor: {
      type: Number,
      default: 0,
      min: 0,
    },
    active: {
      type: Boolean,
      default: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhatsAppWallet", whatsAppWalletSchema);

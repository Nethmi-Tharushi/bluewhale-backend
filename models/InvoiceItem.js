const mongoose = require("mongoose");

const INSTALLMENT_TYPES = Object.freeze([
  "First Installment",
  "Second Installment",
  "Third Installment",
  "Full Payment",
  "No Installment / General Item",
]);

const invoiceItemSchema = new mongoose.Schema(
  {
    itemName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    packageCountry: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    packageName: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    installmentType: {
      type: String,
      enum: INSTALLMENT_TYPES,
      default: "No Installment / General Item",
      index: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "USD",
      trim: true,
      uppercase: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
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

invoiceItemSchema.index({ packageCountry: 1, packageName: 1, installmentType: 1, isActive: 1 });

module.exports = mongoose.model("InvoiceItem", invoiceItemSchema);
module.exports.INSTALLMENT_TYPES = INSTALLMENT_TYPES;

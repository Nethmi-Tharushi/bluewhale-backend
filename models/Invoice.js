const mongoose = require("mongoose");

const invoiceItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    paidAt: { type: Date, default: Date.now },
    method: { type: String, default: "Manual" },
    reference: { type: String, default: "" },
    notes: { type: String, default: "" },
    proofUrl: { type: String, default: "" },
    proofFileName: { type: String, default: "" },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    salesAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", required: true, index: true },
    customer: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      phone: { type: String, default: "" },
      address: { type: String, default: "" },
      candidateId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      candidateType: { type: String, enum: ["B2C", "B2B", "Other"], default: "Other" },
    },
    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    currency: { type: String, default: "USD" },
    items: { type: [invoiceItemSchema], required: true, validate: (arr) => Array.isArray(arr) && arr.length > 0 },
    subtotal: { type: Number, required: true, min: 0 },
    discountTotal: { type: Number, required: true, min: 0, default: 0 },
    taxTotal: { type: Number, required: true, min: 0, default: 0 },
    grandTotal: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0, default: 0 },
    balanceDue: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["Draft", "Sent", "Paid", "Overdue", "Cancelled"],
      default: "Draft",
      index: true,
    },
    notes: { type: String, default: "" },
    attachmentUrl: { type: String, default: "" },
    attachmentFileName: { type: String, default: "" },
    sentAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    payments: { type: [paymentSchema], default: [] },
  },
  { timestamps: true }
);

invoiceSchema.index({ salesAdmin: 1, createdAt: -1 });

module.exports = mongoose.model("Invoice", invoiceSchema);

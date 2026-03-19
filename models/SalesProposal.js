const mongoose = require("mongoose");

const salesLineItemSchema = new mongoose.Schema(
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

const salesProposalSchema = new mongoose.Schema(
  {
    proposalNumber: { type: String, required: true, unique: true, index: true },
    teamAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", required: true, index: true },
    ownerAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", required: true },
    customer: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      phone: { type: String, default: "" },
      company: { type: String, default: "" },
      address: { type: String, default: "" },
      candidateId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      candidateType: { type: String, enum: ["B2C", "B2B", "Other"], default: "Other" },
    },
    title: { type: String, required: true, trim: true },
    issueDate: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    currency: { type: String, default: "USD" },
    items: { type: [salesLineItemSchema], default: [] },
    subtotal: { type: Number, required: true, min: 0 },
    discountTotal: { type: Number, required: true, min: 0, default: 0 },
    taxTotal: { type: Number, required: true, min: 0, default: 0 },
    grandTotal: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["Draft", "Sent", "Accepted", "Rejected", "Expired", "Converted"],
      default: "Draft",
      index: true,
    },
    notes: { type: String, default: "" },
    estimateId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesEstimate", default: null },
  },
  { timestamps: true }
);

salesProposalSchema.index({ teamAdmin: 1, ownerAdmin: 1, createdAt: -1 });

module.exports = mongoose.model("SalesProposal", salesProposalSchema);

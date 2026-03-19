const mongoose = require("mongoose");

const salesTargetSchema = new mongoose.Schema(
  {
    teamAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    ownerAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    targetAmount: { type: Number, required: true, min: 0 },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: {
      type: String,
      enum: ["Active", "Completed", "Archived"],
      default: "Active",
      index: true,
    },
  },
  { timestamps: true }
);

salesTargetSchema.index({ teamAdmin: 1, ownerAdmin: 1, periodStart: -1 });

module.exports = mongoose.model("SalesTarget", salesTargetSchema);

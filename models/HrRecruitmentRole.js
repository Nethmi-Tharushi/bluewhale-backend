const mongoose = require("mongoose");

const hrRecruitmentRoleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      unique: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

hrRecruitmentRoleSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model("HrRecruitmentRole", hrRecruitmentRoleSchema);

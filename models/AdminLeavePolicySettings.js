const mongoose = require("mongoose");

const roleAllowanceSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
    },
    days: {
      type: Number,
      default: 0,
      min: 0,
    },
    unlimited: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const leaveTypePolicySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    allowances: {
      SalesAdmin: {
        type: roleAllowanceSchema,
        default: () => ({}),
      },
      SalesStaff: {
        type: roleAllowanceSchema,
        default: () => ({}),
      },
      Receptionist: {
        type: roleAllowanceSchema,
        default: () => ({}),
      },
      Accountant: {
        type: roleAllowanceSchema,
        default: () => ({}),
      },
    },
  },
  { _id: false }
);

const adminLeavePolicySettingsSchema = new mongoose.Schema(
  {
    scopeKey: {
      type: String,
      default: "default",
      unique: true,
      index: true,
    },
    leaveTypes: {
      type: [leaveTypePolicySchema],
      default: [],
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminLeavePolicySettings", adminLeavePolicySettingsSchema);

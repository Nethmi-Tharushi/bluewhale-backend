const mongoose = require("mongoose");
const {
  ROLE_PERMISSION_PROFILE_KEYS,
  ROLE_PERMISSION_KEYS,
} = require("../utils/rolePermissionProfiles");

const permissionShape = ROLE_PERMISSION_KEYS.reduce((acc, key) => {
  acc[key] = { type: Boolean, default: false };
  return acc;
}, {});

const rolePermissionProfileSchema = new mongoose.Schema(
  {
    profileKey: {
      type: String,
      required: true,
      unique: true,
      enum: ROLE_PERMISSION_PROFILE_KEYS,
      trim: true,
      index: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    permissions: {
      type: new mongoose.Schema(permissionShape, { _id: false }),
      default: () => ({}),
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RolePermissionProfile", rolePermissionProfileSchema);

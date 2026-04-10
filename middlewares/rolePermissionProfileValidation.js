const {
  ROLE_PERMISSION_KEYS,
  ROLE_PERMISSION_PROFILE_KEYS,
  isSupportedPermissionKey,
  isSupportedProfileKey,
} = require("../utils/rolePermissionProfiles");

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const validateRolePermissionProfileKey = (req, res, next) => {
  const profileKey = String(req.params?.profileKey || "").trim();

  if (!isSupportedProfileKey(profileKey)) {
    return res.status(400).json({
      message: `profileKey must be one of: ${ROLE_PERMISSION_PROFILE_KEYS.join(", ")}`,
    });
  }

  return next();
};

const validateRolePermissionUpdateBody = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({ message: "Request body must be a JSON object" });
  }

  if (!isPlainObject(req.body.permissions)) {
    return res.status(400).json({ message: "permissions must be a JSON object" });
  }

  const unknownKey = Object.keys(req.body.permissions).find((key) => !isSupportedPermissionKey(key));
  if (unknownKey) {
    return res.status(400).json({ message: `Unknown permission key: ${unknownKey}` });
  }

  const invalidPermission = Object.entries(req.body.permissions).find(([, value]) => typeof value !== "boolean");
  if (invalidPermission) {
    return res.status(400).json({
      message: `Permission ${invalidPermission[0]} must be a boolean`,
    });
  }

  return next();
};

const validateRolePermissionResetBody = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({ message: "Request body must be a JSON object" });
  }

  const hasAll = Object.prototype.hasOwnProperty.call(req.body, "all");
  const hasProfileKey = Object.prototype.hasOwnProperty.call(req.body, "profileKey");

  if (!hasAll && !hasProfileKey) {
    return res.status(400).json({ message: "profileKey is required unless all=true" });
  }

  if (hasAll && typeof req.body.all !== "boolean") {
    return res.status(400).json({ message: "all must be a boolean" });
  }

  if (hasProfileKey && !isSupportedProfileKey(req.body.profileKey)) {
    return res.status(400).json({
      message: `profileKey must be one of: ${ROLE_PERMISSION_PROFILE_KEYS.join(", ")}`,
    });
  }

  return next();
};

module.exports = {
  validateRolePermissionProfileKey,
  validateRolePermissionUpdateBody,
  validateRolePermissionResetBody,
};

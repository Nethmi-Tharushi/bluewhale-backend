const { Types } = require("mongoose");

const ADMIN_ROLE_OPTIONS = new Set(["MainAdmin", "SalesAdmin", "SalesStaff", "AgentAdmin"]);
const AGENT_SETTINGS_TABS = new Set(["all", "sales"]);
const ADMIN_MUTABLE_FIELDS = new Set(["name", "email", "phone", "role", "reportsTo", "password"]);

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const isPositiveIntegerLike = (value) => value === undefined || (/^\d+$/.test(String(value)) && Number(value) > 0);

const validateBodyShape = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({ message: "Request body must be a JSON object" });
  }

  return next();
};

const validateAgentSettingsQuery = (req, res, next) => {
  const { tab, role, page, limit } = req.query || {};

  if (tab !== undefined && !AGENT_SETTINGS_TABS.has(String(tab).trim().toLowerCase())) {
    return res.status(400).json({ message: "tab must be all or sales" });
  }

  if (role !== undefined && !ADMIN_ROLE_OPTIONS.has(String(role).trim())) {
    return res.status(400).json({ message: "role must be one of: MainAdmin, SalesAdmin, SalesStaff, AgentAdmin" });
  }

  if (!isPositiveIntegerLike(page)) {
    return res.status(400).json({ message: "page must be a positive integer" });
  }

  if (!isPositiveIntegerLike(limit)) {
    return res.status(400).json({ message: "limit must be a positive integer" });
  }

  return next();
};

const validateAdminIdParam = (req, res, next) => {
  if (!Types.ObjectId.isValid(String(req.params?.id || ""))) {
    return res.status(400).json({ message: "Invalid admin id" });
  }

  return next();
};

const validateCreateAdminBody = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({ message: "Request body must be a JSON object" });
  }

  if (!String(req.body.name || "").trim()) {
    return res.status(400).json({ message: "name is required" });
  }

  if (!String(req.body.email || "").trim()) {
    return res.status(400).json({ message: "email is required" });
  }

  if (!String(req.body.password || "").trim()) {
    return res.status(400).json({ message: "password is required" });
  }

  if (!String(req.body.role || "").trim()) {
    return res.status(400).json({ message: "role is required" });
  }

  return next();
};

const validateUpdateAdminBody = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({ message: "Request body must be a JSON object" });
  }

  const keys = Object.keys(req.body || {});
  if (keys.length < 1) {
    return res.status(400).json({ message: "At least one field is required" });
  }

  const invalidField = keys.find((key) => !ADMIN_MUTABLE_FIELDS.has(key));
  if (invalidField) {
    return res.status(400).json({ message: `Unsupported field: ${invalidField}` });
  }

  return next();
};

module.exports = {
  validateBodyShape,
  validateAgentSettingsQuery,
  validateAdminIdParam,
  validateCreateAdminBody,
  validateUpdateAdminBody,
};

const { Types } = require("mongoose");

const CONTACT_HUB_BULK_ACTIONS = new Set(["update_status", "toggle_opt_in"]);
const CONTACT_HUB_MUTABLE_FIELDS = new Set([
  "name",
  "phone",
  "email",
  "tags",
  "status",
  "accountOwner",
  "accountOwnerId",
  "source",
  "b2cConfirmation",
  "optedIn",
  "city",
  "notes",
  "lastSeenAt",
]);

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const validateBodyShape = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({ message: "Request body must be a JSON object" });
  }
  return next();
};

const validateTags = (value) =>
  value === undefined || typeof value === "string" || Array.isArray(value);

const validateDate = (value) =>
  value === undefined
  || value === null
  || value === ""
  || !Number.isNaN(new Date(value).getTime());

const validateIdParam = (req, res, next) => {
  if (!Types.ObjectId.isValid(String(req.params?.id || ""))) {
    return res.status(400).json({ message: "Invalid WhatsApp contact id" });
  }

  return next();
};

const validateCreateBody = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({ message: "Request body must be a JSON object" });
  }

  if (!String(req.body.name || "").trim()) {
    return res.status(400).json({ message: "name is required" });
  }

  if (!String(req.body.phone || "").trim()) {
    return res.status(400).json({ message: "phone is required" });
  }

  if (!validateTags(req.body.tags)) {
    return res.status(400).json({ message: "tags must be an array or comma-separated string" });
  }

  if (!validateDate(req.body.lastSeenAt)) {
    return res.status(400).json({ message: "lastSeenAt must be a valid date" });
  }

  return next();
};

const validateUpdateBody = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({ message: "Request body must be a JSON object" });
  }

  const keys = Object.keys(req.body || {});
  if (keys.length < 1) {
    return res.status(400).json({ message: "At least one field is required" });
  }

  const invalidField = keys.find((key) => !CONTACT_HUB_MUTABLE_FIELDS.has(key));
  if (invalidField) {
    return res.status(400).json({ message: `Unsupported field: ${invalidField}` });
  }

  if (hasOwnProperty(req.body, "tags") && !validateTags(req.body.tags)) {
    return res.status(400).json({ message: "tags must be an array or comma-separated string" });
  }

  if (hasOwnProperty(req.body, "lastSeenAt") && !validateDate(req.body.lastSeenAt)) {
    return res.status(400).json({ message: "lastSeenAt must be a valid date" });
  }

  return next();
};

const validateStatusBody = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({ message: "Request body must be a JSON object" });
  }

  if (!String(req.body.status || "").trim()) {
    return res.status(400).json({ message: "status is required" });
  }

  return next();
};

const validateBulkBody = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({ message: "Request body must be a JSON object" });
  }

  if (!Array.isArray(req.body.ids) || req.body.ids.length < 1) {
    return res.status(400).json({ message: "ids must be a non-empty array" });
  }

  if (req.body.ids.some((id) => !Types.ObjectId.isValid(String(id || "")))) {
    return res.status(400).json({ message: "ids must contain valid contact ids" });
  }

  if (!CONTACT_HUB_BULK_ACTIONS.has(String(req.body.action || ""))) {
    return res.status(400).json({ message: "action must be update_status or toggle_opt_in" });
  }

  return next();
};

const hasOwnProperty = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

module.exports = {
  validateBodyShape,
  validateIdParam,
  validateCreateBody,
  validateUpdateBody,
  validateStatusBody,
  validateBulkBody,
};

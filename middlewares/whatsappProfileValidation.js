const WHATSAPP_PROFILE_FIELDS = new Set([
  "businessName",
  "businessType",
  "businessDescription",
  "address",
  "email",
  "website",
  "phone",
  "logoUrl",
]);

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const validateWhatsAppProfileBody = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({ message: "Request body must be a JSON object" });
  }

  const keys = Object.keys(req.body || {});
  if (!keys.length) {
    return res.status(400).json({ message: "At least one field is required" });
  }

  const invalidField = keys.find((key) => !WHATSAPP_PROFILE_FIELDS.has(key));
  if (invalidField) {
    return res.status(400).json({ message: `Unsupported field: ${invalidField}` });
  }

  return next();
};

module.exports = {
  validateWhatsAppProfileBody,
};

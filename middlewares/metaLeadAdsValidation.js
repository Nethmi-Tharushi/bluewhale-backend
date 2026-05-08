const { trimString } = require("../services/metaGraphService");

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map(trimString).filter(Boolean);
};

const ensurePlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const validateMetaLeadAdsExchangeBody = (req, res, next) => {
  const body = req.body || {};
  if (!trimString(body.code)) {
    return res.status(400).json({ message: "code is required" });
  }

  if (body.redirectUri !== undefined && typeof body.redirectUri !== "string") {
    return res.status(400).json({ message: "redirectUri must be a string" });
  }

  if (body.fieldMapping !== undefined && !ensurePlainObject(body.fieldMapping)) {
    return res.status(400).json({ message: "fieldMapping must be an object" });
  }

  if (body.selectedFormIds !== undefined && !Array.isArray(body.selectedFormIds)) {
    return res.status(400).json({ message: "selectedFormIds must be an array" });
  }

  req.body = {
    ...body,
    selectedFormIds: body.selectedFormIds !== undefined ? normalizeStringArray(body.selectedFormIds) : body.selectedFormIds,
  };
  return next();
};

const validateMetaLeadAdsSyncBody = (req, res, next) => {
  const body = req.body || {};

  for (const field of ["selectedBusinessId", "selectedBusinessName", "selectedPageId", "selectedPageName", "crmSourceLabel"]) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return res.status(400).json({ message: `${field} must be a string` });
    }
  }

  if (body.fieldMapping !== undefined && !ensurePlainObject(body.fieldMapping)) {
    return res.status(400).json({ message: "fieldMapping must be an object" });
  }

  if (body.selectedFormIds !== undefined && !Array.isArray(body.selectedFormIds)) {
    return res.status(400).json({ message: "selectedFormIds must be an array" });
  }

  if (body.selectedFormNames !== undefined && !Array.isArray(body.selectedFormNames)) {
    return res.status(400).json({ message: "selectedFormNames must be an array" });
  }

  for (const field of ["autoCreateLeads", "autoAssignToOwner", "autoSyncEnabled", "syncFormsOnConnect"]) {
    if (body[field] !== undefined && !["boolean", "string", "number"].includes(typeof body[field])) {
      return res.status(400).json({ message: `${field} must be a boolean-like value` });
    }
  }

  if (body.syncIntervalMinutes !== undefined) {
    const value = Number(body.syncIntervalMinutes);
    if (!Number.isInteger(value) || value < 5 || value > 59) {
      return res.status(400).json({ message: "syncIntervalMinutes must be an integer between 5 and 59" });
    }
  }

  if (body.pollLookbackMinutes !== undefined) {
    const value = Number(body.pollLookbackMinutes);
    if (!Number.isInteger(value) || value < 5 || value > 240) {
      return res.status(400).json({ message: "pollLookbackMinutes must be an integer between 5 and 240" });
    }
  }

  if (body.lookbackMinutes !== undefined) {
    const value = Number(body.lookbackMinutes);
    if (!Number.isInteger(value) || value < 5 || value > 240) {
      return res.status(400).json({ message: "lookbackMinutes must be an integer between 5 and 240" });
    }
  }

  req.body = {
    ...body,
    selectedFormIds: body.selectedFormIds !== undefined ? normalizeStringArray(body.selectedFormIds) : body.selectedFormIds,
    selectedFormNames: body.selectedFormNames !== undefined ? normalizeStringArray(body.selectedFormNames) : body.selectedFormNames,
    ...(body.syncIntervalMinutes !== undefined ? { syncIntervalMinutes: Number(body.syncIntervalMinutes) } : {}),
    ...(body.pollLookbackMinutes !== undefined ? { pollLookbackMinutes: Number(body.pollLookbackMinutes) } : {}),
    ...(body.lookbackMinutes !== undefined ? { lookbackMinutes: Number(body.lookbackMinutes) } : {}),
  };
  return next();
};

const validateMetaLeadAdsDisconnectBody = (req, _res, next) => {
  req.body = req.body || {};
  return next();
};

const validateMetaLeadAdsRetryBody = (req, res, next) => {
  const body = req.body || {};
  if (body.limit !== undefined) {
    const limit = Number(body.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return res.status(400).json({ message: "limit must be an integer between 1 and 50" });
    }
  }

  req.body = {
    ...body,
    ...(body.limit !== undefined ? { limit: Number(body.limit) } : {}),
  };
  return next();
};

module.exports = {
  validateMetaLeadAdsExchangeBody,
  validateMetaLeadAdsSyncBody,
  validateMetaLeadAdsDisconnectBody,
  validateMetaLeadAdsRetryBody,
};

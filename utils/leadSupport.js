const { getSalesScope } = require("./salesScope");

const DEFAULT_LEAD_STATUS = "Leads";
const DEFAULT_LEAD_SOURCE = "Nothing selected";
const CANONICAL_LEAD_STATUSES = Object.freeze([
  "Leads",
  "Prospects",
  "Follow-up Required",
  "Converted Leads",
  "Paid Client",
  "Not Interested",
]);
const LEAD_STATUS_ALIASES = Object.freeze({
  "Paid Clients": "Paid Client",
});
const VALID_LEAD_STATUSES = Object.freeze([
  ...CANONICAL_LEAD_STATUSES,
  ...Object.keys(LEAD_STATUS_ALIASES),
]);

const trimString = (value) => String(value || "").trim();

const toApiId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const normalizeLeadStatus = (value, fallback = DEFAULT_LEAD_STATUS) => {
  const normalized = trimString(value);
  if (!normalized) return fallback;

  const canonical = LEAD_STATUS_ALIASES[normalized] || normalized;
  if (CANONICAL_LEAD_STATUSES.includes(canonical)) {
    return canonical;
  }

  return fallback;
};

const isSupportedLeadStatus = (value) => VALID_LEAD_STATUSES.includes(trimString(value));

const normalizeLeadSource = (value, fallback = DEFAULT_LEAD_SOURCE) => trimString(value) || fallback;

const normalizeLeadTags = (value) => {
  const rawTags = Array.isArray(value)
    ? value
    : trimString(value)
      ? String(value)
          .split(",")
          .map((tag) => tag.trim())
      : [];

  const seen = new Set();
  return rawTags
    .map((tag) => trimString(tag))
    .filter((tag) => {
      if (!tag) return false;
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const buildAssignedAdminPayload = (assignedTo) => {
  if (!assignedTo) return null;

  if (typeof assignedTo !== "object") {
    return {
      _id: toApiId(assignedTo),
      name: "",
    };
  }

  return {
    ...assignedTo,
    _id: toApiId(assignedTo),
    name: trimString(assignedTo.name),
  };
};

const formatLeadForApi = (lead) => {
  const base = lead && typeof lead.toObject === "function" ? lead.toObject() : lead || {};

  return {
    ...base,
    _id: toApiId(base._id),
    status: normalizeLeadStatus(base.status),
    source: normalizeLeadSource(base.source),
    sourceDetails: trimString(base.sourceDetails),
    name: trimString(base.name),
    email: trimString(base.email).toLowerCase(),
    phone: trimString(base.phone),
    company: trimString(base.company),
    assignedTo: buildAssignedAdminPayload(base.assignedTo),
    leadValue: Number(base.leadValue || 0),
    currency: trimString(base.currency || "AED") || "AED",
    tags: normalizeLeadTags(base.tags),
    description: trimString(base.description),
    lastContactAt: base.lastContactAt || base.updatedAt || base.createdAt || null,
    createdAt: base.createdAt || null,
  };
};

const buildLeadAccessFilter = (req) => {
  const scope = getSalesScope(req);

  if (scope.isSalesStaff) {
    return {
      $or: [
        { ownerAdmin: scope.actorId },
        { assignedTo: scope.actorId },
      ],
    };
  }

  return {
    $or: [
      { teamAdmin: scope.managerId },
      { ownerAdmin: scope.actorId },
    ],
  };
};

module.exports = {
  DEFAULT_LEAD_STATUS,
  DEFAULT_LEAD_SOURCE,
  CANONICAL_LEAD_STATUSES,
  VALID_LEAD_STATUSES,
  normalizeLeadStatus,
  isSupportedLeadStatus,
  normalizeLeadSource,
  normalizeLeadTags,
  formatLeadForApi,
  buildLeadAccessFilter,
  toApiId,
};

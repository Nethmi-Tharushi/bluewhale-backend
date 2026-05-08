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

const buildAssignmentHistoryPayload = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item) => ({
      action: trimString(item?.action) || "assigned",
      assignedAt: item?.assignedAt || item?.createdAt || null,
      assignedTo: buildAssignedAdminPayload(item?.assignedTo),
      previousAssignedTo: buildAssignedAdminPayload(item?.previousAssignedTo),
      assignedBy: buildAssignedAdminPayload(item?.assignedBy),
    }))
    .filter((item) => item.assignedAt || item.assignedTo || item.assignedBy);

const pickFirstString = (...values) => {
  for (const value of values) {
    const normalized = trimString(value);
    if (normalized) return normalized;
  }
  return "";
};

const normalizeMetaLeadCustomFields = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      name: trimString(item?.name || item?.key),
      key: trimString(item?.key),
      values: Array.isArray(item?.values)
        ? item.values.map((entry) => trimString(entry)).filter(Boolean)
        : trimString(item?.value)
          ? [trimString(item.value)]
          : [],
    }))
    .filter((item) => item.name || item.key || item.values.length);
};

const buildMetaLeadAdsPayload = (sourceMetadata = {}) => {
  const metaLeadAds = sourceMetadata?.metaLeadAds && typeof sourceMetadata.metaLeadAds === "object"
    ? sourceMetadata.metaLeadAds
    : sourceMetadata;
  const customFields = normalizeMetaLeadCustomFields(
    metaLeadAds.customFields || sourceMetadata.customFields || []
  );

  return {
    integrationProvider: pickFirstString(
      metaLeadAds.integrationProvider,
      sourceMetadata.integrationProvider,
      metaLeadAds.provider,
      sourceMetadata.provider
    ),
    metaLeadId: pickFirstString(metaLeadAds.metaLeadId, sourceMetadata.metaLeadId),
    campaignId: pickFirstString(metaLeadAds.campaignId, sourceMetadata.campaignId),
    campaignName: pickFirstString(metaLeadAds.campaignName, sourceMetadata.campaignName),
    formId: pickFirstString(metaLeadAds.formId, sourceMetadata.formId),
    formName: pickFirstString(metaLeadAds.formName, sourceMetadata.formName),
    pageId: pickFirstString(metaLeadAds.pageId, sourceMetadata.pageId),
    pageName: pickFirstString(metaLeadAds.pageName, sourceMetadata.pageName),
    postName: pickFirstString(metaLeadAds.postName, sourceMetadata.postName, metaLeadAds.adName, sourceMetadata.adName),
    jobPosition: pickFirstString(metaLeadAds.jobPosition, sourceMetadata.jobPosition),
    additionalNotes: pickFirstString(metaLeadAds.additionalNotes, sourceMetadata.additionalNotes),
    metaLeadTimestamp: metaLeadAds.metaLeadTimestamp || sourceMetadata.metaLeadTimestamp || null,
    fetchedAt: metaLeadAds.fetchedAt || sourceMetadata.fetchedAt || null,
    syncStatus: pickFirstString(metaLeadAds.syncStatus, sourceMetadata.syncStatus),
    fieldValues:
      metaLeadAds.fieldValues && typeof metaLeadAds.fieldValues === "object" && !Array.isArray(metaLeadAds.fieldValues)
        ? metaLeadAds.fieldValues
        : sourceMetadata.fieldValues && typeof sourceMetadata.fieldValues === "object" && !Array.isArray(sourceMetadata.fieldValues)
          ? sourceMetadata.fieldValues
          : {},
    customFieldValues:
      metaLeadAds.customFieldValues &&
      typeof metaLeadAds.customFieldValues === "object" &&
      !Array.isArray(metaLeadAds.customFieldValues)
        ? metaLeadAds.customFieldValues
        : sourceMetadata.customFieldValues &&
            typeof sourceMetadata.customFieldValues === "object" &&
            !Array.isArray(sourceMetadata.customFieldValues)
          ? sourceMetadata.customFieldValues
          : {},
    customFields,
  };
};

const formatLeadForApi = (lead) => {
  const base = lead && typeof lead.toObject === "function" ? lead.toObject() : lead || {};
  const normalizedSourceMetadata =
    base?.sourceMetadata && typeof base.sourceMetadata === "object" && !Array.isArray(base.sourceMetadata)
      ? base.sourceMetadata
      : {};
  const metaLeadAds = buildMetaLeadAdsPayload(normalizedSourceMetadata);
  const integrationProvider = metaLeadAds.integrationProvider || (trimString(base.integrationKey).startsWith("meta_lead_ads:") ? "meta_lead_ads" : "");
  const isMetaLead = integrationProvider === "meta_lead_ads";
  const syncStatus = pickFirstString(metaLeadAds.syncStatus, isMetaLead ? "synced" : "");
  const additionalNotes = pickFirstString(metaLeadAds.additionalNotes);
  const assignmentState = base.assignedTo ? "assigned" : "unassigned";
  const assignmentHistory = buildAssignmentHistoryPayload(base.assignmentHistory);

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
    assignedBy: buildAssignedAdminPayload(base.assignedBy),
    assignedAt: base.assignedAt || null,
    assignmentState,
    isUnassigned: assignmentState === "unassigned",
    assignmentHistory,
    leadAssignments: assignmentHistory,
    assignments: assignmentHistory,
    leadValue: Number(base.leadValue || 0),
    currency: trimString(base.currency || "AED") || "AED",
    tags: normalizeLeadTags(base.tags),
    description: trimString(base.description),
    lastContactAt: base.lastContactAt || base.updatedAt || base.createdAt || null,
    createdAt: base.createdAt || null,
    integrationKey: trimString(base.integrationKey),
    integrationProvider,
    sourceMetadata: normalizedSourceMetadata,
    integrationMeta: normalizedSourceMetadata,
    metaLeadId: metaLeadAds.metaLeadId,
    campaignId: metaLeadAds.campaignId,
    campaignName: metaLeadAds.campaignName,
    formId: metaLeadAds.formId,
    formName: metaLeadAds.formName,
    pageId: metaLeadAds.pageId,
    pageName: metaLeadAds.pageName,
    postName: metaLeadAds.postName,
    jobPosition: metaLeadAds.jobPosition,
    additionalNotes,
    notes: additionalNotes,
    metaLeadTimestamp: metaLeadAds.metaLeadTimestamp,
    fetchedAt: metaLeadAds.fetchedAt,
    syncStatus,
    customFields: metaLeadAds.customFields,
    customFieldValues: metaLeadAds.customFieldValues,
    fieldValues: metaLeadAds.fieldValues,
    metaLeadAds: {
      ...metaLeadAds,
      integrationProvider,
      syncStatus,
    },
  };
};

const buildLeadAccessFilter = (req) => {
  const scope = getSalesScope(req);

  if (scope.isMainAdmin) {
    return {};
  }

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

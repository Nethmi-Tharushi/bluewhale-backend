const { getSalesScope } = require("./salesScope");

const DEFAULT_LEAD_STATUS = "New Lead";
const DEFAULT_LEAD_SOURCE = "Nothing selected";
const CANONICAL_LEAD_STATUSES = Object.freeze([
  "New Lead",
  "Contact Attempted",
  "Interested",
  "Follow-up Required",
  "Meeting Scheduled",
  "Proposal Sent",
  "Negotiation",
  "Paid Customer",
  "Not Interested",
]);
const LEGACY_STATUS_EQUIVALENTS = Object.freeze({
  "New Lead": ["Leads"],
  Interested: ["Prospects"],
  Negotiation: ["Converted Leads"],
  "Paid Customer": ["Paid Client", "Paid Clients"],
});
const CANONICAL_STATUS_MAP = Object.freeze(
  CANONICAL_LEAD_STATUSES.reduce((accumulator, status) => {
    accumulator[String(status).trim().toLowerCase()] = status;
    return accumulator;
  }, {})
);
const LEAD_STATUS_ALIASES = Object.freeze({
  Leads: "New Lead",
  leads: "New Lead",
  Prospect: "Interested",
  prospects: "Interested",
  prospect: "Interested",
  Interested: "Interested",
  interested: "Interested",
  "Contact Attempted": "Contact Attempted",
  "contact attempted": "Contact Attempted",
  "Follow Up Required": "Follow-up Required",
  "Follow Up": "Follow-up Required",
  "Follow-up": "Follow-up Required",
  "follow up required": "Follow-up Required",
  "follow up": "Follow-up Required",
  "follow-up": "Follow-up Required",
  "Meeting Scheduled": "Meeting Scheduled",
  "meeting scheduled": "Meeting Scheduled",
  "Proposal Sent": "Proposal Sent",
  "proposal sent": "Proposal Sent",
  Negotiation: "Negotiation",
  negotiation: "Negotiation",
  Converted: "Negotiation",
  converted: "Negotiation",
  Customer: "Paid Customer",
  customer: "Paid Customer",
  Customers: "Paid Customer",
  customers: "Paid Customer",
  "Paid Customer": "Paid Customer",
  "Paid Customers": "Paid Customer",
  "Paid Clients": "Paid Customer",
  "Paid Client": "Paid Customer",
  "paid clients": "Paid Customer",
  "paid customer": "Paid Customer",
  "paid customers": "Paid Customer",
  "paid client": "Paid Customer",
  "converted leads": "Negotiation",
  "converted lead": "Negotiation",
  "Not interested": "Not Interested",
  "not interested": "Not Interested",
});
const VALID_LEAD_STATUSES = Object.freeze([
  ...CANONICAL_LEAD_STATUSES,
  ...Object.values(LEGACY_STATUS_EQUIVALENTS).flat(),
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

  const normalizedLower = normalized.toLowerCase();
  const canonical =
    LEAD_STATUS_ALIASES[normalized] ||
    LEAD_STATUS_ALIASES[normalizedLower] ||
    CANONICAL_STATUS_MAP[normalizedLower] ||
    normalized;
  if (CANONICAL_LEAD_STATUSES.includes(canonical)) {
    return canonical;
  }

  return fallback;
};

const expandLeadStatusesForQuery = (values = []) => {
  const requested = Array.isArray(values) ? values : [values];
  const expanded = new Set();

  requested.forEach((value) => {
    const canonical = normalizeLeadStatus(value, "");
    if (!canonical) return;
    expanded.add(canonical);
    (LEGACY_STATUS_EQUIVALENTS[canonical] || []).forEach((legacy) => expanded.add(legacy));
  });

  return [...expanded];
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

const buildInternalNotesPayload = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: toApiId(item?._id),
      text: trimString(item?.text),
      authorId: toApiId(item?.authorId),
      authorName: trimString(item?.authorName || item?.authorId?.name || item?.authorId?.email),
      createdAt: item?.createdAt || null,
    }))
    .filter((item) => item.text);

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

const computeLeadScore = (lead = {}) => {
  const status = normalizeLeadStatus(lead?.status, DEFAULT_LEAD_STATUS);
  const source = normalizeLeadSource(lead?.source, DEFAULT_LEAD_SOURCE).toLowerCase();
  let score = 10;

  if (lead?.email) score += 10;
  if (lead?.phone) score += 10;
  if (lead?.assignedTo) score += 10;
  if (Number(lead?.leadValue || 0) > 0) score += 15;
  if (source.includes("job portal") || source.includes("website") || source.includes("referral")) score += 10;

  const statusWeights = {
    "New Lead": 5,
    "Contact Attempted": 10,
    Interested: 20,
    "Follow-up Required": 25,
    "Meeting Scheduled": 35,
    "Proposal Sent": 45,
    Negotiation: 55,
    "Paid Customer": 100,
    "Not Interested": 0,
  };
  score += statusWeights[status] ?? 0;

  const lastContactAt = lead?.lastContactAt ? new Date(lead.lastContactAt) : null;
  if (lastContactAt && !Number.isNaN(lastContactAt.getTime())) {
    const ageDays = Math.floor((Date.now() - lastContactAt.getTime()) / (1000 * 60 * 60 * 24));
    if (ageDays <= 7) score += 10;
    else if (ageDays <= 30) score += 5;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
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
  const internalNotes = buildInternalNotesPayload(base.internalNotes);
  const leadScore = computeLeadScore(base);

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
    internalNotes,
    leadScore,
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

  if (scope.isMainAdmin || scope.isSalesAdmin) {
    return {};
  }

  if (scope.isSalesStaff) {
    return { assignedTo: scope.actorId };
  }
  return {};
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
  expandLeadStatusesForQuery,
  formatLeadForApi,
  buildLeadAccessFilter,
  toApiId,
  computeLeadScore,
};

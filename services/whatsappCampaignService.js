const WhatsAppCampaign = require("../models/WhatsAppCampaign");
const WhatsAppContact = require("../models/WhatsAppContact");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppCampaignJob = require("../models/WhatsAppCampaignJob");
const { getTemplateById, prepareTemplateMessage } = require("./whatsappTemplateService");
const { normalizePhone, sendMessage } = require("./whatsappService");
const {
  findContactConversationByPhone,
  assertOpenCustomerCareWindow,
} = require("./whatsappCareWindowService");
const {
  launchCampaign,
  pauseCampaignJobs,
  resumeCampaignJobs,
  cancelCampaignJobs,
  deleteCampaignJobs,
  __private: runtimePrivate = {},
} = require("./whatsappCampaignRuntimeService");

const WHATSAPP_CAMPAIGN_STATUS_OPTIONS = WhatsAppCampaign.WHATSAPP_CAMPAIGN_STATUS_OPTIONS || [
  "Draft",
  "Scheduled",
  "Running",
  "Sent",
  "Failed",
  "Paused",
  "Cancelled",
];
const WHATSAPP_CAMPAIGN_TYPE_OPTIONS = WhatsAppCampaign.WHATSAPP_CAMPAIGN_TYPE_OPTIONS || [
  "Broadcast",
  "Promotional",
  "Reminder",
  "Follow-up",
  "Custom",
];
const WHATSAPP_CAMPAIGN_CHANNEL_OPTIONS = WhatsAppCampaign.WHATSAPP_CAMPAIGN_CHANNEL_OPTIONS || [
  "WhatsApp",
  "Instagram",
  "Both",
];
const WHATSAPP_CAMPAIGN_SCHEDULE_TYPE_OPTIONS = WhatsAppCampaign.WHATSAPP_CAMPAIGN_SCHEDULE_TYPE_OPTIONS || [
  "draft",
  "send_now",
  "later",
];
const WHATSAPP_CAMPAIGN_CONTENT_MODE_OPTIONS = WhatsAppCampaign.WHATSAPP_CAMPAIGN_CONTENT_MODE_OPTIONS || [
  "template",
  "compose",
];
const WHATSAPP_CAMPAIGN_AUDIENCE_TYPE_OPTIONS = WhatsAppCampaign.WHATSAPP_CAMPAIGN_AUDIENCE_TYPE_OPTIONS || [
  "all_contacts",
  "segments",
  "manual",
];
const DEFAULT_TIMEZONE = "Asia/Colombo";
const POPULATE_SAFE_ADMIN = "_id name email";
const DEFAULT_STATS = Object.freeze({
  sent: 0,
  delivered: 0,
  read: 0,
  clicked: 0,
  failed: 0,
});

const trimString = (value) => String(value || "").trim();
const hasOwnProperty = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const createHttpError = (message, status = 400, extras = {}) => {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extras);
  return error;
};

const withCampaignPopulation = (query) =>
  query
    .populate("createdBy", POPULATE_SAFE_ADMIN)
    .populate("updatedBy", POPULATE_SAFE_ADMIN)
    .populate("launchedBy", POPULATE_SAFE_ADMIN);

const toObject = (value) => {
  if (!value) return {};
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};

const toIsoStringOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

const normalizePhoneOrNull = (value) => {
  const normalized = normalizePhone(value);
  const digits = normalized.replace(/[^\d]/g, "");

  if (!normalized || digits.length < 8 || digits.length > 15) {
    return null;
  }

  return normalized;
};

const normalizeBoolean = (value, fieldLabel, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === 0) {
    return Boolean(value);
  }

  if (typeof value === "string") {
    const normalized = trimString(value).toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  throw createHttpError(`${fieldLabel} must be true or false`);
};

const normalizeEnum = (value, options, fieldLabel, defaultValue) => {
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw createHttpError(`${fieldLabel} is required`);
  }

  const normalized = trimString(value) || defaultValue || "";
  if (!options.includes(normalized)) {
    throw createHttpError(`${fieldLabel} must be one of: ${options.join(", ")}`);
  }

  return normalized;
};

const normalizeStringArray = (value, fieldLabel, { maxLength } = {}) => {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createHttpError(`${fieldLabel} must be an array`);
  }

  const normalized = [...new Set(value.map((item) => trimString(item)).filter(Boolean))];
  if (maxLength && normalized.length > maxLength) {
    throw createHttpError(`${fieldLabel} can contain at most ${maxLength} items`);
  }

  return normalized;
};

const normalizeManualPhoneArray = (value, fieldLabel, { partial = false } = {}) => {
  if (value === undefined) {
    return partial ? undefined : [];
  }

  if (value === null || value === "") {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createHttpError(`${fieldLabel} must be an array`, 400, { code: "INVALID_MANUAL_PHONE" });
  }

  const normalized = [];
  const seen = new Set();

  value.forEach((item, index) => {
    const phone = normalizePhoneOrNull(item);
    if (!phone) {
      throw createHttpError(`${fieldLabel}[${index}] must be a valid WhatsApp number`, 400, {
        code: "INVALID_MANUAL_PHONE",
        field: fieldLabel,
      });
    }

    const dedupeKey = phone.replace(/[^\d]/g, "");
    if (seen.has(dedupeKey)) {
      return;
    }

    seen.add(dedupeKey);
    normalized.push(phone);
  });

  return normalized;
};

const splitManualAudienceTokens = ({
  manualContactIds = [],
  manualPhones = [],
  partial = false,
} = {}) => {
  const normalizedContactIds = normalizeStringArray(manualContactIds, "manualContactIds");
  const normalizedManualPhones = normalizeManualPhoneArray(manualPhones, "manualPhones", { partial: false });
  const contactIds = [];
  const contactIdSeen = new Set();
  const phoneSeen = new Set(normalizedManualPhones.map((phone) => phone.replace(/[^\d]/g, "")));
  const mergedManualPhones = [...normalizedManualPhones];

  normalizedContactIds.forEach((token) => {
    const normalizedPhone = normalizePhoneOrNull(token);
    if (normalizedPhone) {
      const dedupeKey = normalizedPhone.replace(/[^\d]/g, "");
      if (!phoneSeen.has(dedupeKey)) {
        phoneSeen.add(dedupeKey);
        mergedManualPhones.push(normalizedPhone);
      }
      return;
    }

    const dedupeKey = token.toLowerCase();
    if (contactIdSeen.has(dedupeKey)) {
      return;
    }

    contactIdSeen.add(dedupeKey);
    contactIds.push(token);
  });

  return {
    manualContactIds: contactIds,
    manualPhones: mergedManualPhones,
    invalidManualPhoneCount: 0,
  };
};

const normalizeTemplateVariables = (value, { partial = false } = {}) => {
  if (value === undefined) {
    return partial ? undefined : {};
  }

  if (!value) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw createHttpError("templateVariables must be an object");
  }

  return { ...value };
};

const normalizeUrl = (value) => {
  const url = trimString(value);
  if (!url) {
    return "";
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    throw createHttpError("ctaUrl must be a valid http or https URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw createHttpError("ctaUrl must be a valid http or https URL");
  }

  return parsed.toString();
};

const normalizeDate = (value, fieldLabel) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(`${fieldLabel} must be a valid date`);
  }

  return date;
};

const normalizeAudienceSize = (value, { partial = false } = {}) => {
  if (value === undefined) {
    return partial ? undefined : 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createHttpError("audienceSize must be 0 or greater");
  }

  return parsed;
};

const normalizeStats = (value = {}) => {
  const statsSource = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return {
    sent: toNonNegativeNumber(statsSource.sent ?? statsSource.sentCount, 0),
    delivered: toNonNegativeNumber(statsSource.delivered ?? statsSource.deliveredCount, 0),
    read: toNonNegativeNumber(statsSource.read ?? statsSource.readCount, 0),
    clicked: toNonNegativeNumber(statsSource.clicked ?? statsSource.clickedCount, 0),
    failed: toNonNegativeNumber(statsSource.failed ?? statsSource.failedCount, 0),
  };
};

const normalizeBooleanLike = (value) => {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return Boolean(value);
  if (typeof value === "string") {
    const normalized = trimString(value).toLowerCase();
    if (["true", "yes", "y", "1", "opted_in", "subscribed"].includes(normalized)) return true;
    if (["false", "no", "n", "0", "opted_out", "unsubscribed"].includes(normalized)) return false;
  }
  return null;
};

const normalizeCreatedBy = (value) => {
  if (!value) return null;
  if (typeof value === "object") {
    return {
      _id: trimString(value._id || value.id),
      name: trimString(value.name),
      email: trimString(value.email),
    };
  }

  return {
    _id: trimString(value),
    name: "",
    email: "",
  };
};

const slugifyAudienceTag = (value) =>
  trimString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeAudienceTags = (value) => {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const seen = new Set();
  const normalized = [];

  source.forEach((item) => {
    const tag = trimString(item);
    if (!tag) return;
    const dedupeKey = tag.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    normalized.push(tag);
  });

  return normalized;
};

const inferAudienceOptIn = (contact = {}, linkedLead = null) => {
  const negativeFlags = [
    contact?.doNotContact,
    contact?.profile?.doNotContact,
    contact?.profile?.unsubscribed,
    contact?.profile?.whatsappUnsubscribed,
    linkedLead?.doNotContact,
    linkedLead?.unsubscribed,
  ];

  if (negativeFlags.some((value) => normalizeBooleanLike(value) === true)) {
    return false;
  }

  const directSignals = [
    contact?.optedIn,
    contact?.optIn,
    contact?.whatsappOptIn,
    contact?.whatsappOptedIn,
    contact?.marketingOptIn,
    contact?.marketingConsent,
    contact?.profile?.optedIn,
    contact?.profile?.optIn,
    contact?.profile?.whatsappOptIn,
    contact?.profile?.whatsappOptedIn,
    contact?.profile?.marketingOptIn,
    contact?.profile?.marketingConsent,
    linkedLead?.optedIn,
    linkedLead?.optIn,
    linkedLead?.whatsappOptIn,
    linkedLead?.whatsappOptedIn,
    linkedLead?.marketingOptIn,
    linkedLead?.marketingConsent,
  ];

  for (const signal of directSignals) {
    const normalized = normalizeBooleanLike(signal);
    if (normalized !== null) {
      return normalized;
    }
  }

  return true;
};

const resolveAudienceSourceLabel = (contact = {}, linkedLead = null) => {
  const sourceCandidates = [
    linkedLead?.source,
    linkedLead?.sourceDetails,
    contact?.source,
    contact?.profile?.source,
    contact?.profile?.sourceDetails,
    contact?.profile?.leadSource,
    contact?.profile?.channel,
  ];

  for (const candidate of sourceCandidates) {
    const normalized = trimString(candidate);
    if (normalized && normalized.toLowerCase() !== "nothing selected") {
      return normalized;
    }
  }

  return "WhatsApp";
};

const normalizeAudienceContactRecord = ({ contact = {}, conversation = null } = {}) => {
  const linkedLead = conversation?.linkedLeadId && typeof conversation.linkedLeadId === "object"
    ? conversation.linkedLeadId
    : null;
  const tags = normalizeAudienceTags(conversation?.tags);
  const phone = trimString(contact.phone || contact.waId || linkedLead?.phone);

  if (!phone) {
    return null;
  }

  return {
    id: trimString(contact._id || contact.id || conversation?._id),
    name: trimString(contact.name || contact.profile?.name || linkedLead?.name || phone) || phone,
    phone,
    source: resolveAudienceSourceLabel(contact, linkedLead),
    tag: tags[0] || "",
    optedIn: inferAudienceOptIn(contact, linkedLead),
  };
};

const buildAudienceSegments = (conversations = []) => {
  const tagMap = new Map();

  conversations.forEach((conversation) => {
    const contactId = trimString(conversation.contactId?._id || conversation.contactId);
    normalizeAudienceTags(conversation.tags).forEach((tag) => {
      const dedupeKey = tag.toLowerCase();
      if (!tagMap.has(dedupeKey)) {
        tagMap.set(dedupeKey, {
          id: slugifyAudienceTag(tag) || dedupeKey,
          name: tag,
          description: `WhatsApp conversations tagged with ${tag}`,
          contactIds: new Set(),
        });
      }

      if (contactId) {
        tagMap.get(dedupeKey).contactIds.add(contactId);
      }
    });
  });

  return [...tagMap.values()]
    .map((segment) => ({
      id: segment.id,
      name: segment.name,
      description: segment.description,
      audienceSize: segment.contactIds.size,
    }))
    .sort((left, right) => right.audienceSize - left.audienceSize || left.name.localeCompare(right.name));
};

const fetchWhatsAppAudienceBaseData = async () => {
  const [contacts, conversations] = await Promise.all([
    WhatsAppContact.find({})
      .sort({ lastActivityAt: -1, _id: -1 })
      .lean(),
    WhatsAppConversation.find({ channel: "whatsapp" })
      .select("contactId tags linkedLeadId")
      .populate("linkedLeadId", "name source sourceDetails phone optedIn optIn whatsappOptIn whatsappOptedIn marketingOptIn marketingConsent doNotContact unsubscribed")
      .lean(),
  ]);

  const conversationMap = new Map();
  conversations.forEach((conversation) => {
    const contactId = trimString(conversation.contactId?._id || conversation.contactId);
    if (!contactId) return;

    if (!conversationMap.has(contactId)) {
      conversationMap.set(contactId, {
        ...conversation,
        tags: normalizeAudienceTags(conversation.tags),
      });
      return;
    }

    const existing = conversationMap.get(contactId);
    existing.tags = normalizeAudienceTags([...(existing.tags || []), ...(conversation.tags || [])]);
    if (!existing.linkedLeadId && conversation.linkedLeadId) {
      existing.linkedLeadId = conversation.linkedLeadId;
    }
  });

  return {
    contacts: Array.isArray(contacts) ? contacts : [],
    conversations,
    conversationMap,
  };
};

const filterAudienceContacts = (contacts = [], query = {}) => {
  const search = trimString(query.search);
  if (!search) {
    return contacts;
  }

  const expression = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return contacts.filter((contact) =>
    expression.test(contact.name)
    || expression.test(contact.phone)
    || expression.test(contact.source)
    || expression.test(contact.tag)
  );
};

const listWhatsAppCampaignAudienceResources = async () => {
  const { contacts, conversations, conversationMap } = await fetchWhatsAppAudienceBaseData();

  const normalizedContacts = contacts
    .map((contact) => normalizeAudienceContactRecord({
      contact,
      conversation: conversationMap.get(trimString(contact._id || contact.id)) || null,
    }))
    .filter(Boolean);
  const segments = buildAudienceSegments(conversations);

  return {
    contacts: normalizedContacts,
    segments,
    summary: {
      totalContacts: normalizedContacts.length,
      optedInContacts: normalizedContacts.filter((contact) => contact.optedIn).length,
      totalTags: segments.length,
    },
  };
};

const listWhatsAppCampaignAudienceContacts = async (query = {}) => {
  const resources = await listWhatsAppCampaignAudienceResources();
  const filteredContacts = filterAudienceContacts(resources.contacts, query);
  const limit = Math.max(1, Math.min(100, Number(query.limit || 50) || 50));

  return {
    items: filteredContacts.slice(0, limit),
  };
};

const normalizeDateRangeBoundary = (value, boundary) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(`${boundary} must be a valid date`);
  }

  if (boundary === "dateTo" && /^\d{4}-\d{2}-\d{2}$/.test(trimString(value))) {
    date.setUTCHours(23, 59, 59, 999);
  }

  if (boundary === "dateFrom" && /^\d{4}-\d{2}-\d{2}$/.test(trimString(value))) {
    date.setUTCHours(0, 0, 0, 0);
  }

  return date;
};

const buildDateRangeFilter = (fromValue, toValue, fieldLabel) => {
  const from = normalizeDateRangeBoundary(fromValue, "dateFrom");
  const to = normalizeDateRangeBoundary(toValue, "dateTo");

  if (!from && !to) {
    return null;
  }

  const range = {};
  if (from) {
    range.$gte = from;
  }
  if (to) {
    range.$lte = to;
  }

  if (from && to && from > to) {
    throw createHttpError(`${fieldLabel} dateFrom cannot be after dateTo`);
  }

  return range;
};

const deriveContentLabel = (source = {}) => {
  const explicitLabel = trimString(source.contentLabel);
  if (explicitLabel) {
    return explicitLabel;
  }

  const templateName = trimString(source.templateName || source.template?.name);
  if (templateName) {
    return templateName;
  }

  const messageTitle = trimString(source.messageTitle);
  if (messageTitle) {
    return messageTitle;
  }

  const bodyText = trimString(source.bodyText);
  if (bodyText) {
    return bodyText.length > 80 ? `${bodyText.slice(0, 77)}...` : bodyText;
  }

  return "";
};

const defaultStatusForScheduleType = (scheduleType) => {
  if (scheduleType === "later") return "Scheduled";
  if (scheduleType === "send_now") return "Running";
  return "Draft";
};

const buildComposeCampaignText = (campaign = {}) => {
  const parts = [
    trimString(campaign.messageTitle),
    trimString(campaign.headerText),
    trimString(campaign.bodyText),
    trimString(campaign.ctaText) && trimString(campaign.ctaUrl)
      ? `${trimString(campaign.ctaText)}: ${trimString(campaign.ctaUrl)}`
      : trimString(campaign.ctaUrl),
  ].filter(Boolean);

  return parts.join("\n\n");
};

const toTemplateParameterList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          return item.type ? item : { type: "text", text: trimString(item.text || item.value) };
        }
        return { type: "text", text: trimString(item) };
      })
      .filter((item) => trimString(item?.text) || item?.type !== "text");
  }

  if (value && typeof value === "object") {
    return Object.values(value)
      .map((item) => ({ type: "text", text: trimString(item) }))
      .filter((item) => item.text);
  }

  if (trimString(value)) {
    return [{ type: "text", text: trimString(value) }];
  }

  return [];
};

const buildTemplateSendComponents = (templateVariables = {}) => {
  if (!templateVariables || typeof templateVariables !== "object" || Array.isArray(templateVariables)) {
    return [];
  }

  if (Array.isArray(templateVariables.components)) {
    return templateVariables.components;
  }

  const components = [];
  const headerParameters = toTemplateParameterList(templateVariables.header);
  const bodyParameters = toTemplateParameterList(templateVariables.body);
  const buttonParameters = Array.isArray(templateVariables.buttons) ? templateVariables.buttons : [];

  if (headerParameters.length) {
    components.push({
      type: "header",
      parameters: headerParameters,
    });
  }

  if (bodyParameters.length) {
    components.push({
      type: "body",
      parameters: bodyParameters,
    });
  }

  buttonParameters.forEach((button, index) => {
    if (!button || typeof button !== "object") {
      return;
    }

    const parameters = toTemplateParameterList(button.parameters || button.value || button.text);
    if (!parameters.length) {
      return;
    }

    components.push({
      type: "button",
      sub_type: trimString(button.sub_type || button.subType || "url").toLowerCase(),
      index: String(button.index ?? index),
      parameters,
    });
  });

  return components;
};

const buildCampaignPayloadSource = (payload = {}, current = {}) => {
  const template = payload.template && typeof payload.template === "object" ? payload.template : {};

  return {
    ...current,
    ...payload,
    templateId:
      hasOwnProperty(payload, "templateId")
        ? payload.templateId
        : hasOwnProperty(template, "id")
          ? template.id
          : current.templateId,
    templateName:
      hasOwnProperty(payload, "templateName")
        ? payload.templateName
        : hasOwnProperty(template, "name")
          ? template.name
          : current.templateName,
    scheduledAt:
      hasOwnProperty(payload, "scheduledAt")
        ? payload.scheduledAt
        : hasOwnProperty(payload, "scheduleAt")
          ? payload.scheduleAt
          : current.scheduledAt,
  };
};

const normalizeCampaignPayload = (payload = {}, options = {}) => {
  const partial = Boolean(options.partial);
  const current = toObject(options.current || {});
  const source = buildCampaignPayloadSource(payload, current);
  const normalized = {};

  if (!partial || hasOwnProperty(payload, "name")) {
    const name = trimString(source.name);
    if (!name) {
      throw createHttpError("name is required");
    }
    normalized.name = name;
  }

  if (!partial || hasOwnProperty(payload, "type")) {
    normalized.type = normalizeEnum(
      source.type,
      WHATSAPP_CAMPAIGN_TYPE_OPTIONS,
      "type"
    );
  }

  if (!partial || hasOwnProperty(payload, "channel")) {
    normalized.channel = normalizeEnum(
      source.channel,
      WHATSAPP_CAMPAIGN_CHANNEL_OPTIONS,
      "channel"
    );
  }

  if (!partial || hasOwnProperty(payload, "audienceType")) {
    normalized.audienceType = normalizeEnum(
      source.audienceType,
      WHATSAPP_CAMPAIGN_AUDIENCE_TYPE_OPTIONS,
      "audienceType"
    );
  }

  if (!partial || hasOwnProperty(payload, "contentMode")) {
    normalized.contentMode = normalizeEnum(
      source.contentMode,
      WHATSAPP_CAMPAIGN_CONTENT_MODE_OPTIONS,
      "contentMode",
      "compose"
    );
  }

  if (!partial || hasOwnProperty(payload, "scheduleType")) {
    normalized.scheduleType = normalizeEnum(
      source.scheduleType,
      WHATSAPP_CAMPAIGN_SCHEDULE_TYPE_OPTIONS,
      "scheduleType",
      "draft"
    );
  }

  if (!partial || hasOwnProperty(payload, "audienceSize")) {
    normalized.audienceSize = normalizeAudienceSize(source.audienceSize, { partial });
  }

  if (!partial || hasOwnProperty(payload, "segmentIds")) {
    normalized.segmentIds = normalizeStringArray(source.segmentIds, "segmentIds");
  }

  if (
    !partial
    || hasOwnProperty(payload, "manualContactIds")
    || hasOwnProperty(payload, "manualPhones")
  ) {
    const manualAudience = splitManualAudienceTokens({
      manualContactIds: source.manualContactIds,
      manualPhones: source.manualPhones,
      partial,
    });
    normalized.manualContactIds = manualAudience.manualContactIds;
    normalized.manualPhones = manualAudience.manualPhones;
  }

  if (!partial || hasOwnProperty(payload, "templateId") || hasOwnProperty(payload, "template")) {
    normalized.templateId = trimString(source.templateId);
  }

  if (!partial || hasOwnProperty(payload, "templateName") || hasOwnProperty(payload, "template")) {
    normalized.templateName = trimString(source.templateName);
  }

  if (!partial || hasOwnProperty(payload, "messageTitle")) {
    normalized.messageTitle = trimString(source.messageTitle);
  }

  if (!partial || hasOwnProperty(payload, "headerText")) {
    normalized.headerText = trimString(source.headerText);
  }

  if (!partial || hasOwnProperty(payload, "bodyText")) {
    normalized.bodyText = trimString(source.bodyText);
  }

  if (!partial || hasOwnProperty(payload, "ctaText")) {
    normalized.ctaText = trimString(source.ctaText);
  }

  if (!partial || hasOwnProperty(payload, "ctaUrl")) {
    normalized.ctaUrl = normalizeUrl(source.ctaUrl);
  }

  if (!partial || hasOwnProperty(payload, "quickReplies")) {
    normalized.quickReplies = normalizeStringArray(source.quickReplies, "quickReplies", { maxLength: 3 });
  }

  if (!partial || hasOwnProperty(payload, "templateVariables")) {
    normalized.templateVariables = normalizeTemplateVariables(source.templateVariables, { partial }) ?? {};
  }

  if (!partial || hasOwnProperty(payload, "notes")) {
    normalized.notes = trimString(source.notes);
  }

  if (!partial || hasOwnProperty(payload, "timezone")) {
    normalized.timezone = trimString(source.timezone) || DEFAULT_TIMEZONE;
  }

  if (!partial || hasOwnProperty(payload, "batchEnabled")) {
    normalized.batchEnabled = normalizeBoolean(source.batchEnabled, "batchEnabled", false);
  }

  if (!partial || hasOwnProperty(payload, "skipInactiveContacts")) {
    normalized.skipInactiveContacts = normalizeBoolean(
      source.skipInactiveContacts,
      "skipInactiveContacts",
      false
    );
  }

  if (!partial || hasOwnProperty(payload, "stopIfTemplateMissing")) {
    normalized.stopIfTemplateMissing = normalizeBoolean(
      source.stopIfTemplateMissing,
      "stopIfTemplateMissing",
      false
    );
  }

  if (!partial || hasOwnProperty(payload, "scheduledAt") || hasOwnProperty(payload, "scheduleAt") || hasOwnProperty(payload, "scheduleType")) {
    const effectiveScheduleType = normalized.scheduleType || trimString(current.scheduleType) || "draft";
    normalized.scheduledAt = effectiveScheduleType === "later"
      ? normalizeDate(source.scheduledAt, "scheduledAt")
      : null;
  }

  const effectiveContentMode = normalized.contentMode || trimString(current.contentMode) || "compose";
  const effectiveTemplateId = normalized.templateId !== undefined ? normalized.templateId : trimString(current.templateId);
  const effectiveBodyText = normalized.bodyText !== undefined ? normalized.bodyText : trimString(current.bodyText);
  const effectiveScheduleType = normalized.scheduleType || trimString(current.scheduleType) || "draft";
  const effectiveScheduledAt = normalized.scheduledAt !== undefined ? normalized.scheduledAt : current.scheduledAt || null;

  if (effectiveContentMode === "template" && !effectiveTemplateId) {
    throw createHttpError("templateId is required when contentMode is template");
  }

  if (effectiveContentMode === "compose" && !trimString(effectiveBodyText)) {
    throw createHttpError("bodyText is required when contentMode is compose");
  }

  if (effectiveScheduleType === "later" && !effectiveScheduledAt) {
    throw createHttpError("scheduledAt is required when scheduleType is later");
  }

  if (!partial || hasOwnProperty(payload, "status") || hasOwnProperty(payload, "scheduleType")) {
    if (hasOwnProperty(payload, "status")) {
      normalized.status = normalizeEnum(
        source.status,
        WHATSAPP_CAMPAIGN_STATUS_OPTIONS,
        "status"
      );
    } else {
      normalized.status = defaultStatusForScheduleType(effectiveScheduleType);
    }
  }

  const mergedForLabel = {
    ...current,
    ...normalized,
    templateName: normalized.templateName !== undefined ? normalized.templateName : current.templateName,
  };

  if (
    !partial
    || hasOwnProperty(payload, "contentLabel")
    || hasOwnProperty(payload, "templateName")
    || hasOwnProperty(payload, "template")
    || hasOwnProperty(payload, "messageTitle")
    || hasOwnProperty(payload, "bodyText")
  ) {
    normalized.contentLabel = trimString(source.contentLabel) || deriveContentLabel(mergedForLabel);
  }

  if (!partial) {
    normalized.stats = normalizeStats(source.stats || {});
    if (options.actorId) {
      normalized.createdBy = options.actorId;
      normalized.updatedBy = options.actorId;
    }
  } else if (options.actorId) {
    normalized.updatedBy = options.actorId;
  }

  return normalized;
};

const normalizeCampaignRecord = (campaignDoc) => {
  const plain = toObject(campaignDoc);
  const statsSource = plain.stats && typeof plain.stats === "object" ? plain.stats : plain;
  const stats = {
    ...DEFAULT_STATS,
    ...normalizeStats(statsSource),
  };
  const manualAudience = splitManualAudienceTokens({
    manualContactIds: plain.manualContactIds,
    manualPhones: plain.manualPhones,
  });

  return {
    id: trimString(plain._id || plain.id),
    _id: trimString(plain._id || plain.id),
    name: trimString(plain.name),
    type: trimString(plain.type),
    channel: trimString(plain.channel),
    status: trimString(plain.status),
    audienceType: trimString(plain.audienceType),
    audienceSize: toNonNegativeNumber(plain.audienceSize, 0),
    segmentIds: normalizeStringArray(plain.segmentIds, "segmentIds"),
    manualContactIds: manualAudience.manualContactIds,
    manualPhones: manualAudience.manualPhones,
    templateId: trimString(plain.templateId || plain.template?.id),
    templateName: trimString(plain.templateName || plain.template?.name),
    contentMode: trimString(plain.contentMode || "compose"),
    contentLabel: trimString(plain.contentLabel) || deriveContentLabel(plain),
    messageTitle: trimString(plain.messageTitle),
    headerText: trimString(plain.headerText),
    bodyText: trimString(plain.bodyText),
    ctaText: trimString(plain.ctaText),
    ctaUrl: trimString(plain.ctaUrl),
    quickReplies: normalizeStringArray(plain.quickReplies, "quickReplies", { maxLength: 3 }),
    templateVariables: normalizeTemplateVariables(plain.templateVariables) || {},
    scheduleType: trimString(plain.scheduleType || "draft"),
    scheduledAt: toIsoStringOrNull(plain.scheduledAt || plain.scheduleAt),
    scheduleAt: toIsoStringOrNull(plain.scheduledAt || plain.scheduleAt),
    timezone: trimString(plain.timezone) || DEFAULT_TIMEZONE,
    notes: trimString(plain.notes),
    batchEnabled: Boolean(plain.batchEnabled),
    skipInactiveContacts: Boolean(plain.skipInactiveContacts),
    stopIfTemplateMissing: Boolean(plain.stopIfTemplateMissing),
    stats,
    sentCount: stats.sent,
    deliveredCount: stats.delivered,
    readCount: stats.read,
    clickedCount: stats.clicked,
    failedCount: stats.failed,
    createdBy: normalizeCreatedBy(plain.createdBy),
    updatedBy: normalizeCreatedBy(plain.updatedBy),
    launchedBy: normalizeCreatedBy(plain.launchedBy),
    launchedAt: toIsoStringOrNull(plain.launchedAt),
    pausedAt: toIsoStringOrNull(plain.pausedAt),
    resumedAt: toIsoStringOrNull(plain.resumedAt),
    cancelledAt: toIsoStringOrNull(plain.cancelledAt),
    createdAt: toIsoStringOrNull(plain.createdAt),
    updatedAt: toIsoStringOrNull(plain.updatedAt),
  };
};

const withEligibilityMetadata = async (campaignDoc) => {
  const normalized = normalizeCampaignRecord(campaignDoc);
  const { evaluateCampaignAudience } = runtimePrivate;

  if (typeof evaluateCampaignAudience !== "function") {
    return normalized;
  }

  const eligibility = await evaluateCampaignAudience(campaignDoc);
  return {
    ...normalized,
    eligibleAudienceCount: Number(eligibility?.eligibleAudienceCount || 0),
    optedOutExcludedCount: Number(eligibility?.optedOutExcludedCount || 0),
    inactiveExcludedCount: Number(eligibility?.inactiveExcludedCount || 0),
    invalidManualPhoneCount: Number(eligibility?.invalidManualPhoneCount || 0),
  };
};

const buildCampaignFilter = (query = {}) => {
  const filter = {};
  const search = trimString(query.search);
  const status = trimString(query.status);
  const channel = trimString(query.channel);
  const updatedRange = buildDateRangeFilter(
    query.updatedFrom ?? query.dateFrom,
    query.updatedTo ?? query.dateTo,
    "updatedAt"
  );
  const scheduledRange = buildDateRangeFilter(
    query.scheduledFrom ?? query.scheduleFrom,
    query.scheduledTo ?? query.scheduleTo,
    "scheduledAt"
  );

  if (status) {
    filter.status = normalizeEnum(status, WHATSAPP_CAMPAIGN_STATUS_OPTIONS, "status");
  }

  if (channel) {
    filter.channel = normalizeEnum(channel, WHATSAPP_CAMPAIGN_CHANNEL_OPTIONS, "channel");
  }

  if (search) {
    const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { name: searchRegex },
      { templateName: searchRegex },
      { messageTitle: searchRegex },
      { bodyText: searchRegex },
      { notes: searchRegex },
    ];
  }

  if (updatedRange) {
    filter.updatedAt = updatedRange;
  }

  if (scheduledRange) {
    filter.scheduledAt = scheduledRange;
  }

  return filter;
};

const buildCampaignSort = (query = {}) => {
  const allowedSortFields = new Set(["updatedAt", "createdAt", "scheduledAt", "name", "status", "audienceSize"]);
  const sortBy = allowedSortFields.has(trimString(query.sortBy)) ? trimString(query.sortBy) : "updatedAt";
  const sortOrder = trimString(query.sortOrder || query.order).toLowerCase() === "asc" ? 1 : -1;

  return {
    [sortBy]: sortOrder,
    _id: sortOrder,
  };
};

const fetchCampaignById = async (id) => withCampaignPopulation(WhatsAppCampaign.findOne({ _id: id })).lean();

const getCampaignDocumentOrThrow = async (id) => {
  const campaign = await WhatsAppCampaign.findById(id);
  if (!campaign) {
    throw createHttpError("WhatsApp campaign not found", 404);
  }
  return campaign;
};

const listWhatsAppCampaigns = async (query = {}) => {
  const filter = buildCampaignFilter(query);
  const sort = buildCampaignSort(query);
  const campaigns = await withCampaignPopulation(
    WhatsAppCampaign.find(filter).sort(sort)
  ).lean();

  return campaigns.map((campaign) => normalizeCampaignRecord(campaign));
};

const getWhatsAppCampaignById = async (id) => {
  const campaign = await fetchCampaignById(id);
  if (!campaign) {
    return null;
  }
  return withEligibilityMetadata(campaign);
};

const createWhatsAppCampaign = async (payload = {}, actorId = null) => {
  const normalized = normalizeCampaignPayload(payload, { actorId, current: {} });
  const created = await WhatsAppCampaign.create(normalized);
  const campaign = await fetchCampaignById(created._id);
  return withEligibilityMetadata(campaign);
};

const updateWhatsAppCampaign = async (id, payload = {}, actorId = null) => {
  const campaign = await getCampaignDocumentOrThrow(id);
  const normalized = normalizeCampaignPayload(payload, {
    partial: true,
    actorId,
    current: campaign,
  });

  Object.assign(campaign, normalized);
  await campaign.save();

  const updated = await fetchCampaignById(campaign._id);
  return withEligibilityMetadata(updated);
};

const normalizeTestSendPhoneNumber = (value) => {
  const normalized = normalizePhone(value);
  const digits = normalized.replace(/[^\d]/g, "");

  if (!normalized || digits.length < 8 || digits.length > 15) {
    throw createHttpError("phoneNumber must be a valid WhatsApp number", 400, {
      code: "INVALID_PHONE_NUMBER",
    });
  }

  return normalized;
};

const testSendWhatsAppCampaign = async (id, payload = {}) => {
  const campaign = await getCampaignDocumentOrThrow(id);
  const normalizedCampaign = await withEligibilityMetadata(campaign);
  const phoneNumber = normalizeTestSendPhoneNumber(payload.phoneNumber || payload.to || payload.recipient);
  const context = {
    source: "whatsapp_campaign_test_send",
    campaignId: normalizedCampaign.id,
    isTestSend: true,
  };

  if (normalizedCampaign.contentMode === "template") {
    const preparedTemplate = await prepareTemplateMessage({
      template: {
        id: normalizedCampaign.templateId,
        name: normalizedCampaign.templateName,
        language: normalizedCampaign.templateVariables?.language || "en_US",
        components: buildTemplateSendComponents(normalizedCampaign.templateVariables),
      },
    });

    const sendResult = await sendMessage({
      to: phoneNumber,
      type: "template",
      template: preparedTemplate,
      context,
    });

    return {
      campaignId: normalizedCampaign.id,
      phoneNumber,
      note: "Template test message sent successfully. Campaign analytics were not changed.",
      previewMode: false,
      sent: true,
      modeUsed: "template",
      messageId: sendResult?.response?.messages?.[0]?.id || "",
    };
  }

  const text = buildComposeCampaignText(normalizedCampaign);
  if (!text) {
    throw createHttpError("This campaign does not have any sendable compose content", 400, {
      code: "EMPTY_COMPOSE_CONTENT",
      contentMode: "compose",
    });
  }

  const { contact, conversation } = await findContactConversationByPhone({
    phoneNumber,
    ContactModel: WhatsAppContact,
    ConversationModel: WhatsAppConversation,
  });

  assertOpenCustomerCareWindow({
    conversation,
    contact,
    createError: (message) => createHttpError(message, 400, {
      code: "OUTSIDE_CARE_WINDOW",
      contentMode: "compose",
    }),
    contextLabel: "Compose campaign test sends",
  });

  const sendResult = await sendMessage({
    to: phoneNumber,
    type: "text",
    text,
    context,
  });

  return {
    campaignId: normalizedCampaign.id,
    phoneNumber,
    note: "Compose campaign test message sent successfully. Campaign analytics were not changed.",
    previewMode: false,
    sent: true,
    modeUsed: "text",
    messageId: sendResult?.response?.messages?.[0]?.id || "",
  };
};

const ensureLaunchAllowed = async (campaign) => {
  if (campaign.status === "Cancelled") {
    throw createHttpError("Cancelled campaigns cannot be launched");
  }

  if (campaign.status === "Sent") {
    throw createHttpError("Sent campaigns cannot be launched again");
  }

  if (campaign.status === "Running") {
    const jobCount = await WhatsAppCampaignJob.countDocuments({ campaignId: campaign._id });
    if (jobCount > 0) {
      throw createHttpError("Campaign is already running");
    }

    const fallbackStatus = defaultStatusForScheduleType(trimString(campaign.scheduleType || "draft"));
    campaign.status = ["Draft", "Scheduled"].includes(fallbackStatus) ? fallbackStatus : "Draft";
    await campaign.save();
  }

  if (campaign.contentMode === "template" && campaign.stopIfTemplateMissing) {
    const template = await getTemplateById(campaign.templateId, { includeSyncFallback: false });
    if (!template) {
      throw createHttpError("Selected template could not be found for this campaign");
    }
  }
};

const launchWhatsAppCampaign = async (id, actorId = null) => {
  const campaign = await getCampaignDocumentOrThrow(id);
  await ensureLaunchAllowed(campaign);
  await launchCampaign({ campaignId: campaign._id, actorId });

  const updated = await fetchCampaignById(campaign._id);
  return withEligibilityMetadata(updated);
};

const pauseWhatsAppCampaign = async (id, actorId = null) => {
  const campaign = await getCampaignDocumentOrThrow(id);
  if (!["Scheduled", "Running"].includes(campaign.status)) {
    throw createHttpError("Only Scheduled or Running campaigns can be paused");
  }

  campaign.status = "Paused";
  campaign.pausedAt = new Date();
  if (actorId) {
    campaign.updatedBy = actorId;
  }

  await campaign.save();
  await pauseCampaignJobs(campaign._id);

  const updated = await fetchCampaignById(campaign._id);
  return withEligibilityMetadata(updated);
};

const resumeWhatsAppCampaign = async (id, actorId = null) => {
  const campaign = await getCampaignDocumentOrThrow(id);
  if (campaign.status !== "Paused") {
    throw createHttpError("Only Paused campaigns can be resumed");
  }

  campaign.status = "Running";
  campaign.resumedAt = new Date();
  if (actorId) {
    campaign.updatedBy = actorId;
  }

  await campaign.save();
  await resumeCampaignJobs(campaign._id);

  const updated = await fetchCampaignById(campaign._id);
  return withEligibilityMetadata(updated);
};

const cancelWhatsAppCampaign = async (id, actorId = null) => {
  const campaign = await getCampaignDocumentOrThrow(id);
  if (!["Scheduled", "Running", "Paused"].includes(campaign.status)) {
    throw createHttpError("Only Scheduled, Running, or Paused campaigns can be cancelled");
  }

  campaign.status = "Cancelled";
  campaign.cancelledAt = new Date();
  if (actorId) {
    campaign.updatedBy = actorId;
  }

  await campaign.save();
  await cancelCampaignJobs(campaign._id);

  const updated = await fetchCampaignById(campaign._id);
  return withEligibilityMetadata(updated);
};

const deleteWhatsAppCampaign = async (id) => {
  await deleteCampaignJobs(id);
  const deleted = await WhatsAppCampaign.findByIdAndDelete(id);
  if (!deleted) {
    throw createHttpError("WhatsApp campaign not found", 404);
  }

  return {
    id: trimString(deleted._id || deleted.id),
    success: true,
  };
};

module.exports = {
  WHATSAPP_CAMPAIGN_STATUS_OPTIONS,
  WHATSAPP_CAMPAIGN_TYPE_OPTIONS,
  WHATSAPP_CAMPAIGN_CHANNEL_OPTIONS,
  WHATSAPP_CAMPAIGN_SCHEDULE_TYPE_OPTIONS,
  WHATSAPP_CAMPAIGN_CONTENT_MODE_OPTIONS,
  WHATSAPP_CAMPAIGN_AUDIENCE_TYPE_OPTIONS,
  listWhatsAppCampaigns,
  getWhatsAppCampaignById,
  createWhatsAppCampaign,
  updateWhatsAppCampaign,
  testSendWhatsAppCampaign,
  launchWhatsAppCampaign,
  pauseWhatsAppCampaign,
  resumeWhatsAppCampaign,
  cancelWhatsAppCampaign,
  deleteWhatsAppCampaign,
  listWhatsAppCampaignAudienceResources,
  listWhatsAppCampaignAudienceContacts,
  __private: {
    normalizeCampaignPayload,
    normalizeCampaignRecord,
    normalizeStats,
    defaultStatusForScheduleType,
    buildComposeCampaignText,
    buildTemplateSendComponents,
    normalizeAudienceContactRecord,
    buildAudienceSegments,
    inferAudienceOptIn,
    resolveAudienceSourceLabel,
  },
};

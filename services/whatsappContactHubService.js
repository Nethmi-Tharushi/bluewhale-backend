const { Types } = require("mongoose");
const AdminUser = require("../models/AdminUser");
const WhatsAppContact = require("../models/WhatsAppContact");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const { normalizePhone } = require("./whatsappWebhookService");

const CONTACT_HUB_STATUS_OPTIONS = WhatsAppContact.CONTACT_HUB_STATUS_OPTIONS || [
  "New Lead",
  "Qualified",
  "Follow-up",
  "Customer",
  "Inactive",
];
const CONTACT_HUB_B2C_CONFIRMATION_OPTIONS = WhatsAppContact.CONTACT_HUB_B2C_CONFIRMATION_OPTIONS || [
  "Confirmed",
  "Pending",
  "Requested",
  "Opted Out",
];
const CONTACT_HUB_SORT_OPTIONS = new Set([
  "createdAt:desc",
  "lastSeenAt:desc",
  "name:asc",
  "status:asc",
]);
const CONTACT_HUB_ALLOWED_OWNER_ROLES = ["MainAdmin", "SalesAdmin", "SalesStaff"];

const trimString = (value) => String(value || "").trim();
const hasOwnProperty = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
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
const toDateOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const createHttpError = (message, status = 400, extras = {}) => {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extras);
  return error;
};

const normalizePhoneOrThrow = (value, fieldLabel = "phone") => {
  const normalized = normalizePhone(value);
  const digitsLength = normalized.length;

  if (!normalized || digitsLength < 8 || digitsLength > 15) {
    throw createHttpError(`${fieldLabel} must be a valid WhatsApp number`, 400, {
      code: "INVALID_PHONE_NUMBER",
      field: fieldLabel,
    });
  }

  return normalized;
};

const normalizeTags = (value) => {
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

const normalizeBooleanInput = (value, fieldLabel, defaultValue, { allowUndefined = true } = {}) => {
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    if (allowUndefined) return defaultValue;
    throw createHttpError(`${fieldLabel} is required`);
  }

  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return Boolean(value);

  const normalized = trimString(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  throw createHttpError(`${fieldLabel} must be true or false`);
};

const normalizeBooleanLike = (value) => {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return Boolean(value);

  const normalized = trimString(value).toLowerCase();
  if (["true", "yes", "y", "1", "opted_in", "subscribed"].includes(normalized)) return true;
  if (["false", "no", "n", "0", "opted_out", "unsubscribed"].includes(normalized)) return false;

  return null;
};

const normalizeEnum = (value, options, fieldLabel, defaultValue) => {
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw createHttpError(`${fieldLabel} is required`);
  }

  const normalized = trimString(value) || defaultValue || "";
  if (!options.includes(normalized)) {
    throw createHttpError(`${fieldLabel} must be one of: ${options.join(", ")}`);
  }

  return normalized;
};

const normalizeEmail = (value, { partial = false } = {}) => {
  if (value === undefined) {
    return partial ? undefined : "";
  }

  const normalized = trimString(value).toLowerCase();
  if (!normalized) return "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw createHttpError("email must be a valid email address");
  }

  return normalized;
};

const normalizeDate = (value, fieldLabel, { partial = false } = {}) => {
  if (value === undefined) {
    return partial ? undefined : null;
  }

  if (value === null || value === "") {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(`${fieldLabel} must be a valid date`);
  }

  return date;
};

const normalizePage = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

const normalizeLimit = (value, fallback = 20) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(200, Math.floor(parsed));
};

const normalizeSortBy = (value) => {
  const normalized = trimString(value || "createdAt:desc") || "createdAt:desc";
  if (!CONTACT_HUB_SORT_OPTIONS.has(normalized)) {
    throw createHttpError(`sortBy must be one of: ${[...CONTACT_HUB_SORT_OPTIONS].join(", ")}`);
  }
  return normalized;
};

const escapeCsvValue = (value) => {
  const stringValue = String(value ?? "");
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const normalizeLeadStatusToContactHubStatus = (value) => {
  const status = trimString(value);
  if (!status) return "";
  if (["Paid Client", "Paid Clients", "Converted Leads"].includes(status)) return "Customer";
  if (status === "Follow-up Required") return "Follow-up";
  if (status === "Not Interested") return "Inactive";
  if (["Prospects", "Leads"].includes(status)) return "New Lead";
  return "";
};

const resolveContactSource = (contact = {}, linkedLead = null) => {
  const candidates = [
    contact.source,
    contact.profile?.source,
    contact.profile?.sourceDetails,
    contact.profile?.leadSource,
    linkedLead?.source,
    linkedLead?.sourceDetails,
  ];

  for (const candidate of candidates) {
    const normalized = trimString(candidate);
    if (normalized && normalized.toLowerCase() !== "nothing selected") {
      return normalized;
    }
  }

  return "WhatsApp";
};

const inferContactOptIn = (contact = {}, linkedLead = null) => {
  if (typeof contact.optedIn === "boolean") {
    return contact.optedIn;
  }

  const negativeSignals = [
    contact.doNotContact,
    contact.profile?.doNotContact,
    contact.profile?.unsubscribed,
    contact.profile?.whatsappUnsubscribed,
    linkedLead?.doNotContact,
    linkedLead?.unsubscribed,
  ];

  if (negativeSignals.some((value) => normalizeBooleanLike(value) === true)) {
    return false;
  }

  const positiveSignals = [
    contact.optIn,
    contact.whatsappOptIn,
    contact.whatsappOptedIn,
    contact.marketingOptIn,
    contact.marketingConsent,
    contact.profile?.optedIn,
    contact.profile?.optIn,
    contact.profile?.whatsappOptIn,
    contact.profile?.whatsappOptedIn,
    contact.profile?.marketingOptIn,
    contact.profile?.marketingConsent,
    linkedLead?.optedIn,
    linkedLead?.optIn,
    linkedLead?.whatsappOptIn,
    linkedLead?.whatsappOptedIn,
    linkedLead?.marketingOptIn,
    linkedLead?.marketingConsent,
  ];

  for (const signal of positiveSignals) {
    const normalized = normalizeBooleanLike(signal);
    if (normalized !== null) {
      return normalized;
    }
  }

  return true;
};

const buildLatestConversationMap = (conversations = []) => {
  const map = new Map();

  conversations.forEach((conversation) => {
    const contactId = trimString(conversation.contactId?._id || conversation.contactId);
    if (!contactId) return;

    const lastSeenCandidates = [
      conversation.lastMessageAt,
      conversation.lastIncomingAt,
      conversation.lastOutgoingAt,
      conversation.updatedAt,
      conversation.createdAt,
    ]
      .map((value) => toDateOrNull(value))
      .filter(Boolean);

    const lastSeenAt = lastSeenCandidates.length
      ? new Date(Math.max(...lastSeenCandidates.map((value) => value.getTime())))
      : null;

    if (!map.has(contactId)) {
      map.set(contactId, {
        ...conversation,
        tags: normalizeTags(conversation.tags),
        lastSeenAt,
      });
      return;
    }

    const existing = map.get(contactId);
    const existingTime = existing.lastSeenAt ? new Date(existing.lastSeenAt).getTime() : 0;
    const candidateTime = lastSeenAt ? lastSeenAt.getTime() : 0;
    existing.tags = normalizeTags([...(existing.tags || []), ...(conversation.tags || [])]);

    if (conversation.linkedLeadId && !existing.linkedLeadId) {
      existing.linkedLeadId = conversation.linkedLeadId;
    }

    if (conversation.agentId && !existing.agentId) {
      existing.agentId = conversation.agentId;
    }

    if (candidateTime >= existingTime) {
      existing.lastSeenAt = lastSeenAt || existing.lastSeenAt || null;
      existing.lastMessageAt = conversation.lastMessageAt || existing.lastMessageAt || null;
      existing.lastIncomingAt = conversation.lastIncomingAt || existing.lastIncomingAt || null;
      existing.lastOutgoingAt = conversation.lastOutgoingAt || existing.lastOutgoingAt || null;
      existing.notes = Array.isArray(conversation.notes) ? conversation.notes : existing.notes;
    }
  });

  return map;
};

const buildMessageStatsMap = (messages = []) => {
  const map = new Map();

  messages.forEach((message) => {
    const contactId = trimString(message.contactId?._id || message.contactId);
    if (!contactId) return;

    const timestamp = normalizeDate(message.timestamp || message.createdAt, "timestamp", { partial: true });
    const entry = map.get(contactId) || { totalMessages: 0, lastSeenAt: null };
    entry.totalMessages += 1;

    if (timestamp && (!entry.lastSeenAt || timestamp.getTime() > entry.lastSeenAt.getTime())) {
      entry.lastSeenAt = timestamp;
    }

    map.set(contactId, entry);
  });

  return map;
};

const resolveConversationNotes = (conversation = {}) => {
  const notes = Array.isArray(conversation.notes) ? conversation.notes : [];
  if (!notes.length) return "";
  const latest = notes[notes.length - 1];
  return trimString(latest?.text);
};

const buildContactHubRecord = ({ contact = {}, conversation = null, messageStats = null } = {}) => {
  const sourceContact = toObject(contact);
  const sourceConversation = toObject(conversation);
  const linkedLead = sourceConversation.linkedLeadId && typeof sourceConversation.linkedLeadId === "object"
    ? sourceConversation.linkedLeadId
    : null;
  const phone = trimString(
    sourceContact.phone
    || sourceContact.normalizedPhone
    || sourceContact.waId
    || linkedLead?.phone
  );

  if (!phone) {
    return null;
  }

  const tags = normalizeTags([
    ...(Array.isArray(sourceContact.tags) ? sourceContact.tags : []),
    ...(Array.isArray(sourceConversation.tags) ? sourceConversation.tags : []),
    ...(Array.isArray(linkedLead?.tags) ? linkedLead.tags : []),
  ]);
  const optedIn = inferContactOptIn(sourceContact, linkedLead);
  const accountOwnerId = trimString(
    sourceContact.accountOwnerId?._id
    || sourceContact.accountOwnerId
    || sourceConversation.agentId?._id
    || sourceConversation.agentId
  );
  const accountOwner = trimString(
    sourceContact.accountOwner
    || sourceContact.accountOwnerId?.name
    || sourceConversation.agentId?.name
  );
  const totalMessages = Number(
    messageStats?.totalMessages
    ?? sourceContact.totalMessages
    ?? 0
  );
  const lastSeenAt =
    toDateOrNull(sourceContact.lastSeenAt)
    || messageStats?.lastSeenAt
    || toDateOrNull(sourceConversation.lastSeenAt)
    || toDateOrNull(sourceContact.lastActivityAt)
    || null;
  const requestedStatus = trimString(sourceContact.status || normalizeLeadStatusToContactHubStatus(linkedLead?.status));
  const status = CONTACT_HUB_STATUS_OPTIONS.includes(requestedStatus) ? requestedStatus : "New Lead";
  const requestedB2C = trimString(sourceContact.b2cConfirmation);
  const b2cConfirmation = CONTACT_HUB_B2C_CONFIRMATION_OPTIONS.includes(requestedB2C)
    ? requestedB2C
    : optedIn
      ? "Confirmed"
      : "Opted Out";

  return {
    id: trimString(sourceContact._id || sourceContact.id),
    name: trimString(sourceContact.name || sourceContact.profile?.name || linkedLead?.name || phone) || phone,
    phone,
    normalizedPhone: trimString(sourceContact.normalizedPhone || normalizePhone(phone)),
    email: trimString(sourceContact.email || sourceContact.profile?.email || linkedLead?.email).toLowerCase(),
    tags,
    tag: tags[0] || "",
    createdAt: toIsoStringOrNull(sourceContact.createdAt),
    status,
    accountOwner,
    accountOwnerId,
    source: resolveContactSource(sourceContact, linkedLead),
    b2cConfirmation,
    optedIn,
    city: trimString(sourceContact.city || sourceContact.profile?.city || linkedLead?.city),
    notes: trimString(sourceContact.notes || resolveConversationNotes(sourceConversation)),
    lastSeenAt: toIsoStringOrNull(lastSeenAt),
    totalMessages,
    externalContactId: trimString(sourceContact.externalContactId),
  };
};

const loadHydratedContactHubRecords = async () => {
  const [contacts, conversations, messages] = await Promise.all([
    WhatsAppContact.find({})
      .sort({ createdAt: -1, _id: -1 })
      .lean(),
    WhatsAppConversation.find({ channel: "whatsapp" })
      .populate(
        "linkedLeadId",
        "name email phone source sourceDetails status city tags optedIn optIn whatsappOptIn whatsappOptedIn marketingOptIn marketingConsent doNotContact unsubscribed"
      )
      .populate("agentId", "_id name email role")
      .lean(),
    WhatsAppMessage.find({})
      .select("contactId timestamp createdAt")
      .sort({ timestamp: -1, createdAt: -1 })
      .lean(),
  ]);

  const conversationMap = buildLatestConversationMap(conversations);
  const messageStatsMap = buildMessageStatsMap(messages);

  return (Array.isArray(contacts) ? contacts : [])
    .map((contact) =>
      buildContactHubRecord({
        contact,
        conversation: conversationMap.get(trimString(contact._id || contact.id)) || null,
        messageStats: messageStatsMap.get(trimString(contact._id || contact.id)) || null,
      })
    )
    .filter(Boolean);
};

const matchesExactFilter = (actualValue, expectedValue) =>
  trimString(actualValue).toLowerCase() === trimString(expectedValue).toLowerCase();

const filterContactHubRecords = (records = [], query = {}) => {
  const search = trimString(query.search);
  const status = trimString(query.status);
  const source = trimString(query.source);
  const accountOwner = trimString(query.accountOwner);
  const optedInFilter =
    query.optedIn === undefined || query.optedIn === ""
      ? undefined
      : normalizeBooleanInput(query.optedIn, "optedIn", undefined, { allowUndefined: true });

  let items = Array.isArray(records) ? [...records] : [];

  if (search) {
    const expression = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    items = items.filter((record) =>
      expression.test(record.name)
      || expression.test(record.phone)
      || expression.test(record.email)
      || expression.test(record.source)
      || expression.test(record.status)
      || expression.test(record.accountOwner)
      || expression.test(record.city)
      || expression.test(record.notes)
      || record.tags.some((tag) => expression.test(tag))
    );
  }

  if (status) {
    items = items.filter((record) => matchesExactFilter(record.status, status));
  }

  if (source) {
    items = items.filter((record) => matchesExactFilter(record.source, source));
  }

  if (accountOwner) {
    items = items.filter((record) => matchesExactFilter(record.accountOwner, accountOwner));
  }

  if (typeof optedInFilter === "boolean") {
    items = items.filter((record) => record.optedIn === optedInFilter);
  }

  return items;
};

const sortContactHubRecords = (records = [], sortBy = "createdAt:desc") => {
  const [field, direction] = normalizeSortBy(sortBy).split(":");
  const sign = direction === "asc" ? 1 : -1;

  return [...records].sort((left, right) => {
    let leftValue = left[field];
    let rightValue = right[field];

    if (["createdAt", "lastSeenAt"].includes(field)) {
      leftValue = leftValue ? new Date(leftValue).getTime() : 0;
      rightValue = rightValue ? new Date(rightValue).getTime() : 0;
    } else {
      leftValue = trimString(leftValue).toLowerCase();
      rightValue = trimString(rightValue).toLowerCase();
    }

    if (leftValue === rightValue) {
      return trimString(left.id).localeCompare(trimString(right.id));
    }

    return leftValue > rightValue ? sign : -sign;
  });
};

const buildContactHubSummary = (records = []) => ({
  totalContacts: records.length,
  optedInContacts: records.filter((record) => record.optedIn).length,
  newLeadCount: records.filter((record) => record.status === "New Lead").length,
  qualifiedCount: records.filter((record) => record.status === "Qualified").length,
});

const listWhatsAppContactHub = async (query = {}) => {
  const page = normalizePage(query.page, 1);
  const limit = normalizeLimit(query.limit, 20);
  const sortBy = normalizeSortBy(query.sortBy);
  const hydratedRecords = await loadHydratedContactHubRecords();
  const filteredRecords = sortContactHubRecords(filterContactHubRecords(hydratedRecords, query), sortBy);
  const total = filteredRecords.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const startIndex = (page - 1) * limit;
  const items = filteredRecords.slice(startIndex, startIndex + limit);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
    summary: buildContactHubSummary(filteredRecords),
  };
};

const listAllWhatsAppContactHubRecords = async (query = {}) =>
  sortContactHubRecords(filterContactHubRecords(await loadHydratedContactHubRecords(), query), query.sortBy || "createdAt:desc");

const resolveOwnerSnapshot = async ({ accountOwnerId, accountOwner, current = {} } = {}) => {
  if (accountOwnerId === undefined && accountOwner === undefined) {
    return {
      accountOwnerId: current.accountOwnerId || null,
      accountOwner: trimString(current.accountOwner || ""),
    };
  }

  if (accountOwnerId === null || accountOwnerId === "") {
    return {
      accountOwnerId: null,
      accountOwner: trimString(accountOwner),
    };
  }

  if (accountOwnerId !== undefined) {
    if (!Types.ObjectId.isValid(String(accountOwnerId))) {
      throw createHttpError("accountOwnerId must be a valid admin id");
    }

    const owner = await AdminUser.findById(accountOwnerId).select("_id name email role");
    if (!owner) {
      throw createHttpError("accountOwnerId does not match an admin user", 400, {
        code: "INVALID_ACCOUNT_OWNER",
      });
    }

    return {
      accountOwnerId: owner._id,
      accountOwner: trimString(accountOwner || owner.name),
    };
  }

  return {
    accountOwnerId:
      hasOwnProperty(current, "accountOwnerId") && trimString(current.accountOwner) !== trimString(accountOwner)
        ? null
        : current.accountOwnerId || null,
    accountOwner: trimString(accountOwner),
  };
};

const normalizeContactHubPayload = async (payload = {}, options = {}) => {
  const partial = Boolean(options.partial);
  const current = toObject(options.current);
  const normalized = {};
  const body = payload && typeof payload === "object" ? payload : {};

  if (!partial || hasOwnProperty(body, "name")) {
    const name = trimString(body.name);
    if (!name) {
      throw createHttpError("name is required");
    }
    normalized.name = name;
  }

  if (!partial || hasOwnProperty(body, "phone")) {
    normalized.phone = normalizePhoneOrThrow(body.phone, "phone");
    normalized.normalizedPhone = normalized.phone;
    if (!trimString(current.waId)) {
      normalized.waId = normalized.phone;
    }
  }

  if (!partial || hasOwnProperty(body, "email")) {
    normalized.email = normalizeEmail(body.email, { partial });
  }

  if (!partial || hasOwnProperty(body, "tags")) {
    normalized.tags = normalizeTags(body.tags);
  }

  if (!partial || hasOwnProperty(body, "status")) {
    normalized.status = normalizeEnum(body.status, CONTACT_HUB_STATUS_OPTIONS, "status", current.status || "New Lead");
  }

  if (!partial || hasOwnProperty(body, "source")) {
    normalized.source = trimString(body.source || current.source || "WhatsApp") || "WhatsApp";
  }

  if (!partial || hasOwnProperty(body, "city")) {
    normalized.city = trimString(body.city);
  }

  if (!partial || hasOwnProperty(body, "notes")) {
    normalized.notes = trimString(body.notes);
  }

  if (!partial || hasOwnProperty(body, "lastSeenAt")) {
    normalized.lastSeenAt = normalizeDate(body.lastSeenAt, "lastSeenAt", { partial });
  }

  if (!partial || hasOwnProperty(body, "optedIn")) {
    normalized.optedIn = normalizeBooleanInput(body.optedIn, "optedIn", current.optedIn ?? true, { allowUndefined: partial });
  }

  if (!partial || hasOwnProperty(body, "b2cConfirmation")) {
    normalized.b2cConfirmation = normalizeEnum(
      body.b2cConfirmation,
      CONTACT_HUB_B2C_CONFIRMATION_OPTIONS,
      "b2cConfirmation",
      current.b2cConfirmation || "Confirmed"
    );
  }

  if (normalized.optedIn === false) {
    normalized.b2cConfirmation = "Opted Out";
  } else if (
    normalized.optedIn === true
    && normalized.b2cConfirmation === "Opted Out"
    && !(hasOwnProperty(body, "b2cConfirmation") && trimString(body.b2cConfirmation) === "Opted Out")
  ) {
    normalized.b2cConfirmation = "Confirmed";
  } else if (
    normalized.b2cConfirmation === "Opted Out"
    && !hasOwnProperty(body, "optedIn")
  ) {
    normalized.optedIn = false;
  }

  if (
    !partial
    || hasOwnProperty(body, "accountOwner")
    || hasOwnProperty(body, "accountOwnerId")
  ) {
    Object.assign(
      normalized,
      await resolveOwnerSnapshot({
        accountOwnerId: hasOwnProperty(body, "accountOwnerId") ? body.accountOwnerId : undefined,
        accountOwner: hasOwnProperty(body, "accountOwner") ? body.accountOwner : undefined,
        current,
      })
    );
  }

  if (options.actorId) {
    normalized.updatedBy = options.actorId;
    if (!current._id) {
      normalized.createdBy = options.actorId;
    }
  }

  return normalized;
};

const buildPhoneLookupFilter = (normalizedPhone, excludeId = null) => {
  const candidates = [...new Set([
    normalizedPhone,
    `+${normalizedPhone}`,
  ])];
  const filter = {
    $or: [
      { normalizedPhone },
      { phone: { $in: candidates } },
      { waId: { $in: candidates } },
    ],
  };

  if (excludeId) {
    filter._id = { $ne: excludeId };
  }

  return filter;
};

const saveContactDocument = async (contact, updates = {}) => {
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      contact[key] = value;
    }
  });

  await contact.save();
  return contact;
};

const getContactDocumentOrThrow = async (id) => {
  if (!Types.ObjectId.isValid(String(id || ""))) {
    throw createHttpError("Invalid WhatsApp contact id", 400);
  }

  const contact = await WhatsAppContact.findById(id);
  if (!contact) {
    throw createHttpError("WhatsApp contact not found", 404);
  }

  return contact;
};

const toApiContactRecord = async (contactDoc) => {
  const contact = toObject(contactDoc);
  const allRecords = await loadHydratedContactHubRecords();
  return allRecords.find((item) => item.id === trimString(contact._id || contact.id)) || buildContactHubRecord({ contact });
};

const createWhatsAppContactHubRecord = async (payload = {}, actorId = null) => {
  const requiredName = trimString(payload?.name);
  if (!requiredName) {
    throw createHttpError("name is required");
  }

  const normalizedPhone = normalizePhoneOrThrow(payload?.phone, "phone");
  const existing = await WhatsAppContact.findOne(buildPhoneLookupFilter(normalizedPhone));

  if (existing) {
    const normalized = await normalizeContactHubPayload(
      {
        ...payload,
        name: requiredName,
        phone: normalizedPhone,
      },
      {
        partial: true,
        current: existing,
        actorId,
      }
    );
    await saveContactDocument(existing, normalized);
    return {
      created: false,
      item: await toApiContactRecord(existing),
    };
  }

  const normalized = await normalizeContactHubPayload(
    {
      ...payload,
      name: requiredName,
      phone: normalizedPhone,
    },
    { current: {}, actorId }
  );
  const created = await WhatsAppContact.create(normalized);
  return {
    created: true,
    item: await toApiContactRecord(created),
  };
};

const updateWhatsAppContactHubRecord = async (id, payload = {}, actorId = null) => {
  const contact = await getContactDocumentOrThrow(id);
  const normalized = await normalizeContactHubPayload(payload, {
    partial: true,
    current: contact,
    actorId,
  });

  if (normalized.normalizedPhone) {
    const duplicate = await WhatsAppContact.findOne(buildPhoneLookupFilter(normalized.normalizedPhone, contact._id));
    if (duplicate) {
      throw createHttpError("A WhatsApp contact with this phone already exists", 409, {
        code: "DUPLICATE_CONTACT_PHONE",
      });
    }
  }

  await saveContactDocument(contact, normalized);
  return toApiContactRecord(contact);
};

const updateWhatsAppContactHubStatus = async (id, status, actorId = null) =>
  updateWhatsAppContactHubRecord(id, { status }, actorId);

const bulkUpdateWhatsAppContactHub = async ({ ids = [], action = "", payload = {}, actorId = null } = {}) => {
  if (!Array.isArray(ids) || ids.length < 1) {
    throw createHttpError("ids must be a non-empty array");
  }

  const normalizedIds = [...new Set(ids.map((item) => trimString(item)).filter(Boolean))];
  if (normalizedIds.some((id) => !Types.ObjectId.isValid(id))) {
    throw createHttpError("ids must contain valid contact ids");
  }

  if (!["update_status", "toggle_opt_in"].includes(action)) {
    throw createHttpError("action must be one of: update_status, toggle_opt_in");
  }

  const contacts = await Promise.all(normalizedIds.map((id) => getContactDocumentOrThrow(id)));

  if (action === "update_status") {
    const status = normalizeEnum(payload.status, CONTACT_HUB_STATUS_OPTIONS, "payload.status");
    const updatedItems = await Promise.all(
      contacts.map(async (contact) => {
        await saveContactDocument(contact, {
          status,
          updatedBy: actorId || null,
        });
        return toApiContactRecord(contact);
      })
    );

    return {
      count: updatedItems.length,
      action,
      items: updatedItems,
    };
  }

  const updatedItems = await Promise.all(
    contacts.map(async (contact) => {
      const nextOptIn = !Boolean(contact.optedIn);
      await saveContactDocument(contact, {
        optedIn: nextOptIn,
        b2cConfirmation: nextOptIn
          ? trimString(contact.b2cConfirmation) === "Opted Out"
            ? "Confirmed"
            : trimString(contact.b2cConfirmation) || "Confirmed"
          : "Opted Out",
        updatedBy: actorId || null,
      });
      return toApiContactRecord(contact);
    })
  );

  return {
    count: updatedItems.length,
    action,
    items: updatedItems,
  };
};

const exportWhatsAppContactHubCsv = async (query = {}) => {
  const records = await listAllWhatsAppContactHubRecords(query);
  const headers = [
    "id",
    "name",
    "phone",
    "email",
    "tags",
    "createdAt",
    "status",
    "accountOwner",
    "source",
    "b2cConfirmation",
    "optedIn",
    "city",
    "notes",
    "lastSeenAt",
    "totalMessages",
  ];

  const rows = records.map((record) =>
    [
      record.id,
      record.name,
      record.phone,
      record.email,
      record.tags.join("; "),
      record.createdAt,
      record.status,
      record.accountOwner,
      record.source,
      record.b2cConfirmation,
      record.optedIn,
      record.city,
      record.notes,
      record.lastSeenAt,
      record.totalMessages,
    ]
      .map(escapeCsvValue)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
};

const getWhatsAppContactHubMeta = async () => {
  const [records, owners] = await Promise.all([
    listAllWhatsAppContactHubRecords({}),
    AdminUser.find({ role: { $in: CONTACT_HUB_ALLOWED_OWNER_ROLES } })
      .select("_id name email role")
      .sort({ name: 1, createdAt: 1 })
      .lean(),
  ]);

  const sources = [...new Set(records.map((record) => trimString(record.source)).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
  const availableOwners = [...new Map(
    [
      ...(Array.isArray(owners) ? owners : []).map((owner) => [
        trimString(owner._id || owner.id),
        {
          id: trimString(owner._id || owner.id),
          name: trimString(owner.name),
          email: trimString(owner.email),
          role: trimString(owner.role),
        },
      ]),
      ...records
        .filter((record) => record.accountOwnerId || record.accountOwner)
        .map((record) => [
          trimString(record.accountOwnerId || record.accountOwner),
          {
            id: trimString(record.accountOwnerId),
            name: trimString(record.accountOwner),
            email: "",
            role: "",
          },
        ]),
    ],
  ).values()].filter((owner) => owner.name);

  return {
    statuses: CONTACT_HUB_STATUS_OPTIONS,
    sources: sources.length ? sources : ["WhatsApp"],
    owners: availableOwners,
  };
};

module.exports = {
  CONTACT_HUB_STATUS_OPTIONS,
  CONTACT_HUB_B2C_CONFIRMATION_OPTIONS,
  listWhatsAppContactHub,
  listAllWhatsAppContactHubRecords,
  createWhatsAppContactHubRecord,
  updateWhatsAppContactHubRecord,
  updateWhatsAppContactHubStatus,
  bulkUpdateWhatsAppContactHub,
  exportWhatsAppContactHubCsv,
  getWhatsAppContactHubMeta,
  buildContactHubRecord,
  buildContactHubSummary,
  inferContactOptIn,
  resolveContactSource,
  normalizeTags,
  __private: {
    normalizeContactHubPayload,
    filterContactHubRecords,
    sortContactHubRecords,
    buildLatestConversationMap,
    buildMessageStatsMap,
    normalizeLeadStatusToContactHubStatus,
  },
};

const { Types } = require("mongoose");

const ActivityLog = require("../models/ActivityLog");
const AdminUser = require("../models/AdminUser");
const Lead = require("../models/Lead");
const WhatsAppAiAgentInterest = require("../models/WhatsAppAiAgentInterest");
const WhatsAppAiAgentLog = require("../models/WhatsAppAiAgentLog");
const WhatsAppAiAgentSettings = require("../models/WhatsAppAiAgentSettings");
const WhatsAppAutomation = require("../models/WhatsAppAutomation");
const WhatsAppBusinessProfile = require("../models/WhatsAppBusinessProfile");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppForm = require("../models/WhatsAppForm");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const WhatsAppQuickReply = require("../models/WhatsAppQuickReply");
const { listAvailableProductCollections } = require("./whatsappProductCollectionService");
const { sendMessage } = require("./whatsappService");
const { generateGroundedWhatsAppReply, generateOpenScopeWhatsAppReply, isOpenAiConfigured } = require("./openaiService");
const { getQualificationFieldPrompt } = require("../prompts/whatsappAiAgentPrompts");

const ROLLOUT_STATUS_OPTIONS = WhatsAppAiAgentSettings.ROLLOUT_STATUS_OPTIONS || ["draft", "interest_collected", "pilot", "live"];
const AGENT_TYPE_OPTIONS = WhatsAppAiAgentSettings.AGENT_TYPE_OPTIONS || ["sales_agent", "faq_responder", "lead_qualifier"];
const INTEREST_STATUS_OPTIONS = WhatsAppAiAgentInterest.INTEREST_STATUS_OPTIONS || ["new", "contacted", "qualified", "closed"];
const RESPONSE_SOURCE_OPTIONS = WhatsAppAiAgentLog.RESPONSE_SOURCE_OPTIONS || [
  "ai",
  "knowledge_base",
  "catalog",
  "qualification_flow",
  "handoff",
  "fallback",
];

const DEFAULT_SINGLETON_KEY = "default";
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const RECENT_WINDOW_DAYS = 30;
const HUMAN_HANDOFF_PATTERN = /\b(human|agent|representative|person|staff|team member|someone|call me)\b/i;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "be",
  "for",
  "from",
  "hello",
  "help",
  "hi",
  "i",
  "is",
  "me",
  "my",
  "need",
  "of",
  "on",
  "or",
  "please",
  "the",
  "to",
  "want",
  "with",
]);

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  rolloutStatus: "draft",
  defaultAgentType: "sales_agent",
  webinarUrl: "",
  interestFormEnabled: true,
  pricing: {
    currency: "USD",
    amount: 250,
    conversationQuota: 2000,
  },
  salesAgent: {
    enabled: false,
    catalogEnabled: true,
    handoffEnabled: true,
    fallbackMessage: "",
  },
  faqResponder: {
    enabled: false,
    knowledgeBaseEnabled: true,
    handoffEnabled: true,
    fallbackMessage: "",
  },
  leadQualifier: {
    enabled: false,
    qualificationFields: [],
    crmSyncTarget: "",
    handoffEnabled: true,
    fallbackMessage: "",
  },
});

const trimString = (value) => String(value || "").trim();
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toObjectIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};
const toPlainObject = (value) => {
  if (!value) return {};
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};

const createHttpError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const clampPositiveInteger = (value, fallback, maxValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized < 1) return fallback;
  if (maxValue && normalized > maxValue) return maxValue;
  return normalized;
};

const parseBooleanFilter = (value, fieldLabel) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return Boolean(value);
  if (typeof value === "string") {
    const normalized = trimString(value).toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  throw createHttpError(`${fieldLabel} must be true or false`);
};

const normalizeBoolean = (value, fieldLabel, defaultValue) => {
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return Boolean(value);
  if (typeof value === "string") {
    const normalized = trimString(value).toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  throw createHttpError(`${fieldLabel} must be boolean`);
};

const normalizeEnum = (value, fieldLabel, options, defaultValue) => {
  if (value === undefined) return defaultValue;
  const normalized = trimString(value) || defaultValue;
  if (!options.includes(normalized)) {
    throw createHttpError(`${fieldLabel} must be one of: ${options.join(", ")}`);
  }
  return normalized;
};

const normalizeString = (value, fieldLabel, defaultValue = "") => {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "string" && typeof value !== "number") {
    throw createHttpError(`${fieldLabel} must be a string`);
  }
  return trimString(value);
};

const normalizeOptionalUrl = (value, fieldLabel, defaultValue = "") => {
  const normalized = normalizeString(value, fieldLabel, defaultValue);
  if (!normalized) return "";
  try {
    return new URL(normalized).toString();
  } catch (_error) {
    throw createHttpError(`${fieldLabel} must be a valid URL`);
  }
};

const normalizeNonNegativeNumber = (value, fieldLabel, defaultValue) => {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createHttpError(`${fieldLabel} must be greater than or equal to 0`);
  }
  return parsed;
};

const normalizeCurrency = (value, defaultValue = "USD") => {
  const normalized = normalizeString(value, "pricing.currency", defaultValue).toUpperCase();
  if (!normalized || normalized.length < 3 || normalized.length > 10) {
    throw createHttpError("pricing.currency must be a valid code");
  }
  return normalized;
};

const normalizeStringArray = (value, fieldLabel, defaultValue = []) => {
  if (value === undefined) return defaultValue;
  if (!Array.isArray(value)) {
    throw createHttpError(`${fieldLabel} must be an array`);
  }

  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const trimmed = trimString(item);
    if (!trimmed) continue;
    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push(trimmed);
  }
  return normalized;
};

const normalizeAgentTypeArray = (value, fieldLabel, defaultValue = []) => {
  const normalized = normalizeStringArray(value, fieldLabel, defaultValue);
  normalized.forEach((item) => {
    if (!AGENT_TYPE_OPTIONS.includes(item)) {
      throw createHttpError(`${fieldLabel} must contain only: ${AGENT_TYPE_OPTIONS.join(", ")}`);
    }
  });
  return normalized;
};

const normalizeSettingsPayload = (payload = {}, current = DEFAULT_SETTINGS) => {
  const currentSalesAgent = current.salesAgent || DEFAULT_SETTINGS.salesAgent;
  const currentFaqResponder = current.faqResponder || DEFAULT_SETTINGS.faqResponder;
  const currentLeadQualifier = current.leadQualifier || DEFAULT_SETTINGS.leadQualifier;
  const currentPricing = current.pricing || DEFAULT_SETTINGS.pricing;

  if (payload.pricing !== undefined && (payload.pricing === null || typeof payload.pricing !== "object" || Array.isArray(payload.pricing))) {
    throw createHttpError("pricing must be an object");
  }
  if (payload.salesAgent !== undefined && (payload.salesAgent === null || typeof payload.salesAgent !== "object" || Array.isArray(payload.salesAgent))) {
    throw createHttpError("salesAgent must be an object");
  }
  if (payload.faqResponder !== undefined && (payload.faqResponder === null || typeof payload.faqResponder !== "object" || Array.isArray(payload.faqResponder))) {
    throw createHttpError("faqResponder must be an object");
  }
  if (payload.leadQualifier !== undefined && (payload.leadQualifier === null || typeof payload.leadQualifier !== "object" || Array.isArray(payload.leadQualifier))) {
    throw createHttpError("leadQualifier must be an object");
  }

  const pricingPayload = payload.pricing || {};
  const salesAgentPayload = payload.salesAgent || {};
  const faqResponderPayload = payload.faqResponder || {};
  const leadQualifierPayload = payload.leadQualifier || {};

  return {
    enabled: normalizeBoolean(payload.enabled, "enabled", Boolean(current.enabled)),
    rolloutStatus: normalizeEnum(payload.rolloutStatus, "rolloutStatus", ROLLOUT_STATUS_OPTIONS, current.rolloutStatus || DEFAULT_SETTINGS.rolloutStatus),
    defaultAgentType: normalizeEnum(payload.defaultAgentType, "defaultAgentType", AGENT_TYPE_OPTIONS, current.defaultAgentType || DEFAULT_SETTINGS.defaultAgentType),
    webinarUrl: normalizeOptionalUrl(payload.webinarUrl, "webinarUrl", current.webinarUrl || DEFAULT_SETTINGS.webinarUrl),
    interestFormEnabled: normalizeBoolean(payload.interestFormEnabled, "interestFormEnabled", Boolean(current.interestFormEnabled)),
    pricing: {
      currency: normalizeCurrency(pricingPayload.currency, currentPricing.currency || DEFAULT_SETTINGS.pricing.currency),
      amount: normalizeNonNegativeNumber(pricingPayload.amount, "pricing.amount", Number(currentPricing.amount ?? DEFAULT_SETTINGS.pricing.amount)),
      conversationQuota: normalizeNonNegativeNumber(
        pricingPayload.conversationQuota,
        "pricing.conversationQuota",
        Number(currentPricing.conversationQuota ?? DEFAULT_SETTINGS.pricing.conversationQuota)
      ),
    },
    salesAgent: {
      enabled: normalizeBoolean(salesAgentPayload.enabled, "salesAgent.enabled", Boolean(currentSalesAgent.enabled)),
      catalogEnabled: normalizeBoolean(salesAgentPayload.catalogEnabled, "salesAgent.catalogEnabled", Boolean(currentSalesAgent.catalogEnabled)),
      handoffEnabled: normalizeBoolean(salesAgentPayload.handoffEnabled, "salesAgent.handoffEnabled", Boolean(currentSalesAgent.handoffEnabled)),
      fallbackMessage: normalizeString(salesAgentPayload.fallbackMessage, "salesAgent.fallbackMessage", currentSalesAgent.fallbackMessage || ""),
    },
    faqResponder: {
      enabled: normalizeBoolean(faqResponderPayload.enabled, "faqResponder.enabled", Boolean(currentFaqResponder.enabled)),
      knowledgeBaseEnabled: normalizeBoolean(
        faqResponderPayload.knowledgeBaseEnabled,
        "faqResponder.knowledgeBaseEnabled",
        Boolean(currentFaqResponder.knowledgeBaseEnabled)
      ),
      handoffEnabled: normalizeBoolean(faqResponderPayload.handoffEnabled, "faqResponder.handoffEnabled", Boolean(currentFaqResponder.handoffEnabled)),
      fallbackMessage: normalizeString(faqResponderPayload.fallbackMessage, "faqResponder.fallbackMessage", currentFaqResponder.fallbackMessage || ""),
    },
    leadQualifier: {
      enabled: normalizeBoolean(leadQualifierPayload.enabled, "leadQualifier.enabled", Boolean(currentLeadQualifier.enabled)),
      qualificationFields: normalizeStringArray(
        leadQualifierPayload.qualificationFields,
        "leadQualifier.qualificationFields",
        Array.isArray(currentLeadQualifier.qualificationFields) ? currentLeadQualifier.qualificationFields : []
      ),
      crmSyncTarget: normalizeString(leadQualifierPayload.crmSyncTarget, "leadQualifier.crmSyncTarget", currentLeadQualifier.crmSyncTarget || ""),
      handoffEnabled: normalizeBoolean(leadQualifierPayload.handoffEnabled, "leadQualifier.handoffEnabled", Boolean(currentLeadQualifier.handoffEnabled)),
      fallbackMessage: normalizeString(leadQualifierPayload.fallbackMessage, "leadQualifier.fallbackMessage", currentLeadQualifier.fallbackMessage || ""),
    },
  };
};

const serializeUpdatedBy = (updatedBy) =>
  updatedBy && typeof updatedBy === "object"
    ? {
        _id: updatedBy._id || null,
        name: trimString(updatedBy.name),
      }
    : null;

const serializeSettings = (settings) => {
  const plain = settings ? toPlainObject(settings) : DEFAULT_SETTINGS;
  return {
    enabled: plain.enabled === undefined ? DEFAULT_SETTINGS.enabled : Boolean(plain.enabled),
    rolloutStatus: trimString(plain.rolloutStatus || DEFAULT_SETTINGS.rolloutStatus) || DEFAULT_SETTINGS.rolloutStatus,
    defaultAgentType: trimString(plain.defaultAgentType || DEFAULT_SETTINGS.defaultAgentType) || DEFAULT_SETTINGS.defaultAgentType,
    webinarUrl: trimString(plain.webinarUrl || DEFAULT_SETTINGS.webinarUrl),
    interestFormEnabled: plain.interestFormEnabled === undefined ? DEFAULT_SETTINGS.interestFormEnabled : Boolean(plain.interestFormEnabled),
    pricing: {
      currency: normalizeCurrency(plain.pricing?.currency, DEFAULT_SETTINGS.pricing.currency),
      amount: Number(plain.pricing?.amount ?? DEFAULT_SETTINGS.pricing.amount),
      conversationQuota: Number(plain.pricing?.conversationQuota ?? DEFAULT_SETTINGS.pricing.conversationQuota),
    },
    salesAgent: {
      enabled: Boolean(plain.salesAgent?.enabled),
      catalogEnabled: plain.salesAgent?.catalogEnabled === undefined ? true : Boolean(plain.salesAgent.catalogEnabled),
      handoffEnabled: plain.salesAgent?.handoffEnabled === undefined ? true : Boolean(plain.salesAgent.handoffEnabled),
      fallbackMessage: trimString(plain.salesAgent?.fallbackMessage),
    },
    faqResponder: {
      enabled: Boolean(plain.faqResponder?.enabled),
      knowledgeBaseEnabled: plain.faqResponder?.knowledgeBaseEnabled === undefined ? true : Boolean(plain.faqResponder.knowledgeBaseEnabled),
      handoffEnabled: plain.faqResponder?.handoffEnabled === undefined ? true : Boolean(plain.faqResponder.handoffEnabled),
      fallbackMessage: trimString(plain.faqResponder?.fallbackMessage),
    },
    leadQualifier: {
      enabled: Boolean(plain.leadQualifier?.enabled),
      qualificationFields: Array.isArray(plain.leadQualifier?.qualificationFields) ? plain.leadQualifier.qualificationFields.map(trimString).filter(Boolean) : [],
      crmSyncTarget: trimString(plain.leadQualifier?.crmSyncTarget),
      handoffEnabled: plain.leadQualifier?.handoffEnabled === undefined ? true : Boolean(plain.leadQualifier.handoffEnabled),
      fallbackMessage: trimString(plain.leadQualifier?.fallbackMessage),
    },
    createdBy: plain.createdBy || null,
    updatedBy: plain.updatedBy || null,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
};

const recordActivityLogSafely = async ({ actor, title, description = "" } = {}) => {
  if (!actor?._id || !trimString(title)) return;
  try {
    await ActivityLog.create({
      admin: actor._id,
      role: actor.role,
      type: "system",
      title: trimString(title),
      description: trimString(description),
    });
  } catch (error) {
    console.error("Failed to write activity log for WhatsApp AI Agent:", error);
  }
};

const getOrCreateSettingsDocument = async ({ createIfMissing = false } = {}) => {
  let settings = await WhatsAppAiAgentSettings.findOne({ singletonKey: DEFAULT_SINGLETON_KEY })
    .populate("updatedBy", "_id name")
    .populate("createdBy", "_id name");

  if (!settings && createIfMissing) {
    try {
      settings = await WhatsAppAiAgentSettings.create({ singletonKey: DEFAULT_SINGLETON_KEY });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    settings = await WhatsAppAiAgentSettings.findOne({ singletonKey: DEFAULT_SINGLETON_KEY })
      .populate("updatedBy", "_id name")
      .populate("createdBy", "_id name");
  }

  return settings;
};

const getWhatsAppAiAgentSettings = async () => serializeSettings(await getOrCreateSettingsDocument());

const getRecentAgentRunCount = async () => {
  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return WhatsAppAiAgentLog.countDocuments({ createdAt: { $gte: since } });
};

const getCatalogItemCount = async () => {
  const collections = await listAvailableProductCollections().catch(() => []);
  return collections.reduce((total, collection) => total + Number(collection.itemCount || collection.items?.length || 0), 0);
};

const buildOverviewFromSettings = async (settings) => {
  const serialized = serializeSettings(settings);
  const [catalogItems, workflows, quickReplies, forms, recentAgentRuns, interestSubmissions] = await Promise.all([
    getCatalogItemCount(),
    WhatsAppAutomation.countDocuments({ enabled: true }),
    WhatsAppQuickReply.countDocuments({ isActive: true }),
    WhatsAppForm.countDocuments({ isActive: true }),
    getRecentAgentRunCount(),
    WhatsAppAiAgentInterest.countDocuments({}),
  ]);

  return {
    enabled: serialized.enabled,
    rolloutStatus: serialized.rolloutStatus,
    defaultAgentType: serialized.defaultAgentType,
    webinarUrl: serialized.webinarUrl,
    interestFormEnabled: serialized.interestFormEnabled,
    pricing: serialized.pricing,
    salesAgent: serialized.salesAgent,
    faqResponder: serialized.faqResponder,
    leadQualifier: serialized.leadQualifier,
    stats: {
      catalogItems,
      knowledgeArticles: 0,
      workflows,
      quickReplies,
      forms,
      recentAgentRuns,
      interestSubmissions,
    },
    updatedAt: serialized.updatedAt,
    updatedBy: serializeUpdatedBy(serialized.updatedBy),
  };
};

const getWhatsAppAiAgentOverview = async () => buildOverviewFromSettings(await getOrCreateSettingsDocument());

const updateWhatsAppAiAgentSettings = async ({ payload = {}, actor = null } = {}) => {
  const settingsDocument = await getOrCreateSettingsDocument({ createIfMissing: true });
  const current = serializeSettings(settingsDocument);
  const normalized = normalizeSettingsPayload(payload, current);

  settingsDocument.enabled = normalized.enabled;
  settingsDocument.rolloutStatus = normalized.rolloutStatus;
  settingsDocument.defaultAgentType = normalized.defaultAgentType;
  settingsDocument.webinarUrl = normalized.webinarUrl;
  settingsDocument.interestFormEnabled = normalized.interestFormEnabled;
  settingsDocument.pricing = normalized.pricing;
  settingsDocument.salesAgent = normalized.salesAgent;
  settingsDocument.faqResponder = normalized.faqResponder;
  settingsDocument.leadQualifier = normalized.leadQualifier;
  settingsDocument.updatedBy = actor?._id || settingsDocument.updatedBy || null;
  if (!settingsDocument.createdBy && actor?._id) {
    settingsDocument.createdBy = actor._id;
  }

  await settingsDocument.save();

  await recordActivityLogSafely({
    actor,
    title: "Updated WhatsApp AI Agent settings",
    description: `Rollout: ${normalized.rolloutStatus}, default agent: ${normalized.defaultAgentType}`,
  });

  return getWhatsAppAiAgentOverview();
};

const normalizeText = (value) =>
  trimString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s@.+-]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value) =>
  normalizeText(value)
    .split(" ")
    .map((token) => trimString(token))
    .filter((token) => token && token.length > 1 && !STOP_WORDS.has(token));

const uniqueTokens = (value) => [...new Set(tokenize(value))];

const buildCharacterNgrams = (value, size = 3) => {
  const normalized = normalizeText(value).replace(/\s+/g, "");
  if (!normalized) return new Set();
  if (normalized.length <= size) return new Set([normalized]);

  const grams = new Set();
  for (let index = 0; index <= normalized.length - size; index += 1) {
    grams.add(normalized.slice(index, index + size));
  }

  return grams;
};

const computeDiceSimilarity = (left, right) => {
  const leftSet = buildCharacterNgrams(left);
  const rightSet = buildCharacterNgrams(right);

  if (!leftSet.size || !rightSet.size) return 0;

  let matches = 0;
  for (const gram of leftSet) {
    if (rightSet.has(gram)) matches += 1;
  }

  return (2 * matches) / (leftSet.size + rightSet.size);
};

const scoreCandidate = (message, candidate) => {
  const messageText = normalizeText(message);
  const messageTokens = uniqueTokens(messageText);
  const candidateText = normalizeText(candidate.searchableText || candidate.title || "");
  const candidateTokens = uniqueTokens(candidateText);

  if (!messageText || !candidateText || !messageTokens.length || !candidateTokens.length) {
    return 0;
  }

  const overlapCount = messageTokens.filter((token) => candidateTokens.includes(token)).length;
  const overlapScore = overlapCount / Math.max(messageTokens.length, 1);
  const candidateCoverage = overlapCount / Math.max(candidateTokens.length, 1);
  const phraseScore =
    candidateText.includes(messageText) || messageText.includes(candidateText)
      ? 0.2
      : messageTokens.some((token) => candidateText.includes(token))
        ? 0.08
        : 0;
  const keywordScore = Array.isArray(candidate.keywords)
    ? Math.min(
        0.25,
        candidate.keywords
          .map((keyword) => normalizeText(keyword))
          .filter(Boolean)
          .reduce((total, keyword) => (messageText.includes(keyword) ? total + 0.08 : total), 0)
      )
    : 0;
  const fuzzyScore = computeDiceSimilarity(messageText, candidateText) * 0.3;

  return Math.max(0, Math.min(1, overlapScore * 0.45 + candidateCoverage * 0.1 + phraseScore + keywordScore + fuzzyScore));
};

const buildSalesCatalogSource = async () => {
  const collections = await listAvailableProductCollections().catch(() => []);

  return collections.flatMap((collection) =>
    (Array.isArray(collection.items) ? collection.items : []).map((item) => ({
      destinationId: trimString(item.id || collection.id),
      title: trimString(item.title),
      description: trimString(item.description),
      price: item.price ?? null,
      collectionName: trimString(collection.name),
      category: trimString(collection.category),
      searchableText: [
        collection.name,
        collection.description,
        collection.category,
        item.title,
        item.description,
      ]
        .map(trimString)
        .filter(Boolean)
        .join(" "),
      keywords: [collection.name, collection.category, item.title],
    }))
  );
};

const buildSalesKnowledgeEntries = (catalogItems = []) =>
  (Array.isArray(catalogItems) ? catalogItems : [])
    .map((item) => {
      const details = [
        trimString(item.title) ? `Option: ${trimString(item.title)}.` : "",
        trimString(item.collectionName) ? `Collection: ${trimString(item.collectionName)}.` : "",
        trimString(item.category) ? `Category: ${trimString(item.category)}.` : "",
        trimString(item.description) ? `Details: ${trimString(item.description)}.` : "",
        item.price !== undefined && item.price !== null ? `Price: ${item.price}.` : "",
      ].filter(Boolean);

      return {
        destinationId: trimString(item.destinationId),
        title: trimString(item.title),
        answer: details.join(" "),
        searchableText: trimString(item.searchableText),
      };
    })
    .filter((item) => item.destinationId && item.title && item.answer);

const didAssistantAskAboutCountry = (conversationHistory = []) => {
  const lastAssistantMessage = (Array.isArray(conversationHistory) ? conversationHistory : [])
    .slice()
    .reverse()
    .find((item) => item?.role === "assistant" && trimString(item?.text));

  if (!lastAssistantMessage) {
    return false;
  }

  return /\b(which country|what country|destination|interested in)\b/i.test(trimString(lastAssistantMessage.text));
};

const buildSalesClarificationReply = ({ country = "" } = {}) => {
  const normalizedCountry = trimString(country);
  if (normalizedCountry) {
    return `Thanks for sharing. Are you looking for work, study, or migration support for ${normalizedCountry}?`;
  }

  return "Thanks for sharing. Are you looking for work, study, or migration support?";
};

const buildConversationHistory = async (conversation = null, limit = 15) => {
  if (!conversation?._id) {
    return [];
  }

  const normalizedLimit = clampPositiveInteger(limit, 15, 20);
  const recentMessages = await WhatsAppMessage.find({ conversationId: conversation._id })
    .select("direction sender content timestamp type")
    .sort({ timestamp: -1, createdAt: -1 })
    .limit(normalizedLimit)
    .lean();

  return recentMessages
    .slice()
    .reverse()
    .filter((item) => trimString(item?.content))
    .map((item) => ({
      role: item.direction === "outbound" || item.sender === "agent" || item.sender === "system" ? "assistant" : "user",
      text: trimString(item.content),
      timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : "",
    }));
};

const buildFaqKnowledgeSource = async () => {
  const [quickReplies, businessProfile] = await Promise.all([
    WhatsAppQuickReply.find({ isActive: true }).select("_id title category folder content").sort({ updatedAt: -1, _id: -1 }).lean(),
    WhatsAppBusinessProfile.findOne({ singletonKey: DEFAULT_SINGLETON_KEY }).lean(),
  ]);

  const quickReplyEntries = quickReplies.map((reply) => ({
    destinationId: toObjectIdString(reply._id),
    title: trimString(reply.title),
    answer: trimString(reply.content),
    searchableText: [reply.title, reply.category, reply.folder, reply.content].map(trimString).filter(Boolean).join(" "),
    keywords: [reply.title, reply.category, reply.folder],
  }));

  const profileEntries = [
    businessProfile?.businessDescription
      ? {
          destinationId: "business_description",
          title: "About the business",
          answer: trimString(businessProfile.businessDescription),
          searchableText: [businessProfile.businessName, businessProfile.businessType, businessProfile.businessDescription].join(" "),
          keywords: ["about", "business", businessProfile.businessName],
        }
      : null,
    businessProfile?.website
      ? {
          destinationId: "website",
          title: "Website",
          answer: trimString(businessProfile.website),
          searchableText: `website site url ${trimString(businessProfile.website)}`,
          keywords: ["website", "site", "url"],
        }
      : null,
    businessProfile?.email
      ? {
          destinationId: "email",
          title: "Email",
          answer: trimString(businessProfile.email),
          searchableText: `email contact support ${trimString(businessProfile.email)}`,
          keywords: ["email", "contact", "support"],
        }
      : null,
    businessProfile?.phone
      ? {
          destinationId: "phone",
          title: "Phone",
          answer: trimString(businessProfile.phone),
          searchableText: `phone call contact ${trimString(businessProfile.phone)}`,
          keywords: ["phone", "call", "contact"],
        }
      : null,
    businessProfile?.address
      ? {
          destinationId: "address",
          title: "Address",
          answer: trimString(businessProfile.address),
          searchableText: `address location office ${trimString(businessProfile.address)}`,
          keywords: ["address", "location", "office"],
        }
      : null,
  ].filter(Boolean);

  return {
    businessName: trimString(businessProfile?.businessName || ""),
    knowledgeEntries: [...quickReplyEntries, ...profileEntries],
  };
};

const getBusinessDisplayName = async () => {
  const businessProfile = await WhatsAppBusinessProfile.findOne({ singletonKey: DEFAULT_SINGLETON_KEY })
    .select("businessName")
    .lean();

  return trimString(businessProfile?.businessName || "");
};
const getAgentModeConfig = (settings, agentType) => {
  if (agentType === "sales_agent") return settings.salesAgent || DEFAULT_SETTINGS.salesAgent;
  if (agentType === "faq_responder") return settings.faqResponder || DEFAULT_SETTINGS.faqResponder;
  return settings.leadQualifier || DEFAULT_SETTINGS.leadQualifier;
};

const isAgentTypeEnabled = (settings, agentType) => Boolean(getAgentModeConfig(settings, agentType)?.enabled);

const resolveRuntimeAgentType = (settings, requestedType = "") => {
  const preferred = trimString(requestedType || settings.defaultAgentType || DEFAULT_SETTINGS.defaultAgentType);
  if (preferred && isAgentTypeEnabled(settings, preferred)) {
    return preferred;
  }

  return AGENT_TYPE_OPTIONS.find((agentType) => isAgentTypeEnabled(settings, agentType)) || preferred;
};

const buildFallbackReply = ({ settings, agentType, reason = "low_confidence", handoffRequested = false } = {}) => {
  const modeConfig = getAgentModeConfig(settings, agentType);
  const fallbackMessage = trimString(modeConfig?.fallbackMessage);

  if (handoffRequested || (reason === "low_confidence" && modeConfig?.handoffEnabled)) {
    return {
      reply: fallbackMessage || "A team member will take over this WhatsApp conversation shortly.",
      responseSource: "handoff",
      handoffTriggered: true,
      confidence: 0.4,
      notes: [handoffRequested ? "Customer requested a human handoff" : "Low confidence triggered human handoff"],
      matchedKnowledgeArticleIds: [],
      matchedCatalogItemIds: [],
    };
  }

  return {
    reply: fallbackMessage || "I do not have a reliable automated answer for that yet.",
    responseSource: "fallback",
    handoffTriggered: false,
    confidence: 0.2,
    notes: ["Used configured fallback reply"],
    matchedKnowledgeArticleIds: [],
    matchedCatalogItemIds: [],
  };
};

const formatSuggestions = (items = []) =>
  items.slice(0, 3).map((item) => ({
    title: trimString(item.title),
    price: item.price ?? null,
  }));

const tryOpenScopeAiReply = async ({ agentType, message, businessName = "", knowledgeEntries = [], conversationHistory = [], capturedContext = {}, pendingField = "", } = {}) => {
  if (!isOpenAiConfigured()) {
    return null;
  }
  try {
    const aiReply = await generateOpenScopeWhatsAppReply({
      agentType,
      message,
      knowledgeEntries,
      businessName,
      conversationHistory,
      capturedContext,
      pendingField,
    });
    if (!aiReply) {
      return null;
    }
    return {
      shouldAnswer: Boolean(aiReply.shouldAnswer),
      answer: trimString(aiReply.answer),
      confidence: Math.max(0, Math.min(1, Number(aiReply.confidence || 0))),
      handoff: Boolean(aiReply.handoff),
      reason: trimString(aiReply.reason),
    };
  } catch (error) {
    console.warn(`Open-scope ${trimString(agentType) || "ai_agent"} reply failed, falling back to local logic: ${error.message}`);
    return null;
  }
};

const resolveSalesAgentResponse = async ({ message, settings, conversation = null, contact = null } = {}) => {
  const modeConfig = settings.salesAgent || DEFAULT_SETTINGS.salesAgent;
  if (!modeConfig.catalogEnabled) {
    return {
      status: "fallback",
      suggestions: [],
      leadCapture: { needed: false, fields: [] },
      ...buildFallbackReply({ settings, agentType: "sales_agent", reason: "catalog_disabled" }),
    };
  }

  const catalogItems = await buildSalesCatalogSource();
  if (!catalogItems.length) {
    return {
      status: "fallback",
      suggestions: [],
      leadCapture: { needed: false, fields: [] },
      ...buildFallbackReply({ settings, agentType: "sales_agent", reason: "catalog_missing" }),
    };
  }

  const scored = catalogItems
    .map((item) => ({ ...item, confidence: scoreCandidate(message, item) }))
    .sort((left, right) => right.confidence - left.confidence);

  const top = scored[0];
  if (!top || top.confidence < 0.42) {
    const openScopeReply = await tryOpenScopeAiReply({
      agentType: "sales_agent",
      message,
      businessName: await getBusinessDisplayName(),
      knowledgeEntries: buildSalesKnowledgeEntries(catalogItems),
      conversationHistory: [],
      capturedContext: {},
    });
    if (openScopeReply?.shouldAnswer && openScopeReply.answer) {
      return {
        status: "preview",
        reply: trimString(openScopeReply.answer),
        responseSource: "ai",
        confidence: Number(openScopeReply.confidence.toFixed(2)),
        suggestions: [],
        leadCapture: { needed: false, fields: [] },
        handoffTriggered: false,
        notes: [
          "open_scope_ai_reply",
          `match_reason=${openScopeReply.reason}`,
        ].filter(Boolean),
        matchedCatalogItemIds: [],
        matchedKnowledgeArticleIds: [],
      };
    }
    if (openScopeReply?.handoff) {
      return {
        status: "handoff",
        suggestions: [],
        leadCapture: { needed: false, fields: [] },
        ...buildFallbackReply({ settings, agentType: "sales_agent", reason: "handoff_requested", handoffRequested: true }),
      };
    }
    return {
      status: "fallback",
      suggestions: [],
      leadCapture: { needed: false, fields: [] },
      ...buildFallbackReply({ settings, agentType: "sales_agent", reason: "low_confidence" }),
    };
  }

  const closeMatches = scored.filter((item) => item.confidence >= Math.max(0.25, top.confidence - 0.1));
  const suggestions = formatSuggestions(closeMatches);

  const reply = closeMatches.length > 1
    ? `I found a few matching options: ${closeMatches.slice(0, 3).map((item) => item.title).join(", ")}. If you want, I can narrow it down by fit, color, or occasion.`
    : `A good match could be ${top.title}${top.collectionName ? ` from ${top.collectionName}` : ""}. ${trimString(top.description)}`.trim();

  return {
    status: "preview",
    reply,
    responseSource: "catalog",
    confidence: Number(top.confidence.toFixed(2)),
    suggestions,
    leadCapture: { needed: false, fields: [] },
    handoffTriggered: false,
    notes: [
      "catalog_match",
      top.category ? `top_category=${top.category}` : "",
      `matched_item=${top.title}`,
    ].filter(Boolean),
    matchedCatalogItemIds: closeMatches.map((item) => trimString(item.destinationId)).filter(Boolean),
    matchedKnowledgeArticleIds: [],
  };
};

const resolveFaqResponderResponse = async ({ message, settings, conversation = null, contact = null } = {}) => {
  const modeConfig = settings.faqResponder || DEFAULT_SETTINGS.faqResponder;
  if (!modeConfig.knowledgeBaseEnabled) {
    return {
      status: "fallback",
      suggestions: [],
      leadCapture: { needed: false, fields: [] },
      ...buildFallbackReply({ settings, agentType: "faq_responder", reason: "knowledge_disabled" }),
    };
  }

  const { knowledgeEntries, businessName } = await buildFaqKnowledgeSource();
  if (!knowledgeEntries.length) {
    return {
      status: "fallback",
      suggestions: [],
      leadCapture: { needed: false, fields: [] },
      ...buildFallbackReply({ settings, agentType: "faq_responder", reason: "knowledge_missing" }),
    };
  }

  const scored = knowledgeEntries
    .map((entry) => ({ ...entry, confidence: scoreCandidate(message, entry) }))
    .sort((left, right) => right.confidence - left.confidence);

  const top = scored[0];
  if (!top || top.confidence < 0.46) {
    const openScopeReply = await tryOpenScopeAiReply({
      agentType: "faq_responder",
      message,
      businessName,
      knowledgeEntries,
      conversationHistory: [],
      capturedContext: {},
    });
    if (openScopeReply?.shouldAnswer && openScopeReply.answer) {
      return {
        status: "preview",
        reply: trimString(openScopeReply.answer),
        responseSource: "ai",
        confidence: Number(openScopeReply.confidence.toFixed(2)),
        suggestions: [],
        leadCapture: { needed: false, fields: [] },
        handoffTriggered: false,
        notes: [
          "open_scope_ai_reply",
          `match_reason=${openScopeReply.reason}`,
        ].filter(Boolean),
        matchedKnowledgeArticleIds: [],
        matchedCatalogItemIds: [],
      };
    }
    return {
      status: "fallback",
      suggestions: [],
      leadCapture: { needed: false, fields: [] },
      ...buildFallbackReply({ settings, agentType: "faq_responder", reason: "low_confidence" }),
    };
  }

  return {
    status: "preview",
    reply: trimString(top.answer),
    responseSource: "knowledge_base",
    confidence: Number(top.confidence.toFixed(2)),
    suggestions: [],
    leadCapture: { needed: false, fields: [] },
    handoffTriggered: false,
    notes: [
      "knowledge_base_match",
      `matched_article=${top.title}`,
    ],
    matchedKnowledgeArticleIds: [trimString(top.destinationId)].filter(Boolean),
    matchedCatalogItemIds: [],
  };
};

const extractEmail = (message) => {
  const match = trimString(message).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? trimString(match[0]).toLowerCase() : "";
};

const extractPhone = (message) => {
  const match = trimString(message).match(/(\+?\d[\d\s()-]{6,}\d)/);
  return match ? trimString(match[1]) : "";
};

const extractNumberPhrase = (message) => {
  const match = trimString(message).match(/(\d[\d,]*(?:\.\d+)?)/);
  return match ? trimString(match[1]) : "";
};

const extractFieldValue = ({ field, message, pendingField = "", contact = {} } = {}) => {
  const normalizedField = trimString(field).toLowerCase();
  const trimmedMessage = trimString(message);
  const normalizedMessage = normalizeText(message);

  if (!trimmedMessage) return "";

  if (pendingField && trimString(pendingField).toLowerCase() === normalizedField) {
    if (normalizedField === "email") return extractEmail(trimmedMessage);
    if (normalizedField === "phone" || normalizedField === "whatsapp" || normalizedField === "whatsappnumber") return extractPhone(trimmedMessage);
    return trimmedMessage;
  }

  if (normalizedField === "name") {
    const match = trimmedMessage.match(/\b(?:my name is|i am|this is)\s+(.+)$/i);
    return match ? trimString(match[1]) : "";
  }

  if (normalizedField === "email") {
    return extractEmail(trimmedMessage);
  }

  if (normalizedField === "phone" || normalizedField === "whatsapp" || normalizedField === "whatsappnumber") {
    return extractPhone(trimmedMessage) || trimString(contact.phone);
  }

  if (normalizedField === "budget") {
    const match = trimmedMessage.match(/\b(?:budget|price|spend)\b[:\s-]*([^\n]+)/i);
    return match ? trimString(match[1]) : extractNumberPhrase(trimmedMessage);
  }

  if (normalizedField === "timeline") {
    const match = trimmedMessage.match(/\b(?:timeline|timeframe|by|within)\b[:\s-]*([^\n]+)/i);
    return match ? trimString(match[1]) : (/\b(today|tomorrow|week|month|quarter|urgent|asap)\b/i.test(normalizedMessage) ? trimmedMessage : "");
  }

  if (normalizedField === "company") {
    const match = trimmedMessage.match(/\b(?:company|business|organization)\b[:\s-]*([^\n]+)/i);
    return match ? trimString(match[1]) : "";
  }

  return "";
};

const buildQualificationPrompt = (field) => {
  const normalizedField = trimString(field).toLowerCase();
  if (normalizedField === "name") return "Could you share your name?";
  if (normalizedField === "email") return "What email should we use for follow-up?";
  if (normalizedField === "phone" || normalizedField === "whatsapp" || normalizedField === "whatsappnumber") {
    return "What is the best phone or WhatsApp number to reach you on?";
  }
  if (normalizedField === "budget") return "Do you have a target budget in mind?";
  if (normalizedField === "timeline") return "What timeline are you working with?";
  if (normalizedField === "company") return "Which company or business are you enquiring from?";
  return `Could you share your ${trimString(field)}?`;
};

const normalizeQualificationFields = (fields = []) => normalizeStringArray(fields, "leadQualifier.qualificationFields", []);

const resolveLeadOwnership = async ({ actorId = null, conversation = null } = {}) => {
  const preferredAdminId = conversation?.agentId || actorId || null;
  if (!preferredAdminId) return null;

  const admin = await AdminUser.findById(preferredAdminId).select("_id role reportsTo").lean();
  if (!admin?._id) return null;

  return {
    ownerAdmin: admin._id,
    assignedTo: conversation?.agentId || admin._id,
    teamAdmin: admin.role === "SalesStaff" ? admin.reportsTo || admin._id : admin._id,
  };
};

const buildLeadDescription = ({ agentType, capturedFields, message, notes = [] } = {}) => {
  const entries = Object.entries(capturedFields || {})
    .filter(([, value]) => trimString(value))
    .map(([key, value]) => `${key}: ${trimString(value)}`);
  const descriptionParts = [
    `Source: ${agentType}`,
    trimString(message) ? `Last message: ${trimString(message)}` : "",
    entries.length ? `Captured fields: ${entries.join(", ")}` : "",
    Array.isArray(notes) ? notes.map(trimString).filter(Boolean).join(" | ") : "",
  ].filter(Boolean);
  return descriptionParts.join("\n");
};

const upsertQualifiedLead = async ({
  conversation = null,
  contact = null,
  actorId = null,
  agentType = "lead_qualifier",
  capturedFields = {},
  source = "whatsapp_ai_agent",
  sourceTag = "whatsapp_ai_agent",
  message = "",
  notes = [],
} = {}) => {
  const ownership = await resolveLeadOwnership({ actorId, conversation });
  if (!ownership?.teamAdmin || !ownership.ownerAdmin || !ownership.assignedTo) {
    throw createHttpError("Unable to resolve lead ownership for AI agent flow", 400);
  }

  const email = trimString(capturedFields.email || contact?.email || "").toLowerCase();
  const phone = trimString(capturedFields.phone || capturedFields.whatsapp || contact?.phone || "");
  const name = trimString(capturedFields.name || contact?.name || phone || "WhatsApp Lead");
  const company = trimString(capturedFields.company);

  let lead = null;
  if (conversation?.linkedLeadId && Types.ObjectId.isValid(String(conversation.linkedLeadId))) {
    lead = await Lead.findById(conversation.linkedLeadId);
  }

  if (!lead && (email || phone)) {
    const orFilter = [];
    if (email) orFilter.push({ email });
    if (phone) orFilter.push({ phone });
    if (orFilter.length) {
      lead = await Lead.findOne({
        teamAdmin: ownership.teamAdmin,
        $or: orFilter,
      });
    }
  }

  const description = buildLeadDescription({ agentType, capturedFields, message, notes });
  const tags = [...new Set([...(Array.isArray(lead?.tags) ? lead.tags : []), sourceTag, agentType].map(trimString).filter(Boolean))];

  if (lead) {
    lead.ownerAdmin = ownership.ownerAdmin;
    lead.assignedTo = ownership.assignedTo;
    lead.name = name;
    lead.email = email || lead.email;
    lead.phone = phone || lead.phone;
    lead.company = company || lead.company;
    lead.source = source;
    lead.sourceDetails = source;
    lead.description = description;
    lead.tags = tags;
    lead.lastContactAt = new Date();
    await lead.save();
  } else {
    const nextLeadNumber = 2000 + (await Lead.countDocuments({ teamAdmin: ownership.teamAdmin })) + 1;
    lead = await Lead.create({
      teamAdmin: ownership.teamAdmin,
      ownerAdmin: ownership.ownerAdmin,
      assignedTo: ownership.assignedTo,
      leadNumber: nextLeadNumber,
      status: "Leads",
      source,
      sourceDetails: source,
      name,
      email,
      phone,
      company,
      description,
      tags,
      lastContactAt: new Date(),
    });
  }

  if (conversation) {
    conversation.linkedLeadId = lead._id;
    conversation.automationState = {
      ...toPlainObject(conversation.automationState),
      aiAgent: {
        ...toPlainObject(conversation.automationState?.aiAgent),
        qualification: {
          ...toPlainObject(conversation.automationState?.aiAgent?.qualification),
          leadId: lead._id,
          completedAt: new Date(),
        },
      },
    };
    if (typeof conversation?.save === 'function') {
      await conversation.save();
    }
  }

  return lead;
};

const resolveLeadQualifierResponse = async ({
  message,
  settings,
  conversation = null,
  contact = null,
  actorId = null,
} = {}) => {
  const modeConfig = settings.leadQualifier || DEFAULT_SETTINGS.leadQualifier;
  const qualificationFields = normalizeQualificationFields(modeConfig.qualificationFields);

  if (!qualificationFields.length) {
    return {
      status: "fallback",
      suggestions: [],
      leadCapture: { needed: false, fields: [] },
      ...buildFallbackReply({ settings, agentType: "lead_qualifier", reason: "qualification_fields_missing" }),
    };
  }

  const currentState = toPlainObject(conversation?.automationState?.aiAgent?.qualification);
  const capturedFields = {
    ...(currentState?.capturedFields && typeof currentState.capturedFields === "object" ? currentState.capturedFields : {}),
  };
  const pendingField = trimString(currentState?.pendingField);

  qualificationFields.forEach((field) => {
    const key = trimString(field);
    if (!key || trimString(capturedFields[key])) return;
    const extracted = extractFieldValue({ field: key, message, pendingField, contact });
    if (trimString(extracted)) {
      capturedFields[key] = trimString(extracted);
    }
  });

  const missingFields = qualificationFields.filter((field) => !trimString(capturedFields[field]));

  if (conversation) {
    conversation.automationState = {
      ...toPlainObject(conversation.automationState),
      aiAgent: {
        ...toPlainObject(conversation.automationState?.aiAgent),
        qualification: {
          ...toPlainObject(conversation.automationState?.aiAgent?.qualification),
          capturedFields,
          pendingField: missingFields[0] || "",
          lastAskedAt: missingFields[0] ? new Date() : currentState?.lastAskedAt || null,
        },
      },
    };
    if (typeof conversation?.save === 'function') {
      await conversation.save();
    }
  }

  if (missingFields.length) {
    return {
      status: "preview",
      reply: buildQualificationPrompt(missingFields[0]),
      responseSource: "qualification_flow",
      confidence: 0.84,
      suggestions: [],
      leadCapture: {
        needed: true,
        fields: missingFields,
      },
      handoffTriggered: false,
      notes: [`Collecting qualification field ${missingFields[0]}`],
      capturedFields,
      matchedKnowledgeArticleIds: [],
      matchedCatalogItemIds: [],
    };
  }

  let lead = null;
  const notes = ["Lead qualification complete"];
  try {
    lead = await upsertQualifiedLead({
      conversation,
      contact,
      actorId,
      agentType: "lead_qualifier",
      capturedFields,
      source: modeConfig.crmSyncTarget || "whatsapp_ai_agent",
      sourceTag: "whatsapp_ai_agent",
      message,
      notes,
    });
  } catch (error) {
    notes.push(`Lead sync failed: ${error.message}`);
    return {
      status: "fallback",
      suggestions: [],
      leadCapture: {
        needed: false,
        fields: [],
      },
      ...buildFallbackReply({ settings, agentType: "lead_qualifier", reason: "lead_sync_failed" }),
      notes,
      capturedFields,
    };
  }

  return {
    status: "preview",
    reply: "Thanks, I have captured your details and shared them with our team for follow-up.",
    responseSource: "qualification_flow",
    confidence: 0.9,
    suggestions: [],
    leadCapture: {
      needed: false,
      fields: [],
    },
    handoffTriggered: false,
    notes,
    capturedFields,
    leadCaptured: true,
    leadId: lead?._id || null,
    matchedKnowledgeArticleIds: [],
    matchedCatalogItemIds: [],
  };
};

const resolveWhatsAppAiAgentResponse = async (message, workspaceContext = {}, options = {}) => {
  const trimmedMessage = trimString(message);
  const normalizedMessage = normalizeText(trimmedMessage);
  const settings = options.settings || await getWhatsAppAiAgentSettings();
  const agentType = resolveRuntimeAgentType(settings, options.agentType);
  const conversation = workspaceContext.conversation || null;
  const contact = workspaceContext.contact || null;

  if (!trimmedMessage || normalizedMessage.length < 2) {
    return {
      agentType,
      status: "ignored",
      message: trimmedMessage,
      reply: "",
      responseSource: "fallback",
      confidence: 0,
      suggestions: [],
      leadCapture: { needed: false, fields: [] },
      notes: ["Ignored empty or very short message"],
    };
  }

  if (!settings.enabled) {
    return {
      agentType,
      status: "disabled",
      message: trimmedMessage,
      reply: "",
      responseSource: "fallback",
      confidence: 0,
      suggestions: [],
      leadCapture: { needed: false, fields: [] },
      notes: ["WhatsApp AI Agent is disabled"],
    };
  }

  if (!AGENT_TYPE_OPTIONS.includes(agentType)) {
    return {
      agentType,
      status: "disabled",
      message: trimmedMessage,
      reply: "",
      responseSource: "fallback",
      confidence: 0,
      suggestions: [],
      leadCapture: { needed: false, fields: [] },
      notes: ["No AI agent type is enabled"],
    };
  }

  if (!isAgentTypeEnabled(settings, agentType)) {
    return {
      agentType,
      status: "disabled",
      message: trimmedMessage,
      reply: "",
      responseSource: "fallback",
      confidence: 0,
      suggestions: [],
      leadCapture: { needed: false, fields: [] },
      notes: [`Configured agent type ${agentType} is disabled`],
    };
  }

  if (HUMAN_HANDOFF_PATTERN.test(trimmedMessage)) {
    return {
      agentType,
      status: "preview",
      message: trimmedMessage,
      suggestions: [],
      leadCapture: { needed: false, fields: [] },
      ...buildFallbackReply({ settings, agentType, reason: "handoff_requested", handoffRequested: true }),
    };
  }

  let agentResponse;
  if (agentType === "sales_agent") {
    agentResponse = await resolveSalesAgentResponse({ message: trimmedMessage, settings, conversation, contact });
  } else if (agentType === "faq_responder") {
    agentResponse = await resolveFaqResponderResponse({ message: trimmedMessage, settings, conversation, contact });
  } else {
    agentResponse = await resolveLeadQualifierResponse({
      message: trimmedMessage,
      settings,
      conversation,
      contact,
      actorId: options.actorId || null,
    });
  }

  return {
    agentType,
    message: trimmedMessage,
    ...agentResponse,
  };
};

const createAgentLog = async ({
  adminId = null,
  conversationId = null,
  messageId = "",
  customerPhone = "",
  agentType = "sales_agent",
  direction = "inbound",
  messageText = "",
  responseText = "",
  responseSource = "fallback",
  confidence = 0,
  leadCaptured = false,
  leadId = null,
  handoffTriggered = false,
  notes = [],
} = {}) =>
  WhatsAppAiAgentLog.create({
    adminId: adminId || null,
    conversationId: conversationId || null,
    messageId: trimString(messageId),
    customerPhone: trimString(customerPhone),
    agentType: normalizeEnum(agentType, "agentType", AGENT_TYPE_OPTIONS, DEFAULT_SETTINGS.defaultAgentType),
    direction,
    messageText: trimString(messageText),
    responseText: trimString(responseText),
    responseSource: normalizeEnum(responseSource, "responseSource", RESPONSE_SOURCE_OPTIONS, "fallback"),
    confidence: Math.max(0, Math.min(1, Number(confidence || 0))),
    leadCaptured: Boolean(leadCaptured),
    leadId: leadId || null,
    handoffTriggered: Boolean(handoffTriggered),
    notes: Array.isArray(notes) ? notes.map(trimString).filter(Boolean) : [],
  });

const serializeHistoryItem = (item = {}) => ({
  _id: item._id,
  conversationId: toObjectIdString(item.conversationId) || null,
  messageId: trimString(item.messageId),
  customerPhone: trimString(item.customerPhone),
  agentType: trimString(item.agentType),
  direction: trimString(item.direction),
  messageText: trimString(item.messageText),
  responseText: trimString(item.responseText),
  responseSource: trimString(item.responseSource),
  confidence: Number(item.confidence || 0),
  leadCaptured: Boolean(item.leadCaptured),
  leadId: toObjectIdString(item.leadId) || null,
  handoffTriggered: Boolean(item.handoffTriggered),
  notes: Array.isArray(item.notes) ? item.notes.map(trimString).filter(Boolean) : [],
  createdAt: item.createdAt || null,
});

const buildHistoryFilter = ({
  agentType,
  responseSource,
  handoffTriggered,
  leadCaptured,
  dateFrom,
  dateTo,
  customerPhone,
  conversationId,
} = {}) => {
  const filter = {};
  const normalizedAgentType = trimString(agentType);
  const normalizedResponseSource = trimString(responseSource);
  const normalizedCustomerPhone = trimString(customerPhone);
  const normalizedConversationId = normalizeObjectIdFilter(conversationId, "conversationId");

  if (normalizedAgentType) {
    filter.agentType = normalizeEnum(normalizedAgentType, "agentType", AGENT_TYPE_OPTIONS, DEFAULT_SETTINGS.defaultAgentType);
  }

  if (normalizedResponseSource) {
    filter.responseSource = normalizeEnum(normalizedResponseSource, "responseSource", RESPONSE_SOURCE_OPTIONS, "fallback");
  }

  const parsedHandoffTriggered = parseBooleanFilter(handoffTriggered, "handoffTriggered");
  if (parsedHandoffTriggered !== undefined) {
    filter.handoffTriggered = parsedHandoffTriggered;
  }

  const parsedLeadCaptured = parseBooleanFilter(leadCaptured, "leadCaptured");
  if (parsedLeadCaptured !== undefined) {
    filter.leadCaptured = parsedLeadCaptured;
  }

  const parsedDateFrom = parseDateFilter(dateFrom, "dateFrom");
  const parsedDateTo = parseDateFilter(dateTo, "dateTo", { endOfDay: true });
  if (parsedDateFrom || parsedDateTo) {
    filter.createdAt = {};
    if (parsedDateFrom) filter.createdAt.$gte = parsedDateFrom;
    if (parsedDateTo) filter.createdAt.$lte = parsedDateTo;
    if (parsedDateFrom && parsedDateTo && parsedDateFrom > parsedDateTo) {
      throw createHttpError("dateFrom must be less than or equal to dateTo");
    }
  }

  if (normalizedCustomerPhone) {
    filter.customerPhone = { $regex: escapeRegex(normalizedCustomerPhone), $options: "i" };
  }

  if (normalizedConversationId) {
    filter.conversationId = normalizedConversationId;
  }

  return filter;
};

const listWhatsAppAiAgentHistory = async ({
  page,
  limit,
  agentType,
  responseSource,
  handoffTriggered,
  leadCaptured,
  dateFrom,
  dateTo,
  customerPhone,
  conversationId,
} = {}) => {
  const safePage = clampPositiveInteger(page, DEFAULT_PAGE);
  const safeLimit = clampPositiveInteger(limit, DEFAULT_LIMIT, MAX_LIMIT);
  const skip = (safePage - 1) * safeLimit;
  const filter = buildHistoryFilter({
    agentType,
    responseSource,
    handoffTriggered,
    leadCaptured,
    dateFrom,
    dateTo,
    customerPhone,
    conversationId,
  });

  const [items, total] = await Promise.all([
    WhatsAppAiAgentLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    WhatsAppAiAgentLog.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeHistoryItem),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total > 0 ? Math.ceil(total / safeLimit) : 0,
    },
  };
};

const normalizeInterestPayload = (payload = {}) => {
  const companyName = normalizeString(payload.companyName, "companyName");
  const contactName = normalizeString(payload.contactName, "contactName");
  const email = normalizeString(payload.email, "email").toLowerCase();
  if (!companyName) throw createHttpError("companyName is required");
  if (!contactName) throw createHttpError("contactName is required");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createHttpError("email must be a valid email");
  }

  return {
    companyName,
    contactName,
    email,
    phone: normalizeString(payload.phone, "phone", ""),
    whatsappNumber: normalizeString(payload.whatsappNumber, "whatsappNumber", ""),
    preferredAgentTypes: normalizeAgentTypeArray(payload.preferredAgentTypes, "preferredAgentTypes", []),
    monthlyConversationVolume: normalizeNonNegativeNumber(payload.monthlyConversationVolume, "monthlyConversationVolume", 0),
    useCase: normalizeString(payload.useCase, "useCase", ""),
    catalogNeeded: normalizeBoolean(payload.catalogNeeded, "catalogNeeded", false),
    crmIntegrationNeeded: normalizeBoolean(payload.crmIntegrationNeeded, "crmIntegrationNeeded", false),
    webinarRequested: normalizeBoolean(payload.webinarRequested, "webinarRequested", false),
    notes: normalizeString(payload.notes, "notes", ""),
  };
};

const normalizeInterestUpdatePayload = (payload = {}) => {
  const update = {};

  if (payload.companyName !== undefined) update.companyName = normalizeString(payload.companyName, "companyName");
  if (payload.contactName !== undefined) update.contactName = normalizeString(payload.contactName, "contactName");
  if (payload.email !== undefined) {
    const email = normalizeString(payload.email, "email").toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw createHttpError("email must be a valid email");
    }
    update.email = email;
  }
  if (payload.phone !== undefined) update.phone = normalizeString(payload.phone, "phone", "");
  if (payload.whatsappNumber !== undefined) update.whatsappNumber = normalizeString(payload.whatsappNumber, "whatsappNumber", "");
  if (payload.preferredAgentTypes !== undefined) {
    update.preferredAgentTypes = normalizeAgentTypeArray(payload.preferredAgentTypes, "preferredAgentTypes", []);
  }
  if (payload.monthlyConversationVolume !== undefined) {
    update.monthlyConversationVolume = normalizeNonNegativeNumber(
      payload.monthlyConversationVolume,
      "monthlyConversationVolume",
      0
    );
  }
  if (payload.useCase !== undefined) update.useCase = normalizeString(payload.useCase, "useCase", "");
  if (payload.catalogNeeded !== undefined) update.catalogNeeded = normalizeBoolean(payload.catalogNeeded, "catalogNeeded", false);
  if (payload.crmIntegrationNeeded !== undefined) {
    update.crmIntegrationNeeded = normalizeBoolean(payload.crmIntegrationNeeded, "crmIntegrationNeeded", false);
  }
  if (payload.webinarRequested !== undefined) {
    update.webinarRequested = normalizeBoolean(payload.webinarRequested, "webinarRequested", false);
  }
  if (payload.notes !== undefined) update.notes = normalizeString(payload.notes, "notes", "");

  return update;
};

const normalizeObjectIdFilter = (value, fieldLabel) => {
  if (value === undefined || value === null || trimString(value) === "") return "";
  const normalized = trimString(value);
  if (!Types.ObjectId.isValid(normalized)) {
    throw createHttpError(`${fieldLabel} must be a valid id`);
  }
  return normalized;
};

const parseDateFilter = (value, fieldLabel, { endOfDay = false } = {}) => {
  const normalized = trimString(value);
  if (!normalized) return null;

  let date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    date = new Date(`${normalized}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  } else {
    date = new Date(normalized);
  }

  if (Number.isNaN(date.getTime())) {
    throw createHttpError(`${fieldLabel} must be a valid date`);
  }

  return date;
};

const serializeInterestItem = (item = {}) => ({
  _id: item._id,
  companyName: trimString(item.companyName),
  contactName: trimString(item.contactName),
  email: trimString(item.email),
  phone: trimString(item.phone),
  whatsappNumber: trimString(item.whatsappNumber),
  preferredAgentTypes: Array.isArray(item.preferredAgentTypes) ? item.preferredAgentTypes.map(trimString).filter(Boolean) : [],
  monthlyConversationVolume: Number(item.monthlyConversationVolume || 0),
  useCase: trimString(item.useCase),
  catalogNeeded: Boolean(item.catalogNeeded),
  crmIntegrationNeeded: Boolean(item.crmIntegrationNeeded),
  webinarRequested: Boolean(item.webinarRequested),
  notes: trimString(item.notes),
  status: trimString(item.status),
  createdAt: item.createdAt || null,
  updatedAt: item.updatedAt || null,
});

const createLeadFromInterestSubmission = async ({ interest, actor = null } = {}) => {
  if (!actor?._id) return null;

  try {
    return await upsertQualifiedLead({
      conversation: null,
      contact: {
        phone: trimString(interest.whatsappNumber || interest.phone),
        name: trimString(interest.contactName),
      },
      actorId: actor._id,
      agentType: "sales_agent",
      capturedFields: {
        name: trimString(interest.contactName),
        email: trimString(interest.email),
        phone: trimString(interest.whatsappNumber || interest.phone),
        company: trimString(interest.companyName),
      },
      source: "whatsapp_ai_agent_interest",
      sourceTag: "whatsapp_ai_agent_interest",
      message: trimString(interest.useCase),
      notes: [
        `Preferred agent types: ${Array.isArray(interest.preferredAgentTypes) ? interest.preferredAgentTypes.join(", ") : ""}`,
        `Monthly volume: ${Number(interest.monthlyConversationVolume || 0)}`,
      ],
    });
  } catch (error) {
    console.error("Failed to sync AI Agent interest submission into leads:", error);
    return null;
  }
};

const createWhatsAppAiAgentInterest = async ({ payload = {}, actor = null } = {}) => {
  const normalized = normalizeInterestPayload(payload);
  const interest = await WhatsAppAiAgentInterest.create({
    adminId: actor?._id || null,
    ...normalized,
    createdBy: actor?._id || null,
  });

  await createLeadFromInterestSubmission({ interest, actor });
  await recordActivityLogSafely({
    actor,
    title: "Created WhatsApp AI Agent interest submission",
    description: `${normalized.companyName} - ${normalized.contactName}`,
  });

  return {
    _id: interest._id,
    status: interest.status,
    createdAt: interest.createdAt,
  };
};

const listWhatsAppAiAgentInterests = async ({ page, limit, status, search } = {}) => {
  const safePage = clampPositiveInteger(page, DEFAULT_PAGE);
  const safeLimit = clampPositiveInteger(limit, DEFAULT_LIMIT, MAX_LIMIT);
  const filter = {};
  const normalizedStatus = trimString(status);
  const normalizedSearch = trimString(search);
  if (normalizedStatus) {
    if (!INTEREST_STATUS_OPTIONS.includes(normalizedStatus)) {
      throw createHttpError(`status must be one of: ${INTEREST_STATUS_OPTIONS.join(", ")}`);
    }
    filter.status = normalizedStatus;
  }

  if (normalizedSearch) {
    filter.$or = [
      { companyName: { $regex: escapeRegex(normalizedSearch), $options: "i" } },
      { contactName: { $regex: escapeRegex(normalizedSearch), $options: "i" } },
      { email: { $regex: escapeRegex(normalizedSearch), $options: "i" } },
      { phone: { $regex: escapeRegex(normalizedSearch), $options: "i" } },
      { whatsappNumber: { $regex: escapeRegex(normalizedSearch), $options: "i" } },
      { useCase: { $regex: escapeRegex(normalizedSearch), $options: "i" } },
    ];
  }

  const skip = (safePage - 1) * safeLimit;
  const [items, total] = await Promise.all([
    WhatsAppAiAgentInterest.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    WhatsAppAiAgentInterest.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeInterestItem),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total > 0 ? Math.ceil(total / safeLimit) : 0,
    },
  };
};

const updateWhatsAppAiAgentInterestStatus = async ({ id, status, actor = null } = {}) => {
  const interestId = normalizeObjectIdFilter(id, "id");
  const normalizedStatus = normalizeEnum(status, "status", INTEREST_STATUS_OPTIONS, "new");
  const interest = await WhatsAppAiAgentInterest.findById(interestId);
  if (!interest) {
    throw createHttpError("Interest submission not found", 404);
  }

  interest.status = normalizedStatus;
  await interest.save();

  await recordActivityLogSafely({
    actor,
    title: "Updated WhatsApp AI Agent interest status",
    description: `${trimString(interest.companyName)} -> ${normalizedStatus}`,
  });

  return {
    _id: interest._id,
    status: interest.status,
    updatedAt: interest.updatedAt || null,
  };
};

const updateWhatsAppAiAgentInterest = async ({ id, payload = {}, actor = null } = {}) => {
  const interestId = normalizeObjectIdFilter(id, "id");
  const update = normalizeInterestUpdatePayload(payload);
  if (!Object.keys(update).length) {
    throw createHttpError("At least one editable field is required");
  }

  const interest = await WhatsAppAiAgentInterest.findById(interestId);
  if (!interest) {
    throw createHttpError("Interest submission not found", 404);
  }

  Object.assign(interest, update);
  await interest.save();

  await recordActivityLogSafely({
    actor,
    title: "Updated WhatsApp AI Agent interest details",
    description: trimString(interest.companyName) || trimString(interest.contactName),
  });

  return serializeInterestItem(interest);
};

const resolvePreviewConversationContext = async ({ conversationId = "", customerPhone = "", allowCreate = false } = {}) => {
  const normalizedConversationId = trimString(conversationId);
  const normalizedCustomerPhone = trimString(customerPhone);

  if (normalizedConversationId) {
    if (!Types.ObjectId.isValid(normalizedConversationId)) {
      throw createHttpError("conversationId must be a valid id");
    }

    const conversation = await WhatsAppConversation.findById(normalizedConversationId)
      .populate("contactId", "name phone waId profile")
      .lean();
    if (!conversation) {
      throw createHttpError("Conversation not found", 404);
    }

    const contact =
      conversation.contactId && typeof conversation.contactId === "object"
        ? conversation.contactId
        : null;

    if (!contact?.phone) {
      throw createHttpError("Conversation contact phone is missing", 400);
    }

    return { conversation, contact };
  }

  if (!normalizedCustomerPhone) {
    return { conversation: null, contact: null };
  }

  const { normalizePhone } = require("./whatsappWebhookService");
  const normalizedPhone = normalizePhone(normalizedCustomerPhone);
  if (!allowCreate) {
    return { conversation: null, contact: { phone: normalizedPhone } };
  }

  const { upsertContact, ensureConversation } = require("./whatsappCRMService");
  const contact = await upsertContact({
    phone: normalizedPhone,
    waId: normalizedPhone,
    name: "",
    profile: {},
  });
  const conversation = await ensureConversation({ contactId: contact._id, autoAssign: true });
  return { conversation, contact };
};

const sendAgentReply = async ({
  app,
  conversation,
  contact,
  inboundMessage,
  agentType,
  result,
} = {}) => {
  if (!conversation?._id || !contact?.phone) {
    throw createHttpError("conversation and contact are required to send an AI agent reply");
  }
  if (!trimString(result?.reply)) {
    return null;
  }

  const { payload, response } = await sendMessage({
    to: contact.phone,
    type: "text",
    text: result.reply,
    context: {
      conversationId: conversation._id,
      contactId: contact._id,
      aiAgent: true,
      sourceMessageId: toObjectIdString(inboundMessage?._id),
      sourceExternalMessageId: trimString(inboundMessage?.externalMessageId),
      agentType,
      responseSource: result.responseSource,
    },
  });

  const { saveOutgoingMessage } = require("./whatsappCRMService");
  return saveOutgoingMessage({
    app,
    conversation,
    contact,
    agentId: conversation.agentId || null,
    messageType: "text",
    content: result.reply,
    response,
    requestPayload: payload,
    sender: "system",
    additionalMetadata: {
      aiAgent: {
        agentType,
        responseSource: result.responseSource,
        confidence: Number(result.confidence || 0),
        sourceMessageId: toObjectIdString(inboundMessage?._id),
        sourceExternalMessageId: trimString(inboundMessage?.externalMessageId),
      },
    },
  });
};

const persistConversationAgentState = async ({
  conversation,
  inboundMessage,
  agentType,
  handoffTriggered = false,
  handoffReason = "",
} = {}) => {
  if (!conversation) return;

  conversation.automationState = {
    ...toPlainObject(conversation.automationState),
    aiAgent: {
      ...toPlainObject(conversation.automationState?.aiAgent),
      currentAgentType: trimString(agentType),
      lastHandledMessageId: inboundMessage?._id || conversation.automationState?.aiAgent?.lastHandledMessageId || null,
      handoffTriggered: Boolean(handoffTriggered),
      handoffReason: handoffTriggered ? trimString(handoffReason) : trimString(conversation.automationState?.aiAgent?.handoffReason),
      handoffTriggeredAt: handoffTriggered ? new Date() : conversation.automationState?.aiAgent?.handoffTriggeredAt || null,
      qualification: {
        ...toPlainObject(conversation.automationState?.aiAgent?.qualification),
      },
    },
  };
  if (typeof conversation?.save === 'function') {
    await conversation.save();
  }
};

const isConversationEligibleForAiAgent = (conversation = {}) => {
  const aiAgentState = toPlainObject(conversation?.automationState?.aiAgent);
  if (aiAgentState?.handoffTriggered) return false;
  if (trimString(conversation?.workflowContext?.status) === "awaiting_interactive") return false;
  return true;
};

const processInboundWhatsAppAiAgent = async ({
  app,
  conversation,
  contact,
  inboundMessage,
  hardRuleMatched = false,
  aiIntentMatched = false,
  adminId = null,
} = {}) => {
  try {
    const settings = await getWhatsAppAiAgentSettings();
    const messageText = trimString(inboundMessage?.content);

    if (!settings.enabled) {
      return { status: "skipped", reason: "disabled" };
    }

    if (hardRuleMatched || aiIntentMatched) {
      return { status: "skipped", reason: hardRuleMatched ? "hard_rule_precedence" : "ai_intent_precedence" };
    }

    if (String(inboundMessage?.direction || "") !== "inbound") {
      return { status: "skipped", reason: "not_inbound" };
    }

    if (String(inboundMessage?.type || "text") !== "text") {
      return { status: "skipped", reason: "unsupported_type" };
    }

    if (!trimString(messageText)) {
      return { status: "skipped", reason: "empty_message" };
    }

    if (!isConversationEligibleForAiAgent(conversation)) {
      return { status: "skipped", reason: "conversation_ineligible" };
    }

    const lastHandledMessageId = toObjectIdString(conversation?.automationState?.aiAgent?.lastHandledMessageId);
    if (lastHandledMessageId && lastHandledMessageId === toObjectIdString(inboundMessage?._id)) {
      return { status: "skipped", reason: "already_handled" };
    }

    const result = await resolveWhatsAppAiAgentResponse(
      messageText,
      { conversation, contact },
      {
        settings,
        actorId: adminId || conversation?.agentId || null,
      }
    );

    if (result.status === "ignored" || result.status === "disabled") {
      return result;
    }

    if (trimString(result.reply)) {
      await sendAgentReply({
        app,
        conversation,
        contact,
        inboundMessage,
        agentType: result.agentType,
        result,
      });
    }

    await persistConversationAgentState({
      conversation,
      inboundMessage,
      agentType: result.agentType,
      handoffTriggered: Boolean(result.handoffTriggered),
      handoffReason: Array.isArray(result.notes) ? result.notes[0] : "",
    });

    await createAgentLog({
      adminId: adminId || conversation?.agentId || null,
      conversationId: conversation?._id || null,
      messageId: trimString(inboundMessage?.externalMessageId || inboundMessage?._id),
      customerPhone: trimString(contact?.phone),
      agentType: result.agentType,
      direction: "inbound",
      messageText,
      responseText: trimString(result.reply),
      responseSource: result.responseSource,
      confidence: result.confidence,
      leadCaptured: Boolean(result.leadCaptured),
      leadId: result.leadId || null,
      handoffTriggered: Boolean(result.handoffTriggered),
      notes: result.notes,
    });

    return result;
  } catch (error) {
    console.error("WhatsApp AI Agent processing failed:", error);
    await createAgentLog({
      adminId: adminId || conversation?.agentId || null,
      conversationId: conversation?._id || null,
      messageId: trimString(inboundMessage?.externalMessageId || inboundMessage?._id),
      customerPhone: trimString(contact?.phone),
      agentType: DEFAULT_SETTINGS.defaultAgentType,
      direction: "inbound",
      messageText: trimString(inboundMessage?.content),
      responseText: "",
      responseSource: "fallback",
      confidence: 0,
      notes: [error.message || "Unhandled WhatsApp AI Agent failure"],
    }).catch((logError) => {
      console.error("Failed to write WhatsApp AI Agent failure log:", logError);
    });

    return {
      status: "failed",
      error: error.message || "Unhandled WhatsApp AI Agent failure",
    };
  }
};

const previewWhatsAppAiAgent = async ({
  app,
  actor = null,
  agentType,
  message,
  conversationId = "",
  customerPhone = "",
  send = false,
} = {}) => {
  const trimmedMessage = trimString(message);
  if (!trimmedMessage) {
    throw createHttpError("message is required");
  }

  const selectedAgentType = normalizeEnum(agentType, "agentType", AGENT_TYPE_OPTIONS, DEFAULT_SETTINGS.defaultAgentType);
  const settings = await getWhatsAppAiAgentSettings();
  const previewContext = await resolvePreviewConversationContext({
    conversationId,
    customerPhone,
    allowCreate: Boolean(send),
  });

  const result = await resolveWhatsAppAiAgentResponse(
    trimmedMessage,
    {
      conversation: previewContext.conversation,
      contact: previewContext.contact,
    },
    {
      agentType: selectedAgentType,
      settings,
      actorId: actor?._id || null,
    }
  );

  let actionTaken = "preview_only";
  if (send === true && trimString(result.reply)) {
    if (!previewContext.conversation || !previewContext.contact?.phone) {
      throw createHttpError("conversationId or customerPhone is required when send is true");
    }

    await sendAgentReply({
      app,
      conversation: previewContext.conversation,
      contact: previewContext.contact,
      inboundMessage: {
        _id: null,
        externalMessageId: "",
        content: trimmedMessage,
      },
      agentType: result.agentType,
      result,
    });

    await persistConversationAgentState({
      conversation: previewContext.conversation,
      inboundMessage: { _id: null },
      agentType: result.agentType,
      handoffTriggered: Boolean(result.handoffTriggered),
      handoffReason: Array.isArray(result.notes) ? result.notes[0] : "",
    });

    await createAgentLog({
      adminId: actor?._id || null,
      conversationId: previewContext.conversation._id || null,
      messageId: "",
      customerPhone: trimString(previewContext.contact.phone),
      agentType: result.agentType,
      direction: "outbound",
      messageText: trimmedMessage,
      responseText: trimString(result.reply),
      responseSource: result.responseSource,
      confidence: result.confidence,
      leadCaptured: Boolean(result.leadCaptured),
      leadId: result.leadId || null,
      handoffTriggered: Boolean(result.handoffTriggered),
      notes: [...(Array.isArray(result.notes) ? result.notes : []), "Triggered from admin test endpoint"],
    });

    actionTaken = "sent";
  }

  return {
    agentType: result.agentType,
    status: "preview",
    message: trimmedMessage,
    reply: trimString(result.reply),
    responseSource: result.responseSource,
    confidence: Number(result.confidence || 0),
    suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
    leadCapture: result.leadCapture || { needed: false, fields: [] },
    handoffTriggered: Boolean(result.handoffTriggered),
    notes: Array.isArray(result.notes) ? result.notes.map(trimString).filter(Boolean) : [],
    leadId: toObjectIdString(result.leadId) || "",
    conversationId: toObjectIdString(previewContext.conversation?._id) || "",
    matchedKnowledgeArticleIds: Array.isArray(result.matchedKnowledgeArticleIds)
      ? result.matchedKnowledgeArticleIds.map(trimString).filter(Boolean)
      : [],
    matchedCatalogItemIds: Array.isArray(result.matchedCatalogItemIds)
      ? result.matchedCatalogItemIds.map(trimString).filter(Boolean)
      : [],
    actionTaken,
  };
};

module.exports = {
  AGENT_TYPE_OPTIONS,
  INTEREST_STATUS_OPTIONS,
  getWhatsAppAiAgentSettings,
  getWhatsAppAiAgentOverview,
  updateWhatsAppAiAgentSettings,
  createWhatsAppAiAgentInterest,
  listWhatsAppAiAgentInterests,
  updateWhatsAppAiAgentInterestStatus,
  updateWhatsAppAiAgentInterest,
  previewWhatsAppAiAgent,
  listWhatsAppAiAgentHistory,
  resolveWhatsAppAiAgentResponse,
  processInboundWhatsAppAiAgent,
  __private: {
    normalizeSettingsPayload,
    normalizeInterestPayload,
    normalizeInterestUpdatePayload,
    normalizeText,
    tokenize,
    scoreCandidate,
    resolveSalesAgentResponse,
    resolveFaqResponderResponse,
    resolveLeadQualifierResponse,
    resolveRuntimeAgentType,
    buildFallbackReply,
    buildHistoryFilter,
    serializeInterestItem,
    serializeHistoryItem,
    isConversationEligibleForAiAgent,
    buildQualificationPrompt,
    extractFieldValue,
    upsertQualifiedLead,
  },
};




const { Types } = require("mongoose");

const ActivityLog = require("../models/ActivityLog");
const WhatsAppAiIntentMatchLog = require("../models/WhatsAppAiIntentMatchLog");
const WhatsAppAiIntentMatchingSettings = require("../models/WhatsAppAiIntentMatchingSettings");
const WhatsAppAutomation = require("../models/WhatsAppAutomation");
const WhatsAppAutomationJob = require("../models/WhatsAppAutomationJob");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppForm = require("../models/WhatsAppForm");
const WhatsAppQuickReply = require("../models/WhatsAppQuickReply");
const { getBasicAutomationSettings } = require("./whatsappBasicAutomationService");
const { reserveWalletAmount, commitWalletReservation, getWalletSummary } = require("./whatsappWalletService");

const MATCH_MODE_OPTIONS = WhatsAppAiIntentMatchingSettings.MATCH_MODE_OPTIONS || ["balanced", "precise", "aggressive"];
const LOW_CONFIDENCE_ACTION_OPTIONS = WhatsAppAiIntentMatchingSettings.LOW_CONFIDENCE_ACTION_OPTIONS || ["no_match", "fallback_to_team"];
const DEFAULT_SINGLETON_KEY = "default";
const DEFAULT_HISTORY_PAGE = 1;
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;
const RECENT_WORKFLOW_RUN_WINDOW_DAYS = 30;
const MATCH_THRESHOLD_BY_MODE = Object.freeze({
  precise: 0.82,
  balanced: 0.72,
  aggressive: 0.6,
});
const REQUIRED_CONFIDENCE_MARGIN = 0.08;
const MINIMUM_MARGIN_WITH_HIGH_CONFIDENCE = 0.06;

const resolveConfidenceMargin = (topConfidence, threshold) => {
  if (topConfidence >= Math.min(0.92, threshold + 0.15)) {
    return MINIMUM_MARGIN_WITH_HIGH_CONFIDENCE;
  }

  if (topConfidence >= Math.min(0.8, threshold + 0.08)) {
    return MINIMUM_MARGIN_WITH_HIGH_CONFIDENCE;
  }

  return REQUIRED_CONFIDENCE_MARGIN;
};

const MIN_MESSAGE_LENGTH = 2;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "be",
  "by",
  "for",
  "from",
  "hello",
  "help",
  "hi",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "the",
  "to",
  "we",
  "what",
  "where",
  "with",
  "you",
  "your",
]);

const INTENT_SYNONYM_GROUPS = Object.freeze({
  consultation: [
    "consult",
    "consultation",
    "appointment",
    "book a call",
    "book call",
    "book consultation",
    "booking",
    "call",
    "counseling",
    "meeting",
    "speak to someone",
    "talk to someone",
  ],
  documents: [
    "document",
    "documents",
    "document list",
    "required documents",
    "required docs",
    "docs",
    "papers",
    "paperwork",
    "checklist",
    "document checklist",
    "submit documents",
  ],
  visa: [
    "visa",
    "visa info",
    "visa information",
    "visa processing",
    "application",
    "student visa",
    "migration",
    "requirements",
    "visa requirements",
  ],
  follow_up: [
    "follow up",
    "follow-up",
    "update",
    "status",
    "check progress",
    "progress",
    "application status",
  ],
  out_of_office: [
    "are you available",
    "office closed",
    "reply later",
    "not available",
    "out of office",
    "available now",
  ],
  booking: [
    "book",
    "booking",
    "reserve",
    "schedule",
    "appointment",
  ],
  send: [
    "send",
    "share",
    "provide",
    "give me",
  ],
  info: [
    "information",
    "info",
    "details",
    "guide",
    "requirements",
  ],
});

const VERB_HINTS = Object.freeze({
  book: ["book", "schedule", "reserve"],
  send: ["send", "share", "provide", "give"],
  track: ["track", "check", "follow", "update"],
  know: ["know", "need", "want", "understand", "learn"],
});

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  matchMode: "balanced",
  billingEnabled: false,
  pricePerSuccessfulMatchMinor: 20,
  currency: "INR",
  lowConfidenceAction: "fallback_to_team",
  createdBy: null,
  updatedBy: null,
  createdAt: null,
  updatedAt: null,
});

const BASIC_AUTOMATION_INTENT_MAP = Object.freeze({
  outOfOffice: "Out of office",
  welcome: "Welcome",
  delayedResponse: "Delayed response",
});

const trimString = (value) => String(value || "").trim();
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

const normalizeCurrency = (value, defaultValue = "INR") => {
  if (value === undefined) return defaultValue;
  const currency = trimString(value).toUpperCase();
  if (!currency || currency.length < 3 || currency.length > 10) {
    throw createHttpError("currency must be a valid code");
  }
  return currency;
};

const normalizeMatchMode = (value, defaultValue = "balanced") => {
  if (value === undefined) return defaultValue;
  const matchMode = trimString(value) || defaultValue;
  if (!MATCH_MODE_OPTIONS.includes(matchMode)) {
    throw createHttpError(`matchMode must be one of: ${MATCH_MODE_OPTIONS.join(", ")}`);
  }
  return matchMode;
};

const normalizeLowConfidenceAction = (value, defaultValue = "fallback_to_team") => {
  if (value === undefined) return defaultValue;
  const action = trimString(value) || defaultValue;
  if (!LOW_CONFIDENCE_ACTION_OPTIONS.includes(action)) {
    throw createHttpError(`lowConfidenceAction must be one of: ${LOW_CONFIDENCE_ACTION_OPTIONS.join(", ")}`);
  }
  return action;
};

const normalizeHistoryStatus = (value) => {
  const normalized = trimString(value);
  if (!normalized) return "";
  const allowed = ["matched", "no_match", "skipped", "failed"];
  if (!allowed.includes(normalized)) {
    throw createHttpError(`status must be one of: ${allowed.join(", ")}`);
  }
  return normalized;
};

const normalizeMinorAmount = (value, fieldLabel, defaultValue) => {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createHttpError(`${fieldLabel} must be greater than or equal to 0`);
  }
  return Math.round(parsed);
};

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

const defaultSettingsPayload = () => ({
  ...DEFAULT_SETTINGS,
  createdBy: null,
  updatedBy: null,
  createdAt: null,
  updatedAt: null,
});

const serializeSettings = (settings) => {
  const plain = settings ? toPlainObject(settings) : defaultSettingsPayload();
  return {
    enabled: plain.enabled === undefined ? DEFAULT_SETTINGS.enabled : Boolean(plain.enabled),
    matchMode: trimString(plain.matchMode || DEFAULT_SETTINGS.matchMode) || DEFAULT_SETTINGS.matchMode,
    billingEnabled: plain.billingEnabled === undefined ? DEFAULT_SETTINGS.billingEnabled : Boolean(plain.billingEnabled),
    pricePerSuccessfulMatchMinor: Number(plain.pricePerSuccessfulMatchMinor ?? DEFAULT_SETTINGS.pricePerSuccessfulMatchMinor),
    currency: normalizeCurrency(plain.currency, DEFAULT_SETTINGS.currency),
    lowConfidenceAction: trimString(plain.lowConfidenceAction || DEFAULT_SETTINGS.lowConfidenceAction) || DEFAULT_SETTINGS.lowConfidenceAction,
    createdBy: plain.createdBy || null,
    updatedBy: plain.updatedBy || null,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
};

const serializeUpdatedBy = (updatedBy) =>
  updatedBy && typeof updatedBy === "object"
    ? {
        _id: updatedBy._id || null,
        name: trimString(updatedBy.name),
      }
    : null;

const normalizeSettingsPayload = (payload = {}, current = DEFAULT_SETTINGS) => ({
  enabled: normalizeBoolean(payload.enabled, "enabled", Boolean(current.enabled)),
  matchMode: normalizeMatchMode(payload.matchMode, current.matchMode || DEFAULT_SETTINGS.matchMode),
  billingEnabled: normalizeBoolean(payload.billingEnabled, "billingEnabled", Boolean(current.billingEnabled)),
  pricePerSuccessfulMatchMinor: normalizeMinorAmount(
    payload.pricePerSuccessfulMatchMinor,
    "pricePerSuccessfulMatchMinor",
    Number(current.pricePerSuccessfulMatchMinor ?? DEFAULT_SETTINGS.pricePerSuccessfulMatchMinor)
  ),
  currency: normalizeCurrency(payload.currency, current.currency || DEFAULT_SETTINGS.currency),
  lowConfidenceAction: normalizeLowConfidenceAction(
    payload.lowConfidenceAction,
    current.lowConfidenceAction || DEFAULT_SETTINGS.lowConfidenceAction
  ),
});

const getOrCreateSettingsDocument = async ({ createIfMissing = false } = {}) => {
  let settings = await WhatsAppAiIntentMatchingSettings.findOne({ singletonKey: DEFAULT_SINGLETON_KEY })
    .populate("updatedBy", "_id name")
    .populate("createdBy", "_id name");

  if (!settings && createIfMissing) {
    try {
      settings = await WhatsAppAiIntentMatchingSettings.create({
        singletonKey: DEFAULT_SINGLETON_KEY,
      });
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
    }

    settings = await WhatsAppAiIntentMatchingSettings.findOne({ singletonKey: DEFAULT_SINGLETON_KEY })
      .populate("updatedBy", "_id name")
      .populate("createdBy", "_id name");
  }

  return settings;
};

const getAiIntentMatchingSettings = async () => serializeSettings(await getOrCreateSettingsDocument());

const getRecentWorkflowRunCount = async () => {
  try {
    const since = new Date(Date.now() - RECENT_WORKFLOW_RUN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return WhatsAppAutomationJob.countDocuments({
      createdAt: { $gte: since },
      status: { $in: ["pending", "processing", "completed"] },
    });
  } catch (error) {
    console.error("Failed to resolve recent workflow run count:", error);
    return 0;
  }
};

const getBasicAutomationEnabledCount = async () => {
  const settings = await getBasicAutomationSettings();
  return ["outOfOffice", "welcome", "delayedResponse"].reduce((count, key) => (
    settings?.automations?.[key]?.enabled ? count + 1 : count
  ), 0);
};

const buildOverviewFromSettings = async (settings) => {
  const serialized = serializeSettings(settings);
  const [quickReplies, forms, basicAutomations, workflows, recentWorkflowRuns] = await Promise.all([
    WhatsAppQuickReply.countDocuments({ isActive: true }),
    WhatsAppForm.countDocuments({ isActive: true }),
    getBasicAutomationEnabledCount(),
    WhatsAppAutomation.countDocuments({ enabled: true }),
    getRecentWorkflowRunCount(),
  ]);

  return {
    enabled: serialized.enabled,
    matchMode: serialized.matchMode,
    billingEnabled: serialized.billingEnabled,
    pricePerSuccessfulMatchMinor: serialized.pricePerSuccessfulMatchMinor,
    currency: serialized.currency,
    lowConfidenceAction: serialized.lowConfidenceAction,
    stats: {
      quickReplies,
      forms,
      basicAutomations,
      workflows,
      recentWorkflowRuns,
    },
    updatedAt: serialized.updatedAt,
    updatedBy: serializeUpdatedBy(serialized.updatedBy),
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
    console.error("Failed to write activity log for WhatsApp AI intent matching:", error);
  }
};

const getAiIntentMatchingOverview = async () => buildOverviewFromSettings(await getOrCreateSettingsDocument());

const updateAiIntentMatchingSettings = async ({ payload = {}, actor = null } = {}) => {
  const existingSettings = await getOrCreateSettingsDocument({ createIfMissing: true });
  const current = serializeSettings(existingSettings);
  const normalized = normalizeSettingsPayload(payload, current);

  existingSettings.enabled = normalized.enabled;
  existingSettings.matchMode = normalized.matchMode;
  existingSettings.billingEnabled = normalized.billingEnabled;
  existingSettings.pricePerSuccessfulMatchMinor = normalized.pricePerSuccessfulMatchMinor;
  existingSettings.currency = normalized.currency;
  existingSettings.lowConfidenceAction = normalized.lowConfidenceAction;
  existingSettings.updatedBy = actor?._id || existingSettings.updatedBy || null;
  if (!existingSettings.createdBy && actor?._id) {
    existingSettings.createdBy = actor._id;
  }

  await existingSettings.save();

  await recordActivityLogSafely({
    actor,
    title: "Updated WhatsApp AI intent matching settings",
    description: `Mode: ${normalized.matchMode}, enabled: ${normalized.enabled ? "yes" : "no"}`,
  });

  const refreshed = await getOrCreateSettingsDocument();
  return buildOverviewFromSettings(refreshed);
};

const stemToken = (value) => {
  const token = trimString(value).toLowerCase();
  if (token.length <= 4) return token;
  if (token.endsWith("ing")) return token.slice(0, -3);
  if (token.endsWith("ed")) return token.slice(0, -2);
  if (token.endsWith("es")) return token.slice(0, -2);
  if (token.endsWith("s")) return token.slice(0, -1);
  return token;
};

const normalizeText = (value) =>
  trimString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value) =>
  normalizeText(value)
    .split(" ")
    .map(stemToken)
    .filter((token) => token && token.length > 1 && !STOP_WORDS.has(token));

const uniqueTokens = (value) => [...new Set(tokenize(value))];

const uniqueNormalizedValues = (values = []) => {
  const seen = new Set();
  const normalized = [];

  for (const value of values) {
    const trimmed = trimString(value);
    if (!trimmed) continue;

    const normalizedValue = normalizeText(trimmed);
    if (!normalizedValue || seen.has(normalizedValue)) continue;

    seen.add(normalizedValue);
    normalized.push(normalizedValue);
  }

  return normalized;
};

const buildTokenSet = (values = []) =>
  [...new Set(values.flatMap((value) => uniqueTokens(value)).filter(Boolean))];

const buildNgramArray = (tokens = [], size = 2) => {
  if (!Array.isArray(tokens) || tokens.length < size) return [];

  const grams = [];
  for (let index = 0; index <= tokens.length - size; index += 1) {
    grams.push(tokens.slice(index, index + size).join(" "));
  }
  return grams;
};

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

const computeSetOverlap = (left = [], right = []) => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let matches = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) matches += 1;
  }

  return matches;
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

const flattenObjectStrings = (value) => {
  if (!value) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenObjectStrings(item));
  }
  if (typeof value === "object") {
    return Object.values(value).flatMap((item) => flattenObjectStrings(item));
  }
  return [];
};

const inferIntentConcepts = (value = "") => {
  const normalized = normalizeText(value);
  if (!normalized) return [];

  return Object.entries(INTENT_SYNONYM_GROUPS)
    .filter(([, synonyms]) => synonyms.some((synonym) => normalized.includes(normalizeText(synonym))))
    .map(([concept]) => concept);
};

const buildConceptExpansions = (value = "") => {
  const concepts = inferIntentConcepts(value);
  return uniqueNormalizedValues(
    concepts.flatMap((concept) => INTENT_SYNONYM_GROUPS[concept] || [])
  );
};

const generateAliasVariants = (value = "") => {
  const trimmed = trimString(value);
  if (!trimmed) return [];

  const normalized = normalizeText(trimmed);
  const tokens = uniqueTokens(trimmed);
  const variants = new Set([
    normalized,
    trimmed,
    ...tokens,
  ]);

  const conceptExpansions = buildConceptExpansions(trimmed);
  conceptExpansions.forEach((item) => variants.add(item));

  if (tokens.includes("consultation") || conceptExpansions.includes("consultation")) {
    ["book consultation", "consultation booking", "appointment", "book appointment"].forEach((item) => variants.add(item));
  }
  if (tokens.includes("document") || tokens.includes("documents") || conceptExpansions.includes("documents")) {
    ["required documents", "document list", "checklist", "required docs"].forEach((item) => variants.add(item));
  }
  if (tokens.includes("visa") || conceptExpansions.includes("visa")) {
    ["visa information", "visa processing", "visa requirements"].forEach((item) => variants.add(item));
  }
  if (tokens.includes("booking") || tokens.includes("book")) {
    ["book", "booking", "appointment"].forEach((item) => variants.add(item));
  }
  if (tokens.includes("follow") || tokens.includes("update") || conceptExpansions.includes("update")) {
    ["follow up", "application status", "check progress"].forEach((item) => variants.add(item));
  }

  return uniqueNormalizedValues([...variants]);
};

const detectVerbObjectHints = (value = "") => {
  const normalized = normalizeText(value);
  const hints = new Set();
  if (!normalized) return [];

  const concepts = inferIntentConcepts(normalized);
  for (const [verbKey, verbs] of Object.entries(VERB_HINTS)) {
    if (!verbs.some((verb) => normalized.includes(normalizeText(verb)))) continue;
    concepts.forEach((concept) => hints.add(`${verbKey}:${concept}`));
  }

  if (/\bbook\b/.test(normalized) && /\bconsult|appointment|meeting\b/.test(normalized)) {
    hints.add("book:consultation");
  }
  if (/\bsend|share|provide\b/.test(normalized) && /\bdocument|checklist|paper|docs\b/.test(normalized)) {
    hints.add("send:documents");
  }
  if (/\bneed|want|information|info\b/.test(normalized) && /\bvisa|migration|application\b/.test(normalized)) {
    hints.add("know:visa");
  }
  if (/\bfollow|update|status|progress\b/.test(normalized) && /\bapplication|case|process\b/.test(normalized)) {
    hints.add("track:follow_up");
  }

  return [...hints];
};

const buildKeywordBuckets = ({
  title = "",
  intentLabel = "",
  aliases = [],
  shortcut = "",
  category = "",
  folder = "",
  tags = [],
  keywords = [],
  phrases = [],
  description = "",
  messageBody = "",
  fieldLabels = [],
  placeholderText = [],
  nodeLabels = [],
  nodeBodyTexts = [],
  extra = [],
} = {}) => {
  const generatedAliases = [
    ...generateAliasVariants(title),
    ...generateAliasVariants(intentLabel),
    ...aliases,
  ];

  return {
    primaryKeywords: uniqueNormalizedValues([
      title,
      intentLabel,
      shortcut,
      ...generatedAliases,
      ...keywords,
    ]),
    secondaryKeywords: uniqueNormalizedValues([
      category,
      folder,
      description,
      messageBody,
      ...tags,
      ...fieldLabels,
      ...placeholderText,
      ...nodeLabels,
      ...nodeBodyTexts,
      ...extra,
    ]),
    phrases: uniqueNormalizedValues([
      title,
      intentLabel,
      description,
      messageBody,
      ...phrases,
      ...generatedAliases,
      ...fieldLabels,
      ...nodeLabels,
      ...nodeBodyTexts,
    ]),
  };
};

const buildCandidateMatchData = (candidate = {}) => {
  const fields = candidate.matchFields || {};
  const keywordBuckets = candidate.keywordBuckets || buildKeywordBuckets({
    title: fields.destinationName,
    intentLabel: fields.intentLabel,
    aliases: fields.aliases,
    shortcut: fields.shortcut,
    category: fields.category,
    folder: fields.folder,
    tags: fields.tags,
    keywords: fields.keywords,
    phrases: fields.phrases,
    description: fields.description,
    messageBody: fields.messageBody,
    fieldLabels: fields.fieldLabels,
    placeholderText: fields.placeholderText,
    nodeLabels: fields.nodeLabels,
    nodeBodyTexts: fields.nodeBodyTexts,
    extra: fields.extra,
  });

  const titleAliases = uniqueNormalizedValues([
    fields.destinationName,
    fields.intentLabel,
    ...(Array.isArray(fields.aliases) ? fields.aliases : []),
  ]);
  const phraseSet = uniqueNormalizedValues([
    ...(Array.isArray(keywordBuckets.phrases) ? keywordBuckets.phrases : []),
    ...(Array.isArray(fields.phrases) ? fields.phrases : []),
  ]);
  const primaryTokens = buildTokenSet(keywordBuckets.primaryKeywords);
  const secondaryTokens = buildTokenSet(keywordBuckets.secondaryKeywords);
  const bodySources = [
    fields.description,
    fields.messageBody,
    fields.searchableText,
    ...(Array.isArray(fields.fieldLabels) ? fields.fieldLabels : []),
    ...(Array.isArray(fields.placeholderText) ? fields.placeholderText : []),
    ...(Array.isArray(fields.nodeLabels) ? fields.nodeLabels : []),
    ...(Array.isArray(fields.nodeBodyTexts) ? fields.nodeBodyTexts : []),
    ...(Array.isArray(fields.extra) ? fields.extra : []),
  ];
  const titleTokens = buildTokenSet(titleAliases);
  const bodyTokens = buildTokenSet(bodySources);
  const titleNgrams = [
    ...buildNgramArray(titleTokens, 2),
    ...buildNgramArray(titleTokens, 3),
  ];
  const bodyNgrams = [
    ...buildNgramArray(bodyTokens, 2),
    ...buildNgramArray(bodyTokens, 3),
  ];

  return {
    titleAliases,
    titleTokens,
    primaryTokens,
    secondaryTokens,
    bodyTokens,
    titleNgrams,
    bodyNgrams,
    phraseSet,
    keywordBuckets,
    normalizedSearchableText: normalizeText(fields.searchableText || candidate.searchableText || ""),
    verbObjectHints: detectVerbObjectHints([
      fields.destinationName,
      fields.intentLabel,
      ...(Array.isArray(keywordBuckets.primaryKeywords) ? keywordBuckets.primaryKeywords : []),
      ...(Array.isArray(keywordBuckets.phrases) ? keywordBuckets.phrases : []),
    ].join(" ")),
  };
};

const buildQuickReplyCandidates = async () => {
  const quickReplies = await WhatsAppQuickReply.find({ isActive: true })
    .select("_id title shortcut category folder content tags labels aliases isActive updatedAt")
    .sort({ updatedAt: -1, _id: -1 })
    .lean();

  return quickReplies.map((quickReply) => {
    const aliases = uniqueNormalizedValues([
      ...(Array.isArray(quickReply.tags) ? quickReply.tags : []),
      ...(Array.isArray(quickReply.labels) ? quickReply.labels : []),
      ...(Array.isArray(quickReply.aliases) ? quickReply.aliases : []),
      ...generateAliasVariants(quickReply.title),
    ]);
    const phrases = uniqueNormalizedValues([
      quickReply.title,
      quickReply.content,
      ...aliases,
    ]);
    const keywordBuckets = buildKeywordBuckets({
      title: quickReply.title,
      intentLabel: quickReply.title,
      aliases,
      shortcut: quickReply.shortcut,
      category: quickReply.category,
      folder: quickReply.folder,
      tags: quickReply.tags,
      phrases,
      description: quickReply.content,
      messageBody: quickReply.content,
    });
    const searchableText = [
      quickReply.title,
      quickReply.shortcut,
      quickReply.category,
      quickReply.folder,
      quickReply.content,
      ...(Array.isArray(quickReply.tags) ? quickReply.tags : []),
      ...aliases,
    ]
      .map(trimString)
      .filter(Boolean)
      .join(" ");

    return {
      destinationType: "quick_reply",
      destinationId: toObjectIdString(quickReply._id),
      destinationName: trimString(quickReply.title),
      intentLabel: trimString(quickReply.title),
      searchableText,
      keywordBuckets,
      execution: {
        quickReplyId: toObjectIdString(quickReply._id),
        content: trimString(quickReply.content),
      },
      matchFields: {
        destinationName: quickReply.title,
        intentLabel: quickReply.title,
        shortcut: quickReply.shortcut,
        category: quickReply.category,
        folder: quickReply.folder,
        tags: Array.isArray(quickReply.tags) ? quickReply.tags : [],
        aliases,
        phrases,
        messageBody: quickReply.content,
        searchableText,
      },
    };
  });
};

const buildBasicAutomationCandidates = async () => {
  const settings = await getBasicAutomationSettings();
  const automations = settings?.automations || {};

  return Object.entries(BASIC_AUTOMATION_INTENT_MAP)
    .map(([automationKey, intentLabel]) => {
      const config = automations?.[automationKey];
      if (!config?.enabled) return null;

      const searchableText = [
        intentLabel,
        automationKey,
        trimString(config.message),
        trimString(config.templateName),
        trimString(config.templateCategory),
        trimString(config.replyActionType),
        trimString(config.formName),
        trimString(config.interactiveListName),
        trimString(config.productCollectionName),
        trimString(config.delayLabel),
        trimString(config.cooldownLabel),
        trimString(config.triggerDescription),
      ]
        .filter(Boolean)
        .join(" ");

      const aliases = uniqueNormalizedValues([
        automationKey,
        intentLabel,
        ...generateAliasVariants(intentLabel),
      ]);
      const phrases = uniqueNormalizedValues([
        intentLabel,
        config.message,
        config.triggerDescription,
        `${automationKey} automation`,
      ]);
      const keywordBuckets = buildKeywordBuckets({
        title: intentLabel,
        intentLabel,
        aliases,
        keywords: [automationKey, config.replyActionType],
        phrases,
        description: config.triggerDescription || config.message,
        messageBody: config.message,
        extra: [
          config.templateName,
          config.templateCategory,
          config.formName,
          config.interactiveListName,
          config.productCollectionName,
          config.delayLabel,
          config.cooldownLabel,
        ],
      });

      return {
        destinationType: "basic_automation",
        destinationId: automationKey,
        destinationName: intentLabel,
        intentLabel,
        searchableText,
        keywordBuckets,
        execution: {
          automationKey,
        },
        matchFields: {
          destinationName: intentLabel,
          intentLabel,
          aliases,
          phrases,
          description: config.triggerDescription || config.message,
          messageBody: config.message,
          keywords: [
            automationKey,
            config.replyActionType,
            config.formName,
            config.interactiveListName,
            config.productCollectionName,
            config.templateName,
            config.templateCategory,
          ],
          extra: [config.delayLabel, config.cooldownLabel],
          searchableText,
        },
      };
    })
    .filter(Boolean);
};

const buildFormCandidates = async () => {
  const forms = await WhatsAppForm.find({ isActive: true })
    .select("_id name description category fields providerFlowId providerFlowName providerFlowMode providerFlowFirstScreenId updatedAt")
    .sort({ updatedAt: -1, _id: -1 })
    .lean();

  return forms.map((form) => {
    const fieldLabels = Array.isArray(form.fields) ? form.fields.map((field) => trimString(field.label)).filter(Boolean) : [];
    const placeholderText = Array.isArray(form.fields)
      ? form.fields.flatMap((field) => [trimString(field.placeholder), ...(Array.isArray(field.options) ? field.options : [])]).filter(Boolean)
      : [];
    const aliases = uniqueNormalizedValues([
      ...generateAliasVariants(form.name),
      form.category,
    ]);
    const phrases = uniqueNormalizedValues([
      form.name,
      form.description,
      ...fieldLabels,
      ...placeholderText,
      ...aliases,
    ]);
    const searchableText = [
      form.name,
      form.description,
      form.category,
      ...fieldLabels,
      ...placeholderText,
      ...aliases,
    ]
      .map(trimString)
      .filter(Boolean)
      .join(" ");
    const keywordBuckets = buildKeywordBuckets({
      title: form.name,
      intentLabel: form.name,
      aliases,
      category: form.category,
      phrases,
      description: form.description,
      fieldLabels,
      placeholderText,
      extra: [form.submitButtonText, form.successMessage],
    });

    return {
      destinationType: "form",
      destinationId: toObjectIdString(form._id),
      destinationName: trimString(form.name),
      intentLabel: trimString(form.name),
      searchableText,
      keywordBuckets,
      execution: {
        formId: toObjectIdString(form._id),
        providerFlowId: trimString(form.providerFlowId),
        providerFlowName: trimString(form.providerFlowName),
        providerFlowMode: trimString(form.providerFlowMode || "published") || "published",
        providerFlowFirstScreenId: trimString(form.providerFlowFirstScreenId),
      },
      matchFields: {
        destinationName: form.name,
        intentLabel: form.name,
        aliases,
        description: form.description,
        category: form.category,
        fieldLabels,
        placeholderText,
        phrases,
        extra: [form.submitButtonText, form.successMessage],
        searchableText,
      },
    };
  });
};

const buildWorkflowCandidates = async () => {
  const workflows = await WhatsAppAutomation.find({ enabled: true })
    .select("name description enabled triggerType triggerConfig workflowGraph actions updatedAt builderMode")
    .sort({ updatedAt: -1, _id: -1 })
    .lean();

  return workflows.map((workflow) => {
    const triggerKeywords = Array.isArray(workflow.triggerConfig?.keywords)
      ? workflow.triggerConfig.keywords.map((value) => trimString(value)).filter(Boolean)
      : [];
    const nodeLabels = Array.isArray(workflow.workflowGraph?.nodes)
      ? workflow.workflowGraph.nodes.map((node) => trimString(node.label || node.nodeId)).filter(Boolean)
      : [];
    const nodeBodyTexts = Array.isArray(workflow.workflowGraph?.nodes)
      ? workflow.workflowGraph.nodes
        .flatMap((node) => flattenObjectStrings(node.config))
        .map(trimString)
        .filter(Boolean)
      : [];
    const actionLabels = Array.isArray(workflow.actions)
      ? workflow.actions
        .flatMap((action) => [trimString(action.label || action.type), ...flattenObjectStrings(action.config)])
        .filter(Boolean)
      : [];
    const aliases = uniqueNormalizedValues([
      ...generateAliasVariants(workflow.name),
      workflow.triggerType,
      ...(Array.isArray(workflow.triggerConfig?.labels) ? workflow.triggerConfig.labels : []),
    ]);
    const phrases = uniqueNormalizedValues([
      workflow.name,
      workflow.description,
      ...triggerKeywords,
      ...nodeLabels,
      ...nodeBodyTexts,
      ...aliases,
    ]);
    const searchableText = [
      workflow.name,
      workflow.description,
      workflow.triggerType,
      ...triggerKeywords,
      ...nodeLabels,
      ...nodeBodyTexts,
      ...actionLabels,
      ...aliases,
    ]
      .map(trimString)
      .filter(Boolean)
      .join(" ");
    const keywordBuckets = buildKeywordBuckets({
      title: workflow.name,
      intentLabel: workflow.name,
      aliases,
      category: workflow.triggerType,
      keywords: triggerKeywords,
      phrases,
      description: workflow.description,
      nodeLabels,
      nodeBodyTexts,
      extra: actionLabels,
    });

    return {
      destinationType: "workflow",
      destinationId: toObjectIdString(workflow._id),
      destinationName: trimString(workflow.name),
      intentLabel: trimString(workflow.name),
      searchableText,
      keywordBuckets,
      execution: {
        automationId: toObjectIdString(workflow._id),
      },
      matchFields: {
        destinationName: workflow.name,
        intentLabel: workflow.name,
        aliases,
        description: workflow.description,
        category: workflow.triggerType,
        keywords: triggerKeywords,
        phrases,
        nodeLabels: [...nodeLabels, ...actionLabels],
        nodeBodyTexts,
        extra: actionLabels,
        searchableText,
      },
    };
  });
};

const buildAiIntentCandidateCatalog = async () => {
  const [quickReplies, basicAutomations, forms, workflows] = await Promise.all([
    buildQuickReplyCandidates(),
    buildBasicAutomationCandidates(),
    buildFormCandidates(),
    buildWorkflowCandidates(),
  ]);

  return [...quickReplies, ...basicAutomations, ...forms, ...workflows].map((candidate) => ({
    ...candidate,
    __matchData: buildCandidateMatchData(candidate),
  }));
};

const buildMessageAnalysis = (message = "") => {
  const normalizedText = normalizeText(message);
  const baseTokens = uniqueTokens(normalizedText);
  const expansions = buildConceptExpansions(normalizedText);
  const expandedText = uniqueNormalizedValues([normalizedText, ...expansions]).join(" ");
  const expandedTokens = uniqueTokens(expandedText);
  const combinedTokens = [...new Set([...baseTokens, ...expandedTokens])];
  const phrases = uniqueNormalizedValues([normalizedText, ...expansions]);
  const bigrams = [...new Set([...buildNgramArray(baseTokens, 2), ...buildNgramArray(expandedTokens, 2)])];
  const trigrams = [...new Set([...buildNgramArray(baseTokens, 3), ...buildNgramArray(expandedTokens, 3)])];
  const verbObjectHints = detectVerbObjectHints(normalizedText);

  return {
    normalizedText,
    baseTokens,
    combinedTokens,
    phrases,
    bigrams,
    trigrams,
    verbObjectHints,
  };
};

const computeCoverage = (queryItems = [], targetItems = []) => {
  if (!queryItems.length || !targetItems.length) return 0;
  return computeSetOverlap(queryItems, targetItems) / queryItems.length;
};

const pickPrimaryReason = (signals = []) => {
  if (signals.includes("semantic_rerank_used")) {
    return "lexical_plus_semantic_match";
  }
  if (
    (signals.includes("title_phrase_match") || signals.includes("body_phrase_match"))
    && signals.includes("primary_keyword_match")
  ) {
    return "lexical_plus_phrase_match";
  }
  if (signals.includes("title_phrase_match") || signals.includes("body_phrase_match")) {
    return "phrase_overlap";
  }
  if (signals.includes("verb_object_intent_match")) {
    return "verb_object_match";
  }
  if (signals.includes("primary_keyword_match")) {
    return "primary_keyword_match";
  }
  if (signals.includes("ngram_overlap")) {
    return "ngram_overlap";
  }
  if (signals.includes("fuzzy_match")) {
    return "fuzzy_match";
  }
  return "lexical_match";
};

const scoreCandidateLexically = ({ message, analysis, candidate }) => {
  const normalizedText = analysis?.normalizedText || normalizeText(message);
  const matchData = candidate.__matchData || buildCandidateMatchData(candidate);
  const messageTokens = analysis?.combinedTokens || uniqueTokens(normalizedText);
  const messageBigrams = analysis?.bigrams || buildNgramArray(messageTokens, 2);
  const messageTrigrams = analysis?.trigrams || buildNgramArray(messageTokens, 3);
  const messagePhrases = analysis?.phrases || uniqueNormalizedValues([normalizedText]);
  const messageHints = analysis?.verbObjectHints || detectVerbObjectHints(normalizedText);
  const signals = [];

  const titleExact = matchData.titleAliases.includes(normalizedText) ? 1 : 0;
  const titlePhraseMatch = matchData.phraseSet.some((phrase) => phrase && normalizedText.includes(phrase) && phrase.length > 5)
    || messagePhrases.some((phrase) => matchData.titleAliases.includes(phrase))
    ? 1
    : 0;
  const bodyPhraseMatch = matchData.phraseSet.some((phrase) => phrase && normalizedText.includes(phrase) && phrase.length > 7) ? 1 : 0;
  const queryContainsCandidate = matchData.normalizedSearchableText && normalizedText.includes(matchData.normalizedSearchableText)
    ? 1
    : 0;
  const candidateContainsQuery = matchData.normalizedSearchableText && matchData.normalizedSearchableText.includes(normalizedText)
    ? 1
    : 0;
  const titleCoverage = computeCoverage(messageTokens, matchData.titleTokens);
  const primaryCoverage = computeCoverage(messageTokens, matchData.primaryTokens);
  const secondaryCoverage = computeCoverage(messageTokens, matchData.secondaryTokens);
  const bodyCoverage = computeCoverage(messageTokens, matchData.bodyTokens);
  const bigramCoverage = computeCoverage(messageBigrams, matchData.titleNgrams);
  const trigramCoverage = computeCoverage(messageTrigrams, matchData.bodyNgrams);
  const phraseCoverage = computeCoverage(messagePhrases, matchData.phraseSet);
  const verbObjectScore = computeCoverage(messageHints, matchData.verbObjectHints);
  const substringSimilarity = normalizedText && matchData.normalizedSearchableText
    ? computeDiceSimilarity(normalizedText, matchData.normalizedSearchableText)
    : 0;
  const titleSimilarity = computeDiceSimilarity(normalizedText, candidate.intentLabel || candidate.destinationName || "");
  const fuzzySimilarity = Math.max(substringSimilarity, titleSimilarity);

  if (titleExact) signals.push("title_phrase_match");
  if (titlePhraseMatch) signals.push("title_phrase_match");
  if (bodyPhraseMatch || queryContainsCandidate || candidateContainsQuery) signals.push("body_phrase_match");
  if (verbObjectScore > 0) signals.push("verb_object_intent_match");
  if (primaryCoverage > 0) signals.push("primary_keyword_match");
  if (secondaryCoverage > 0 || bodyCoverage > 0) signals.push("secondary_keyword_match");
  if (bigramCoverage > 0 || trigramCoverage > 0 || phraseCoverage > 0) signals.push("ngram_overlap");
  if (fuzzySimilarity > 0.35) signals.push("fuzzy_match");

  const confidence = Math.max(
    0,
    Math.min(
      1,
      (titleExact * 0.42)
      + (titlePhraseMatch * 0.28)
      + (verbObjectScore * 0.22)
      + (primaryCoverage * 0.26)
      + (phraseCoverage * 0.14)
      + (bigramCoverage * 0.12)
      + (trigramCoverage * 0.08)
      + (bodyCoverage * 0.11)
      + (secondaryCoverage * 0.08)
      + (bodyPhraseMatch * 0.12)
      + (queryContainsCandidate * 0.08)
      + (candidateContainsQuery * 0.08)
      + (fuzzySimilarity * 0.09)
    )
  );

  return {
    confidence,
    signals,
    reason: pickPrimaryReason(signals),
  };
};

const getSemanticResolver = () => {
  const moduleCandidates = [
    "./openaiService",
    "./llmService",
    "./aiService",
  ];

  for (const modulePath of moduleCandidates) {
    try {
      const loaded = require(modulePath);
      if (typeof loaded?.rankWhatsAppIntentCandidates === "function") {
        return loaded.rankWhatsAppIntentCandidates;
      }
    } catch (_error) {
      // Fall back to lexical matching when no semantic provider is available.
    }
  }

  return null;
};

const resolveWithSemanticProvider = async ({ message, candidates, matchMode }) => {
  const semanticResolver = getSemanticResolver();
  if (!semanticResolver) return null;

  const ranked = await semanticResolver({
    message,
    matchMode,
    candidates: candidates.map((candidate) => ({
      destinationType: candidate.destinationType,
      destinationId: candidate.destinationId,
      destinationName: candidate.destinationName,
      intentLabel: candidate.intentLabel,
      searchableText: candidate.searchableText,
    })),
  });

  if (!Array.isArray(ranked) || !ranked.length) {
    return null;
  }

  const rankedById = new Map(candidates.map((candidate) => [`${candidate.destinationType}:${candidate.destinationId}`, candidate]));
  return ranked
    .map((item) => {
      const key = `${trimString(item.destinationType)}:${trimString(item.destinationId)}`;
      const candidate = rankedById.get(key);
      if (!candidate) return null;
      return {
        candidate,
        confidence: Math.max(0, Math.min(1, Number(item.confidence || 0))),
        reason: trimString(item.reason || "semantic_match") || "semantic_match",
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.confidence - left.confidence);
};

const resolveAiIntentMatch = async (message, _workspaceContext = {}, options = {}) => {
  const trimmedMessage = trimString(message);
  const analysis = buildMessageAnalysis(trimmedMessage);
  const normalizedText = analysis.normalizedText;
  const settings = options.settings || await getAiIntentMatchingSettings();
  const matchMode = normalizeMatchMode(options.matchMode, settings.matchMode || DEFAULT_SETTINGS.matchMode);
  const threshold = Number(MATCH_THRESHOLD_BY_MODE[matchMode] || MATCH_THRESHOLD_BY_MODE.balanced);
  const notes = [];
  const lexicalNotes = [];

  if (!normalizedText || normalizedText.length < MIN_MESSAGE_LENGTH) {
    return {
      status: "skipped",
      matchMode,
      message: trimmedMessage,
      normalizedText,
      topMatch: null,
      candidates: [],
      candidateCount: 0,
      provider: "lexical_fallback",
      notes: ["Inbound message is empty or too short for intent matching"],
    };
  }

  const messageTokens = analysis.combinedTokens;
  if (!messageTokens.length) {
    return {
      status: "skipped",
      matchMode,
      message: trimmedMessage,
      normalizedText,
      topMatch: null,
      candidates: [],
      candidateCount: 0,
      provider: "lexical_fallback",
      notes: ["Inbound message did not produce meaningful tokens after normalization"],
    };
  }

  const candidateCatalog = Array.isArray(options.candidateCatalog)
    ? options.candidateCatalog
    : await buildAiIntentCandidateCatalog();
  const candidates = candidateCatalog.filter(Boolean);

  if (!candidates.length) {
    return {
      status: "skipped",
      matchMode,
      message: trimmedMessage,
      normalizedText,
      topMatch: null,
      candidates: [],
      candidateCount: 0,
      provider: "lexical_fallback",
      notes: ["No active quick replies, forms, basic automations, or workflows are available"],
    };
  }

  let ranked = null;
  let provider = "lexical_fallback";
  const lexicalRanked = candidates
    .map((candidate) => {
      const lexical = scoreCandidateLexically({
        message: trimmedMessage,
        analysis,
        candidate,
      });

      return {
        candidate,
        confidence: lexical.confidence,
        reason: lexical.reason,
        signals: lexical.signals,
      };
    })
    .sort((left, right) => right.confidence - left.confidence);

  try {
    const semanticShortlist = lexicalRanked.slice(0, 7).map((item) => item.candidate);
    ranked = await resolveWithSemanticProvider({
      message: trimmedMessage,
      candidates: semanticShortlist,
      matchMode,
    });

    if (ranked?.length) {
      const lexicalLookup = new Map(
        lexicalRanked.map((item) => [`${item.candidate.destinationType}:${item.candidate.destinationId}`, item])
      );
      ranked = ranked.map((item) => {
        const lexical = lexicalLookup.get(`${item.candidate.destinationType}:${item.candidate.destinationId}`);
        const blendedConfidence = lexical
          ? Math.max(item.confidence, Math.min(1, (lexical.confidence * 0.6) + (item.confidence * 0.4)))
          : item.confidence;
        const signals = lexical?.signals || [];

        return {
          ...item,
          confidence: blendedConfidence,
          signals: [...new Set([...signals, "semantic_rerank_used"])],
          reason: lexical
            ? "lexical_plus_semantic_match"
            : (trimString(item.reason || "semantic_match") || "semantic_match"),
        };
      }).sort((left, right) => right.confidence - left.confidence);

      provider = "semantic";
      notes.push("semantic_rerank_used");
    }
  } catch (error) {
    notes.push(`Semantic provider unavailable: ${error.message}`);
    ranked = null;
  }

  if (!ranked) {
    ranked = lexicalRanked;
  }

  const topTwo = ranked.slice(0, 2);
  const secondConfidence = Number(topTwo[1]?.confidence || 0);
  const topMatch = topTwo[0] || null;
  const topConfidence = Number(topMatch?.confidence || 0);
  const confidenceGap = topConfidence - secondConfidence;
  const requiredMargin = resolveConfidenceMargin(topConfidence, threshold);
  const serializedCandidates = ranked.slice(0, 5).map((item) => ({
    intentLabel: item.candidate.intentLabel,
    destinationType: item.candidate.destinationType,
    destinationId: item.candidate.destinationId,
    destinationName: item.candidate.destinationName,
    confidence: Number(item.confidence.toFixed(4)),
    reason: item.reason,
    signals: Array.isArray(item.signals) ? item.signals : [],
  }));

  if (!topMatch || topConfidence < threshold || confidenceGap < requiredMargin) {
    if (topConfidence < threshold) {
      notes.push("below_threshold");
      notes.push(`Top confidence ${topConfidence.toFixed(2)} is below ${matchMode} threshold ${threshold.toFixed(2)}`);
    }
    if (topMatch && confidenceGap < requiredMargin) {
      notes.push("below_margin");
      notes.push("ambiguous_candidates");
      notes.push(`Top candidate margin ${confidenceGap.toFixed(2)} is below required safety margin ${requiredMargin.toFixed(2)}`);
    }
    if (settings.lowConfidenceAction === "fallback_to_team") {
      notes.push("fallback_to_team");
    }

    return {
      status: "no_match",
      matchMode,
      message: trimmedMessage,
      normalizedText,
      topMatch: null,
      candidates: serializedCandidates,
      candidateCount: candidates.length,
      provider,
      notes,
      debug: {
        normalizedMessage: normalizedText,
        threshold,
        topScore: Number(topConfidence.toFixed(4)),
        secondScore: Number(secondConfidence.toFixed(4)),
        margin: Number(confidenceGap.toFixed(4)),
        providerUsed: provider === "semantic" ? "semantic" : "none",
        signals: Array.isArray(topMatch?.signals) ? topMatch.signals : [],
      },
    };
  }

  lexicalNotes.push(...(Array.isArray(topMatch.signals) ? topMatch.signals : []));
  notes.push(...[...new Set(lexicalNotes)]);

  return {
    status: "matched",
    matchMode,
    message: trimmedMessage,
    normalizedText,
    topMatch: {
      intentLabel: topMatch.candidate.intentLabel,
      destinationType: topMatch.candidate.destinationType,
      destinationId: topMatch.candidate.destinationId,
      destinationName: topMatch.candidate.destinationName,
      confidence: Number(topConfidence.toFixed(4)),
      reason: topMatch.reason,
      execution: topMatch.candidate.execution || {},
      signals: Array.isArray(topMatch.signals) ? topMatch.signals : [],
    },
    candidates: serializedCandidates,
    candidateCount: candidates.length,
    provider,
    notes,
    debug: {
      normalizedMessage: normalizedText,
      threshold,
      topScore: Number(topConfidence.toFixed(4)),
      secondScore: Number(secondConfidence.toFixed(4)),
      margin: Number(confidenceGap.toFixed(4)),
      providerUsed: provider === "semantic" ? "semantic" : "none",
      signals: Array.isArray(topMatch.signals) ? topMatch.signals : [],
    },
  };
};

const buildFormInteractivePayload = ({ form, messageText }) => {
  const providerFlowMode = trimString(form?.providerFlowMode || "published").toLowerCase() || "published";
  const providerFlowId = trimString(form?.providerFlowId);
  const providerFlowName = trimString(form?.providerFlowName);
  const providerFlowFirstScreenId = trimString(form?.providerFlowFirstScreenId);

  if (providerFlowMode === "draft" && !providerFlowName) {
    throw createHttpError("Selected WhatsApp form is missing providerFlowName for draft Meta Flow delivery");
  }

  if (providerFlowMode !== "draft" && !providerFlowId) {
    throw createHttpError("Selected WhatsApp form is missing providerFlowId for published Meta Flow delivery");
  }

  const flowActionPayload = {};
  if (providerFlowFirstScreenId) {
    flowActionPayload.screen = providerFlowFirstScreenId;
  }

  return {
    type: "flow",
    body: {
      text: trimString(messageText || form?.description || `Please complete ${trimString(form?.name || "this form")}`),
    },
    flow: providerFlowMode === "draft"
      ? {
          name: providerFlowName,
          language: "en_US",
          mode: "draft",
        }
      : {
          id: providerFlowId,
          language: "en_US",
          mode: "published",
        },
    ctaText: `Open ${trimString(form?.name || "form")}`.slice(0, 20) || "Open form",
    flowToken: `bwcrm-ai-intent-form-${Date.now()}`,
    flowMessageVersion: "3",
    flowAction: "navigate",
    ...(Object.keys(flowActionPayload).length ? { flowActionPayload } : {}),
  };
};

const saveIntentTriggeredMessage = async ({
  app,
  conversation,
  contact,
  messageType,
  content,
  response,
  requestPayload,
  media = null,
  additionalMetadata = {},
}) => {
  const { saveOutgoingMessage } = require("./whatsappCRMService");
  return saveOutgoingMessage({
    app,
    conversation,
    contact,
    agentId: conversation.agentId || null,
    messageType,
    content,
    response,
    requestPayload,
    media,
    sender: "system",
    additionalMetadata,
  });
};

const executeQuickReplyIntentMatch = async ({ app, conversation, contact, inboundMessage, match }) => {
  const { sendMessage } = require("./whatsappService");
  const text = trimString(match?.execution?.content);
  if (!text) {
    throw createHttpError("Quick reply content is empty", 400);
  }

  const { payload, response } = await sendMessage({
    to: contact.phone,
    type: "text",
    text,
    context: {
      conversationId: conversation._id,
      contactId: contact._id,
      aiIntentMatch: true,
      sourceMessageId: toObjectIdString(inboundMessage?._id),
      sourceExternalMessageId: trimString(inboundMessage?.externalMessageId),
      destinationType: "quick_reply",
      destinationId: match.destinationId,
    },
  });

  const savedMessage = await saveIntentTriggeredMessage({
    app,
    conversation,
    contact,
    messageType: "text",
    content: text,
    response,
    requestPayload: payload,
    additionalMetadata: {
      aiIntentMatch: {
        destinationType: "quick_reply",
        destinationId: match.destinationId,
        intentLabel: match.intentLabel,
        confidence: Number(match.confidence || 0),
        sourceMessageId: toObjectIdString(inboundMessage?._id),
        sourceExternalMessageId: trimString(inboundMessage?.externalMessageId),
      },
    },
  });

  return {
    actionStatus: "sent",
    actionSummary: "Sent quick reply text",
    savedMessage,
  };
};

const executeBasicAutomationIntentMatch = async ({ app, conversation, contact, inboundMessage, match }) => {
  const { dispatchAutomationMessage } = require("./whatsappCRMService");
  const { triggerBasicAutomation } = require("./whatsappBasicAutomationRuntimeService");

  const result = await triggerBasicAutomation({
    app,
    conversation,
    contact,
    inboundMessage,
    automationKey: trimString(match?.execution?.automationKey),
    dispatchAutomationMessage,
  });

  if (result?.status !== "sent" || !result?.savedMessage) {
    throw createHttpError("Basic automation did not produce an outbound message", 400);
  }

  return {
    actionStatus: result.status,
    actionSummary: `Triggered basic automation ${trimString(match?.execution?.automationKey)}`,
    savedMessage: result.savedMessage,
  };
};

const executeFormIntentMatch = async ({ app, conversation, contact, inboundMessage, match }) => {
  const { sendMessage } = require("./whatsappService");

  if (!Types.ObjectId.isValid(String(match?.execution?.formId || ""))) {
    throw createHttpError("Configured form id is invalid", 400);
  }

  const form = await WhatsAppForm.findById(match.execution.formId)
    .select("_id name description isActive providerFlowId providerFlowName providerFlowMode providerFlowFirstScreenId")
    .lean();

  if (!form) {
    throw createHttpError("Matched form not found", 404);
  }

  if (form.isActive === false) {
    throw createHttpError("Matched form is inactive", 400);
  }

  const interactive = buildFormInteractivePayload({
    form,
    messageText: form.description || `Please complete ${trimString(form.name)}`,
  });

  const { payload, response } = await sendMessage({
    to: contact.phone,
    type: "interactive",
    interactive,
    context: {
      conversationId: conversation._id,
      contactId: contact._id,
      aiIntentMatch: true,
      sourceMessageId: toObjectIdString(inboundMessage?._id),
      sourceExternalMessageId: trimString(inboundMessage?.externalMessageId),
      destinationType: "form",
      destinationId: toObjectIdString(form._id),
    },
  });

  const content = trimString(form.description || `Please complete ${trimString(form.name)}`);
  const savedMessage = await saveIntentTriggeredMessage({
    app,
    conversation,
    contact,
    messageType: "interactive",
    content,
    response,
    requestPayload: payload,
    additionalMetadata: {
      aiIntentMatch: {
        destinationType: "form",
        destinationId: toObjectIdString(form._id),
        intentLabel: match.intentLabel,
        confidence: Number(match.confidence || 0),
        sourceMessageId: toObjectIdString(inboundMessage?._id),
        sourceExternalMessageId: trimString(inboundMessage?.externalMessageId),
      },
    },
  });

  return {
    actionStatus: "sent",
    actionSummary: `Triggered form ${trimString(form.name)}`,
    savedMessage,
  };
};

const executeWorkflowIntentMatch = async ({ app, conversation, contact, inboundMessage, match }) => {
  const { triggerAutomationById } = require("./whatsappAutomationService");

  const result = await triggerAutomationById({
    app,
    automationId: trimString(match?.execution?.automationId),
    conversation,
    contact,
    inboundMessage,
  });

  if (!Array.isArray(result?.results) || !result.results.length) {
    throw createHttpError("Workflow did not produce any action results", 400);
  }

  return {
    actionStatus: "triggered",
    actionSummary: `Triggered workflow ${trimString(result.automation?.name)}`,
    results: result.results,
  };
};

const executeResolvedAiIntentMatch = async ({ app, conversation, contact, inboundMessage, match }) => {
  if (!match?.destinationType) {
    throw createHttpError("Matched destination is required", 400);
  }

  if (!contact?.phone) {
    throw createHttpError("Contact phone is required to execute an AI intent match", 400);
  }

  if (match.destinationType === "quick_reply") {
    return executeQuickReplyIntentMatch({ app, conversation, contact, inboundMessage, match });
  }

  if (match.destinationType === "basic_automation") {
    return executeBasicAutomationIntentMatch({ app, conversation, contact, inboundMessage, match });
  }

  if (match.destinationType === "form") {
    return executeFormIntentMatch({ app, conversation, contact, inboundMessage, match });
  }

  if (match.destinationType === "workflow") {
    return executeWorkflowIntentMatch({ app, conversation, contact, inboundMessage, match });
  }

  throw createHttpError(`Unsupported AI intent destination type: ${match.destinationType}`);
};

const maybeChargeForMatchedIntent = async ({ settings, actorId = null, logNotes = [], metadata = {} } = {}) => {
  if (!settings?.billingEnabled) {
    return {
      charged: false,
      chargedAmountMinor: 0,
      notes: [...logNotes],
    };
  }

  const wallet = await getWalletSummary();
  const configuredCurrency = normalizeCurrency(settings.currency, DEFAULT_SETTINGS.currency);
  const walletCurrency = trimString(wallet.currency || "").toUpperCase();

  if (walletCurrency && configuredCurrency !== walletCurrency) {
    return {
      charged: false,
      chargedAmountMinor: 0,
      notes: [...logNotes, `Billing skipped because wallet currency ${walletCurrency} does not match ${configuredCurrency}`],
    };
  }

  try {
    const reservation = await reserveWalletAmount({
      amountMinor: Number(settings.pricePerSuccessfulMatchMinor || 0),
      actorId,
      note: "Reserved for WhatsApp AI intent match billing",
      description: "Reserved for successful WhatsApp AI intent match",
      metadata,
    });
    await commitWalletReservation({
      reservationId: reservation.reservationId,
      note: "Committed successful WhatsApp AI intent match billing",
      metadata,
    });

    return {
      charged: true,
      chargedAmountMinor: Number(settings.pricePerSuccessfulMatchMinor || 0),
      notes: [...logNotes],
    };
  } catch (error) {
    return {
      charged: false,
      chargedAmountMinor: 0,
      notes: [...logNotes, `Billing skipped: ${error.message}`],
    };
  }
};

const createMatchLog = async ({
  adminId = null,
  conversationId = null,
  messageId = "",
  customerPhone = "",
  inboundText = "",
  normalizedText = "",
  status = "skipped",
  matchedIntentLabel = "",
  matchedDestinationType = "",
  matchedDestinationId = "",
  confidence = 0,
  matchMode = DEFAULT_SETTINGS.matchMode,
  candidateCount = 0,
  provider = "lexical_fallback",
  charged = false,
  chargedAmountMinor = 0,
  notes = [],
} = {}) =>
  WhatsAppAiIntentMatchLog.create({
    adminId: adminId || null,
    conversationId: conversationId || null,
    messageId: trimString(messageId),
    customerPhone: trimString(customerPhone),
    inboundText: trimString(inboundText),
    normalizedText: trimString(normalizedText),
    status,
    matchedIntentLabel: trimString(matchedIntentLabel),
    matchedDestinationType: trimString(matchedDestinationType),
    matchedDestinationId: trimString(matchedDestinationId),
    confidence: Math.max(0, Math.min(1, Number(confidence || 0))),
    matchMode: normalizeMatchMode(matchMode, DEFAULT_SETTINGS.matchMode),
    candidateCount: Math.max(0, Math.trunc(Number(candidateCount || 0))),
    provider: trimString(provider || "lexical_fallback") || "lexical_fallback",
    charged: Boolean(charged),
    chargedAmountMinor: Math.max(0, Math.round(Number(chargedAmountMinor || 0))),
    notes: Array.isArray(notes) ? notes.map((note) => trimString(note)).filter(Boolean) : [],
  });

const isAutomationEligibleConversation = (conversation = {}) =>
  !conversation?.workflowContext?.status || trimString(conversation.workflowContext.status) !== "awaiting_interactive";

const processInboundAiIntentMatch = async ({
  app,
  conversation,
  contact,
  inboundMessage,
  hardRuleMatched = false,
  adminId = null,
} = {}) => {
  try {
    const settings = await getAiIntentMatchingSettings();

    if (!settings.enabled) {
      return { status: "skipped", reason: "disabled", logged: false };
    }

    const inboundText = trimString(inboundMessage?.content);
    const normalizedText = normalizeText(inboundText);
    const baseLogPayload = {
      adminId: adminId || conversation?.agentId || null,
      conversationId: conversation?._id || null,
      messageId: trimString(inboundMessage?.externalMessageId || inboundMessage?._id),
      customerPhone: trimString(contact?.phone),
      inboundText,
      normalizedText,
      matchMode: settings.matchMode,
    };

    if (hardRuleMatched) {
      await createMatchLog({
        ...baseLogPayload,
        status: "skipped",
        notes: ["Skipped because an existing automation rule already handled this inbound message"],
      });
      return { status: "skipped", reason: "hard_rule_precedence", logged: true };
    }

    if (String(inboundMessage?.direction || "") !== "inbound") {
      await createMatchLog({
        ...baseLogPayload,
        status: "skipped",
        notes: ["Skipped because the message is not inbound"],
      });
      return { status: "skipped", reason: "not_inbound", logged: true };
    }

    if (String(inboundMessage?.type || "text") !== "text") {
      await createMatchLog({
        ...baseLogPayload,
        status: "skipped",
        notes: ["Skipped because AI intent matching only supports inbound text messages"],
      });
      return { status: "skipped", reason: "unsupported_type", logged: true };
    }

    if (!isAutomationEligibleConversation(conversation)) {
      await createMatchLog({
        ...baseLogPayload,
        status: "skipped",
        notes: ["Skipped because the conversation is awaiting a stronger interactive workflow response"],
      });
      return { status: "skipped", reason: "conversation_ineligible", logged: true };
    }

    const candidateCatalog = await buildAiIntentCandidateCatalog();
    const resolution = await resolveAiIntentMatch(inboundText, { conversation, contact }, {
      settings,
      candidateCatalog,
    });

    if (resolution.status !== "matched" || !resolution.topMatch) {
      await createMatchLog({
        ...baseLogPayload,
        status: resolution.status === "skipped" ? "skipped" : "no_match",
        candidateCount: resolution.candidateCount,
        provider: resolution.provider,
        notes: resolution.notes,
      });
      return resolution;
    }

    const actionResult = await executeResolvedAiIntentMatch({
      app,
      conversation,
      contact,
      inboundMessage,
      match: resolution.topMatch,
    });
    const billingResult = await maybeChargeForMatchedIntent({
      settings,
      actorId: adminId || conversation?.agentId || null,
      logNotes: resolution.notes,
      metadata: {
        source: "whatsapp_ai_intent_match",
        conversationId: toObjectIdString(conversation?._id),
        inboundMessageId: toObjectIdString(inboundMessage?._id),
        inboundExternalMessageId: trimString(inboundMessage?.externalMessageId),
        destinationType: resolution.topMatch.destinationType,
        destinationId: resolution.topMatch.destinationId,
        confidence: Number(resolution.topMatch.confidence || 0),
      },
    });

    await createMatchLog({
      ...baseLogPayload,
      status: "matched",
      matchedIntentLabel: resolution.topMatch.intentLabel,
      matchedDestinationType: resolution.topMatch.destinationType,
      matchedDestinationId: resolution.topMatch.destinationId,
      confidence: resolution.topMatch.confidence,
      candidateCount: resolution.candidateCount,
      provider: resolution.provider,
      charged: billingResult.charged,
      chargedAmountMinor: billingResult.chargedAmountMinor,
      notes: [...billingResult.notes, trimString(actionResult?.actionSummary)],
    });

    return {
      ...resolution,
      charged: billingResult.charged,
      chargedAmountMinor: billingResult.chargedAmountMinor,
      actionResult,
    };
  } catch (error) {
    console.error("WhatsApp AI intent matching failed:", error);
    await createMatchLog({
      adminId: adminId || conversation?.agentId || null,
      conversationId: conversation?._id || null,
      messageId: trimString(inboundMessage?.externalMessageId || inboundMessage?._id),
      customerPhone: trimString(contact?.phone),
      inboundText: trimString(inboundMessage?.content),
      normalizedText: normalizeText(inboundMessage?.content),
      status: "failed",
      matchMode: DEFAULT_SETTINGS.matchMode,
      notes: [error.message || "Unhandled AI intent matching failure"],
    }).catch((logError) => {
      console.error("Failed to write WhatsApp AI intent matching failure log:", logError);
    });

    return {
      status: "failed",
      message: trimString(inboundMessage?.content),
      error: error.message || "Unhandled AI intent matching failure",
    };
  }
};

const serializeHistoryItem = (item = {}) => ({
  _id: item._id,
  status: trimString(item.status),
  conversationId: toObjectIdString(item.conversationId) || null,
  messageId: trimString(item.messageId),
  customerPhone: trimString(item.customerPhone),
  inboundText: trimString(item.inboundText),
  matchedIntentLabel: trimString(item.matchedIntentLabel),
  matchedDestinationType: trimString(item.matchedDestinationType),
  matchedDestinationId: trimString(item.matchedDestinationId),
  confidence: Number(item.confidence || 0),
  matchMode: trimString(item.matchMode || DEFAULT_SETTINGS.matchMode) || DEFAULT_SETTINGS.matchMode,
  charged: Boolean(item.charged),
  chargedAmountMinor: Number(item.chargedAmountMinor || 0),
  createdAt: item.createdAt || null,
});

const buildHistoryFilter = ({ status, matchMode, search } = {}) => {
  const filter = {};
  const normalizedStatus = normalizeHistoryStatus(status);
  const normalizedMatchMode = trimString(matchMode)
    ? normalizeMatchMode(matchMode, DEFAULT_SETTINGS.matchMode)
    : "";
  const normalizedSearch = trimString(search);

  if (normalizedStatus) {
    filter.status = normalizedStatus;
  }

  if (normalizedMatchMode) {
    filter.matchMode = normalizedMatchMode;
  }

  if (normalizedSearch) {
    const regex = { $regex: escapeRegex(normalizedSearch), $options: "i" };
    filter.$or = [
      { inboundText: regex },
      { customerPhone: regex },
      { matchedIntentLabel: regex },
      { matchedDestinationType: regex },
      { matchedDestinationId: regex },
      { messageId: regex },
    ];

    if (Types.ObjectId.isValid(normalizedSearch)) {
      filter.$or.push({ conversationId: normalizedSearch });
    }
  }

  return filter;
};

const listAiIntentMatchHistory = async ({ page, limit, status, matchMode, search } = {}) => {
  const safePage = clampPositiveInteger(page, DEFAULT_HISTORY_PAGE);
  const safeLimit = clampPositiveInteger(limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
  const skip = (safePage - 1) * safeLimit;
  const filter = buildHistoryFilter({ status, matchMode, search });
  const [items, total] = await Promise.all([
    WhatsAppAiIntentMatchLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    WhatsAppAiIntentMatchLog.countDocuments(filter),
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

const resolvePreviewConversationContext = async ({ conversationId = "", customerPhone = "", allowCreate = false } = {}) => {
  const normalizedConversationId = trimString(conversationId);
  const normalizedCustomerPhone = trimString(customerPhone);
  const { ensureConversation, upsertContact } = require("./whatsappCRMService");
  const { normalizePhone } = require("./whatsappWebhookService");

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

    return {
      conversation: {
        ...conversation,
        _id: conversation._id,
      },
      contact,
    };
  }

  if (!normalizedCustomerPhone) {
    return { conversation: null, contact: null };
  }

  if (!allowCreate) {
    return { conversation: null, contact: { phone: normalizePhone(normalizedCustomerPhone) } };
  }

  const contact = await upsertContact({
    phone: normalizePhone(normalizedCustomerPhone),
    waId: normalizePhone(normalizedCustomerPhone),
    name: "",
    profile: {},
  });
  const conversation = await ensureConversation({
    contactId: contact._id,
    autoAssign: true,
  });

  return { conversation, contact };
};

const previewAiIntentMatch = async ({
  app,
  actor = null,
  message,
  conversationId = "",
  customerPhone = "",
  send = false,
} = {}) => {
  const trimmedMessage = trimString(message);
  if (!trimmedMessage) {
    throw createHttpError("message is required");
  }

  const settings = await getAiIntentMatchingSettings();
  const candidateCatalog = await buildAiIntentCandidateCatalog();
  const resolution = await resolveAiIntentMatch(trimmedMessage, {}, {
    settings,
    candidateCatalog,
  });

  let actionTaken = "preview_only";
  let sendResult = null;

  if (send === true && resolution.status === "matched" && resolution.topMatch) {
    const { conversation, contact } = await resolvePreviewConversationContext({
      conversationId,
      customerPhone,
      allowCreate: true,
    });

    if (!conversation || !contact?.phone) {
      throw createHttpError("conversationId or customerPhone is required when send is true");
    }

    const inboundMessage = {
      _id: null,
      externalMessageId: "",
      direction: "inbound",
      type: "text",
      content: trimmedMessage,
    };

    sendResult = await executeResolvedAiIntentMatch({
      app,
      conversation,
      contact,
      inboundMessage,
      match: resolution.topMatch,
    });

    const billingResult = await maybeChargeForMatchedIntent({
      settings,
      actorId: actor?._id || null,
      logNotes: resolution.notes,
      metadata: {
        source: "whatsapp_ai_intent_match_test_send",
        destinationType: resolution.topMatch.destinationType,
        destinationId: resolution.topMatch.destinationId,
        confidence: Number(resolution.topMatch.confidence || 0),
      },
    });

    await createMatchLog({
      adminId: actor?._id || null,
      conversationId: conversation._id || null,
      messageId: "",
      customerPhone: trimString(contact.phone),
      inboundText: trimmedMessage,
      normalizedText: resolution.normalizedText,
      status: "matched",
      matchedIntentLabel: resolution.topMatch.intentLabel,
      matchedDestinationType: resolution.topMatch.destinationType,
      matchedDestinationId: resolution.topMatch.destinationId,
      confidence: resolution.topMatch.confidence,
      matchMode: resolution.matchMode,
      candidateCount: resolution.candidateCount,
      provider: resolution.provider,
      charged: billingResult.charged,
      chargedAmountMinor: billingResult.chargedAmountMinor,
      notes: [...billingResult.notes, "Triggered from admin test endpoint"],
    });

    actionTaken = "action_triggered";
  }

  return {
    status: resolution.status,
    matchMode: resolution.matchMode,
    message: trimmedMessage,
    topMatch: resolution.topMatch
      ? {
          intentLabel: resolution.topMatch.intentLabel,
          destinationType: resolution.topMatch.destinationType,
          destinationId: resolution.topMatch.destinationId,
          destinationName: resolution.topMatch.destinationName,
          confidence: resolution.topMatch.confidence,
          reason: resolution.topMatch.reason,
        }
      : null,
    candidates: Array.isArray(resolution.candidates) ? resolution.candidates.map((candidate) => ({
      intentLabel: candidate.intentLabel,
      destinationType: candidate.destinationType,
      destinationId: candidate.destinationId,
      destinationName: candidate.destinationName,
      confidence: candidate.confidence,
      ...(candidate.reason ? { reason: candidate.reason } : {}),
    })) : [],
    actionTaken,
    ...(resolution.debug ? { debug: resolution.debug } : {}),
    ...(sendResult ? { sendResult } : {}),
  };
};

module.exports = {
  MATCH_THRESHOLD_BY_MODE,
  REQUIRED_CONFIDENCE_MARGIN,
  getAiIntentMatchingSettings,
  getAiIntentMatchingOverview,
  updateAiIntentMatchingSettings,
  listAiIntentMatchHistory,
  buildAiIntentCandidateCatalog,
  resolveAiIntentMatch,
  executeResolvedAiIntentMatch,
  processInboundAiIntentMatch,
  previewAiIntentMatch,
  __private: {
    normalizeSettingsPayload,
    normalizeText,
    tokenize,
    uniqueTokens,
    buildCandidateMatchData,
    scoreCandidateLexically,
    buildFormInteractivePayload,
    maybeChargeForMatchedIntent,
    buildHistoryFilter,
    serializeHistoryItem,
    isAutomationEligibleConversation,
  },
};

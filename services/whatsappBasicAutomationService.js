const WhatsAppBasicAutomationSettings = require("../models/WhatsAppBasicAutomationSettings");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const WhatsAppTemplate = require("../models/WhatsAppTemplate");
const WhatsAppForm = require("../models/WhatsAppForm");
const { listAvailableWhatsAppForms } = require("./whatsappFormService");
const { getTemplateById } = require("./whatsappTemplateService");

const DAY_OPTIONS = WhatsAppBasicAutomationSettings.DAY_OPTIONS || ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TEMPLATE_MODE_OPTIONS = WhatsAppBasicAutomationSettings.TEMPLATE_MODE_OPTIONS || ["custom", "approved_template"];
const APPLY_SCOPE_OPTIONS = WhatsAppBasicAutomationSettings.APPLY_SCOPE_OPTIONS || ["new_or_closed", "new_only", "all"];
const COOLDOWN_UNIT_OPTIONS = WhatsAppBasicAutomationSettings.COOLDOWN_UNIT_OPTIONS || ["minutes", "hours"];
const AUTOMATION_TYPE_OPTIONS = ["outOfOffice", "welcome", "delayedResponse"];
const REPLY_ACTION_TYPE_OPTIONS = WhatsAppBasicAutomationSettings.REPLY_ACTION_TYPE_OPTIONS || [
  "none",
  "whatsapp_form",
  "interactive_list",
  "product_collection",
];
const FORM_OPEN_MODE_OPTIONS = WhatsAppBasicAutomationSettings.FORM_OPEN_MODE_OPTIONS || [
  "navigate_first_screen",
  "data_exchange",
];
const DEFAULT_SINGLETON_KEY = "default";
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const POPULATE_SAFE_ADMIN = "_id name email";
const DEFAULT_TEMPLATE_CONFIG = Object.freeze({
  templateId: "",
  templateName: "",
  templateLanguage: "",
  templateCategory: "",
});
const DEFAULT_COOLDOWN_CONFIG = Object.freeze({
  cooldownEnabled: false,
  cooldownValue: 30,
  cooldownUnit: "minutes",
});
const DEFAULT_REPLY_ACTION = Object.freeze({
  replyActionType: "none",
  actionButtonText: "",
  formId: "",
  formName: "",
  formOpenMode: "navigate_first_screen",
  interactiveListId: "",
  interactiveListName: "",
  productCollectionId: "",
  productCollectionName: "",
});
const DEFAULT_SETTINGS = Object.freeze({
  workingHours: {
    enabled: true,
    days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    startTime: "10:00",
    endTime: "18:00",
    timezone: "Asia/Colombo",
  },
  automations: {
    outOfOffice: {
      enabled: true,
      message: "We are currently offline. Our team will get back to you during working hours.",
      sentCount: 0,
      templateMode: "custom",
      applyScope: "new_or_closed",
      ...DEFAULT_TEMPLATE_CONFIG,
      ...DEFAULT_COOLDOWN_CONFIG,
      ...DEFAULT_REPLY_ACTION,
    },
    welcome: {
      enabled: true,
      message: "Thank you for contacting Blue Whale Migration. Please tell us how we can help you.",
      sentCount: 0,
      retriggerAfterHours: 24,
      templateMode: "custom",
      ...DEFAULT_TEMPLATE_CONFIG,
      ...DEFAULT_COOLDOWN_CONFIG,
      ...DEFAULT_REPLY_ACTION,
    },
    delayedResponse: {
      enabled: true,
      message: "Thanks for your message. Our team will respond shortly.",
      sentCount: 0,
      delayMinutes: 15,
      templateMode: "custom",
      ...DEFAULT_TEMPLATE_CONFIG,
      ...DEFAULT_COOLDOWN_CONFIG,
      ...DEFAULT_REPLY_ACTION,
    },
  },
});

const trimString = (value) => String(value || "").trim();
const hasOwnProperty = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const createHttpError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const clampPositiveInteger = (value, fallback, maxValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.trunc(parsed);
  if (normalized < 1) {
    return fallback;
  }

  if (maxValue && normalized > maxValue) {
    return maxValue;
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

  throw createHttpError(`${fieldLabel} must be boolean`);
};

const normalizePositiveNumber = (value, fieldLabel, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createHttpError(`${fieldLabel} must be greater than 0`);
  }

  return parsed;
};

const normalizeCooldownUnit = (value, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }

  const cooldownUnit = trimString(value) || defaultValue;
  if (!COOLDOWN_UNIT_OPTIONS.includes(cooldownUnit)) {
    throw createHttpError(`cooldownUnit must be one of: ${COOLDOWN_UNIT_OPTIONS.join(", ")}`);
  }

  return cooldownUnit;
};

const normalizeMessage = (value, defaultValue = "") => {
  if (value === undefined) {
    return defaultValue;
  }

  return trimString(value);
};

const normalizeTextField = (value, defaultValue = "") => {
  if (value === undefined) {
    return defaultValue;
  }

  return trimString(value);
};

const normalizeTimezone = (value, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }

  const timezone = trimString(value);
  return timezone || defaultValue;
};

const normalizeTime = (value, fieldLabel, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }

  const time = trimString(value);
  if (!TIME_PATTERN.test(time)) {
    throw createHttpError(`${fieldLabel} must be in HH:mm format`);
  }

  return time;
};

const normalizeTemplateMode = (value, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }

  const templateMode = trimString(value) || defaultValue;
  if (!TEMPLATE_MODE_OPTIONS.includes(templateMode)) {
    throw createHttpError(`templateMode must be one of: ${TEMPLATE_MODE_OPTIONS.join(", ")}`);
  }

  return templateMode;
};

const normalizeApplyScope = (value, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }

  const applyScope = trimString(value) || defaultValue;
  if (!APPLY_SCOPE_OPTIONS.includes(applyScope)) {
    throw createHttpError(`applyScope must be one of: ${APPLY_SCOPE_OPTIONS.join(", ")}`);
  }

  return applyScope;
};

const normalizeReplyActionType = (value, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }

  const replyActionType = trimString(value) || "none";
  if (!REPLY_ACTION_TYPE_OPTIONS.includes(replyActionType)) {
    throw createHttpError(`replyActionType must be one of: ${REPLY_ACTION_TYPE_OPTIONS.join(", ")}`);
  }

  return replyActionType;
};

const normalizeFormOpenMode = (value, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }

  const formOpenMode = trimString(value) || DEFAULT_REPLY_ACTION.formOpenMode;
  if (!FORM_OPEN_MODE_OPTIONS.includes(formOpenMode)) {
    throw createHttpError(`formOpenMode must be one of: ${FORM_OPEN_MODE_OPTIONS.join(", ")}`);
  }

  return formOpenMode;
};

const normalizeDays = (value, defaultValue) => {
  if (value === undefined) {
    return [...defaultValue];
  }

  if (!Array.isArray(value)) {
    throw createHttpError("days must be an array");
  }

  const normalizedDays = [...new Set(value.map((day) => trimString(day)).filter(Boolean))];
  const invalidDay = normalizedDays.find((day) => !DAY_OPTIONS.includes(day));
  if (invalidDay) {
    throw createHttpError(`Invalid day value: ${invalidDay}`);
  }

  return normalizedDays;
};

const extractTemplateBodyPreview = (components = []) => {
  const bodyComponent = Array.isArray(components)
    ? components.find((component) => trimString(component?.type || "").toUpperCase() === "BODY")
    : null;

  return trimString(bodyComponent?.text || "");
};

const normalizeAutomationType = (value, { required = true } = {}) => {
  const automationType = trimString(value);
  if (!automationType) {
    if (required) {
      throw createHttpError(`type must be one of: ${AUTOMATION_TYPE_OPTIONS.join(", ")}`);
    }
    return "";
  }

  if (!AUTOMATION_TYPE_OPTIONS.includes(automationType)) {
    throw createHttpError(`type must be one of: ${AUTOMATION_TYPE_OPTIONS.join(", ")}`);
  }

  return automationType;
};

const buildDefaultSettings = () => ({
  workingHours: {
    ...DEFAULT_SETTINGS.workingHours,
    days: [...DEFAULT_SETTINGS.workingHours.days],
  },
  automations: {
    outOfOffice: { ...DEFAULT_SETTINGS.automations.outOfOffice },
    welcome: { ...DEFAULT_SETTINGS.automations.welcome },
    delayedResponse: { ...DEFAULT_SETTINGS.automations.delayedResponse },
  },
  createdBy: null,
  updatedBy: null,
  createdAt: null,
  updatedAt: null,
});

const applyTemplateRules = (templateConfig = {}, templateMode = "custom") => {
  const normalized = {
    ...DEFAULT_TEMPLATE_CONFIG,
    ...templateConfig,
    templateId: normalizeTextField(templateConfig.templateId, DEFAULT_TEMPLATE_CONFIG.templateId),
    templateName: normalizeTextField(templateConfig.templateName, DEFAULT_TEMPLATE_CONFIG.templateName),
    templateLanguage: normalizeTextField(templateConfig.templateLanguage, DEFAULT_TEMPLATE_CONFIG.templateLanguage),
    templateCategory: normalizeTextField(templateConfig.templateCategory, DEFAULT_TEMPLATE_CONFIG.templateCategory),
  };

  if (templateMode === "approved_template" && !normalized.templateId) {
    throw createHttpError("templateId is required when templateMode is approved_template");
  }

  return normalized;
};

const applyCooldownRules = (cooldownConfig = {}) => ({
  ...DEFAULT_COOLDOWN_CONFIG,
  ...cooldownConfig,
  cooldownEnabled: normalizeBoolean(
    cooldownConfig.cooldownEnabled,
    "cooldownEnabled",
    DEFAULT_COOLDOWN_CONFIG.cooldownEnabled
  ),
  cooldownValue: normalizePositiveNumber(
    cooldownConfig.cooldownValue,
    "cooldownValue",
    DEFAULT_COOLDOWN_CONFIG.cooldownValue
  ),
  cooldownUnit: normalizeCooldownUnit(
    cooldownConfig.cooldownUnit,
    DEFAULT_COOLDOWN_CONFIG.cooldownUnit
  ),
});

const applyReplyActionRules = (replyActionConfig = {}) => {
  const normalized = {
    ...DEFAULT_REPLY_ACTION,
    ...replyActionConfig,
    replyActionType: normalizeReplyActionType(replyActionConfig.replyActionType, DEFAULT_REPLY_ACTION.replyActionType),
    formOpenMode: normalizeFormOpenMode(replyActionConfig.formOpenMode, DEFAULT_REPLY_ACTION.formOpenMode),
    actionButtonText: normalizeTextField(replyActionConfig.actionButtonText, DEFAULT_REPLY_ACTION.actionButtonText),
    formId: normalizeTextField(replyActionConfig.formId, DEFAULT_REPLY_ACTION.formId),
    formName: normalizeTextField(replyActionConfig.formName, DEFAULT_REPLY_ACTION.formName),
    interactiveListId: normalizeTextField(replyActionConfig.interactiveListId, DEFAULT_REPLY_ACTION.interactiveListId),
    interactiveListName: normalizeTextField(replyActionConfig.interactiveListName, DEFAULT_REPLY_ACTION.interactiveListName),
    productCollectionId: normalizeTextField(replyActionConfig.productCollectionId, DEFAULT_REPLY_ACTION.productCollectionId),
    productCollectionName: normalizeTextField(replyActionConfig.productCollectionName, DEFAULT_REPLY_ACTION.productCollectionName),
  };

  if (normalized.replyActionType === "none") {
    return {
      ...DEFAULT_REPLY_ACTION,
      replyActionType: "none",
      formOpenMode: DEFAULT_REPLY_ACTION.formOpenMode,
    };
  }

  if (normalized.replyActionType === "whatsapp_form") {
    if (!normalized.actionButtonText) {
      throw createHttpError("actionButtonText is required when replyActionType is whatsapp_form");
    }
    if (!normalized.formId) {
      throw createHttpError("formId is required when replyActionType is whatsapp_form");
    }

    return {
      ...DEFAULT_REPLY_ACTION,
      replyActionType: normalized.replyActionType,
      actionButtonText: normalized.actionButtonText,
      formId: normalized.formId,
      formName: normalized.formName,
      formOpenMode: normalized.formOpenMode,
    };
  }

  if (normalized.replyActionType === "interactive_list") {
    if (!normalized.actionButtonText) {
      throw createHttpError("actionButtonText is required when replyActionType is interactive_list");
    }
    if (!normalized.interactiveListId) {
      throw createHttpError("interactiveListId is required when replyActionType is interactive_list");
    }

    return {
      ...DEFAULT_REPLY_ACTION,
      replyActionType: normalized.replyActionType,
      actionButtonText: normalized.actionButtonText,
      interactiveListId: normalized.interactiveListId,
      interactiveListName: normalized.interactiveListName,
      formOpenMode: normalized.formOpenMode,
    };
  }

  if (normalized.replyActionType === "product_collection") {
    if (!normalized.actionButtonText) {
      throw createHttpError("actionButtonText is required when replyActionType is product_collection");
    }
    if (!normalized.productCollectionId) {
      throw createHttpError("productCollectionId is required when replyActionType is product_collection");
    }

    return {
      ...DEFAULT_REPLY_ACTION,
      replyActionType: normalized.replyActionType,
      actionButtonText: normalized.actionButtonText,
      productCollectionId: normalized.productCollectionId,
      productCollectionName: normalized.productCollectionName,
      formOpenMode: normalized.formOpenMode,
    };
  }

  return normalized;
};

const mergeReplyActionConfig = (payload = {}, current = {}) =>
  applyReplyActionRules({
    ...DEFAULT_REPLY_ACTION,
    ...current,
    ...(hasOwnProperty(payload, "replyActionType") ? { replyActionType: payload.replyActionType } : {}),
    ...(hasOwnProperty(payload, "actionButtonText") ? { actionButtonText: payload.actionButtonText } : {}),
    ...(hasOwnProperty(payload, "formId") ? { formId: payload.formId } : {}),
    ...(hasOwnProperty(payload, "formName") ? { formName: payload.formName } : {}),
    ...(hasOwnProperty(payload, "formOpenMode") ? { formOpenMode: payload.formOpenMode } : {}),
    ...(hasOwnProperty(payload, "interactiveListId") ? { interactiveListId: payload.interactiveListId } : {}),
    ...(hasOwnProperty(payload, "interactiveListName") ? { interactiveListName: payload.interactiveListName } : {}),
    ...(hasOwnProperty(payload, "productCollectionId") ? { productCollectionId: payload.productCollectionId } : {}),
    ...(hasOwnProperty(payload, "productCollectionName") ? { productCollectionName: payload.productCollectionName } : {}),
  });

const mergeTemplateConfig = (payload = {}, current = {}, templateMode = "custom") =>
  applyTemplateRules(
    {
      ...DEFAULT_TEMPLATE_CONFIG,
      ...current,
      ...(hasOwnProperty(payload, "templateId") ? { templateId: payload.templateId } : {}),
      ...(hasOwnProperty(payload, "templateName") ? { templateName: payload.templateName } : {}),
      ...(hasOwnProperty(payload, "templateLanguage") ? { templateLanguage: payload.templateLanguage } : {}),
      ...(hasOwnProperty(payload, "templateCategory") ? { templateCategory: payload.templateCategory } : {}),
    },
    templateMode
  );

const mergeCooldownConfig = (payload = {}, current = {}) =>
  applyCooldownRules({
    ...DEFAULT_COOLDOWN_CONFIG,
    ...current,
    ...(hasOwnProperty(payload, "cooldownEnabled") ? { cooldownEnabled: payload.cooldownEnabled } : {}),
    ...(hasOwnProperty(payload, "cooldownValue") ? { cooldownValue: payload.cooldownValue } : {}),
    ...(hasOwnProperty(payload, "cooldownUnit") ? { cooldownUnit: payload.cooldownUnit } : {}),
  });

const withSettingsPopulation = (query) =>
  query
    .populate("createdBy", POPULATE_SAFE_ADMIN)
    .populate("updatedBy", POPULATE_SAFE_ADMIN);

const serializeSettings = (settingsDoc) => {
  const base = buildDefaultSettings();
  const plain = settingsDoc?.toObject ? settingsDoc.toObject() : settingsDoc || {};

  return {
    workingHours: {
      ...base.workingHours,
      ...(plain.workingHours || {}),
      days: Array.isArray(plain.workingHours?.days) ? plain.workingHours.days : base.workingHours.days,
    },
    automations: {
      outOfOffice: {
        ...base.automations.outOfOffice,
        ...(plain.automations?.outOfOffice || {}),
      },
      welcome: {
        ...base.automations.welcome,
        ...(plain.automations?.welcome || {}),
      },
      delayedResponse: {
        ...base.automations.delayedResponse,
        ...(plain.automations?.delayedResponse || {}),
      },
    },
    createdBy: plain.createdBy || null,
    updatedBy: plain.updatedBy || null,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
};

const getStoredSettingsDocument = () =>
  withSettingsPopulation(
    WhatsAppBasicAutomationSettings.findOne({ singletonKey: DEFAULT_SINGLETON_KEY })
  );

const ensureSettingsDocument = async (actorId = null) => {
  let settings = await WhatsAppBasicAutomationSettings.findOne({ singletonKey: DEFAULT_SINGLETON_KEY });
  if (!settings) {
    settings = await WhatsAppBasicAutomationSettings.create({
      singletonKey: DEFAULT_SINGLETON_KEY,
      createdBy: actorId || null,
      updatedBy: actorId || null,
    });
  }

  return settings;
};

const normalizeWorkingHoursPayload = (payload = {}, options = {}) => {
  const partial = Boolean(options.partial);
  const current = options.current || DEFAULT_SETTINGS.workingHours;
  const normalized = {};

  if (!partial || hasOwnProperty(payload, "enabled")) {
    normalized.enabled = normalizeBoolean(payload.enabled, "enabled", current.enabled);
  }

  if (!partial || hasOwnProperty(payload, "days")) {
    normalized.days = normalizeDays(payload.days, current.days);
  }

  if (!partial || hasOwnProperty(payload, "startTime")) {
    normalized.startTime = normalizeTime(payload.startTime, "startTime", current.startTime);
  }

  if (!partial || hasOwnProperty(payload, "endTime")) {
    normalized.endTime = normalizeTime(payload.endTime, "endTime", current.endTime);
  }

  if (!partial || hasOwnProperty(payload, "timezone")) {
    normalized.timezone = normalizeTimezone(payload.timezone, current.timezone);
  }

  return normalized;
};

const normalizeOutOfOfficePayload = (payload = {}, options = {}) => {
  const partial = Boolean(options.partial);
  const current = options.current || DEFAULT_SETTINGS.automations.outOfOffice;
  const normalized = {};

  if (!partial || hasOwnProperty(payload, "enabled")) {
    normalized.enabled = normalizeBoolean(payload.enabled, "enabled", current.enabled);
  }

  if (!partial || hasOwnProperty(payload, "message")) {
    normalized.message = normalizeMessage(payload.message, current.message);
  }

  if (!partial || hasOwnProperty(payload, "templateMode")) {
    normalized.templateMode = normalizeTemplateMode(payload.templateMode, current.templateMode);
  }

  if (!partial || hasOwnProperty(payload, "applyScope")) {
    normalized.applyScope = normalizeApplyScope(payload.applyScope, current.applyScope);
  }

  Object.assign(normalized, mergeTemplateConfig(payload, current, normalized.templateMode || current.templateMode));
  Object.assign(normalized, mergeCooldownConfig(payload, current));
  Object.assign(normalized, mergeReplyActionConfig(payload, current));

  return normalized;
};

const normalizeWelcomePayload = (payload = {}, options = {}) => {
  const partial = Boolean(options.partial);
  const current = options.current || DEFAULT_SETTINGS.automations.welcome;
  const normalized = {};

  if (!partial || hasOwnProperty(payload, "enabled")) {
    normalized.enabled = normalizeBoolean(payload.enabled, "enabled", current.enabled);
  }

  if (!partial || hasOwnProperty(payload, "message")) {
    normalized.message = normalizeMessage(payload.message, current.message);
  }

  if (!partial || hasOwnProperty(payload, "retriggerAfterHours")) {
    normalized.retriggerAfterHours = normalizePositiveNumber(
      payload.retriggerAfterHours,
      "retriggerAfterHours",
      current.retriggerAfterHours
    );
  }

  if (!partial || hasOwnProperty(payload, "templateMode")) {
    normalized.templateMode = normalizeTemplateMode(payload.templateMode, current.templateMode);
  }

  Object.assign(normalized, mergeTemplateConfig(payload, current, normalized.templateMode || current.templateMode));
  Object.assign(normalized, mergeCooldownConfig(payload, current));
  Object.assign(normalized, mergeReplyActionConfig(payload, current));

  return normalized;
};

const normalizeDelayedResponsePayload = (payload = {}, options = {}) => {
  const partial = Boolean(options.partial);
  const current = options.current || DEFAULT_SETTINGS.automations.delayedResponse;
  const normalized = {};

  if (!partial || hasOwnProperty(payload, "enabled")) {
    normalized.enabled = normalizeBoolean(payload.enabled, "enabled", current.enabled);
  }

  if (!partial || hasOwnProperty(payload, "message")) {
    normalized.message = normalizeMessage(payload.message, current.message);
  }

  if (!partial || hasOwnProperty(payload, "delayMinutes")) {
    normalized.delayMinutes = normalizePositiveNumber(payload.delayMinutes, "delayMinutes", current.delayMinutes);
  }

  if (!partial || hasOwnProperty(payload, "templateMode")) {
    normalized.templateMode = normalizeTemplateMode(payload.templateMode, current.templateMode);
  }

  Object.assign(normalized, mergeTemplateConfig(payload, current, normalized.templateMode || current.templateMode));
  Object.assign(normalized, mergeCooldownConfig(payload, current));
  Object.assign(normalized, mergeReplyActionConfig(payload, current));

  return normalized;
};

const getBasicAutomationSettings = async () => {
  const settings = await getStoredSettingsDocument().lean();
  return serializeSettings(settings);
};

const refreshSerializedSettings = async () => {
  const populatedSettings = await getStoredSettingsDocument().lean();
  return serializeSettings(populatedSettings);
};

const updateWorkingHours = async (payload = {}, actorId = null) => {
  const settings = await ensureSettingsDocument(actorId);
  const current = serializeSettings(settings).workingHours;
  const normalized = normalizeWorkingHoursPayload(payload, { partial: true, current });

  settings.workingHours = {
    ...((settings.workingHours && settings.workingHours.toObject) ? settings.workingHours.toObject() : settings.workingHours || {}),
    ...normalized,
  };
  settings.updatedBy = actorId || settings.updatedBy || null;
  await settings.save();

  return refreshSerializedSettings();
};

const updateOutOfOfficeAutomation = async (payload = {}, actorId = null) => {
  const settings = await ensureSettingsDocument(actorId);
  const current = serializeSettings(settings).automations.outOfOffice;
  const normalized = normalizeOutOfOfficePayload(payload, { partial: true, current });

  settings.automations.outOfOffice = {
    ...((settings.automations?.outOfOffice && settings.automations.outOfOffice.toObject)
      ? settings.automations.outOfOffice.toObject()
      : settings.automations?.outOfOffice || {}),
    ...normalized,
  };
  settings.updatedBy = actorId || settings.updatedBy || null;
  await settings.save();

  return refreshSerializedSettings();
};

const updateWelcomeAutomation = async (payload = {}, actorId = null) => {
  const settings = await ensureSettingsDocument(actorId);
  const current = serializeSettings(settings).automations.welcome;
  const normalized = normalizeWelcomePayload(payload, { partial: true, current });

  settings.automations.welcome = {
    ...((settings.automations?.welcome && settings.automations.welcome.toObject)
      ? settings.automations.welcome.toObject()
      : settings.automations?.welcome || {}),
    ...normalized,
  };
  settings.updatedBy = actorId || settings.updatedBy || null;
  await settings.save();

  return refreshSerializedSettings();
};

const updateDelayedResponseAutomation = async (payload = {}, actorId = null) => {
  const settings = await ensureSettingsDocument(actorId);
  const current = serializeSettings(settings).automations.delayedResponse;
  const normalized = normalizeDelayedResponsePayload(payload, { partial: true, current });

  settings.automations.delayedResponse = {
    ...((settings.automations?.delayedResponse && settings.automations.delayedResponse.toObject)
      ? settings.automations.delayedResponse.toObject()
      : settings.automations?.delayedResponse || {}),
    ...normalized,
  };
  settings.updatedBy = actorId || settings.updatedBy || null;
  await settings.save();

  return refreshSerializedSettings();
};

const listAvailableBasicAutomationTemplates = async () => {
  const templates = await WhatsAppTemplate.find({
    status: "APPROVED",
    $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
  })
    .select("templateId name language category status components updatedAt")
    .sort({ updatedAt: -1, name: 1 })
    .lean();

  return templates.map((template) => ({
    id: trimString(template.templateId),
    name: trimString(template.name),
    language: trimString(template.language),
    category: trimString(template.category),
    status: trimString(template.status),
    bodyPreview: extractTemplateBodyPreview(template.components),
  }));
};

const listAvailableBasicAutomationForms = async () => {
  return listAvailableWhatsAppForms({ activeOnly: true });
};

const getAutomationConfigNormalizer = (type) => {
  if (type === "outOfOffice") return normalizeOutOfOfficePayload;
  if (type === "welcome") return normalizeWelcomePayload;
  if (type === "delayedResponse") return normalizeDelayedResponsePayload;
  throw createHttpError(`type must be one of: ${AUTOMATION_TYPE_OPTIONS.join(", ")}`);
};

const resolveBasicAutomationConfig = async ({ type, settingsOverride = {} } = {}) => {
  const automationType = normalizeAutomationType(type);
  const settings = await getBasicAutomationSettings();
  const currentConfig = settings.automations[automationType];
  const normalizeConfig = getAutomationConfigNormalizer(automationType);
  const normalizedOverride = normalizeConfig(settingsOverride || {}, {
    partial: true,
    current: currentConfig,
  });

  return {
    type: automationType,
    settings,
    config: {
      ...currentConfig,
      ...normalizedOverride,
    },
  };
};

const listBasicAutomationHistory = async (query = {}) => {
  const type = normalizeAutomationType(query.type, { required: false });
  const limit = clampPositiveInteger(query.limit, 10, 50);
  const settings = await getBasicAutomationSettings();
  const filter = {
    sender: "system",
    direction: "outbound",
    "metadata.automation.key": type ? type : { $in: AUTOMATION_TYPE_OPTIONS },
  };

  const messages = await WhatsAppMessage.find(filter)
    .populate("contactId", "name phone waId")
    .sort({ timestamp: -1, _id: -1 })
    .limit(limit)
    .lean();

  const items = messages.map((message) => {
    const automationMeta = message?.metadata?.automation || {};
    const triggeredType = trimString(automationMeta.key);

    return {
      type: triggeredType,
      triggeredAt: message.timestamp || message.createdAt || null,
      conversationId: message.conversationId || null,
      recipient: {
        name: trimString(message.contactId?.name),
        phone: trimString(message.contactId?.phone || message.contactId?.waId),
      },
      outcome: trimString(message.status || "sent") || "sent",
      fallbackUsed: Boolean(
        automationMeta.fallbackUsed
        || automationMeta.replyActionReason
        || (automationMeta.templateMode === "approved_template" && message.type !== "template")
      ),
      sentCountSnapshot: Number(
        automationMeta.sentCountSnapshot
        || settings.automations?.[triggeredType]?.sentCount
        || 0
      ),
    };
  });

  return {
    items,
    summary: {
      lastTriggeredAt: items[0]?.triggeredAt || null,
      lastSentCount: type
        ? Number(settings.automations?.[type]?.sentCount || 0)
        : Number(
            (settings.automations?.outOfOffice?.sentCount || 0)
            + (settings.automations?.welcome?.sentCount || 0)
            + (settings.automations?.delayedResponse?.sentCount || 0)
          ),
      lastUpdatedAt: settings.updatedAt || null,
      lastUpdatedBy: settings.updatedBy || null,
    },
  };
};

const previewBasicAutomation = async ({ type, phoneNumber = "", settingsOverride = {} } = {}) => {
  const { config: previewConfig } = await resolveBasicAutomationConfig({ type, settingsOverride });
  const runtimeNotes = [];
  let template = null;
  let message = previewConfig.message || "";
  let replyActionDelivered = false;
  let replyActionFallbackExpected = false;
  let replyActionProviderMode = "none";

  if (previewConfig.cooldownEnabled) {
    runtimeNotes.push(`Cooldown is enabled: ${previewConfig.cooldownValue} ${previewConfig.cooldownUnit}`);
  } else {
    runtimeNotes.push("Cooldown is disabled; existing automation suppression rules still apply");
  }

  if (previewConfig.templateMode === "approved_template") {
    message = "";
    if (!previewConfig.templateId) {
      runtimeNotes.push("Approved template mode is selected but templateId is missing");
    } else {
      const selectedTemplate = await getTemplateById(previewConfig.templateId, { includeSyncFallback: false });
      if (!selectedTemplate) {
        runtimeNotes.push("Selected approved template was not found locally");
      } else {
        template = {
          id: trimString(selectedTemplate.id || selectedTemplate.templateId),
          name: trimString(selectedTemplate.name),
          language: trimString(selectedTemplate.language),
          category: trimString(selectedTemplate.category),
          status: trimString(selectedTemplate.status),
          bodyPreview: extractTemplateBodyPreview(selectedTemplate.components),
        };
        runtimeNotes.push("Approved template delivery is runtime-supported when the selected template can be prepared without missing parameters");
      }
    }
  } else {
    runtimeNotes.push("Custom text mode is selected");
  }

  if (previewConfig.replyActionType === "whatsapp_form") {
    replyActionFallbackExpected = true;
    const form = previewConfig.formId ? await WhatsAppForm.findById(previewConfig.formId).select("isActive providerFlowId providerFlowName providerFlowMode providerFlowFirstScreenId").lean() : null;

    if (!form) {
      runtimeNotes.push("Selected WhatsApp form was not found");
    } else if (form.isActive === false) {
      runtimeNotes.push("Selected WhatsApp form is inactive");
    } else if (previewConfig.templateMode === "approved_template") {
      runtimeNotes.push("WhatsApp form actions cannot be attached to approved template sends in the current automation config");
    } else if ((form.providerFlowMode || "published") === "draft" && !String(form.providerFlowName || "").trim()) {
      runtimeNotes.push("Selected WhatsApp form is missing providerFlowName for draft Meta Flow delivery");
    } else if ((form.providerFlowMode || "published") !== "draft" && !String(form.providerFlowId || "").trim()) {
      runtimeNotes.push("Selected WhatsApp form is missing providerFlowId for published Meta Flow delivery");
    } else if (previewConfig.formOpenMode === "data_exchange") {
      runtimeNotes.push("formOpenMode=data_exchange is not supported yet by the current backend");
    } else {
      replyActionDelivered = true;
      replyActionFallbackExpected = false;
      replyActionProviderMode = "interactive_flow";
      runtimeNotes.push("WhatsApp form action is expected to be delivered via Meta interactive flow message");
    }
  } else if (previewConfig.replyActionType === "interactive_list") {
    runtimeNotes.push("Interactive list source/delivery is not available in the current backend");
    replyActionFallbackExpected = true;
  } else if (previewConfig.replyActionType === "product_collection") {
    runtimeNotes.push("Product collection source/delivery is not available in the current backend");
    replyActionFallbackExpected = true;
  }

  return {
    mode: "preview",
    phoneNumber: trimString(phoneNumber),
    message,
    template,
    replyAction: {
      type: previewConfig.replyActionType,
      actionButtonText: previewConfig.actionButtonText,
      formId: previewConfig.formId,
      formName: previewConfig.formName,
      formOpenMode: previewConfig.formOpenMode,
      interactiveListId: previewConfig.interactiveListId,
      interactiveListName: previewConfig.interactiveListName,
      productCollectionId: previewConfig.productCollectionId,
      productCollectionName: previewConfig.productCollectionName,
    },
    replyActionDelivered,
    replyActionFallbackExpected,
    replyActionProviderMode,
    runtimeNotes,
  };
};

module.exports = {
  DAY_OPTIONS,
  TEMPLATE_MODE_OPTIONS,
  APPLY_SCOPE_OPTIONS,
  COOLDOWN_UNIT_OPTIONS,
  REPLY_ACTION_TYPE_OPTIONS,
  FORM_OPEN_MODE_OPTIONS,
  buildDefaultSettings,
  getBasicAutomationSettings,
  updateWorkingHours,
  updateOutOfOfficeAutomation,
  updateWelcomeAutomation,
  updateDelayedResponseAutomation,
  listAvailableBasicAutomationTemplates,
  listAvailableBasicAutomationForms,
  listBasicAutomationHistory,
  resolveBasicAutomationConfig,
  previewBasicAutomation,
};

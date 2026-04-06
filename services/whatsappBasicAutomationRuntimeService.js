const { randomUUID } = require("crypto");
const { Types } = require("mongoose");
const RecruitmentChannel = require("../models/RecruitmentChannel");
const WhatsAppForm = require("../models/WhatsAppForm");
const WhatsAppBasicAutomationSettings = require("../models/WhatsAppBasicAutomationSettings");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppContact = require("../models/WhatsAppContact");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const {
  getInteractiveListById,
  buildInteractiveListResourceFromConfig,
  validateInteractiveListSnapshot,
} = require("./whatsappInteractiveListService");
const {
  getProductCollectionById,
  buildProductCollectionResourceFromConfig,
  validateProductCollectionSnapshot,
  isProductCollectionProviderConfigured,
  getProductCollectionProviderConfig,
  MAX_BUTTON_TEXT_LENGTH: PRODUCT_COLLECTION_MAX_BUTTON_TEXT_LENGTH,
  MAX_PRODUCT_ITEMS,
} = require("./whatsappProductCollectionService");
const { prepareTemplateMessage, getTemplateById } = require("./whatsappTemplateService");
const { sendMessage, normalizePhone } = require("./whatsappService");
const { getBasicAutomationSettings, resolveBasicAutomationConfig } = require("./whatsappBasicAutomationService");

const OUT_OF_OFFICE_COOLDOWN_MINUTES = 60;
const MAX_DELAYED_RESPONSE_BATCH = 100;

const DEFAULT_AUTOMATION_STATE = Object.freeze({
  lastCustomerMessageAt: null,
  lastCustomerMessageId: null,
  lastTeamReplyAt: null,
  outOfOffice: {
    lastSentAt: null,
    lastSentMessageId: null,
  },
  welcome: {
    lastSentAt: null,
    lastSentMessageId: null,
  },
  delayedResponse: {
    pendingSince: null,
    dueAt: null,
    pendingMessageId: null,
    waitingForTeamReply: false,
    lastSentAt: null,
    lastSentMessageId: null,
    lastSentForPendingMessageId: null,
    cancelledAt: null,
    resolvedAt: null,
  },
});

const trimString = (value) => String(value || "").trim();
const getReplyActionLabel = (replyActionType) => {
  if (replyActionType === "whatsapp_form") return "Interactive form";
  if (replyActionType === "interactive_list") return "Interactive list";
  if (replyActionType === "product_collection") return "Product collection";
  return "Interactive reply";
};
const toObject = (value) => {
  if (!value) return {};
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60 * 1000);
const addHours = (date, hours) => new Date(date.getTime() + hours * 60 * 60 * 1000);
const addMilliseconds = (date, milliseconds) => new Date(date.getTime() + milliseconds);

const getCooldownWindowMs = (config = {}, fallbackMinutes = 0) => {
  if (config?.cooldownEnabled) {
    const value = Number(config.cooldownValue || 0);
    const unit = trimString(config.cooldownUnit || "minutes") || "minutes";
    if (Number.isFinite(value) && value > 0) {
      return unit === "hours" ? value * 60 * 60 * 1000 : value * 60 * 1000;
    }
  }

  return fallbackMinutes > 0 ? fallbackMinutes * 60 * 1000 : 0;
};

const cloneAutomationState = (state = {}) => ({
  ...DEFAULT_AUTOMATION_STATE,
  ...state,
  outOfOffice: {
    ...DEFAULT_AUTOMATION_STATE.outOfOffice,
    ...(state.outOfOffice || {}),
  },
  welcome: {
    ...DEFAULT_AUTOMATION_STATE.welcome,
    ...(state.welcome || {}),
  },
  delayedResponse: {
    ...DEFAULT_AUTOMATION_STATE.delayedResponse,
    ...(state.delayedResponse || {}),
  },
});

const getLocalTimeParts = (date, timeZone) => {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: trimString(timeZone) || "Asia/Colombo",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    return {
      day: map.weekday,
      hour: Number(map.hour || 0),
      minute: Number(map.minute || 0),
    };
  } catch {
    return {
      day: "Mon",
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
};

const parseClockMinutes = (value, fallback) => {
  const normalized = trimString(value || fallback);
  const [hour, minute] = normalized.split(":").map((item) => Number(item || 0));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return fallback === "18:00" ? 18 * 60 : 10 * 60;
  }
  return hour * 60 + minute;
};

const isOutsideWorkingHours = (workingHours, date) => {
  if (!workingHours?.enabled) return false;

  const local = getLocalTimeParts(date, workingHours.timezone);
  const activeDays = Array.isArray(workingHours.days) ? workingHours.days : [];
  if (!activeDays.includes(local.day)) {
    return true;
  }

  const currentMinutes = local.hour * 60 + local.minute;
  const startMinutes = parseClockMinutes(workingHours.startTime, "10:00");
  const endMinutes = parseClockMinutes(workingHours.endTime, "18:00");

  return currentMinutes < startMinutes || currentMinutes >= endMinutes;
};

const incrementSentCount = async (automationKey) => {
  if (!["outOfOffice", "welcome", "delayedResponse"].includes(automationKey)) {
    return 0;
  }

  const result = await WhatsAppBasicAutomationSettings.findOneAndUpdate(
    { singletonKey: "default" },
    { $inc: { [`automations.${automationKey}.sentCount`]: 1 } },
    {
      new: true,
      projection: { [`automations.${automationKey}.sentCount`]: 1 },
    }
  );

  return Number(result?.automations?.[automationKey]?.sentCount || 0);
};

const updateAutomationMessageMetadata = async (savedMessageId, metadata = {}) => {
  if (!savedMessageId) return;

  await WhatsAppMessage.updateOne(
    { _id: savedMessageId },
    {
      $set: Object.fromEntries(
        Object.entries(metadata).map(([key, value]) => [`metadata.automation.${key}`, value])
      ),
    }
  );
};

const normalizeTestPhoneNumber = (value) => {
  const normalized = normalizePhone(value);
  const digits = normalized.replace(/[^\d]/g, "");

  if (!normalized || digits.length < 8 || digits.length > 15) {
    const error = new Error("phoneNumber must be a valid WhatsApp number");
    error.status = 400;
    throw error;
  }

  return normalized;
};

const validateReplyActionResource = async (automationKey, config) => {
  if (!config || config.replyActionType === "none") {
    return {
      status: "none",
      supported: true,
      resource: null,
      reason: "",
    };
  }

  if (config.replyActionType === "whatsapp_form") {
    if (!Types.ObjectId.isValid(String(config.formId || ""))) {
      return {
        status: "invalid",
        supported: false,
        resource: null,
        reason: `Configured form id is invalid for ${automationKey}`,
      };
    }

    let form = await WhatsAppForm.findById(config.formId)
      .select("_id name isActive providerFlowId providerFlowName providerFlowMode providerFlowFirstScreenId")
      .lean();
    let source = "whatsapp_form";

    if (!form) {
      form = await RecruitmentChannel.findById(config.formId).select("_id formName status").lean();
      source = "recruitment_channel";
    }

    if (!form) {
      return {
        status: "invalid",
        supported: false,
        resource: null,
        reason: `Configured form not found for ${automationKey}`,
      };
    }

    const isActive =
      source === "whatsapp_form"
        ? form.isActive !== false
        : String(form.status || "").trim().toLowerCase() === "active";

    if (!isActive) {
      return {
        status: "inactive",
        supported: false,
        resource: {
          id: String(form._id),
          name: String(form.name || form.formName || "").trim(),
          status: String(form.status || (form.isActive ? "Active" : "Inactive") || "").trim(),
          source,
        },
        reason: `Configured form is inactive for ${automationKey}`,
      };
    }

    if (source !== "whatsapp_form") {
      return {
        status: "legacy",
        supported: false,
        resource: {
          id: String(form._id),
          name: String(form.name || form.formName || "").trim(),
          status: String(form.status || "").trim(),
          source,
        },
        reason: "Legacy recruitment-channel forms do not include provider Meta Flow mapping fields, so interactive form delivery is unavailable",
      };
    }

    const providerFlowMode = trimString(form.providerFlowMode || "published") || "published";
    const providerFlowId = trimString(form.providerFlowId);
    const providerFlowName = trimString(form.providerFlowName);
    const providerFlowFirstScreenId = trimString(form.providerFlowFirstScreenId);

    if (!config.actionButtonText) {
      return {
        status: "invalid",
        supported: false,
        resource: {
          id: String(form._id),
          name: String(form.name || "").trim(),
          status: String(form.isActive ? "Active" : "Inactive"),
          source,
        },
        reason: `actionButtonText is required for WhatsApp form delivery in ${automationKey}`,
      };
    }

    if (trimString(config.formOpenMode || "navigate_first_screen") !== "navigate_first_screen") {
      return {
        status: "unsupported",
        supported: false,
        resource: {
          id: String(form._id),
          name: String(form.name || "").trim(),
          status: String(form.isActive ? "Active" : "Inactive"),
          source,
          provider: "meta_flow",
          providerFlowMode,
        },
        reason: "formOpenMode=data_exchange is not supported yet because the current backend has no Flow data-exchange implementation",
      };
    }

    if (providerFlowMode === "draft" && !providerFlowName) {
      return {
        status: "invalid",
        supported: false,
        resource: {
          id: String(form._id),
          name: String(form.name || "").trim(),
          status: String(form.isActive ? "Active" : "Inactive"),
          source,
          provider: "meta_flow",
          providerFlowMode,
        },
        reason: "Configured form is missing providerFlowName for draft Meta Flow delivery",
      };
    }

    if (providerFlowMode !== "draft" && !providerFlowId) {
      return {
        status: "invalid",
        supported: false,
        resource: {
          id: String(form._id),
          name: String(form.name || "").trim(),
          status: String(form.isActive ? "Active" : "Inactive"),
          source,
          provider: "meta_flow",
          providerFlowMode,
        },
        reason: "Configured form is missing providerFlowId for published Meta Flow delivery",
      };
    }

    return {
      status: "validated",
      supported: true,
      resource: {
        id: String(form._id),
        name: String(form.name || form.formName || "").trim(),
        status: String(form.status || (form.isActive ? "Active" : "Inactive") || "").trim(),
        source,
        provider: "meta_flow",
        providerFlowId,
        providerFlowName,
        providerFlowMode,
        providerFlowFirstScreenId,
      },
      reason: "",
    };
  }

  if (config.replyActionType === "interactive_list") {
    const cachedResource = buildInteractiveListResourceFromConfig(config);
    const interactiveListId = trimString(config.interactiveListId);
    const buttonText = trimString(config.actionButtonText || cachedResource.buttonText);

    if (!interactiveListId) {
      return {
        status: "invalid",
        supported: false,
        resource: cachedResource,
        reason: `interactiveListId is required for ${automationKey}`,
      };
    }

    const interactiveList = await getInteractiveListById(interactiveListId);
    if (!interactiveList) {
      return {
        status: "invalid",
        supported: false,
        resource: cachedResource,
        reason: `Configured interactive list not found for ${automationKey}`,
      };
    }

    if (interactiveList.isActive === false) {
      return {
        status: "inactive",
        supported: false,
        resource: interactiveList,
        reason: `Configured interactive list is inactive for ${automationKey}`,
      };
    }

    const sectionCount = Number(interactiveList.sectionCount || 0);
    const rowCount = Number(interactiveList.rowCount || 0);
    const validation = validateInteractiveListSnapshot({
      sections: interactiveList.sections,
      buttonText,
      requireActive: true,
      isActive: interactiveList.isActive,
    });

    if (!buttonText) {
      return {
        status: "invalid",
        supported: false,
        resource: interactiveList,
        reason: `actionButtonText is required for interactive list delivery in ${automationKey}`,
      };
    }

    if (buttonText.length > 20) {
      return {
        status: "invalid",
        supported: false,
        resource: interactiveList,
        reason: "Interactive list button text must be 20 characters or fewer",
      };
    }

    if (sectionCount < 1) {
      return {
        status: "invalid",
        supported: false,
        resource: interactiveList,
        reason: "Configured interactive list must contain at least one section",
      };
    }

    if (rowCount < 1) {
      return {
        status: "invalid",
        supported: false,
        resource: interactiveList,
        reason: "Configured interactive list must contain at least one row",
      };
    }

    if (sectionCount > 10) {
      return {
        status: "invalid",
        supported: false,
        resource: interactiveList,
        reason: "Configured interactive list exceeds the 10 section WhatsApp limit",
      };
    }

    if (!validation.valid) {
      return {
        status: "invalid",
        supported: false,
        resource: interactiveList,
        reason: validation.reason,
      };
    }

    return {
      status: "validated",
      supported: true,
      resource: {
        ...interactiveList,
        provider: "meta_interactive_list",
        buttonText,
      },
      reason: "",
    };
  }

  if (config.replyActionType === "product_collection") {
    const cachedResource = buildProductCollectionResourceFromConfig(config);
    const productCollectionId = trimString(config.productCollectionId);
    const buttonText = trimString(config.actionButtonText || cachedResource.buttonText);

    if (!productCollectionId) {
      return {
        status: "invalid",
        supported: false,
        resource: cachedResource,
        reason: `productCollectionId is required for ${automationKey}`,
      };
    }

    const productCollection = await getProductCollectionById(productCollectionId);
    if (!productCollection) {
      return {
        status: "invalid",
        supported: false,
        resource: cachedResource,
        reason: `Configured product collection not found for ${automationKey}`,
      };
    }

    if (productCollection.isActive === false) {
      return {
        status: "inactive",
        supported: false,
        resource: productCollection,
        reason: `Configured product collection is inactive for ${automationKey}`,
      };
    }

    const itemCount = Number(productCollection.itemCount || 0);
    const validation = validateProductCollectionSnapshot({
      items: productCollection.items,
      buttonText,
      requireActive: true,
      isActive: productCollection.isActive,
    });

    if (!buttonText) {
      return {
        status: "invalid",
        supported: false,
        resource: productCollection,
        reason: `actionButtonText is required for product collection delivery in ${automationKey}`,
      };
    }

    if (buttonText.length > PRODUCT_COLLECTION_MAX_BUTTON_TEXT_LENGTH) {
      return {
        status: "invalid",
        supported: false,
        resource: productCollection,
        reason: `Product collection button text must be ${PRODUCT_COLLECTION_MAX_BUTTON_TEXT_LENGTH} characters or fewer`,
      };
    }

    if (itemCount < 1) {
      return {
        status: "invalid",
        supported: false,
        resource: productCollection,
        reason: "Configured product collection must contain at least one item",
      };
    }

    if (itemCount > MAX_PRODUCT_ITEMS) {
      return {
        status: "invalid",
        supported: false,
        resource: productCollection,
        reason: `Configured product collection exceeds the ${MAX_PRODUCT_ITEMS} product WhatsApp limit`,
      };
    }

    if (!validation.valid) {
      return {
        status: "invalid",
        supported: false,
        resource: productCollection,
        reason: validation.reason,
      };
    }

    if (!isProductCollectionProviderConfigured()) {
      return {
        status: "provider_unavailable",
        supported: false,
        resource: {
          ...productCollection,
          provider: "meta_catalog",
          buttonText,
          providerAttempted: false,
        },
        reason: "Product collection preset is saved, but provider catalog delivery is not yet configured; plain text fallback will be used",
      };
    }

    const providerConfig = getProductCollectionProviderConfig();
    if (!providerConfig.catalogId) {
      return {
        status: "provider_invalid",
        supported: false,
        resource: {
          ...productCollection,
          provider: "meta_catalog",
          buttonText,
          providerAttempted: false,
        },
        reason: "Product collection provider catalog id is missing",
      };
    }

    return {
      status: "validated",
      supported: true,
      resource: {
        ...productCollection,
        provider: "meta_catalog",
        buttonText,
        providerAttempted: true,
        catalogId: providerConfig.catalogId,
      },
      reason: "",
    };
  }

  return {
    status: "unsupported",
    supported: false,
    resource: null,
    reason: "Unknown reply action type",
  };
};

const resolveApprovedTemplate = async (automationKey, config) => {
  const templateMode = trimString(config?.templateMode || "custom") || "custom";
  if (templateMode !== "approved_template") {
    return {
      status: "none",
      supported: false,
      template: null,
      resource: null,
      reason: "",
    };
  }

  const templateId = trimString(config?.templateId);
  if (!templateId) {
    return {
      status: "invalid",
      supported: false,
      template: null,
      resource: null,
      reason: `Missing templateId for ${automationKey}`,
    };
  }

  const templateRecord = await getTemplateById(templateId, { includeSyncFallback: false });
  if (!templateRecord) {
    return {
      status: "invalid",
      supported: false,
      template: null,
      resource: null,
      reason: `Approved template not found for ${automationKey}`,
    };
  }

  try {
    const preparedTemplate = await prepareTemplateMessage({
      template: {
        id: trimString(templateRecord.id || templateRecord.templateId),
      },
    });

    return {
      status: "prepared",
      supported: true,
      template: preparedTemplate,
      resource: {
        id: trimString(templateRecord.id || templateRecord.templateId),
        name: trimString(templateRecord.name),
        language: trimString(templateRecord.language),
        category: trimString(templateRecord.category),
        status: trimString(templateRecord.status),
      },
      reason: "",
    };
  } catch (error) {
    return {
      status: "fallback",
      supported: false,
      template: null,
      resource: {
        id: trimString(templateRecord.id || templateRecord.templateId),
        name: trimString(templateRecord.name),
        language: trimString(templateRecord.language),
        category: trimString(templateRecord.category),
        status: trimString(templateRecord.status),
      },
      reason: error.message || `Template preparation failed for ${automationKey}`,
    };
  }
};

const buildAutomationDeliveryMeta = (automationKey, config, replyActionResult, templateResult, deliveredType) => {
  const templateMode = trimString(config?.templateMode || "custom") || "custom";
  const replyActionUsed = config?.replyActionType || "none";
  const replyActionDelivered = replyActionUsed !== "none" && deliveredType === "interactive";
  if (templateResult?.reason) {
    console.warn(`[WhatsAppAutomation] ${automationKey} template fallback: ${templateResult.reason}`);
  }

  if (replyActionResult?.reason) {
    console.warn(`[WhatsAppAutomation] ${automationKey} reply action fallback: ${replyActionResult.reason}`);
  }

  return {
    templateMode,
    deliveredType,
    templateStatus: templateResult?.status || "none",
    templateReason: templateResult?.reason || "",
    templateResource: templateResult?.resource || null,
    templateId: trimString(config?.templateId),
    templateName: trimString(config?.templateName),
    fallbackUsed: Boolean(
      (templateMode === "approved_template" && deliveredType !== "template")
      || templateResult?.reason
      || replyActionResult?.reason
      || (replyActionUsed !== "none" && !replyActionDelivered)
    ),
    replyActionType: replyActionUsed,
    replyActionStatus: replyActionResult?.status || "none",
    replyActionDelivered,
    replyActionFallbackUsed: Boolean(replyActionUsed !== "none" && !replyActionDelivered),
    replyActionReason: replyActionResult?.reason || "",
    replyActionResource: replyActionResult?.resource || null,
  };
};

const buildWhatsAppFormInteractivePayload = ({ automationKey, config, replyActionResult, text }) => {
  if (config?.replyActionType !== "whatsapp_form" || !replyActionResult?.supported) {
    return null;
  }

  const resource = replyActionResult.resource || {};
  const flowActionPayload = {};
  const providerFlowMode = trimString(resource.providerFlowMode || "published").toLowerCase() || "published";

  if (trimString(resource.providerFlowFirstScreenId)) {
    flowActionPayload.screen = trimString(resource.providerFlowFirstScreenId);
  }

  const flowPayload = providerFlowMode === "draft"
    ? {
        name: trimString(resource.providerFlowName),
        language: "en_US",
        mode: "draft",
      }
    : {
        id: trimString(resource.providerFlowId),
        language: "en_US",
        mode: "published",
      };

  console.info(`[WhatsAppAutomation] ${automationKey} prepared flow payload`, {
    mode: providerFlowMode,
    providerFlowId: trimString(resource.providerFlowId),
    providerFlowName: trimString(resource.providerFlowName),
    providerFlowFirstScreenId: trimString(resource.providerFlowFirstScreenId),
  });

  return {
    type: "flow",
    body: trimString(text) ? { text: trimString(text) } : undefined,
    flow: flowPayload,
    ctaText: trimString(config?.actionButtonText),
    flowToken: `bwcrm-${automationKey}-${randomUUID()}`,
    flowMessageVersion: "3",
    flowAction: "navigate",
    ...(Object.keys(flowActionPayload).length ? { flowActionPayload } : {}),
  };
};

const buildInteractiveListPayload = ({ automationKey, config, replyActionResult, text }) => {
  if (config?.replyActionType !== "interactive_list" || !replyActionResult?.supported) {
    return null;
  }

  const resource = replyActionResult.resource || {};
  const bodyText = trimString(text || resource.description || "Please choose an option.");
  const buttonText = trimString(config?.actionButtonText || resource.buttonText);
  const sections = Array.isArray(resource.sections) ? resource.sections : [];
  const sectionCount = Number(resource.sectionCount || sections.length || 0);
  const rowCount = Number(resource.rowCount || 0);

  console.info(`[WhatsAppAutomation] ${automationKey} prepared interactive list payload`, {
    interactiveListId: trimString(resource.id),
    interactiveListName: trimString(resource.name),
    sectionCount,
    rowCount,
    phoneReplyActionType: "interactive_list",
  });

  return {
    type: "list",
    body: { text: bodyText },
    ...(trimString(resource.headerText) ? { headerText: trimString(resource.headerText) } : {}),
    ...(trimString(resource.footerText) ? { footerText: trimString(resource.footerText) } : {}),
    buttonText,
    sections,
  };
};

const buildProductCollectionPayload = ({ automationKey, config, replyActionResult }) => {
  if (config?.replyActionType !== "product_collection" || !replyActionResult?.supported) {
    return null;
  }

  const resource = replyActionResult?.resource || buildProductCollectionResourceFromConfig(config);
  const itemCount = Number(resource.itemCount || 0);
  const sectionTitle = trimString(resource.category || resource.name || "Services");
  const bodyText = trimString(config?.message || resource.description || "Please browse the available services.");
  const footerText = "Blue Whale Migration";

  console.info(`[WhatsAppAutomation] ${automationKey} prepared product collection preset`, {
    productCollectionId: trimString(resource.id),
    productCollectionName: trimString(resource.name),
    itemCount,
    catalogId: trimString(resource.catalogId),
    providerDeliveryAttempted: true,
    phoneReplyActionType: "product_collection",
  });

  return {
    type: "product_list",
    header: { type: "text", text: trimString(resource.name || "Blue Whale Services") },
    body: { text: bodyText },
    footer: { text: footerText },
    action: {
      catalog_id: trimString(resource.catalogId),
      sections: [
        {
          title: sectionTitle,
          product_items: (Array.isArray(resource.items) ? resource.items : []).map((item) => ({
            product_retailer_id: trimString(item.id),
          })),
        },
      ],
    },
  };
};

const buildAutomationSendPlan = async ({ automationKey, config }) => {
  const text = trimString(config?.message || "");
  const replyActionResult = await validateReplyActionResource(automationKey, config);
  const templateResult = await resolveApprovedTemplate(automationKey, config);
  const interactivePayload =
    config?.replyActionType === "whatsapp_form"
      ? buildWhatsAppFormInteractivePayload({ automationKey, config, replyActionResult, text })
      : config?.replyActionType === "interactive_list"
        ? buildInteractiveListPayload({ automationKey, config, replyActionResult, text })
        : config?.replyActionType === "product_collection"
          ? buildProductCollectionPayload({ automationKey, config, replyActionResult, text })
          : null;
  const canSendTemplate =
    trimString(config?.templateMode || "custom") === "approved_template"
    && templateResult?.supported
    && templateResult?.template;
  const canSendInteractiveReply =
    trimString(config?.templateMode || "custom") !== "approved_template"
    && ["whatsapp_form", "interactive_list", "product_collection"].includes(config?.replyActionType)
    && Boolean(interactivePayload);
  const deliveredType = canSendTemplate ? "template" : canSendInteractiveReply ? "interactive" : "text";
  const notes = [];

  if (templateResult?.reason) {
    notes.push(templateResult.reason);
  } else if (deliveredType === "template") {
    notes.push("Approved template prepared successfully");
  }

  if (replyActionResult?.reason) {
    notes.push(replyActionResult.reason);
  }

  if (canSendInteractiveReply) {
    notes.push(
      config?.replyActionType === "interactive_list"
        ? "Interactive list action will be delivered via Meta interactive list message"
        : config?.replyActionType === "product_collection"
          ? "Product collection action will be delivered via Meta catalog multi-product message"
          : "WhatsApp form action will be delivered via Meta interactive flow message"
    );
  }

  if (
    trimString(config?.templateMode || "custom") === "approved_template"
    && ["whatsapp_form", "interactive_list", "product_collection"].includes(config?.replyActionType)
    && (replyActionResult?.supported || config?.replyActionType === "product_collection")
  ) {
    notes.push(
      config?.replyActionType === "interactive_list"
        ? "Interactive lists cannot be attached to approved template sends in the current automation config; template delivery will continue without the list action"
        : config?.replyActionType === "product_collection"
          ? "Product collections cannot be attached to approved template sends in the current automation config; template delivery will continue without the collection action"
          : "WhatsApp form actions cannot be attached to approved template sends in the current automation config; template delivery will continue without the form action"
    );
  }

  const interactiveBodyText = trimString(interactivePayload?.body?.text || "");

  if (!canSendTemplate && !canSendInteractiveReply && !text && !interactiveBodyText) {
    return {
      sendable: false,
      deliveredType,
      text,
      template: null,
      interactive: null,
      content: "",
      replyActionResult,
      templateResult,
      deliveryMeta: buildAutomationDeliveryMeta(automationKey, config, replyActionResult, templateResult, deliveredType),
      notes: [...notes, "No text fallback is available for this automation"],
    };
  }

  return {
    sendable: true,
    deliveredType,
    text: text || interactiveBodyText,
    template: canSendTemplate ? templateResult.template : null,
    interactive: canSendInteractiveReply ? interactivePayload : null,
    content: canSendTemplate
      ? `Template: ${templateResult.resource?.name || config?.templateName || automationKey}`
      : canSendInteractiveReply
        ? text || interactiveBodyText || `[interactive:${config?.actionButtonText || "reply"}]`
        : text,
    replyActionResult,
    templateResult,
    deliveryMeta: buildAutomationDeliveryMeta(automationKey, config, replyActionResult, templateResult, deliveredType),
    notes,
  };
};

const updateConversationAutomationState = async (conversationId, updater) => {
  const conversation = await WhatsAppConversation.findById(conversationId);
  if (!conversation) return null;

  const nextState = cloneAutomationState(toObject(conversation.automationState));
  updater(nextState);
  conversation.automationState = nextState;
  await conversation.save();

  return conversation;
};

const sendAutomationMessage = async ({
  app,
  conversation,
  contact,
  automationKey,
  config,
  dispatchAutomationMessage,
}) => {
  const plan = await buildAutomationSendPlan({ automationKey, config });

  if (!plan.sendable) {
    console.warn(`[WhatsAppAutomation] ${automationKey} has no sendable text fallback, skipping send.`);
    return { status: "skipped", savedMessage: null };
  }

  let savedMessage = null;
  let deliveredType = plan.deliveredType;
  const notes = [...plan.notes];

  try {
    savedMessage = await dispatchAutomationMessage({
      app,
      conversation,
      contact,
      automationKey,
      messageType: deliveredType,
      text: plan.text,
      template: plan.template,
      interactive: plan.interactive,
      content: plan.content,
      deliveryMeta: plan.deliveryMeta,
    });
  } catch (error) {
    const canFallbackToText = deliveredType === "interactive" && trimString(plan.text);
    const replyActionLabel = getReplyActionLabel(config?.replyActionType);

    if (!canFallbackToText) {
      throw error;
    }

    console.error(`[WhatsAppAutomation] ${automationKey} ${replyActionLabel.toLowerCase()} send failed, sending text fallback`, {
      error: error.message,
      phone: contact?.phone || "",
      replyActionType: config?.replyActionType || "none",
      interactiveListId: plan.replyActionResult?.resource?.id || "",
      interactiveListName: plan.replyActionResult?.resource?.name || "",
      sectionCount: plan.replyActionResult?.resource?.sectionCount || 0,
      rowCount: plan.replyActionResult?.resource?.rowCount || 0,
      productCollectionId: plan.replyActionResult?.resource?.id || "",
      productCollectionName: plan.replyActionResult?.resource?.name || "",
      itemCount: plan.replyActionResult?.resource?.itemCount || 0,
      mode: plan.interactive?.flow?.mode || "",
      providerFlowId: plan.interactive?.flow?.id || "",
      providerFlowName: plan.interactive?.flow?.name || "",
    });

    notes.push(`${replyActionLabel} send failed: ${error.message}`);
    notes.push(
      config?.replyActionType === "interactive_list"
        ? "Sent plain text fallback instead without the list action"
        : config?.replyActionType === "product_collection"
          ? "Sent plain text fallback instead without the collection action"
          : "Sent plain text fallback instead without the form action"
    );
    deliveredType = "text";

    savedMessage = await dispatchAutomationMessage({
      app,
      conversation,
      contact,
      automationKey,
      messageType: "text",
      text: plan.text,
      content: plan.text,
      deliveryMeta: {
        ...plan.deliveryMeta,
        deliveredType: "text",
        fallbackUsed: true,
        replyActionDelivered: false,
        replyActionFallbackUsed: true,
        replyActionReason: `${plan.deliveryMeta?.replyActionReason || ""}${plan.deliveryMeta?.replyActionReason ? " | " : ""}Flow send failed: ${error.message}`,
      },
    });
  }

  if (!savedMessage) {
    return { status: "skipped", savedMessage: null };
  }

  return {
    status: "sent",
    savedMessage,
    replyActionResult: plan.replyActionResult,
    templateResult: plan.templateResult,
    deliveredType,
    notes,
  };
};

const sendBasicAutomationTestMessage = async ({ type, phoneNumber, settingsOverride = {}, actorId = null } = {}) => {
  const { type: automationKey, config } = await resolveBasicAutomationConfig({
    type,
    settingsOverride,
  });
  const normalizedPhoneNumber = normalizeTestPhoneNumber(phoneNumber);
  const plan = await buildAutomationSendPlan({ automationKey, config });

  if (!plan.sendable) {
    const error = new Error("The selected automation does not have a sendable message");
    error.status = 400;
    throw error;
  }

  const notes = [...plan.notes];
  let deliveredType = plan.deliveredType;
  let fallbackUsed = Boolean(plan.deliveryMeta?.fallbackUsed);
  let sendResult = null;
  let replyActionDelivered = Boolean(plan.deliveryMeta?.replyActionDelivered);
  let replyActionFallbackUsed = Boolean(plan.deliveryMeta?.replyActionFallbackUsed);

  const baseContext = {
    source: "basic_automation_test_send",
    automationKey,
    isTestSend: true,
    actorId: actorId || null,
  };
  const replyActionLabel = getReplyActionLabel(config.replyActionType);

  try {
    sendResult = await sendMessage({
      to: normalizedPhoneNumber,
      type: deliveredType,
      text: deliveredType === "text" ? plan.text : undefined,
      template: deliveredType === "template" ? plan.template : undefined,
      interactive: deliveredType === "interactive" ? plan.interactive : undefined,
      context: baseContext,
    });
    replyActionDelivered =
      deliveredType === "interactive" && ["whatsapp_form", "interactive_list", "product_collection"].includes(config.replyActionType);
    replyActionFallbackUsed =
      ["whatsapp_form", "interactive_list", "product_collection"].includes(config.replyActionType) && deliveredType !== "interactive";
  } catch (error) {
    if (["template", "interactive"].includes(deliveredType) && plan.text) {
      notes.push(`${deliveredType === "template" ? "Template" : replyActionLabel} send failed: ${error.message}`);
      notes.push(
        deliveredType === "interactive"
          ? `Sent plain text fallback instead without the ${
            config.replyActionType === "interactive_list"
              ? "list"
              : config.replyActionType === "product_collection"
                ? "collection"
                : "form"
          } action`
          : "Sent plain text fallback instead"
      );
      deliveredType = "text";
      fallbackUsed = true;
      replyActionDelivered = false;
      replyActionFallbackUsed = ["whatsapp_form", "interactive_list", "product_collection"].includes(config.replyActionType);
      sendResult = await sendMessage({
        to: normalizedPhoneNumber,
        type: "text",
        text: plan.text,
        context: {
          ...baseContext,
          templateFallbackUsed: true,
        },
      });
    } else {
      throw error;
    }
  }

  return {
    sent: true,
    type: automationKey,
    phoneNumber: normalizedPhoneNumber,
    modeUsed: deliveredType,
    fallbackUsed,
    replyActionUsed: config.replyActionType || "none",
    replyActionDelivered,
    replyActionFallbackUsed,
    messageId: sendResult?.response?.messages?.[0]?.id || "",
    template: plan.templateResult?.resource
      ? {
          id: plan.templateResult.resource.id || "",
          name: plan.templateResult.resource.name || "",
          language: plan.templateResult.resource.language || "",
        }
      : null,
    notes,
  };
};

const markWelcomeSent = async (conversationId, savedMessage) => {
  await updateConversationAutomationState(conversationId, (state) => {
    state.welcome.lastSentAt = savedMessage.timestamp || new Date();
    state.welcome.lastSentMessageId = savedMessage._id;
  });
  const sentCount = await incrementSentCount("welcome");
  await updateAutomationMessageMetadata(savedMessage._id, { sentCountSnapshot: sentCount });
};

const markOutOfOfficeSent = async (conversationId, savedMessage) => {
  await updateConversationAutomationState(conversationId, (state) => {
    state.outOfOffice.lastSentAt = savedMessage.timestamp || new Date();
    state.outOfOffice.lastSentMessageId = savedMessage._id;
  });
  const sentCount = await incrementSentCount("outOfOffice");
  await updateAutomationMessageMetadata(savedMessage._id, { sentCountSnapshot: sentCount });
};

const markDelayedResponseSent = async (conversationId, savedMessage, pendingMessageId) => {
  await updateConversationAutomationState(conversationId, (state) => {
    state.delayedResponse.lastSentAt = savedMessage.timestamp || new Date();
    state.delayedResponse.lastSentMessageId = savedMessage._id;
    state.delayedResponse.lastSentForPendingMessageId = pendingMessageId || null;
    state.delayedResponse.waitingForTeamReply = true;
  });
  const sentCount = await incrementSentCount("delayedResponse");
  await updateAutomationMessageMetadata(savedMessage._id, { sentCountSnapshot: sentCount });
};

const finalizeDelayedResponseWait = async (conversationId, pendingMessageId, reason = "skipped") => {
  await updateConversationAutomationState(conversationId, (state) => {
    state.delayedResponse.lastSentForPendingMessageId = pendingMessageId || state.delayedResponse.lastSentForPendingMessageId || null;
    state.delayedResponse.waitingForTeamReply = false;
    state.delayedResponse.pendingSince = null;
    state.delayedResponse.dueAt = null;
    state.delayedResponse.pendingMessageId = null;
    state.delayedResponse.cancelledAt = new Date();
    state.delayedResponse.resolvedAt = reason === "staff_reply" ? new Date() : state.delayedResponse.resolvedAt;
  });
};

const shouldSendWelcome = ({ config, previousState, isNewConversation, eventTime }) => {
  if (!config?.enabled) return false;

  const lastCustomerMessageAt = toDate(previousState?.lastCustomerMessageAt);
  if (isNewConversation || !lastCustomerMessageAt) {
    return true;
  }

  const retriggerAfterHours = Number(config.retriggerAfterHours || 24);
  if (eventTime < addHours(lastCustomerMessageAt, retriggerAfterHours)) {
    return false;
  }

  const lastWelcomeSentAt = toDate(previousState?.welcome?.lastSentAt);
  if (lastWelcomeSentAt && eventTime < addHours(lastWelcomeSentAt, retriggerAfterHours)) {
    return false;
  }

  const welcomeCooldownMs = getCooldownWindowMs(config, 0);
  if (lastWelcomeSentAt && welcomeCooldownMs > 0 && eventTime < addMilliseconds(lastWelcomeSentAt, welcomeCooldownMs)) {
    return false;
  }

  return true;
};

const shouldSendOutOfOffice = ({ settings, config, previousState, isNewConversation, previousConversationStatus, eventTime }) => {
  if (!config?.enabled) return false;
  if (!settings?.workingHours?.enabled) return false;
  if (!isOutsideWorkingHours(settings.workingHours, eventTime)) return false;

  if (config.applyScope === "new_only" && !isNewConversation) {
    return false;
  }

  if (config.applyScope === "new_or_closed" && !isNewConversation && previousConversationStatus !== "closed") {
    return false;
  }

  const lastSentAt = toDate(previousState?.outOfOffice?.lastSentAt);
  const cooldownWindowMs = getCooldownWindowMs(config, OUT_OF_OFFICE_COOLDOWN_MINUTES);
  if (lastSentAt && cooldownWindowMs > 0 && eventTime < addMilliseconds(lastSentAt, cooldownWindowMs)) {
    return false;
  }

  return true;
};

const scheduleDelayedResponseWait = ({ config, previousState, nextState, inboundMessage }) => {
  if (!config?.enabled) {
    nextState.delayedResponse.waitingForTeamReply = false;
    nextState.delayedResponse.pendingSince = null;
    nextState.delayedResponse.dueAt = null;
    nextState.delayedResponse.pendingMessageId = null;
    return;
  }

  const previousDelayed = cloneAutomationState(previousState).delayedResponse;
  const alreadySentForCurrentWait =
    previousDelayed.waitingForTeamReply &&
    toIdString(previousDelayed.pendingMessageId) &&
    toIdString(previousDelayed.pendingMessageId) === toIdString(previousDelayed.lastSentForPendingMessageId);

  if (alreadySentForCurrentWait) {
    return;
  }

  const delayedCooldownMs = getCooldownWindowMs(config, 0);
  const lastDelayedSentAt = toDate(previousState?.delayedResponse?.lastSentAt);
  const eventTime = toDate(inboundMessage.timestamp) || new Date();

  if (lastDelayedSentAt && delayedCooldownMs > 0 && eventTime < addMilliseconds(lastDelayedSentAt, delayedCooldownMs)) {
    nextState.delayedResponse.waitingForTeamReply = false;
    nextState.delayedResponse.pendingSince = null;
    nextState.delayedResponse.dueAt = null;
    nextState.delayedResponse.pendingMessageId = null;
    nextState.delayedResponse.cancelledAt = eventTime;
    return;
  }

  nextState.delayedResponse.pendingSince = eventTime;
  nextState.delayedResponse.dueAt = addMinutes(
    eventTime,
    Number(config.delayMinutes || 15)
  );
  nextState.delayedResponse.pendingMessageId = inboundMessage._id;
  nextState.delayedResponse.waitingForTeamReply = true;
  nextState.delayedResponse.cancelledAt = null;
  nextState.delayedResponse.resolvedAt = null;
};

const handleInboundAutomationEvent = async ({
  app,
  conversation,
  contact,
  inboundMessage,
  isNewConversation,
  previousConversationStatus,
  previousAutomationState,
  dispatchAutomationMessage,
}) => {
  const settings = await getBasicAutomationSettings();
  const previousState = cloneAutomationState(previousAutomationState);
  const nextState = cloneAutomationState(toObject(conversation.automationState));
  const eventTime = toDate(inboundMessage.timestamp) || new Date();

  nextState.lastCustomerMessageAt = eventTime;
  nextState.lastCustomerMessageId = inboundMessage._id;

  scheduleDelayedResponseWait({
    config: settings.automations.delayedResponse,
    previousState,
    nextState,
    inboundMessage,
  });

  conversation.automationState = nextState;
  await conversation.save();

  if (
    shouldSendWelcome({
      config: settings.automations.welcome,
      previousState,
      isNewConversation,
      eventTime,
    })
  ) {
    const result = await sendAutomationMessage({
      app,
      conversation,
      contact,
      automationKey: "welcome",
      config: settings.automations.welcome,
      dispatchAutomationMessage,
    });

    if (result.status === "sent" && result.savedMessage) {
      await markWelcomeSent(conversation._id, result.savedMessage);
    }
  }

  if (
    shouldSendOutOfOffice({
      settings,
      config: settings.automations.outOfOffice,
      previousState,
      isNewConversation,
      previousConversationStatus,
      eventTime,
    })
  ) {
    const result = await sendAutomationMessage({
      app,
      conversation,
      contact,
      automationKey: "outOfOffice",
      config: settings.automations.outOfOffice,
      dispatchAutomationMessage,
    });

    if (result.status === "sent" && result.savedMessage) {
      await markOutOfOfficeSent(conversation._id, result.savedMessage);
    }
  }
};

const processDueDelayedResponseAutomations = async ({ app, dispatchAutomationMessage, limit = MAX_DELAYED_RESPONSE_BATCH } = {}) => {
  const settings = await getBasicAutomationSettings();
  if (!settings.automations?.delayedResponse?.enabled) {
    return { processed: 0, sent: 0, skipped: 0 };
  }

  const now = new Date();
  const conversations = await WhatsAppConversation.find({
    channel: "whatsapp",
    "automationState.delayedResponse.waitingForTeamReply": true,
    "automationState.delayedResponse.dueAt": { $lte: now },
  })
    .populate("contactId", "name phone waId profile lastActivityAt")
    .sort({ "automationState.delayedResponse.dueAt": 1 })
    .limit(limit);

  let sent = 0;
  let skipped = 0;

  for (const conversation of conversations) {
    const state = cloneAutomationState(toObject(conversation.automationState));
    const delayedState = state.delayedResponse;
    const pendingSince = toDate(delayedState.pendingSince);
    const lastTeamReplyAt = toDate(state.lastTeamReplyAt);

    if (!delayedState.waitingForTeamReply || !delayedState.pendingMessageId) {
      skipped += 1;
      continue;
    }

    if (
      toIdString(delayedState.pendingMessageId) &&
      toIdString(delayedState.pendingMessageId) === toIdString(delayedState.lastSentForPendingMessageId)
    ) {
      skipped += 1;
      continue;
    }

    if (lastTeamReplyAt && pendingSince && lastTeamReplyAt >= pendingSince) {
      await updateConversationAutomationState(conversation._id, (nextState) => {
        nextState.delayedResponse.waitingForTeamReply = false;
        nextState.delayedResponse.pendingSince = null;
        nextState.delayedResponse.dueAt = null;
        nextState.delayedResponse.pendingMessageId = null;
        nextState.delayedResponse.resolvedAt = new Date();
      });
      skipped += 1;
      continue;
    }

    const contact =
      conversation.contactId && typeof conversation.contactId === "object" && conversation.contactId.phone
        ? conversation.contactId
        : await WhatsAppContact.findById(conversation.contactId);

    if (!contact?.phone) {
      console.warn(`[WhatsAppAutomation] Skipping delayed response for conversation ${conversation._id}: contact phone missing.`);
      await finalizeDelayedResponseWait(conversation._id, delayedState.pendingMessageId, "missing_contact");
      skipped += 1;
      continue;
    }

    const result = await sendAutomationMessage({
      app,
      conversation,
      contact,
      automationKey: "delayedResponse",
      config: settings.automations.delayedResponse,
      dispatchAutomationMessage,
    });

    if (result.status === "sent" && result.savedMessage) {
      await markDelayedResponseSent(conversation._id, result.savedMessage, delayedState.pendingMessageId);
      sent += 1;
      continue;
    }

    await finalizeDelayedResponseWait(conversation._id, delayedState.pendingMessageId, "skipped");
    skipped += 1;
  }

  return {
    processed: conversations.length,
    sent,
    skipped,
  };
};

module.exports = {
  buildAutomationSendPlan,
  handleInboundAutomationEvent,
  processDueDelayedResponseAutomations,
  sendBasicAutomationTestMessage,
};

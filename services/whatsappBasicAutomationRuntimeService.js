const { randomUUID } = require("crypto");
const { Types } = require("mongoose");
const RecruitmentChannel = require("../models/RecruitmentChannel");
const WhatsAppForm = require("../models/WhatsAppForm");
const WhatsAppBasicAutomationSettings = require("../models/WhatsAppBasicAutomationSettings");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppContact = require("../models/WhatsAppContact");
const WhatsAppMessage = require("../models/WhatsAppMessage");
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
    return {
      status: "unsupported",
      supported: false,
      resource: null,
      reason: "Interactive list actions are not backed by a live data source or send pipeline yet",
    };
  }

  if (config.replyActionType === "product_collection") {
    return {
      status: "unsupported",
      supported: false,
      resource: null,
      reason: "Product collection actions are not backed by a live data source or send pipeline yet",
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

  if (trimString(resource.providerFlowFirstScreenId)) {
    flowActionPayload.screen = trimString(resource.providerFlowFirstScreenId);
  }

  return {
    type: "flow",
    body: trimString(text) ? { text: trimString(text) } : undefined,
    action: {
      parameters: {
        flow_message_version: "3",
        flow_token: `bwcrm-${automationKey}-${randomUUID()}`,
        ...(trimString(resource.providerFlowMode || "published") === "draft"
          ? { flow_name: trimString(resource.providerFlowName), mode: "draft" }
          : { flow_id: trimString(resource.providerFlowId), mode: "published" }),
        flow_cta: trimString(config?.actionButtonText),
        flow_action: "navigate",
        ...(Object.keys(flowActionPayload).length ? { flow_action_payload: flowActionPayload } : {}),
      },
    },
  };
};

const buildAutomationSendPlan = async ({ automationKey, config }) => {
  const text = trimString(config?.message || "");
  const replyActionResult = await validateReplyActionResource(automationKey, config);
  const templateResult = await resolveApprovedTemplate(automationKey, config);
  const interactivePayload = buildWhatsAppFormInteractivePayload({
    automationKey,
    config,
    replyActionResult,
    text,
  });
  const canSendTemplate =
    trimString(config?.templateMode || "custom") === "approved_template"
    && templateResult?.supported
    && templateResult?.template;
  const canSendInteractiveForm =
    trimString(config?.templateMode || "custom") !== "approved_template"
    && config?.replyActionType === "whatsapp_form"
    && Boolean(interactivePayload);
  const deliveredType = canSendTemplate ? "template" : canSendInteractiveForm ? "interactive" : "text";
  const notes = [];

  if (templateResult?.reason) {
    notes.push(templateResult.reason);
  } else if (deliveredType === "template") {
    notes.push("Approved template prepared successfully");
  }

  if (replyActionResult?.reason) {
    notes.push(replyActionResult.reason);
  }

  if (canSendInteractiveForm) {
    notes.push("WhatsApp form action will be delivered via Meta interactive flow message");
  }

  if (
    trimString(config?.templateMode || "custom") === "approved_template"
    && config?.replyActionType === "whatsapp_form"
    && replyActionResult?.supported
  ) {
    notes.push("WhatsApp form actions cannot be attached to approved template sends in the current automation config; template delivery will continue without the form action");
  }

  if (!canSendTemplate && !canSendInteractiveForm && !text) {
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
    text,
    template: canSendTemplate ? templateResult.template : null,
    interactive: canSendInteractiveForm ? interactivePayload : null,
    content: canSendTemplate
      ? `Template: ${templateResult.resource?.name || config?.templateName || automationKey}`
      : canSendInteractiveForm
        ? text || `[interactive:${config?.actionButtonText || "form"}]`
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

  const savedMessage = await dispatchAutomationMessage({
    app,
    conversation,
    contact,
    automationKey,
    messageType: plan.deliveredType,
    text: plan.text,
    template: plan.template,
    interactive: plan.interactive,
    content: plan.content,
    deliveryMeta: plan.deliveryMeta,
  });

  if (!savedMessage) {
    return { status: "skipped", savedMessage: null };
  }

  return {
    status: "sent",
    savedMessage,
    replyActionResult: plan.replyActionResult,
    templateResult: plan.templateResult,
    deliveredType: plan.deliveredType,
    notes: plan.notes,
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

  const baseContext = {
    source: "basic_automation_test_send",
    automationKey,
    isTestSend: true,
    actorId: actorId || null,
  };

  try {
    sendResult = await sendMessage({
      to: normalizedPhoneNumber,
      type: deliveredType,
      text: deliveredType === "text" ? plan.text : undefined,
      template: deliveredType === "template" ? plan.template : undefined,
      interactive: deliveredType === "interactive" ? plan.interactive : undefined,
      context: baseContext,
    });
  } catch (error) {
    if (["template", "interactive"].includes(deliveredType) && plan.text) {
      notes.push(`${deliveredType === "template" ? "Template" : "Interactive form"} send failed: ${error.message}`);
      notes.push(`Sent plain text fallback instead${deliveredType === "interactive" ? " without the form action" : ""}`);
      deliveredType = "text";
      fallbackUsed = true;
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
    replyActionDelivered: Boolean(plan.deliveryMeta?.replyActionDelivered),
    replyActionFallbackUsed: Boolean(plan.deliveryMeta?.replyActionFallbackUsed || (config.replyActionType === "whatsapp_form" && deliveredType !== "interactive")),
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

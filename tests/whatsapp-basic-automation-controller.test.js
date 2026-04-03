const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
  send(payload) {
    this.body = payload;
    return this;
  },
  redirect(payload) {
    this.body = payload;
    return this;
  },
  setHeader() {
    return this;
  },
});

const buildSettings = () => ({
  workingHours: {
    enabled: true,
    days: ["Mon", "Tue", "Wed"],
    startTime: "09:00",
    endTime: "17:00",
    timezone: "Asia/Colombo",
  },
  automations: {
    outOfOffice: {
      enabled: true,
      message: "We are offline.",
      sentCount: 2,
      templateMode: "custom",
      applyScope: "new_or_closed",
      templateId: "",
      templateName: "",
      templateLanguage: "",
      templateCategory: "",
      cooldownEnabled: false,
      cooldownValue: 30,
      cooldownUnit: "minutes",
      replyActionType: "none",
      actionButtonText: "",
      formId: "",
      formName: "",
      formOpenMode: "navigate_first_screen",
      interactiveListId: "",
      interactiveListName: "",
      interactiveListDescription: "",
      interactiveListSections: [],
      interactiveListSectionCount: 0,
      interactiveListRowCount: 0,
      productCollectionId: "",
      productCollectionName: "",
    },
    welcome: {
      enabled: true,
      message: "Welcome to Blue Whale.",
      sentCount: 5,
      retriggerAfterHours: 24,
      templateMode: "custom",
      templateId: "",
      templateName: "",
      templateLanguage: "",
      templateCategory: "",
      cooldownEnabled: true,
      cooldownValue: 2,
      cooldownUnit: "hours",
      replyActionType: "interactive_list",
      actionButtonText: "Start here",
      formId: "",
      formName: "",
      formOpenMode: "navigate_first_screen",
      interactiveListId: "list_1",
      interactiveListName: "Welcome Options",
      interactiveListDescription: "Pick a path",
      interactiveListSections: [
        {
          title: "Main",
          rows: [{ id: "row_1", title: "Visa Help", description: "Start here" }],
        },
      ],
      interactiveListSectionCount: 1,
      interactiveListRowCount: 1,
      productCollectionId: "",
      productCollectionName: "",
    },
    delayedResponse: {
      enabled: false,
      message: "We will respond soon.",
      sentCount: 0,
      delayMinutes: 15,
      templateMode: "custom",
      templateId: "",
      templateName: "",
      templateLanguage: "",
      templateCategory: "",
      cooldownEnabled: false,
      cooldownValue: 30,
      cooldownUnit: "minutes",
      replyActionType: "none",
      actionButtonText: "",
      formId: "",
      formName: "",
      formOpenMode: "navigate_first_screen",
      interactiveListId: "",
      interactiveListName: "",
      interactiveListDescription: "",
      interactiveListSections: [],
      interactiveListSectionCount: 0,
      interactiveListRowCount: 0,
      productCollectionId: "",
      productCollectionName: "",
    },
  },
  createdBy: null,
  updatedBy: { _id: "admin_1", name: "Ava Admin", email: "ava@example.com" },
  createdAt: new Date("2026-04-03T08:00:00.000Z"),
  updatedAt: new Date("2026-04-03T09:00:00.000Z"),
});

const buildController = ({ settings, preview, history, testSendResult, onWelcomeUpdate } = {}) => {
  const resolvedSettings = settings || buildSettings();
  const resolvedPreview = preview || {
    mode: "custom",
    phoneNumber: "+94770000000",
    message: "Welcome to Blue Whale.",
    template: null,
    replyAction: null,
    runtimeNotes: ["Custom text mode is selected"],
  };
  const resolvedHistory = history || {
    items: [],
    summary: {
      lastTriggeredAt: null,
      lastSentCount: 0,
      lastUpdatedAt: null,
      lastUpdatedBy: null,
    },
  };
  const resolvedTestSendResult = testSendResult || {
    sent: true,
    type: "welcome",
    phoneNumber: "+94770000000",
    modeUsed: "text",
    fallbackUsed: false,
    replyActionUsed: "none",
    replyActionDelivered: false,
    replyActionFallbackUsed: false,
    messageId: "wamid.default",
    template: null,
    notes: ["Sent successfully"],
  };

  return loadWithMocks(path.resolve(__dirname, "../controllers/whatsappController.js"), {
    "../models/AdminUser": {},
    "../models/Lead": {},
    "../models/WhatsAppEventLog": { create: async () => ({ save: async () => {} }) },
    "../models/WhatsAppConversation": { findById: async () => null },
    "../models/WhatsAppContact": { findById: async () => null },
    "../models/WhatsAppMessage": { findById: async () => null, updateOne: async () => ({}) },
    "../services/whatsappAssignmentService": { getAvailableAgents: async () => [] },
    "../services/whatsappBasicAutomationRuntimeService": {
      sendBasicAutomationTestMessage: async () => resolvedTestSendResult,
    },
    "../services/whatsappCRMService": {
      saveInboundMessage: async () => ({}),
      saveOutgoingMessage: async () => ({}),
      updateMessageStatusFromWebhook: async () => ({}),
      listConversations: async () => [],
      listMessages: async () => [],
      assignConversation: async () => ({}),
      updateConversationStatus: async () => ({}),
      addConversationNote: async () => ({}),
      replaceConversationTags: async () => ({}),
      linkConversationLead: async () => ({}),
      emitConversationEvents: async () => ({}),
      ensureConversation: async () => ({}),
      getConversationById: async () => ({}),
      upsertContact: async () => ({}),
    },
    "../services/whatsappService": {
      sendMessage: async () => ({}),
      downloadMedia: async () => ({ buffer: Buffer.alloc(0), contentType: "application/octet-stream" }),
      cacheInboundMedia: async () => ({}),
      SUPPORTED_MEDIA_TYPES: [],
    },
    "../services/whatsappQuickReplyService": {
      listQuickReplies: async () => ({ items: [], pagination: {}, filters: {} }),
      listQuickReplyFolders: async () => [],
      listQuickReplySuggestions: async () => [],
      getQuickReplyById: async () => null,
      createQuickReply: async () => ({}),
      updateQuickReply: async () => ({}),
      deleteQuickReply: async () => ({}),
      toggleQuickReply: async () => ({}),
      toggleQuickReplyPin: async () => ({}),
      markQuickReplyUsed: async () => ({}),
    },
    "../services/whatsappFormService": {
      listWhatsAppForms: async () => ({ items: [], pagination: {}, filters: {} }),
      getWhatsAppFormById: async () => null,
      createWhatsAppForm: async () => ({}),
      updateWhatsAppForm: async () => ({}),
      deleteWhatsAppForm: async () => ({}),
      toggleWhatsAppForm: async () => ({}),
    },
    "../services/whatsappBasicAutomationService": {
      getBasicAutomationSettings: async () => resolvedSettings,
      updateWorkingHours: async () => resolvedSettings,
      updateOutOfOfficeAutomation: async () => resolvedSettings,
      updateWelcomeAutomation: async (payload, actorId) => {
        if (typeof onWelcomeUpdate === "function") {
          onWelcomeUpdate(payload, actorId);
        }
        return resolvedSettings;
      },
      updateDelayedResponseAutomation: async () => resolvedSettings,
      listAvailableBasicAutomationForms: async () => [],
      listAvailableBasicAutomationInteractiveLists: async () => [],
      listAvailableBasicAutomationProductCollections: async () => [],
      listAvailableBasicAutomationTemplates: async () => [],
      listBasicAutomationHistory: async () => resolvedHistory,
      previewBasicAutomation: async () => resolvedPreview,
    },
    "../services/whatsappInteractiveListService": {
      listInteractiveLists: async () => ({ items: [], pagination: {}, filters: {} }),
    },
    "../services/whatsappProductCollectionService": {
      listProductCollections: async () => ({ items: [], pagination: {}, filters: {} }),
    },
    "../services/whatsappTemplateService": {
      listTemplates: async () => ({ items: [], pagination: {}, filters: {} }),
      syncTemplatesFromMeta: async () => [],
      createTemplate: async () => ({ id: "template_1" }),
      updateTemplate: async () => ({ id: "template_1" }),
      deleteTemplate: async () => ({}),
      getTemplateById: async () => null,
      getTemplateHistory: async () => [],
      uploadTemplateHeaderMedia: async () => ({}),
      saveTemplateDefaultMedia: async () => ({}),
      removeTemplateDefaultMedia: async () => ({}),
      uploadDefaultHeaderMedia: async () => ({}),
      prepareTemplateMessage: async () => ({ name: "template_1" }),
    },
    "../services/whatsappWebhookService": {
      verifyMetaSignature: () => true,
      parseWebhookPayload: () => ({ inboundMessages: [], statusEvents: [] }),
      normalizePhone: (value) => value,
    },
    "../utils/salesScope": {
      SALES_ROLES: [],
      buildOwnedFilter: () => ({}),
    },
  });
};

module.exports = async () => {
  const settings = buildSettings();
  let updateCall = null;
  const preview = {
    mode: "approved_template",
    phoneNumber: "+94770000000",
    message: "",
    template: {
      id: "template_123",
      name: "welcome_template",
      language: "en",
      category: "marketing",
    },
    replyAction: {
      type: "none",
      actionButtonText: "",
    },
    runtimeNotes: ["Approved template delivery is runtime-supported"],
    replyActionDelivered: false,
  };
  const history = {
    items: [
      {
        id: "msg_1",
        type: "welcome",
        triggeredAt: new Date("2026-04-03T10:00:00.000Z"),
        conversationId: "conv_1",
        recipient: {
          name: "Jane",
          phone: "+94771234567",
        },
        outcome: "sent",
        fallbackUsed: false,
        sentCountSnapshot: 5,
      },
    ],
    summary: {
      lastTriggeredAt: new Date("2026-04-03T10:00:00.000Z"),
      lastSentCount: 5,
      lastUpdatedAt: new Date("2026-04-03T09:00:00.000Z"),
      lastUpdatedBy: { _id: "admin_1", name: "Ava Admin", email: "ava@example.com" },
    },
  };
  const testSendResult = {
    sent: true,
    type: "welcome",
    phoneNumber: "+94770000000",
    modeUsed: "template",
    fallbackUsed: false,
    replyActionUsed: "none",
    replyActionDelivered: false,
    replyActionFallbackUsed: false,
    messageId: "wamid.test.1",
    template: {
      id: "template_123",
      name: "welcome_template",
      language: "en",
    },
    notes: ["Template sent successfully"],
  };

  const controller = buildController({
    settings,
    preview,
    history,
    testSendResult,
    onWelcomeUpdate: (payload, actorId) => {
      updateCall = { payload, actorId };
    },
  });

  const getRes = createResponse();
  await controller.getWhatsAppBasicAutomations({}, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.success, true);
  assert.deepEqual(getRes.body.data, settings);
  assert.deepEqual(getRes.body.workingHours, settings.workingHours);
  assert.deepEqual(getRes.body.automations.welcome, settings.automations.welcome);

  const updateRes = createResponse();
  const welcomePayload = {
    enabled: true,
    message: "Hello there",
    retriggerAfterHours: 24,
    templateMode: "custom",
    replyActionType: "none",
  };
  await controller.updateWhatsAppWelcomeAutomation(
    {
      body: welcomePayload,
      admin: { _id: "admin_42" },
    },
    updateRes
  );
  assert.equal(updateRes.statusCode, 200);
  assert.deepEqual(updateCall, { payload: welcomePayload, actorId: "admin_42" });
  assert.equal(updateRes.body.success, true);
  assert.deepEqual(updateRes.body.data, settings);
  assert.equal(updateRes.body.automations.welcome.message, settings.automations.welcome.message);

  const previewRes = createResponse();
  await controller.testWhatsAppBasicAutomation(
    {
      body: {
        type: "welcome",
        phoneNumber: "+94770000000",
        settingsOverride: welcomePayload,
      },
    },
    previewRes
  );
  assert.equal(previewRes.statusCode, 200);
  assert.equal(previewRes.body.success, true);
  assert.equal(previewRes.body.mode, "approved_template");
  assert.equal(previewRes.body.phoneNumber, "+94770000000");
  assert.equal(previewRes.body.replyAction, null);
  assert.deepEqual(previewRes.body.data, preview);

  const sendRes = createResponse();
  await controller.testSendWhatsAppBasicAutomation(
    {
      body: {
        type: "welcome",
        phoneNumber: "+94770000000",
        settingsOverride: welcomePayload,
      },
      admin: { _id: "admin_42" },
    },
    sendRes
  );
  assert.equal(sendRes.statusCode, 200);
  assert.equal(sendRes.body.success, true);
  assert.equal(sendRes.body.sent, true);
  assert.equal(sendRes.body.modeUsed, "template");
  assert.equal(sendRes.body.messageId, "wamid.test.1");
  assert.deepEqual(sendRes.body.data, testSendResult);

  const historyRes = createResponse();
  await controller.getWhatsAppBasicAutomationHistory(
    {
      query: {
        type: "welcome",
        limit: "10",
      },
    },
    historyRes
  );
  assert.equal(historyRes.statusCode, 200);
  assert.equal(historyRes.body.success, true);
  assert.equal(historyRes.body.items.length, 1);
  assert.deepEqual(historyRes.body.data, history);
  assert.deepEqual(historyRes.body.items[0], {
    id: "msg_1",
    type: "welcome",
    triggeredAt: "2026-04-03T10:00:00.000Z",
    conversationId: "conv_1",
    recipient: "+94771234567",
    outcome: "sent",
    fallbackUsed: false,
    sentCountSnapshot: 5,
  });
  assert.deepEqual(historyRes.body.summary, {
    lastTriggeredAt: "2026-04-03T10:00:00.000Z",
    lastSentCount: 5,
    lastUpdatedAt: "2026-04-03T09:00:00.000Z",
    lastUpdatedBy: { _id: "admin_1", name: "Ava Admin", email: "ava@example.com" },
  });
};

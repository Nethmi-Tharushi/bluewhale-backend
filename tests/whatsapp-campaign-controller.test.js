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

const loadController = (campaignServiceOverrides = {}) =>
  loadWithMocks(path.resolve(__dirname, "../controllers/whatsappController.js"), {
    "../models/AdminUser": {},
    "../models/Lead": {},
    "../models/WhatsAppEventLog": { create: async () => ({ save: async () => {} }) },
    "../models/WhatsAppConversation": { findById: async () => null },
    "../models/WhatsAppContact": { findById: async () => null },
    "../models/WhatsAppMessage": { findById: async () => null, updateOne: async () => ({}) },
    "../services/whatsappAssignmentService": {
      getAvailableAgents: async () => [],
      getAssignmentSettings: async () => ({}),
      updateAssignmentSettings: async () => ({}),
    },
    "../services/whatsappBasicAutomationRuntimeService": {
      sendBasicAutomationTestMessage: async () => ({}),
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
    "../services/whatsappCampaignService": {
      listWhatsAppCampaigns: async () => [],
      listWhatsAppCampaignAudienceResources: async () => ({ contacts: [], segments: [], summary: {} }),
      listWhatsAppCampaignAudienceContacts: async () => ({ items: [] }),
      getWhatsAppCampaignById: async () => null,
      createWhatsAppCampaign: async () => ({}),
      updateWhatsAppCampaign: async () => ({}),
      testSendWhatsAppCampaign: async () => ({}),
      launchWhatsAppCampaign: async () => ({}),
      pauseWhatsAppCampaign: async () => ({}),
      resumeWhatsAppCampaign: async () => ({}),
      cancelWhatsAppCampaign: async () => ({}),
      deleteWhatsAppCampaign: async () => ({ success: true }),
      ...campaignServiceOverrides,
    },
    "../services/whatsappBasicAutomationService": {
      getBasicAutomationSettings: async () => ({}),
      updateWorkingHours: async () => ({}),
      updateOutOfOfficeAutomation: async () => ({}),
      updateWelcomeAutomation: async () => ({}),
      updateDelayedResponseAutomation: async () => ({}),
      listAvailableBasicAutomationForms: async () => [],
      listAvailableBasicAutomationInteractiveLists: async () => [],
      listAvailableBasicAutomationProductCollections: async () => [],
      listAvailableBasicAutomationTemplates: async () => [],
      listBasicAutomationHistory: async () => ({ items: [], summary: {} }),
      previewBasicAutomation: async () => ({}),
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

module.exports = async () => {
  const campaign = {
    id: "507f1f77bcf86cd799439011",
    name: "Campaign One",
    type: "Promotional",
    channel: "WhatsApp",
    status: "Draft",
    audienceType: "manual",
    audienceSize: 10,
    segmentIds: [],
    manualContactIds: ["contact_1"],
    templateId: "",
    templateName: "",
    contentMode: "compose",
    contentLabel: "Campaign One",
    messageTitle: "",
    headerText: "",
    bodyText: "Hello",
    ctaText: "",
    ctaUrl: "",
    quickReplies: [],
    templateVariables: {},
    scheduleType: "draft",
    scheduledAt: null,
    timezone: "Asia/Colombo",
    notes: "",
    batchEnabled: false,
    skipInactiveContacts: false,
    stopIfTemplateMissing: false,
    stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 },
    createdBy: null,
    createdAt: "2026-04-03T10:00:00.000Z",
    updatedAt: "2026-04-03T10:00:00.000Z",
  };

  const controller = loadController({
    listWhatsAppCampaigns: async () => [campaign],
    listWhatsAppCampaignAudienceResources: async () => ({
      contacts: [
        {
          id: "contact_1",
          name: "Alice",
          phone: "+94770000000",
          source: "WhatsApp",
          tag: "VIP",
          optedIn: true,
        },
      ],
      segments: [
        {
          id: "vip",
          name: "VIP",
          description: "WhatsApp conversations tagged with VIP",
          audienceSize: 1,
        },
      ],
      summary: {
        totalContacts: 1,
        optedInContacts: 1,
        totalTags: 1,
      },
    }),
    listWhatsAppCampaignAudienceContacts: async () => ({
      items: [
        {
          id: "contact_1",
          name: "Alice",
          phone: "+94770000000",
          source: "WhatsApp",
          tag: "VIP",
          optedIn: true,
        },
      ],
    }),
    getWhatsAppCampaignById: async () => campaign,
    createWhatsAppCampaign: async () => campaign,
    updateWhatsAppCampaign: async () => ({ ...campaign, status: "Scheduled" }),
    testSendWhatsAppCampaign: async () => ({
      campaignId: campaign.id,
      phoneNumber: "+94770000000",
      note: "Compose campaign test message sent successfully. Campaign analytics were not changed.",
      previewMode: false,
      sent: true,
      modeUsed: "text",
      messageId: "wamid.campaign.123",
    }),
    launchWhatsAppCampaign: async () => ({ ...campaign, status: "Running" }),
    pauseWhatsAppCampaign: async () => ({ ...campaign, status: "Paused" }),
    resumeWhatsAppCampaign: async () => ({ ...campaign, status: "Running" }),
    cancelWhatsAppCampaign: async () => ({ ...campaign, status: "Cancelled" }),
    deleteWhatsAppCampaign: async () => ({ success: true }),
  });

  const listRes = createResponse();
  await controller.getWhatsAppCampaigns({ query: {} }, listRes);
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.success, true);
  assert.equal(listRes.body.data.length, 1);

  const csvRes = createResponse();
  await controller.getWhatsAppCampaigns({ query: { format: "csv" } }, csvRes);
  assert.equal(csvRes.statusCode, 200);
  assert.match(csvRes.body, /id,name,type,channel,status/);
  assert.match(csvRes.body, /Campaign One/);

  const audienceResourcesRes = createResponse();
  await controller.getWhatsAppCampaignAudienceResources({}, audienceResourcesRes);
  assert.equal(audienceResourcesRes.statusCode, 200);
  assert.equal(audienceResourcesRes.body.success, true);
  assert.equal(audienceResourcesRes.body.data.summary.totalContacts, 1);

  const audienceContactsRes = createResponse();
  await controller.getWhatsAppCampaignAudienceContacts({ query: { search: "ali" } }, audienceContactsRes);
  assert.equal(audienceContactsRes.statusCode, 200);
  assert.equal(audienceContactsRes.body.success, true);
  assert.equal(audienceContactsRes.body.data.items.length, 1);

  const getRes = createResponse();
  await controller.getWhatsAppCampaign({ params: { id: campaign.id } }, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.data.id, campaign.id);

  const createRes = createResponse();
  await controller.createWhatsAppCampaignRecord(
    {
      body: {
        name: "Campaign One",
        type: "Promotional",
        channel: "WhatsApp",
        audienceType: "manual",
        contentMode: "compose",
        bodyText: "Hello",
      },
      admin: { _id: "admin_1" },
    },
    createRes
  );
  assert.equal(createRes.statusCode, 201);
  assert.equal(createRes.body.success, true);

  const updateRes = createResponse();
  await controller.updateWhatsAppCampaignRecord(
    {
      params: { id: campaign.id },
      body: { scheduleType: "later", scheduledAt: "2026-05-01T10:00:00.000Z" },
      admin: { _id: "admin_1" },
    },
    updateRes
  );
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.data.status, "Scheduled");

  const testRes = createResponse();
  await controller.testSendWhatsAppCampaignRecord(
    {
      params: { id: campaign.id },
      body: { phoneNumber: "+94770000000" },
    },
    testRes
  );
  assert.equal(testRes.statusCode, 200);
  assert.equal(testRes.body.data.previewMode, false);
  assert.equal(testRes.body.data.sent, true);
  assert.equal(testRes.body.data.modeUsed, "text");

  const launchRes = createResponse();
  await controller.launchWhatsAppCampaignRecord(
    {
      params: { id: campaign.id },
      admin: { _id: "admin_1" },
    },
    launchRes
  );
  assert.equal(launchRes.body.data.status, "Running");

  const pauseRes = createResponse();
  await controller.pauseWhatsAppCampaignRecord(
    {
      params: { id: campaign.id },
      admin: { _id: "admin_1" },
    },
    pauseRes
  );
  assert.equal(pauseRes.body.data.status, "Paused");

  const resumeRes = createResponse();
  await controller.resumeWhatsAppCampaignRecord(
    {
      params: { id: campaign.id },
      admin: { _id: "admin_1" },
    },
    resumeRes
  );
  assert.equal(resumeRes.body.data.status, "Running");

  const cancelRes = createResponse();
  await controller.cancelWhatsAppCampaignRecord(
    {
      params: { id: campaign.id },
      admin: { _id: "admin_1" },
    },
    cancelRes
  );
  assert.equal(cancelRes.body.data.status, "Cancelled");

  const deleteRes = createResponse();
  await controller.deleteWhatsAppCampaignRecord(
    {
      params: { id: campaign.id },
    },
    deleteRes
  );
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.body.success, true);
  assert.match(deleteRes.body.message, /deleted successfully/i);
};

const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const createQuery = (value) => ({
  select() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

module.exports = async () => {
  process.env.CLOUDINARY_NAME = process.env.CLOUDINARY_NAME || "test-cloud";
  process.env.CLOUDINARY_KEY = process.env.CLOUDINARY_KEY || "test-key";
  process.env.CLOUDINARY_SECRET = process.env.CLOUDINARY_SECRET || "test-secret";

  let aiAgentCalls = 0;
  let aiIntentCalls = 0;
  const aiIntentModulePath = require.resolve(path.resolve(__dirname, "../services/whatsappAiIntentMatchingService.js"));
  const aiAgentModulePath = require.resolve(path.resolve(__dirname, "../services/whatsappAiAgentService.js"));

  require.cache[aiIntentModulePath] = {
    id: aiIntentModulePath,
    filename: aiIntentModulePath,
    loaded: true,
    exports: {
      processInboundAiIntentMatch: async () => {
        aiIntentCalls += 1;
        return { status: "no_match" };
      },
    },
  };
  require.cache[aiAgentModulePath] = {
    id: aiAgentModulePath,
    filename: aiAgentModulePath,
    loaded: true,
    exports: {
      processInboundWhatsAppAiAgent: async ({ aiIntentMatched }) => {
        aiAgentCalls += 1;
        assert.equal(aiIntentMatched, false);
        return { status: "preview" };
      },
    },
  };

  const contact = {
    _id: "507f1f77bcf86cd799439011",
    phone: "+15550001",
    normalizedPhone: "+15550001",
    waId: "+15550001",
    name: "Test User",
    profile: {},
    source: "WhatsApp",
    async save() {
      return this;
    },
    async updateOne() {
      return {};
    },
  };

  const conversation = {
    _id: "507f1f77bcf86cd799439012",
    contactId: "507f1f77bcf86cd799439011",
    channel: "whatsapp",
    status: "open",
    unreadCount: 0,
    assignmentHistory: [],
    automationState: {},
    agentId: null,
    workflowContext: {},
    async save() {
      return this;
    },
  };

  const inboundMessageRecord = {
    _id: "507f1f77bcf86cd799439013",
    externalMessageId: "wamid.1",
    timestamp: new Date("2026-04-09T10:00:00.000Z"),
    content: "Need help",
    type: "text",
    direction: "inbound",
  };

  const service = loadWithMocks(path.resolve(__dirname, "../services/whatsappCRMService.js"), {
    "../models/AdminUser": {},
    "../models/WhatsAppContact": {
      findOne: async () => contact,
      create: async () => contact,
    },
    "../models/WhatsAppConversation": {
      findOne: () => createQuery(null),
      create: async () => conversation,
    },
    "../models/WhatsAppMessage": {
      findOne: async ({ externalMessageId }) => (externalMessageId === "wamid.duplicate" ? { _id: "message_existing", externalMessageId } : null),
      findOneAndUpdate: async () => inboundMessageRecord,
      countDocuments: async () => 1,
    },
    "./whatsappAssignmentService": {
      pickNextAgentRoundRobin: async () => null,
    },
    "./whatsappWebhookService": {
      normalizePhone: (value) => value,
    },
    "./whatsappService": {
      cacheInboundMedia: async () => ({}),
      sendMessage: async () => ({ payload: {}, response: { messages: [{ id: "wamid.outbound" }] } }),
    },
    "./whatsappAutomationService": {
      processInboundAutomationEvent: async () => [],
    },
    "./whatsappBasicAutomationRuntimeService": {
      handleInboundAutomationEvent: async () => [],
    },
  });

  await service.saveInboundMessage({
    app: { get: () => null },
    message: {
      phone: "+15550001",
      waId: "+15550001",
      name: "Test User",
      messageId: "wamid.1",
      timestamp: new Date("2026-04-09T10:00:00.000Z"),
      text: "Need help",
      type: "text",
    },
  });

  assert.equal(aiIntentCalls, 1);
  assert.equal(aiAgentCalls, 1);

  aiAgentCalls = 0;
  aiIntentCalls = 0;

  const duplicateResult = await service.saveInboundMessage({
    app: { get: () => null },
    message: {
      phone: "+15550001",
      waId: "+15550001",
      name: "Test User",
      messageId: "wamid.duplicate",
      timestamp: new Date("2026-04-09T10:00:00.000Z"),
      text: "Need help",
      type: "text",
    },
  });

  assert.equal(duplicateResult.duplicate, true);
  assert.equal(aiIntentCalls, 0);
  assert.equal(aiAgentCalls, 0);

  delete require.cache[aiIntentModulePath];
  delete require.cache[aiAgentModulePath];
};

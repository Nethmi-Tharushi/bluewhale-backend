const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

module.exports = async () => {
  process.env.CLOUDINARY_NAME = process.env.CLOUDINARY_NAME || "test-cloud";
  process.env.CLOUDINARY_KEY = process.env.CLOUDINARY_KEY || "test-key";
  process.env.CLOUDINARY_SECRET = process.env.CLOUDINARY_SECRET || "test-secret";

  let processAutomationCalls = 0;
  let basicAutomationCalls = 0;

  const existingMessage = {
    _id: "message_existing",
    externalMessageId: "wamid.duplicate",
  };
  const existingContact = {
    _id: "contact_1",
    phone: "+94770000000",
    normalizedPhone: "+94770000000",
    waId: "+94770000000",
    name: "Duplicate User",
    profile: {},
    source: "WhatsApp",
    save: async function save() {
      return this;
    },
  };
  const existingConversation = {
    _id: "conversation_1",
    contactId: "contact_1",
    channel: "whatsapp",
    status: "open",
    automationState: {},
  };

  const service = loadWithMocks(path.resolve(__dirname, "../services/whatsappCRMService.js"), {
    "../models/AdminUser": {},
    "../models/WhatsAppContact": {
      findOne: async () => existingContact,
      create: async () => existingContact,
    },
    "../models/WhatsAppConversation": {
      findOne: () => ({
        select() {
          return Promise.resolve(existingConversation);
        },
      }),
      create: async () => existingConversation,
    },
    "../models/WhatsAppMessage": {
      findOne: async ({ externalMessageId }) => (externalMessageId === "wamid.duplicate" ? existingMessage : null),
      findOneAndUpdate: async () => {
        throw new Error("findOneAndUpdate should not be called for duplicate inbound messages");
      },
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
      processInboundAutomationEvent: async () => {
        processAutomationCalls += 1;
        return [];
      },
    },
    "./whatsappBasicAutomationRuntimeService": {
      handleInboundAutomationEvent: async () => {
        basicAutomationCalls += 1;
        return [];
      },
    },
  });

  const result = await service.saveInboundMessage({
    app: { get: () => null },
    message: {
      phone: "+94770000000",
      waId: "+94770000000",
      name: "Duplicate User",
      messageId: "wamid.duplicate",
      timestamp: new Date("2026-04-09T10:00:00.000Z"),
      text: "where is my order",
      type: "text",
    },
  });

  assert.equal(result.duplicate, true);
  assert.equal(result.message, existingMessage);
  assert.equal(processAutomationCalls, 0);
  assert.equal(basicAutomationCalls, 0);
};

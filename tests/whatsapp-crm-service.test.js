const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const createQuery = (value) => ({
  populate() {
    return this;
  },
  lean: async () => value,
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

module.exports = async () => {
  const conversationDocument = {
    _id: "507f1f77bcf86cd799439020",
    contactId: { _id: "507f1f77bcf86cd799439021", name: "Nethmi", phone: "+94716276803", waId: "94716276803", profile: {} },
    agentId: { _id: "507f1f77bcf86cd799439022", name: "Agent", email: "agent@example.com", role: "SalesStaff" },
    linkedLeadId: null,
    status: "assigned",
    channel: "whatsapp",
    lastMessageAt: new Date("2026-04-10T09:54:52.000Z"),
    lastIncomingAt: new Date("2026-04-10T09:54:51.000Z"),
    lastOutgoingAt: new Date("2026-04-10T09:54:31.000Z"),
    lastMessagePreview: "Japan",
    unreadCount: 4,
    assignmentMethod: "manual",
    workflowStatus: "awaiting_reply",
    workflowContext: { step: "country" },
    tags: ["Students"],
    notes: [],
    assignmentHistory: [],
    automationState: {
      lastCustomerMessageAt: new Date("2026-04-10T09:54:51.000Z"),
      lastCustomerMessageId: "507f1f77bcf86cd799439023",
      lastTeamReplyAt: new Date("2026-04-10T09:54:31.000Z"),
      outOfOffice: { lastSentAt: new Date("2026-04-10T08:00:00.000Z"), lastSentMessageId: "message_1" },
      welcome: { lastSentAt: new Date("2026-04-10T08:00:00.000Z"), lastSentMessageId: "message_2" },
      delayedResponse: { waitingForTeamReply: true, pendingMessageId: "message_3" },
      aiAgent: {
        currentAgentType: "sales_agent",
        lastHandledMessageId: "507f1f77bcf86cd799439024",
        handoffTriggered: true,
        handoffReason: "Low confidence triggered human handoff",
        qualification: {
          capturedFields: { country: "Japan" },
          pendingField: "timeline",
        },
      },
    },
    async save() {
      this.saved = true;
      return this;
    },
  };

  let findByIdCallCount = 0;
  const service = loadWithMocks(path.resolve(__dirname, "../services/whatsappCRMService.js"), {
    "../models/AdminUser": {},
    "../models/WhatsAppContact": {},
    "../models/WhatsAppAiAgentLog": {
      deleteMany: async () => ({ deletedCount: 2 }),
    },
    "../models/WhatsAppConversation": {
      findById: (conversationId) => {
        findByIdCallCount += 1;
        if (findByIdCallCount === 1) {
          assert.equal(String(conversationId), "507f1f77bcf86cd799439020");
          return conversationDocument;
        }
        return createQuery({
          ...conversationDocument,
          _id: conversationDocument._id,
          contactId: conversationDocument.contactId,
          agentId: conversationDocument.agentId,
          linkedLeadId: null,
        });
      },
    },
    "../models/WhatsAppMessage": {
      deleteMany: async (filter) => {
        assert.equal(String(filter.conversationId), "507f1f77bcf86cd799439020");
        return { deletedCount: 5 };
      },
    },
    "./whatsappAssignmentService": {
      pickNextAgentRoundRobin: async () => null,
    },
    "./whatsappWebhookService": {
      normalizePhone: (value) => value,
    },
    "./whatsappService": {
      cacheInboundMedia: async () => ({}),
      sendMessage: async () => ({}),
    },
    "./whatsappAutomationService": {
      processInboundAutomationEvent: async () => [],
    },
    "./whatsappBasicAutomationRuntimeService": {
      handleInboundAutomationEvent: async () => [],
    },
  });

  const result = await service.resetConversationHistory({
    conversationId: "507f1f77bcf86cd799439020",
  });

  assert.equal(result.deletedMessagesCount, 5);
  assert.equal(result.deletedAiHistoryCount, 2);
  assert.equal(conversationDocument.lastMessagePreview, "");
  assert.equal(conversationDocument.unreadCount, 0);
  assert.equal(conversationDocument.workflowStatus, "");
  assert.equal(conversationDocument.workflowContext, null);
  assert.equal(conversationDocument.automationState.aiAgent.handoffTriggered, false);
  assert.deepEqual(conversationDocument.automationState.aiAgent.qualification.capturedFields, {});
  assert.equal(conversationDocument.saved, true);
  assert.equal(result.conversation._id, "507f1f77bcf86cd799439020");
};

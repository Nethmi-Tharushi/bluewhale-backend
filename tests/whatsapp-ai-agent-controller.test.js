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
});

module.exports = async () => {
  const overview = {
    enabled: false,
    rolloutStatus: "draft",
    defaultAgentType: "sales_agent",
    webinarUrl: "",
    interestFormEnabled: true,
    pricing: { currency: "USD", amount: 250, conversationQuota: 2000 },
    salesAgent: { enabled: false, catalogEnabled: true, handoffEnabled: true, fallbackMessage: "" },
    faqResponder: { enabled: false, knowledgeBaseEnabled: true, handoffEnabled: true, fallbackMessage: "" },
    leadQualifier: { enabled: false, qualificationFields: [], crmSyncTarget: "", handoffEnabled: true, fallbackMessage: "" },
    stats: {
      catalogItems: 0,
      knowledgeArticles: 0,
      workflows: 0,
      quickReplies: 0,
      forms: 0,
      recentAgentRuns: 0,
      interestSubmissions: 0,
    },
    updatedAt: null,
    updatedBy: null,
  };

  const controller = loadWithMocks(path.resolve(__dirname, "../controllers/whatsappAiAgentController.js"), {
    "../services/whatsappAiAgentService": {
      getWhatsAppAiAgentOverview: async () => overview,
      updateWhatsAppAiAgentSettings: async ({ payload }) => {
        if (payload.defaultAgentType === "invalid") {
          const error = new Error("defaultAgentType must be one of: sales_agent, faq_responder, lead_qualifier");
          error.status = 400;
          throw error;
        }
        return {
          ...overview,
          enabled: true,
          defaultAgentType: payload.defaultAgentType,
        };
      },
      createWhatsAppAiAgentInterest: async () => ({
        _id: "interest_1",
        status: "new",
        createdAt: "2026-04-09T10:00:00.000Z",
      }),
      listWhatsAppAiAgentInterests: async () => ({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      }),
      updateWhatsAppAiAgentInterestStatus: async ({ status }) => ({
        _id: "interest_1",
        status,
        updatedAt: "2026-04-09T12:00:00.000Z",
      }),
      updateWhatsAppAiAgentInterest: async () => ({
        _id: "interest_1",
        companyName: "Acme",
        contactName: "John",
        email: "john@acme.com",
        phone: "+1555",
        whatsappNumber: "+1555",
        preferredAgentTypes: ["sales_agent"],
        monthlyConversationVolume: 5000,
        useCase: "Need automation",
        catalogNeeded: true,
        crmIntegrationNeeded: false,
        webinarRequested: false,
        notes: "updated",
        status: "new",
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-09T12:00:00.000Z",
      }),
      previewWhatsAppAiAgent: async () => ({
        agentType: "sales_agent",
        status: "preview",
        message: "Need a kurta",
        reply: "Here are some options.",
        responseSource: "catalog",
        confidence: 0.87,
        suggestions: [],
        leadCapture: { needed: false, fields: [] },
        handoffTriggered: false,
        notes: ["catalog_match"],
        leadId: "",
        conversationId: "",
        matchedKnowledgeArticleIds: [],
        matchedCatalogItemIds: ["kurta_1"],
        actionTaken: "preview_only",
      }),
      listWhatsAppAiAgentHistory: async () => ({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      }),
    },
  });

  const getRes = createResponse();
  await controller.getWhatsAppAiAgent({}, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.success, true);
  assert.deepEqual(getRes.body.data, overview);

  const invalidPutRes = createResponse();
  await controller.updateWhatsAppAiAgent(
    {
      body: { defaultAgentType: "invalid" },
      admin: { _id: "admin_1", role: "SalesAdmin" },
    },
    invalidPutRes
  );
  assert.equal(invalidPutRes.statusCode, 400);
  assert.match(invalidPutRes.body.message, /defaultAgentType/i);

  const interestRes = createResponse();
  await controller.submitWhatsAppAiAgentInterest(
    {
      body: {
        companyName: "Acme",
        contactName: "John",
        email: "john@acme.com",
      },
      admin: { _id: "admin_1", role: "SalesAdmin" },
    },
    interestRes
  );
  assert.equal(interestRes.statusCode, 201);
  assert.equal(interestRes.body.success, true);

  const previewRes = createResponse();
  await controller.testWhatsAppAiAgent(
    {
      app: {},
      body: {
        agentType: "sales_agent",
        message: "Need a kurta",
        send: false,
      },
      admin: { _id: "admin_1", role: "SalesAdmin" },
    },
    previewRes
  );
  assert.equal(previewRes.statusCode, 200);
  assert.equal(previewRes.body.data.agentType, "sales_agent");
  assert.equal(previewRes.body.data.handoffTriggered, false);
  assert.deepEqual(previewRes.body.data.notes, ["catalog_match"]);

  const patchStatusRes = createResponse();
  await controller.patchWhatsAppAiAgentInterestStatus(
    {
      params: { id: "interest_1" },
      body: { status: "contacted" },
      admin: { _id: "admin_1", role: "SalesAdmin" },
    },
    patchStatusRes
  );
  assert.equal(patchStatusRes.statusCode, 200);
  assert.equal(patchStatusRes.body.data.status, "contacted");
};

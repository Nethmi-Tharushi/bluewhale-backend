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
  const defaultOverview = {
    enabled: false,
    matchMode: "balanced",
    billingEnabled: false,
    pricePerSuccessfulMatchMinor: 20,
    currency: "INR",
    lowConfidenceAction: "fallback_to_team",
    stats: {
      quickReplies: 0,
      forms: 0,
      basicAutomations: 0,
      workflows: 0,
      recentWorkflowRuns: 0,
    },
    updatedAt: null,
    updatedBy: null,
  };

  const historyCalls = [];
  const controller = loadWithMocks(path.resolve(__dirname, "../controllers/whatsappAiIntentMatchingController.js"), {
    "../services/whatsappAiIntentMatchingService": {
      getAiIntentMatchingOverview: async () => defaultOverview,
      updateAiIntentMatchingSettings: async ({ payload }) => {
        if (payload.matchMode === "invalid") {
          const error = new Error("matchMode must be one of: balanced, precise, aggressive");
          error.status = 400;
          throw error;
        }

        return {
          ...defaultOverview,
          enabled: true,
          matchMode: payload.matchMode,
        };
      },
      listAiIntentMatchHistory: async (payload) => {
        historyCalls.push(payload);
        return {
          items: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        };
      },
      previewAiIntentMatch: async () => ({
        status: "matched",
        matchMode: "balanced",
        message: "where is my order",
        topMatch: {
          intentLabel: "Order tracking",
          destinationType: "workflow",
          destinationId: "workflow_1",
          destinationName: "Order Tracking Workflow",
          confidence: 0.88,
          reason: "semantic_match",
        },
        candidates: [
          {
            intentLabel: "Order tracking",
            destinationType: "workflow",
            destinationId: "workflow_1",
            destinationName: "Order Tracking Workflow",
            confidence: 0.88,
          },
        ],
        actionTaken: "preview_only",
      }),
    },
  });

  const getRes = createResponse();
  await controller.getWhatsAppAiIntentMatching({}, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.success, true);
  assert.deepEqual(getRes.body.data, defaultOverview);

  const invalidPutRes = createResponse();
  await controller.updateWhatsAppAiIntentMatching(
    {
      body: { matchMode: "invalid" },
      admin: { _id: "admin_1", role: "SalesAdmin" },
    },
    invalidPutRes
  );
  assert.equal(invalidPutRes.statusCode, 400);
  assert.match(invalidPutRes.body.message, /matchMode must be one of/i);

  const historyRes = createResponse();
  await controller.getWhatsAppAiIntentMatchingHistory(
    {
      query: { page: "1", limit: "8", status: "matched", matchMode: "balanced", search: "order" },
    },
    historyRes
  );
  assert.equal(historyRes.statusCode, 200);
  assert.deepEqual(historyCalls[0], {
    page: "1",
    limit: "8",
    status: "matched",
    matchMode: "balanced",
    search: "order",
  });

  const previewRes = createResponse();
  await controller.testWhatsAppAiIntentMatching(
    {
      app: {},
      body: { message: "where is my order", send: false },
      admin: { _id: "admin_1", role: "SalesAdmin" },
    },
    previewRes
  );
  assert.equal(previewRes.statusCode, 200);
  assert.equal(previewRes.body.data.topMatch.reason, "semantic_match");
  assert.equal(Array.isArray(previewRes.body.data.candidates), true);
};

const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const createResponse = () => ({
  statusCode: 200,
  body: null,
  text: "",
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
  send(payload) {
    this.text = payload;
    return this;
  },
});

module.exports = async () => {
  let webhookProcessed = false;
  const settings = {
    appId: "123",
    businessLoginConfigId: "cfg-1",
    graphApiVersion: "v21.0",
    webhookVerifyToken: "abc***yz",
    crmSourceLabel: "Meta Lead Ads",
    autoCreateLeads: true,
    autoAssignToOwner: true,
    syncFormsOnConnect: true,
    status: "connected",
    connectionMethod: "business_login",
    connectedAt: "2026-05-07T00:00:00.000Z",
    lastSyncAt: "2026-05-07T00:10:00.000Z",
    selectedBusinessId: "biz-1",
    selectedBusinessName: "Biz",
    selectedPageId: "page-1",
    selectedPageName: "Page",
    selectedFormIds: ["form-1"],
    selectedFormNames: ["Form"],
    scopeSummary: { granted: ["leads_retrieval"], missingRequired: [] },
    diagnostics: [],
    tokenHealth: { status: "ok", expiresAt: null, lastError: "", needsReconnect: false },
    syncSummary: { totalSyncedLeads: 1, failedSyncCount: 0, lastSuccessfulSyncAt: "2026-05-07T00:10:00.000Z" },
    campaignLauncher: { enabled: false, canLaunch: false, status: "coming_soon", message: "Not enabled", requiredScopes: ["ads_read"], lastPreparedAt: null },
    webhookStatus: { status: "subscribed" },
    fieldMapping: { email: "email" },
    assets: { businesses: [], pages: [], forms: [], campaigns: [] },
    syncHistory: [],
    syncedLeads: [],
    failedSyncs: [],
  };
  const logs = {
    syncHistory: [{ id: "log-1", status: "success", title: "Sync complete" }],
    syncedLeads: [{ id: "lead-1", status: "created", title: "Lead synced" }],
    failedSyncs: [{ id: "fail-1", status: "retry_pending", title: "Retry queued" }],
    syncSummary: { totalSyncedLeads: 1, failedSyncCount: 1, lastSuccessfulSyncAt: "2026-05-07T00:10:00.000Z" },
  };

  const controller = loadWithMocks(path.resolve(__dirname, "../controllers/metaLeadAdsController.js"), {
    "../services/metaLeadAdsService": {
      getMetaLeadAdsStatus: async () => settings,
      getMetaLeadAdsCampaigns: async () => [{ id: "cmp-1", name: "Campaign 1" }],
      getMetaLeadAdsLogs: async () => logs,
      exchangeMetaLeadAdsCode: async () => settings,
      syncMetaLeadAdsAssets: async () => settings,
      pollMetaLeadAdsLeads: async () => ({ processed: 1, discovered: 1, succeeded: 1, failed: 0, duplicates: 0 }),
      retryFailedMetaLeadAdsSyncs: async () => ({ retried: 1, resolved: 1, failed: 0, settings, logs }),
      disconnectMetaLeadAds: async () => ({ ...settings, status: "disconnected" }),
      verifyMetaLeadAdsWebhookSignature: async () => true,
      processMetaLeadAdsWebhookPayload: async () => {
        webhookProcessed = true;
        return { processed: 1 };
      },
    },
    "../services/metaLeadAdsConnectionService": {
      loadMetaLeadAdsConnection: async () => ({
        webhookVerifyToken: "verify-token",
      }),
    },
    "../services/metaGraphService": {
      trimString: (value) => String(value || "").trim(),
    },
    "../services/metaLeadAdsPollingService": {
      restartMetaLeadAdsPollingWorker: async () => null,
    },
  });

  const statusRes = createResponse();
  await controller.getMetaLeadAdsStatusHandler({}, statusRes);
  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.body.settings.status, "connected");

  const exchangeRes = createResponse();
  await controller.exchangeMetaLeadAdsCodeHandler({ admin: { _id: "admin-1" }, body: { code: "abc" } }, exchangeRes);
  assert.equal(exchangeRes.statusCode, 200);
  assert.equal(exchangeRes.body.message, "Meta Lead Ads connected successfully");

  const syncRes = createResponse();
  await controller.syncMetaLeadAdsHandler({ admin: { _id: "admin-1" }, body: {} }, syncRes);
  assert.equal(syncRes.statusCode, 200);
  assert.equal(syncRes.body.settings.selectedPageId, "page-1");

  const syncLeadsRes = createResponse();
  await controller.syncMetaLeadAdsLeadsHandler({ admin: { _id: "admin-1" }, body: { lookbackMinutes: 30 } }, syncLeadsRes);
  assert.equal(syncLeadsRes.statusCode, 200);
  assert.equal(syncLeadsRes.body.data.succeeded, 1);

  const campaignsRes = createResponse();
  await controller.getMetaLeadAdsCampaignsHandler({ query: {} }, campaignsRes);
  assert.equal(campaignsRes.statusCode, 200);
  assert.equal(Array.isArray(campaignsRes.body.campaigns), true);
  assert.equal(campaignsRes.body.campaigns[0].id, "cmp-1");

  const logsRes = createResponse();
  await controller.getMetaLeadAdsLogsHandler({ query: {} }, logsRes);
  assert.equal(logsRes.statusCode, 200);
  assert.equal(Array.isArray(logsRes.body.syncHistory), true);
  assert.equal(logsRes.body.syncSummary.failedSyncCount, 1);

  const syncCampaignsRes = createResponse();
  await controller.syncMetaLeadAdsCampaignsHandler({ admin: { _id: "admin-1" }, body: {} }, syncCampaignsRes);
  assert.equal(syncCampaignsRes.statusCode, 200);
  assert.equal(Array.isArray(syncCampaignsRes.body.campaigns), true);

  const retryRes = createResponse();
  await controller.retryFailedMetaLeadAdsSyncsHandler({ admin: { _id: "admin-1" }, body: { limit: 5 } }, retryRes);
  assert.equal(retryRes.statusCode, 200);
  assert.equal(retryRes.body.data.retried, 1);

  const disconnectRes = createResponse();
  await controller.disconnectMetaLeadAdsHandler({ admin: { _id: "admin-1" } }, disconnectRes);
  assert.equal(disconnectRes.statusCode, 200);
  assert.equal(disconnectRes.body.settings.status, "disconnected");

  const verifyRes = createResponse();
  await controller.verifyMetaLeadAdsWebhookHandler(
    {
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "verify-token",
        "hub.challenge": "challenge-123",
      },
    },
    verifyRes
  );
  assert.equal(verifyRes.statusCode, 200);
  assert.equal(verifyRes.text, "challenge-123");

  const previousSetImmediate = global.setImmediate;
  global.setImmediate = (fn) => fn();
  const webhookRes = createResponse();
  await controller.receiveMetaLeadAdsWebhookHandler(
    {
      rawBody: Buffer.from("{}"),
      headers: { "x-hub-signature-256": "sig" },
      body: { object: "page", entry: [] },
    },
    webhookRes
  );
  global.setImmediate = previousSetImmediate;

  assert.equal(webhookRes.statusCode, 200);
  assert.equal(webhookRes.body.success, true);
  assert.equal(webhookProcessed, true);

  const invalidSignatureController = loadWithMocks(path.resolve(__dirname, "../controllers/metaLeadAdsController.js"), {
    "../services/metaLeadAdsService": {
      verifyMetaLeadAdsWebhookSignature: async () => false,
      processMetaLeadAdsWebhookPayload: async () => ({ processed: 0 }),
      getMetaLeadAdsStatus: async () => settings,
      getMetaLeadAdsCampaigns: async () => [],
      getMetaLeadAdsLogs: async () => logs,
      exchangeMetaLeadAdsCode: async () => settings,
      syncMetaLeadAdsAssets: async () => settings,
      retryFailedMetaLeadAdsSyncs: async () => ({ retried: 0, resolved: 0, failed: 0, settings, logs }),
      disconnectMetaLeadAds: async () => settings,
    },
    "../services/metaLeadAdsConnectionService": {
      loadMetaLeadAdsConnection: async () => ({
        webhookVerifyToken: "verify-token",
      }),
    },
    "../services/metaGraphService": {
      trimString: (value) => String(value || "").trim(),
    },
    "../services/metaLeadAdsPollingService": {
      restartMetaLeadAdsPollingWorker: async () => null,
    },
  });

  const invalidWebhookRes = createResponse();
  await invalidSignatureController.receiveMetaLeadAdsWebhookHandler(
    {
      rawBody: Buffer.from("{}"),
      headers: { "x-hub-signature-256": "sig" },
      body: { object: "page", entry: [] },
    },
    invalidWebhookRes
  );
  assert.equal(invalidWebhookRes.statusCode, 401);
};

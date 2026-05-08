const {
  disconnectMetaLeadAds,
  exchangeMetaLeadAdsCode,
  getMetaLeadAdsCampaigns,
  getMetaLeadAdsLogs,
  getMetaLeadAdsStatus,
  processMetaLeadAdsWebhookPayload,
  pollMetaLeadAdsLeads,
  retryFailedMetaLeadAdsSyncs,
  syncMetaLeadAdsAssets,
  verifyMetaLeadAdsWebhookSignature,
} = require("../services/metaLeadAdsService");
const { loadMetaLeadAdsConnection } = require("../services/metaLeadAdsConnectionService");
const { restartMetaLeadAdsPollingWorker } = require("../services/metaLeadAdsPollingService");
const { trimString } = require("../services/metaGraphService");

const buildSettingsResponse = (settings, message = "") => ({
  success: true,
  ...(message ? { message } : {}),
  settings,
  data: settings,
});

const buildErrorPayload = (error, fallbackMessage) => ({
  success: false,
  message: error?.message || fallbackMessage,
  ...(error?.code ? { code: trimString(error.code) } : {}),
  ...(error?.details && typeof error.details === "object" ? { details: error.details } : {}),
});

const getMetaLeadAdsStatusHandler = async (_req, res) => {
  try {
    const settings = await getMetaLeadAdsStatus({ refresh: true });
    return res.json(buildSettingsResponse(settings));
  } catch (error) {
    return res.status(error?.status || 500).json(buildErrorPayload(error, "Failed to load Meta Lead Ads status"));
  }
};

const exchangeMetaLeadAdsCodeHandler = async (req, res) => {
  try {
    const settings = await exchangeMetaLeadAdsCode({
      adminId: req.admin?._id,
      input: req.body || {},
    });
    await restartMetaLeadAdsPollingWorker().catch(() => null);

    return res.json(buildSettingsResponse(settings, "Meta Lead Ads connected successfully"));
  } catch (error) {
    return res.status(error?.status || 500).json(buildErrorPayload(error, "Failed to exchange Meta Lead Ads code"));
  }
};

const syncMetaLeadAdsHandler = async (req, res) => {
  try {
    const settings = await syncMetaLeadAdsAssets({
      adminId: req.admin?._id,
      input: req.body || {},
    });
    await restartMetaLeadAdsPollingWorker().catch(() => null);

    return res.json(buildSettingsResponse(settings, "Meta Lead Ads assets synced successfully"));
  } catch (error) {
    return res.status(error?.status || 500).json(buildErrorPayload(error, "Failed to sync Meta Lead Ads assets"));
  }
};

const syncMetaLeadAdsLeadsHandler = async (req, res) => {
  try {
    const requestedLookbackMinutes = Number(req.body?.lookbackMinutes || 0);
    const lookbackMinutes =
      Number.isInteger(requestedLookbackMinutes) && requestedLookbackMinutes >= 5 && requestedLookbackMinutes <= 240
        ? requestedLookbackMinutes
        : undefined;

    const result = await pollMetaLeadAdsLeads({ lookbackMinutes });

    return res.json({
      success: true,
      message: "Meta Lead Ads leads synced successfully",
      data: result,
    });
  } catch (error) {
    return res.status(error?.status || 500).json(buildErrorPayload(error, "Failed to sync Meta Lead Ads leads"));
  }
};

const getMetaLeadAdsCampaignsHandler = async (req, res) => {
  try {
    const campaigns = await getMetaLeadAdsCampaigns({
      activeOnly: String(req.query.activeOnly || "").trim().toLowerCase() === "true",
    });

    return res.json({
      success: true,
      data: campaigns,
      campaigns,
    });
  } catch (error) {
    return res.status(error?.status || 500).json(buildErrorPayload(error, "Failed to load Meta Lead Ads campaigns"));
  }
};

const getMetaLeadAdsLogsHandler = async (req, res) => {
  try {
    const logs = await getMetaLeadAdsLogs({
      limit: Number(req.query.limit || 25),
    });

    return res.json({
      success: true,
      ...logs,
      data: logs,
    });
  } catch (error) {
    return res.status(error?.status || 500).json(buildErrorPayload(error, "Failed to load Meta Lead Ads logs"));
  }
};

const syncMetaLeadAdsCampaignsHandler = async (req, res) => {
  try {
    const settings = await syncMetaLeadAdsAssets({
      adminId: req.admin?._id,
      input: {
        ...(req.body || {}),
        syncMode: "campaigns",
      },
    });
    await restartMetaLeadAdsPollingWorker().catch(() => null);

    return res.json({
      success: true,
      message: "Meta Lead Ads campaigns synced successfully",
      campaigns: settings?.assets?.campaigns || [],
      settings,
      data: settings?.assets?.campaigns || [],
    });
  } catch (error) {
    return res.status(error?.status || 500).json(buildErrorPayload(error, "Failed to sync Meta Lead Ads campaigns"));
  }
};

const retryFailedMetaLeadAdsSyncsHandler = async (req, res) => {
  try {
    const result = await retryFailedMetaLeadAdsSyncs({
      adminId: req.admin?._id,
      limit: Number(req.body?.limit || 25),
    });

    return res.json({
      success: true,
      message: "Failed Meta Lead Ads syncs retried",
      settings: result.settings,
      logs: result.logs,
      data: result,
    });
  } catch (error) {
    return res.status(error?.status || 500).json(buildErrorPayload(error, "Failed to retry Meta Lead Ads syncs"));
  }
};

const disconnectMetaLeadAdsHandler = async (req, res) => {
  try {
    const settings = await disconnectMetaLeadAds({
      adminId: req.admin?._id,
    });
    await restartMetaLeadAdsPollingWorker().catch(() => null);

    return res.json(buildSettingsResponse(settings, "Meta Lead Ads disconnected successfully"));
  } catch (error) {
    return res.status(error?.status || 500).json(buildErrorPayload(error, "Failed to disconnect Meta Lead Ads"));
  }
};

const verifyMetaLeadAdsWebhookHandler = async (req, res) => {
  try {
    const mode = trimString(req.query["hub.mode"]);
    const token = trimString(req.query["hub.verify_token"]);
    const challenge = trimString(req.query["hub.challenge"]);
    const connection = await loadMetaLeadAdsConnection({ refresh: true });

    if (mode !== "subscribe" || token !== trimString(connection.webhookVerifyToken)) {
      return res.status(403).json({ message: "Webhook verification failed" });
    }

    return res.status(200).send(challenge);
  } catch (error) {
    return res.status(error?.status || 500).json(buildErrorPayload(error, "Failed to verify Meta Lead Ads webhook"));
  }
};

const receiveMetaLeadAdsWebhookHandler = async (req, res) => {
  try {
    const signatureHeader = req.headers["x-hub-signature-256"];
    const isValidSignature = await verifyMetaLeadAdsWebhookSignature({
      rawBody: req.rawBody,
      signatureHeader,
    });

    if (!isValidSignature) {
      return res.status(401).json({ message: "Invalid webhook signature" });
    }

    res.status(200).json({ success: true });

    setImmediate(() => {
      processMetaLeadAdsWebhookPayload({
        payload: req.body,
        headers: req.headers,
      }).catch((error) => {
        console.error("Meta Lead Ads webhook processing failed:", error);
      });
    });

    return undefined;
  } catch (error) {
    return res.status(error?.status || 500).json(buildErrorPayload(error, "Failed to process Meta Lead Ads webhook"));
  }
};

module.exports = {
  getMetaLeadAdsStatusHandler,
  exchangeMetaLeadAdsCodeHandler,
  syncMetaLeadAdsHandler,
  syncMetaLeadAdsLeadsHandler,
  getMetaLeadAdsCampaignsHandler,
  getMetaLeadAdsLogsHandler,
  syncMetaLeadAdsCampaignsHandler,
  retryFailedMetaLeadAdsSyncsHandler,
  disconnectMetaLeadAdsHandler,
  verifyMetaLeadAdsWebhookHandler,
  receiveMetaLeadAdsWebhookHandler,
};

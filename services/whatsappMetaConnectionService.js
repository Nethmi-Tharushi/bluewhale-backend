const AdminUser = require("../models/AdminUser");

const trimString = (value) => String(value || "").trim();
const getEmbeddedSignupConfigId = () =>
  trimString(
    process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ||
      process.env.META_EMBEDDED_SIGNUP_CONFIG_ID ||
      process.env.WHATSAPP_EMBEDDED_CONFIG_ID ||
      process.env.EMBEDDED_SIGNUP_CONFIG_ID ||
      ""
  );

const buildFallbackConnection = () => ({
  accessToken: trimString(process.env.WHATSAPP_ACCESS_TOKEN),
  phoneNumberId: trimString(process.env.WHATSAPP_PHONE_NUMBER_ID),
  businessAccountId: trimString(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID),
  appSecret: trimString(process.env.WHATSAPP_APP_SECRET),
  webhookVerifyToken: trimString(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
  graphApiVersion: trimString(process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0") || "v21.0",
  appId: trimString(process.env.WHATSAPP_APP_ID || process.env.META_APP_ID || ""),
  catalogId: trimString(process.env.WHATSAPP_CATALOG_ID || ""),
  embeddedSignupConfigId: getEmbeddedSignupConfigId(),
  connectionMethod: "manual",
  lastEmbeddedSignupAt: null,
  source: "environment",
});

const normalizeConnection = (value = {}) => {
  const fallback = buildFallbackConnection();
  const saved = value && typeof value === "object" ? value : {};
  const connection = {
    accessToken: trimString(saved.accessToken) || fallback.accessToken,
    phoneNumberId: trimString(saved.phoneNumberId) || fallback.phoneNumberId,
    businessAccountId: trimString(saved.businessAccountId) || fallback.businessAccountId,
    appSecret: trimString(saved.appSecret) || fallback.appSecret,
    webhookVerifyToken: trimString(saved.webhookVerifyToken) || fallback.webhookVerifyToken,
    graphApiVersion: trimString(saved.graphApiVersion) || fallback.graphApiVersion,
    appId: trimString(saved.appId) || fallback.appId,
    catalogId: trimString(saved.catalogId) || fallback.catalogId,
    embeddedSignupConfigId: trimString(saved.embeddedSignupConfigId) || fallback.embeddedSignupConfigId,
    connectionMethod: trimString(saved.connectionMethod) || fallback.connectionMethod,
    lastEmbeddedSignupAt: saved.lastEmbeddedSignupAt || null,
  };

  return {
    ...connection,
    source: trimString(saved.accessToken || saved.phoneNumberId || saved.businessAccountId || saved.appSecret || saved.webhookVerifyToken)
      ? "settings"
      : fallback.source,
    isConfigured: Boolean(connection.accessToken && connection.phoneNumberId),
    isSavedConfigured: Boolean(trimString(saved.accessToken) && trimString(saved.phoneNumberId)),
    isFallbackConfigured: Boolean(fallback.accessToken && fallback.phoneNumberId),
  };
};

let cachedConnection = null;
let cachedAt = 0;
const CACHE_TTL_MS = 15000;

const loadWhatsAppMetaConnection = async ({ refresh = false } = {}) => {
  if (!refresh && cachedConnection && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedConnection;
  }

  const mainAdmin = await AdminUser.findOne({ role: "MainAdmin" })
    .select("settings.whatsappMetaConnection")
    .lean();

  cachedConnection = normalizeConnection(mainAdmin?.settings?.whatsappMetaConnection || {});
  cachedAt = Date.now();
  return cachedConnection;
};

const getWhatsAppMetaConnectionSnapshot = () => cachedConnection || normalizeConnection({});

const syncWhatsAppMetaConnectionCache = (value = {}) => {
  cachedConnection = normalizeConnection(value);
  cachedAt = Date.now();
  return cachedConnection;
};

module.exports = {
  loadWhatsAppMetaConnection,
  getWhatsAppMetaConnectionSnapshot,
  syncWhatsAppMetaConnectionCache,
  normalizeConnection,
};

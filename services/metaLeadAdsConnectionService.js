const AdminUser = require("../models/AdminUser");
const { maskSecret, normalizeGraphVersion, trimString } = require("./metaGraphService");
const {
  decryptSecret,
  decryptStringMap,
  encryptSecret,
  encryptStringMap,
  getEncryptionSecret,
  isEncryptedValue,
} = require("./cryptoService");

const REQUIRED_META_LEAD_ADS_SCOPES = Object.freeze([
  "business_management",
  "leads_retrieval",
  "pages_manage_ads",
  "pages_read_engagement",
  "pages_manage_metadata",
]);

const DEFAULT_META_LEAD_FIELD_MAPPING = Object.freeze({
  full_name: "name",
  first_name: "firstName",
  last_name: "lastName",
  full_name_1: "name",
  email: "email",
  email_address: "email",
  phone_number: "phone",
  phone: "phone",
  whatsapp_number: "phone",
  company_name: "company",
  company: "company",
  city: "city",
  state: "state",
  country: "country",
  zip_code: "zipCode",
  postal_code: "zipCode",
  website: "website",
});

const parseBoolean = (value, fallback) => {
  if (typeof value === "boolean") return value;
  const normalized = trimString(value).toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const clampNumber = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return fallback;
  return Math.min(max, Math.max(min, Math.round(normalized)));
};

const getMetaLeadAdsAppId = () =>
  trimString(
    process.env.META_LEAD_ADS_APP_ID ||
      process.env.META_APP_ID ||
      process.env.WHATSAPP_APP_ID ||
      ""
  );

const getMetaLeadAdsAppSecret = () =>
  trimString(
    process.env.META_LEAD_ADS_APP_SECRET ||
      process.env.META_APP_SECRET ||
      process.env.WHATSAPP_APP_SECRET ||
      ""
  );

const getMetaLeadAdsBusinessLoginConfigId = () =>
  trimString(
    process.env.META_LEAD_ADS_BUSINESS_LOGIN_CONFIG_ID ||
      process.env.META_BUSINESS_LOGIN_CONFIG_ID ||
      process.env.META_LEAD_ADS_CONFIG_ID ||
      ""
  );

const getMetaLeadAdsWebhookVerifyToken = () =>
  trimString(
    process.env.META_LEAD_ADS_WEBHOOK_VERIFY_TOKEN ||
      process.env.META_WEBHOOK_VERIFY_TOKEN ||
      ""
  );

const getMetaLeadAdsWebhookCallbackBaseUrl = () =>
  trimString(
    process.env.META_LEAD_ADS_WEBHOOK_CALLBACK_BASE_URL ||
      process.env.WEBHOOK_CALLBACK_BASE_URL ||
      process.env.SERVER_PUBLIC_URL ||
      process.env.API_BASE_URL ||
      ""
  ).replace(/\/+$/, "");

const buildDefaultWebhookStatus = () => ({
  status: "not_configured",
  verifyTokenConfigured: false,
  callbackUrl: "",
  selectedPageSubscribed: false,
  selectedPageId: "",
  subscribedFields: [],
  lastVerifiedAt: null,
  lastEventAt: null,
  lastProcessedAt: null,
  lastErrorAt: null,
  lastErrorMessage: "",
});

const buildDefaultScopeSummary = () => ({
  required: [...REQUIRED_META_LEAD_ADS_SCOPES],
  granted: [],
  declined: [],
  missingRequired: [...REQUIRED_META_LEAD_ADS_SCOPES],
  grantedCount: 0,
  lastCheckedAt: null,
});

const buildDefaultAssets = () => ({
  businesses: [],
  pages: [],
  forms: [],
  adAccounts: [],
  campaigns: [],
});

const buildFallbackConnection = () => ({
  accessToken: trimString(process.env.META_LEAD_ADS_ACCESS_TOKEN || ""),
  tokenType: "",
  tokenExpiresAt: null,
  pageAccessTokens: {},
  grantedScopes: [],
  appId: getMetaLeadAdsAppId(),
  appSecret: getMetaLeadAdsAppSecret(),
  businessLoginConfigId: getMetaLeadAdsBusinessLoginConfigId(),
  graphApiVersion: normalizeGraphVersion(
    process.env.META_LEAD_ADS_GRAPH_API_VERSION ||
      process.env.META_GRAPH_API_VERSION ||
      process.env.WHATSAPP_GRAPH_API_VERSION ||
      "v21.0"
  ),
  webhookVerifyToken: getMetaLeadAdsWebhookVerifyToken(),
  webhookCallbackBaseUrl: getMetaLeadAdsWebhookCallbackBaseUrl(),
  crmSourceLabel: trimString(process.env.META_LEAD_ADS_CRM_SOURCE_LABEL || "Meta Lead Ads") || "Meta Lead Ads",
  autoCreateLeads: parseBoolean(process.env.META_LEAD_ADS_AUTO_CREATE_LEADS, true),
  autoAssignToOwner: parseBoolean(process.env.META_LEAD_ADS_AUTO_ASSIGN_TO_OWNER, false),
  autoSyncEnabled: parseBoolean(
    process.env.META_LEAD_ADS_AUTO_SYNC_ENABLED ?? process.env.META_LEAD_ADS_POLL_ENABLED,
    true
  ),
  syncIntervalMinutes: clampNumber(process.env.META_LEAD_ADS_SYNC_INTERVAL_MINUTES, 20, { min: 5, max: 59 }),
  pollLookbackMinutes: clampNumber(process.env.META_LEAD_ADS_POLL_LOOKBACK_MINUTES, 30, { min: 5, max: 240 }),
  syncFormsOnConnect: parseBoolean(process.env.META_LEAD_ADS_SYNC_FORMS_ON_CONNECT, true),
  status: "disconnected",
  connectionMethod: "business_login",
  connectedAt: null,
  lastSyncAt: null,
  lastSuccessfulSyncAt: null,
  lastFailedSyncAt: null,
  lastPreparedAt: null,
  connectedByAdminId: null,
  accountId: "",
  accountName: "",
  selectedBusinessId: "",
  selectedBusinessName: "",
  selectedPageId: "",
  selectedPageName: "",
  selectedFormIds: [],
  selectedFormNames: [],
  scopeSummary: buildDefaultScopeSummary(),
  diagnostics: [],
  lastApiError: null,
  webhookStatus: buildDefaultWebhookStatus(),
  fieldMapping: { ...DEFAULT_META_LEAD_FIELD_MAPPING },
  assets: buildDefaultAssets(),
  source: "environment",
});

const normalizeFieldMapping = (value) => ({
  ...DEFAULT_META_LEAD_FIELD_MAPPING,
  ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}),
});

const normalizeScopeSummary = (value = {}) => {
  const granted = Array.isArray(value?.granted) ? value.granted.map(trimString).filter(Boolean) : [];
  const declined = Array.isArray(value?.declined) ? value.declined.map(trimString).filter(Boolean) : [];
  const missingRequired = Array.isArray(value?.missingRequired)
    ? value.missingRequired.map(trimString).filter(Boolean)
    : REQUIRED_META_LEAD_ADS_SCOPES.filter((scope) => !granted.includes(scope));

  return {
    required: Array.isArray(value?.required) && value.required.length
      ? value.required.map(trimString).filter(Boolean)
      : [...REQUIRED_META_LEAD_ADS_SCOPES],
    granted,
    declined,
    missingRequired,
    grantedCount: Number(value?.grantedCount || granted.length || 0),
    lastCheckedAt: value?.lastCheckedAt || null,
  };
};

const normalizeWebhookStatus = (value = {}, fallback = {}) => {
  const base = {
    ...buildDefaultWebhookStatus(),
    ...(fallback || {}),
    ...(value && typeof value === "object" ? value : {}),
  };

  return {
    ...base,
    status: trimString(base.status || "not_configured") || "not_configured",
    verifyTokenConfigured: Boolean(base.verifyTokenConfigured),
    callbackUrl: trimString(base.callbackUrl),
    selectedPageSubscribed: Boolean(base.selectedPageSubscribed),
    selectedPageId: trimString(base.selectedPageId),
    subscribedFields: Array.isArray(base.subscribedFields) ? base.subscribedFields.map(trimString).filter(Boolean) : [],
    lastVerifiedAt: base.lastVerifiedAt || null,
    lastEventAt: base.lastEventAt || null,
    lastProcessedAt: base.lastProcessedAt || null,
    lastErrorAt: base.lastErrorAt || null,
    lastErrorMessage: trimString(base.lastErrorMessage),
  };
};

const normalizeAssets = (value = {}) => ({
  businesses: Array.isArray(value?.businesses) ? value.businesses : [],
  pages: Array.isArray(value?.pages) ? value.pages : [],
  forms: Array.isArray(value?.forms) ? value.forms : [],
  adAccounts: Array.isArray(value?.adAccounts) ? value.adAccounts : [],
  campaigns: Array.isArray(value?.campaigns) ? value.campaigns : [],
});

const normalizeLastApiError = (value = null) => {
  if (!value || typeof value !== "object") return null;

  return {
    code: trimString(value.code),
    message: trimString(value.message),
    category: trimString(value.category),
    needsReconnect: Boolean(value.needsReconnect),
    retryable: Boolean(value.retryable),
    occurredAt: value.occurredAt || null,
    context: trimString(value.context),
  };
};

const deriveConnectionStatus = (connection = {}) => {
  const hasAppConfig = Boolean(connection.appId && connection.appSecret);
  if (!hasAppConfig) return "not_configured";
  if (!trimString(connection.accessToken)) return "disconnected";
  if (connection?.lastApiError?.needsReconnect) return "attention";
  if (Array.isArray(connection?.scopeSummary?.missingRequired) && connection.scopeSummary.missingRequired.length) {
    return "attention";
  }
  if (connection?.webhookStatus?.status === "error") return "attention";
  return trimString(connection.status || "connected") || "connected";
};

const normalizeMetaLeadAdsConnection = (value = {}) => {
  const fallback = buildFallbackConnection();
  const saved = value && typeof value === "object" ? value : {};
  const decryptedAccessToken = decryptSecret(saved.accessToken);
  const decryptedAppSecret = decryptSecret(saved.appSecret);
  const decryptedPageAccessTokens = decryptStringMap(saved.pageAccessTokens);

  const merged = {
    accessToken: decryptedAccessToken || trimString(saved.accessToken) || fallback.accessToken,
    tokenType: trimString(saved.tokenType),
    tokenExpiresAt: saved.tokenExpiresAt || null,
    pageAccessTokens:
      decryptedPageAccessTokens && typeof decryptedPageAccessTokens === "object" && !Array.isArray(decryptedPageAccessTokens)
        ? Object.entries(decryptedPageAccessTokens).reduce((acc, [key, token]) => {
            const normalizedKey = trimString(key);
            const normalizedToken = trimString(token);
            if (normalizedKey && normalizedToken) acc[normalizedKey] = normalizedToken;
            return acc;
          }, {})
        : {},
    grantedScopes: Array.isArray(saved.grantedScopes) ? saved.grantedScopes.map(trimString).filter(Boolean) : [],
    appId: trimString(saved.appId) || fallback.appId,
    appSecret: decryptedAppSecret || trimString(saved.appSecret) || fallback.appSecret,
    businessLoginConfigId: trimString(saved.businessLoginConfigId) || fallback.businessLoginConfigId,
    graphApiVersion: normalizeGraphVersion(saved.graphApiVersion || fallback.graphApiVersion),
    webhookVerifyToken: trimString(saved.webhookVerifyToken) || fallback.webhookVerifyToken,
    webhookCallbackBaseUrl: trimString(saved.webhookCallbackBaseUrl) || fallback.webhookCallbackBaseUrl,
    crmSourceLabel: trimString(saved.crmSourceLabel) || fallback.crmSourceLabel,
    autoCreateLeads: typeof saved.autoCreateLeads === "boolean" ? saved.autoCreateLeads : fallback.autoCreateLeads,
    autoAssignToOwner: typeof saved.autoAssignToOwner === "boolean" ? saved.autoAssignToOwner : fallback.autoAssignToOwner,
    autoSyncEnabled: typeof saved.autoSyncEnabled === "boolean" ? saved.autoSyncEnabled : fallback.autoSyncEnabled,
    syncIntervalMinutes: clampNumber(saved.syncIntervalMinutes, fallback.syncIntervalMinutes, { min: 5, max: 59 }),
    pollLookbackMinutes: clampNumber(saved.pollLookbackMinutes, fallback.pollLookbackMinutes, { min: 5, max: 240 }),
    syncFormsOnConnect: typeof saved.syncFormsOnConnect === "boolean" ? saved.syncFormsOnConnect : fallback.syncFormsOnConnect,
    status: trimString(saved.status) || fallback.status,
    connectionMethod: trimString(saved.connectionMethod) || fallback.connectionMethod,
    connectedAt: saved.connectedAt || null,
    lastSyncAt: saved.lastSyncAt || null,
    lastSuccessfulSyncAt: saved.lastSuccessfulSyncAt || null,
    lastFailedSyncAt: saved.lastFailedSyncAt || null,
    lastPreparedAt: saved.lastPreparedAt || null,
    connectedByAdminId: saved.connectedByAdminId || null,
    accountId: trimString(saved.accountId),
    accountName: trimString(saved.accountName),
    selectedBusinessId: trimString(saved.selectedBusinessId),
    selectedBusinessName: trimString(saved.selectedBusinessName),
    selectedPageId: trimString(saved.selectedPageId),
    selectedPageName: trimString(saved.selectedPageName),
    selectedFormIds: Array.isArray(saved.selectedFormIds) ? saved.selectedFormIds.map(trimString).filter(Boolean) : [],
    selectedFormNames: Array.isArray(saved.selectedFormNames) ? saved.selectedFormNames.map(trimString).filter(Boolean) : [],
    scopeSummary: normalizeScopeSummary(saved.scopeSummary || fallback.scopeSummary),
    diagnostics: Array.isArray(saved.diagnostics) ? saved.diagnostics : [],
    lastApiError: normalizeLastApiError(saved.lastApiError),
    webhookStatus: normalizeWebhookStatus(saved.webhookStatus, {
      verifyTokenConfigured: Boolean(trimString(saved.webhookVerifyToken) || fallback.webhookVerifyToken),
      callbackUrl: trimString(saved.webhookCallbackBaseUrl || fallback.webhookCallbackBaseUrl)
        ? `${trimString(saved.webhookCallbackBaseUrl || fallback.webhookCallbackBaseUrl)}/api/meta-lead-ads/webhook`
        : "",
    }),
    fieldMapping: normalizeFieldMapping(saved.fieldMapping),
    assets: normalizeAssets(saved.assets || fallback.assets),
    source: fallback.source,
  };

  merged.webhookStatus = normalizeWebhookStatus(merged.webhookStatus, {
    verifyTokenConfigured: Boolean(merged.webhookVerifyToken),
    callbackUrl: merged.webhookCallbackBaseUrl ? `${merged.webhookCallbackBaseUrl}/api/meta-lead-ads/webhook` : "",
  });
  merged.status = deriveConnectionStatus(merged);

  return {
    ...merged,
    source: trimString(
      saved.accessToken ||
      saved.selectedPageId ||
      saved.connectedAt ||
      saved.webhookVerifyToken ||
      saved.businessLoginConfigId
    )
      ? "settings"
      : fallback.source,
    isConfigured: Boolean(merged.appId && merged.appSecret),
    isConnected: Boolean(merged.accessToken),
  };
};

const sanitizeMetaLeadAdsConnection = (value = {}) => {
  const connection = normalizeMetaLeadAdsConnection(value);

  return {
    appId: connection.appId,
    businessLoginConfigId: connection.businessLoginConfigId,
    graphApiVersion: connection.graphApiVersion,
    webhookVerifyToken: maskSecret(connection.webhookVerifyToken, { start: 3, end: 2 }),
    crmSourceLabel: connection.crmSourceLabel,
    autoCreateLeads: connection.autoCreateLeads,
    autoAssignToOwner: connection.autoAssignToOwner,
    autoSyncEnabled: connection.autoSyncEnabled,
    syncIntervalMinutes: connection.syncIntervalMinutes,
    pollLookbackMinutes: connection.pollLookbackMinutes,
    syncFormsOnConnect: connection.syncFormsOnConnect,
    status: connection.status,
    connectionMethod: connection.connectionMethod,
    connectedAt: connection.connectedAt,
    lastSyncAt: connection.lastSyncAt,
    lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
    lastFailedSyncAt: connection.lastFailedSyncAt,
    selectedBusinessId: connection.selectedBusinessId,
    selectedBusinessName: connection.selectedBusinessName,
    selectedPageId: connection.selectedPageId,
    selectedPageName: connection.selectedPageName,
    selectedFormIds: connection.selectedFormIds,
    selectedFormNames: connection.selectedFormNames,
    scopeSummary: connection.scopeSummary,
    diagnostics: Array.isArray(connection.diagnostics) ? connection.diagnostics : [],
    lastApiError: connection.lastApiError,
    webhookStatus: connection.webhookStatus,
    fieldMapping: connection.fieldMapping,
    assets: connection.assets,
    tokenSecurity: {
      encryptedAtRest: Boolean(getEncryptionSecret()),
      accessTokenStoredEncrypted: isEncryptedValue(value?.accessToken),
      pageTokensStoredEncrypted:
        value?.pageAccessTokens &&
        typeof value.pageAccessTokens === "object" &&
        !Array.isArray(value.pageAccessTokens)
          ? Object.values(value.pageAccessTokens).every((item) => !trimString(item) || isEncryptedValue(item))
          : false,
    },
  };
};

const prepareMetaLeadAdsConnectionForPersistence = (value = {}) => {
  const connection = normalizeMetaLeadAdsConnection(value);

  return {
    ...connection,
    accessToken: encryptSecret(connection.accessToken),
    appSecret: encryptSecret(connection.appSecret),
    pageAccessTokens: encryptStringMap(connection.pageAccessTokens),
  };
};

let cachedConnection = null;
let cachedAt = 0;
const CACHE_TTL_MS = 15000;

const loadMetaLeadAdsConnection = async ({ refresh = false } = {}) => {
  if (!refresh && cachedConnection && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedConnection;
  }

  const mainAdmin = await AdminUser.findOne({ role: "MainAdmin" })
    .select("settings.metaLeadAdsConnection")
    .lean();

  cachedConnection = normalizeMetaLeadAdsConnection(mainAdmin?.settings?.metaLeadAdsConnection || {});
  cachedAt = Date.now();
  return cachedConnection;
};

const syncMetaLeadAdsConnectionCache = (value = {}) => {
  cachedConnection = normalizeMetaLeadAdsConnection(value);
  cachedAt = Date.now();
  return cachedConnection;
};

module.exports = {
  REQUIRED_META_LEAD_ADS_SCOPES,
  DEFAULT_META_LEAD_FIELD_MAPPING,
  buildDefaultWebhookStatus,
  buildDefaultScopeSummary,
  buildDefaultAssets,
  buildFallbackConnection,
  normalizeMetaLeadAdsConnection,
  sanitizeMetaLeadAdsConnection,
  prepareMetaLeadAdsConnectionForPersistence,
  loadMetaLeadAdsConnection,
  syncMetaLeadAdsConnectionCache,
  getMetaLeadAdsWebhookCallbackBaseUrl,
};

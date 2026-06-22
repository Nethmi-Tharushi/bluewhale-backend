const { Types } = require("mongoose");

const AdminUser = require("../models/AdminUser");
const Lead = require("../models/Lead");
const MetaLeadAdsCampaign = require("../models/MetaLeadAdsCampaign");
const MetaLeadAdsEventLog = require("../models/MetaLeadAdsEventLog");
const MetaLeadAdsSubmission = require("../models/MetaLeadAdsSubmission");
const MetaLeadAdsSyncLog = require("../models/MetaLeadAdsSyncLog");
const {
  DEFAULT_META_LEAD_FIELD_MAPPING,
  REQUIRED_META_LEAD_ADS_SCOPES,
  loadMetaLeadAdsConnection,
  normalizeMetaLeadAdsConnection,
  prepareMetaLeadAdsConnectionForPersistence,
  sanitizeMetaLeadAdsConnection,
  syncMetaLeadAdsConnectionCache,
} = require("./metaLeadAdsConnectionService");
const {
  buildMetaAppAccessToken,
  fetchMetaGraphCollection,
  metaGraphRequest,
  trimString,
} = require("./metaGraphService");
const { getMetaLeadAdsCampaignLauncherState } = require("./metaLeadAdsCampaignLauncherService");
const { DEFAULT_LEAD_STATUS, normalizeLeadTags } = require("../utils/leadSupport");

const SUPPORTED_LEAD_FIELDS = new Set([
  "name",
  "firstName",
  "lastName",
  "email",
  "phone",
  "company",
  "website",
  "address",
  "city",
  "state",
  "country",
  "zipCode",
  "description",
]);
const META_CAMPAIGN_READ_SCOPES = Object.freeze(["ads_read", "ads_management"]);
const META_LEAD_CAMPAIGN_OBJECTIVES = new Set([
  "LEAD_GENERATION",
  "OUTCOME_LEADS",
  "OUTCOME_LEAD_GENERATION",
  "PRODUCT_CATALOG_SALES",
]);
const META_TOKEN_ERROR_CODES = new Set(["102", "190"]);
const META_PERMISSION_ERROR_CODES = new Set(["10", "200", "294"]);
const RETRYABLE_EVENT_STATUSES = new Set(["failed", "retry_pending"]);
const SUCCESSFUL_SUBMISSION_STATUSES = new Set(["created", "pending_review"]);
const STATUS_LOG_LIMIT = 5;
const DEFAULT_LOG_LIMIT = 25;
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MINUTES = 20;

const createIntegrationError = (message, status = 400, code = "META_LEAD_ADS_ERROR", details = null) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details && typeof details === "object") {
    error.details = details;
  }
  return error;
};

const parseBoolean = (value, fallback) => {
  if (typeof value === "boolean") return value;
  if (value === undefined) return fallback;
  const normalized = trimString(value).toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const normalizeArray = (value) => {
  if (Array.isArray(value)) return value.map(trimString).filter(Boolean);
  if (trimString(value)) return [trimString(value)];
  return [];
};

const pickFirstNonEmpty = (...values) => {
  for (const value of values) {
    const normalized = trimString(value);
    if (normalized) return normalized;
  }
  return "";
};

const normalizeFieldKey = (value) =>
  trimString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const dedupeById = (items = []) => {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const id = trimString(item?.id || item?._id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }

  return result;
};

const buildScopeSummary = (permissions = []) => {
  const granted = [];
  const declined = [];

  for (const item of Array.isArray(permissions) ? permissions : []) {
    const permission = trimString(item?.permission || item?.name);
    const status = trimString(item?.status || (item?.granted ? "granted" : ""));
    if (!permission) continue;
    if (status === "granted") granted.push(permission);
    else declined.push(permission);
  }

  return {
    required: [...REQUIRED_META_LEAD_ADS_SCOPES],
    granted,
    declined,
    missingRequired: REQUIRED_META_LEAD_ADS_SCOPES.filter((scope) => !granted.includes(scope)),
    grantedCount: granted.length,
    lastCheckedAt: new Date().toISOString(),
  };
};

const hasAnyCampaignReadScope = (grantedScopes = []) =>
  META_CAMPAIGN_READ_SCOPES.some((scope) => Array.isArray(grantedScopes) && grantedScopes.includes(scope));

const normalizeMetaCampaignStatus = (campaign = {}) => {
  const effectiveStatus = trimString(campaign?.effective_status || campaign?.effectiveStatus).toUpperCase();
  const configuredStatus = trimString(campaign?.configured_status || campaign?.configuredStatus).toUpperCase();
  if (["ACTIVE", "IN_PROCESS"].includes(effectiveStatus) || configuredStatus === "ACTIVE") return "active";
  if (["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"].includes(effectiveStatus) || configuredStatus === "PAUSED") return "paused";
  if (["DELETED", "ARCHIVED"].includes(effectiveStatus)) return "archived";
  return "inactive";
};

const isLeadGenerationCampaign = (campaign = {}) => {
  const objective = trimString(campaign?.objective).toUpperCase();
  return META_LEAD_CAMPAIGN_OBJECTIVES.has(objective);
};

const buildSafeMetaErrorMessage = (message, fallback = "Meta request failed.") => {
  const normalized = trimString(message || fallback) || fallback;
  return normalized
    .replace(/EA[A-Za-z0-9]+/g, "[masked]")
    .replace(/[A-Za-z0-9_-]{20,}\|[A-Za-z0-9_-]{10,}/g, "[masked]")
    .slice(0, 400);
};

const toSafeDiagnostic = (value = {}) => ({
  level: trimString(value.level) || "warning",
  code: trimString(value.code) || "meta_error",
  message: buildSafeMetaErrorMessage(value.message || value.summary || "Meta request failed."),
});

const normalizeMetaApiError = (error, context = "") => {
  const code = trimString(error?.code || error?.details?.code || error?.details?.error_subcode || "");
  const message = buildSafeMetaErrorMessage(error?.message || error?.details?.message || "Meta request failed.");
  const lowerMessage = message.toLowerCase();
  const tokenExpired =
    META_TOKEN_ERROR_CODES.has(code) ||
    lowerMessage.includes("access token") ||
    lowerMessage.includes("session has expired") ||
    lowerMessage.includes("invalid oauth");
  const permissionFailure =
    META_PERMISSION_ERROR_CODES.has(code) ||
    lowerMessage.includes("permission") ||
    lowerMessage.includes("requires ads_read") ||
    lowerMessage.includes("requires ads_management") ||
    lowerMessage.includes("not authorized");
  const assetAccessFailure =
    lowerMessage.includes("page") ||
    lowerMessage.includes("form") ||
    lowerMessage.includes("ad account")
      ? lowerMessage.includes("not found") ||
        lowerMessage.includes("no access") ||
        lowerMessage.includes("unsupported get request") ||
        lowerMessage.includes("permission")
      : false;

  return {
    code: code || "META_GRAPH_REQUEST_FAILED",
    message,
    category: tokenExpired ? "token" : permissionFailure ? "permissions" : assetAccessFailure ? "asset_access" : "api",
    needsReconnect: tokenExpired,
    retryable: !tokenExpired && !permissionFailure,
    occurredAt: new Date(),
    context: trimString(context),
  };
};

const computeNextRetryAt = (attempts = 1, baseMinutes = RETRY_DELAY_MINUTES) =>
  new Date(Date.now() + Math.max(1, Number(baseMinutes || RETRY_DELAY_MINUTES)) * Math.max(1, Number(attempts || 1)) * 60 * 1000);

const buildTokenHealth = (connection = {}) => {
  const expiresAt = connection?.tokenExpiresAt || null;
  const lastError = trimString(connection?.lastApiError?.message || connection?.webhookStatus?.lastErrorMessage || "");
  const isExpired =
    Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now()) || Boolean(connection?.lastApiError?.needsReconnect);
  const expiresSoon =
    Boolean(expiresAt) && new Date(expiresAt).getTime() > Date.now() &&
    new Date(expiresAt).getTime() - Date.now() <= 3 * 24 * 60 * 60 * 1000;

  let status = "unknown";
  if (!trimString(connection?.accessToken)) {
    status = "unknown";
  } else if (isExpired) {
    status = "expired";
  } else if (connection?.lastApiError?.category === "permissions") {
    status = "failed";
  } else if (lastError || expiresSoon) {
    status = "warning";
  } else {
    status = "ok";
  }

  return {
    status,
    expiresAt,
    lastError,
    needsReconnect: Boolean(isExpired),
  };
};

const recordMetaLeadAdsSyncLog = async ({
  adminId = null,
  source = "manual_sync",
  runType = "lead_sync",
  status = "success",
  title = "",
  summary = "",
  metaLeadId = "",
  pageId = "",
  pageName = "",
  formId = "",
  formName = "",
  campaignId = "",
  campaignName = "",
  attempts = 1,
  retryable = false,
  nextRetryAt = null,
  diagnostics = [],
  occurredAt = new Date(),
} = {}) =>
  MetaLeadAdsSyncLog.create({
    adminId: adminId && Types.ObjectId.isValid(String(adminId)) ? adminId : null,
    source,
    runType,
    status,
    title: trimString(title),
    summary: buildSafeMetaErrorMessage(summary || title),
    metaLeadId: trimString(metaLeadId),
    pageId: trimString(pageId),
    pageName: trimString(pageName),
    formId: trimString(formId),
    formName: trimString(formName),
    campaignId: trimString(campaignId),
    campaignName: trimString(campaignName),
    attempts: Math.max(1, Number(attempts || 1)),
    retryable: Boolean(retryable),
    nextRetryAt: nextRetryAt || null,
    diagnostics: Array.isArray(diagnostics) ? diagnostics.map(toSafeDiagnostic) : [],
    occurredAt: occurredAt || new Date(),
  }).catch(() => null);

const updateConnectionErrorState = (connection = {}, error, context = "") => {
  const normalizedError = normalizeMetaApiError(error, context);
  return normalizeMetaLeadAdsConnection({
    ...connection,
    lastApiError: normalizedError,
    lastFailedSyncAt: new Date(),
  });
};

const clearConnectionErrorState = (connection = {}) =>
  normalizeMetaLeadAdsConnection({
    ...connection,
    lastApiError: null,
    lastSuccessfulSyncAt: new Date(),
  });

const applyCompactLogCollections = (settings = {}, logs = {}, limit = STATUS_LOG_LIMIT) => ({
  ...settings,
  syncHistory: Array.isArray(logs?.syncHistory) ? logs.syncHistory.slice(0, limit) : [],
  syncedLeads: Array.isArray(logs?.syncedLeads) ? logs.syncedLeads.slice(0, limit) : [],
  failedSyncs: Array.isArray(logs?.failedSyncs) ? logs.failedSyncs.slice(0, limit) : [],
});

const buildWebhookCallbackUrl = (connection = {}) =>
  trimString(connection.webhookCallbackBaseUrl)
    ? `${trimString(connection.webhookCallbackBaseUrl).replace(/\/+$/, "")}/api/meta-lead-ads/webhook`
    : "";

const buildConnectionDiagnostics = (connection = {}) => {
  const diagnostics = [];

  if (!trimString(connection.appId) || !trimString(connection.appSecret)) {
    diagnostics.push({
      level: "error",
      code: "missing_app_config",
      message: "Meta app ID and app secret must be configured on the server.",
    });
  }

  if (!trimString(connection.accessToken)) {
    diagnostics.push({
      level: "warning",
      code: "missing_access_token",
      message: "No Meta Lead Ads access token is connected yet.",
    });
  }

  if (Array.isArray(connection?.scopeSummary?.missingRequired) && connection.scopeSummary.missingRequired.length) {
    diagnostics.push({
      level: "warning",
      code: "missing_scopes",
      message: `Missing required Meta permissions: ${connection.scopeSummary.missingRequired.join(", ")}.`,
    });
  }

  if (!trimString(connection.selectedPageId) && trimString(connection.accessToken)) {
    diagnostics.push({
      level: "warning",
      code: "missing_page_selection",
      message: "No Meta Page is selected for webhook subscriptions yet.",
    });
  }

  if (!trimString(connection.webhookVerifyToken)) {
    diagnostics.push({
      level: "warning",
      code: "missing_verify_token",
      message: "Webhook verify token is not configured.",
    });
  }

  if (connection?.webhookStatus?.status === "error" && trimString(connection?.webhookStatus?.lastErrorMessage)) {
    diagnostics.push({
      level: "warning",
      code: "webhook_subscription_issue",
      message: trimString(connection.webhookStatus.lastErrorMessage),
    });
  }

  if (trimString(connection?.lastApiError?.message)) {
    diagnostics.push({
      level: connection?.lastApiError?.needsReconnect ? "error" : "warning",
      code: trimString(connection?.lastApiError?.code) || "meta_api_error",
      message: trimString(connection?.lastApiError?.message),
    });
  }

  if (!diagnostics.length && trimString(connection.accessToken)) {
    diagnostics.push({
      level: "info",
      code: "ready",
      message: "Meta Lead Ads connection is ready.",
    });
  }

  return diagnostics;
};

const buildSafeConnectionResponse = (connection = {}) => {
  const normalized = normalizeMetaLeadAdsConnection(connection);
  const existingDiagnostics = Array.isArray(normalized.diagnostics) ? normalized.diagnostics : [];
  const withWebhook = {
    ...normalized,
    webhookStatus: {
      ...(normalized.webhookStatus || {}),
      verifyTokenConfigured: Boolean(trimString(normalized.webhookVerifyToken)),
      callbackUrl: buildWebhookCallbackUrl(normalized),
    },
  };
  withWebhook.diagnostics = [...buildConnectionDiagnostics(withWebhook), ...existingDiagnostics];
  return sanitizeMetaLeadAdsConnection(withWebhook);
};

const assertMetaLeadAdsReadyForExchange = (connection = {}) => {
  if (!trimString(connection.appId) || !trimString(connection.appSecret)) {
    throw createIntegrationError(
      "Meta app ID and app secret are required before connecting Lead Ads.",
      400,
      "META_LEAD_ADS_MISSING_APP_CREDENTIALS"
    );
  }
};

const assertMetaLeadAdsConnected = (connection = {}) => {
  if (!trimString(connection.accessToken)) {
    throw createIntegrationError(
      "Meta Lead Ads is not connected yet.",
      400,
      "META_LEAD_ADS_MISSING_ACCESS_TOKEN"
    );
  }
};

const assertMainAdminDoc = async (adminId) => {
  const admin = await AdminUser.findById(adminId);
  if (!admin) {
    throw createIntegrationError("Admin not found", 404, "ADMIN_NOT_FOUND");
  }

  return admin;
};

const getCurrentConnectionForAdmin = (admin) =>
  normalizeMetaLeadAdsConnection(admin?.settings?.metaLeadAdsConnection || {});

const applyConnectionInput = (connection = {}, input = {}) => {
  const nextConnection = {
    ...connection,
  };

  if (typeof input.crmSourceLabel === "string") {
    nextConnection.crmSourceLabel = trimString(input.crmSourceLabel) || connection.crmSourceLabel;
  }
  if (input.autoCreateLeads !== undefined) {
    nextConnection.autoCreateLeads = parseBoolean(input.autoCreateLeads, connection.autoCreateLeads);
  }
  if (input.autoAssignToOwner !== undefined) {
    nextConnection.autoAssignToOwner = parseBoolean(input.autoAssignToOwner, connection.autoAssignToOwner);
  }
  if (input.autoSyncEnabled !== undefined) {
    nextConnection.autoSyncEnabled = parseBoolean(input.autoSyncEnabled, connection.autoSyncEnabled);
  }
  if (input.syncIntervalMinutes !== undefined) {
    const normalized = Number(input.syncIntervalMinutes);
    if (Number.isFinite(normalized)) {
      nextConnection.syncIntervalMinutes = Math.min(59, Math.max(5, Math.round(normalized)));
    }
  }
  if (input.pollLookbackMinutes !== undefined) {
    const normalized = Number(input.pollLookbackMinutes);
    if (Number.isFinite(normalized)) {
      nextConnection.pollLookbackMinutes = Math.min(240, Math.max(5, Math.round(normalized)));
    }
  }
  if (input.syncFormsOnConnect !== undefined) {
    nextConnection.syncFormsOnConnect = parseBoolean(input.syncFormsOnConnect, connection.syncFormsOnConnect);
  }
  if (input.fieldMapping && typeof input.fieldMapping === "object" && !Array.isArray(input.fieldMapping)) {
    nextConnection.fieldMapping = {
      ...DEFAULT_META_LEAD_FIELD_MAPPING,
      ...connection.fieldMapping,
      ...input.fieldMapping,
    };
  }
  if (typeof input.selectedBusinessId === "string") {
    nextConnection.selectedBusinessId = trimString(input.selectedBusinessId);
  }
  if (typeof input.selectedBusinessName === "string") {
    nextConnection.selectedBusinessName = trimString(input.selectedBusinessName);
  }
  if (typeof input.selectedPageId === "string") {
    nextConnection.selectedPageId = trimString(input.selectedPageId);
  }
  if (typeof input.selectedPageName === "string") {
    nextConnection.selectedPageName = trimString(input.selectedPageName);
  }
  if (Array.isArray(input.selectedFormIds)) {
    nextConnection.selectedFormIds = input.selectedFormIds.map(trimString).filter(Boolean);
  }
  if (Array.isArray(input.selectedFormNames)) {
    nextConnection.selectedFormNames = input.selectedFormNames.map(trimString).filter(Boolean);
  }

  return nextConnection;
};

const fetchGrantedPermissions = async ({ accessToken, graphApiVersion }) => {
  if (!trimString(accessToken)) return [];

  const response = await metaGraphRequest({
    version: graphApiVersion,
    path: "me/permissions",
    query: {
      access_token: accessToken,
    },
  });

  return Array.isArray(response?.data) ? response.data : [];
};

const fetchTokenDebugMetadata = async ({ accessToken, appId, appSecret, graphApiVersion }) => {
  const appAccessToken = buildMetaAppAccessToken({ appId, appSecret });
  if (!trimString(accessToken) || !trimString(appAccessToken)) {
    return {};
  }

  const response = await metaGraphRequest({
    version: graphApiVersion,
    path: "debug_token",
    query: {
      input_token: accessToken,
      access_token: appAccessToken,
    },
  });

  return response?.data || {};
};

const fetchMetaBusinesses = async ({ accessToken, graphApiVersion }) =>
  fetchMetaGraphCollection({
    version: graphApiVersion,
    path: "me/businesses",
    query: {
      access_token: accessToken,
      fields: "id,name",
      limit: 100,
    },
  });

const fetchMetaAdAccounts = async ({ accessToken, graphApiVersion }) =>
  fetchMetaGraphCollection({
    version: graphApiVersion,
    path: "me/adaccounts",
    query: {
      access_token: accessToken,
      fields: "id,name,account_status,business{id,name}",
      limit: 100,
    },
  });

const fetchMetaCampaignsForAdAccount = async ({ adAccountId, accessToken, graphApiVersion }) => {
  if (!trimString(adAccountId)) return [];

  return fetchMetaGraphCollection({
    version: graphApiVersion,
    path: `${trimString(adAccountId)}/campaigns`,
    query: {
      access_token: accessToken,
      fields: "id,name,objective,status,effective_status,configured_status,start_time,stop_time,updated_time",
      limit: 100,
    },
  });
};

const normalizePageAsset = (page = {}, accessiblePage = {}) => ({
  id: trimString(page.id || accessiblePage.id),
  name: trimString(page.name || accessiblePage.name),
  category: trimString(page.category || accessiblePage.category),
  tasks: Array.isArray(accessiblePage.tasks) ? accessiblePage.tasks.map(trimString).filter(Boolean) : [],
  businessId: trimString(page?.business?.id || accessiblePage?.business?.id),
  businessName: trimString(page?.business?.name || accessiblePage?.business?.name),
});

const fetchAccessiblePages = async ({ accessToken, graphApiVersion }) => {
  const pages = await fetchMetaGraphCollection({
    version: graphApiVersion,
    path: "me/accounts",
    query: {
      access_token: accessToken,
      fields: "id,name,access_token,tasks,category,business{id,name}",
      limit: 100,
    },
  });

  return Array.isArray(pages) ? pages : [];
};

const fetchBusinessPages = async ({ businessId, accessToken, graphApiVersion }) => {
  if (!trimString(businessId)) return [];

  const ownedPages = await fetchMetaGraphCollection({
    version: graphApiVersion,
    path: `${trimString(businessId)}/owned_pages`,
    query: {
      access_token: accessToken,
      fields: "id,name,category,business{id,name}",
      limit: 100,
    },
  }).catch(() => []);

  const clientPages = await fetchMetaGraphCollection({
    version: graphApiVersion,
    path: `${trimString(businessId)}/client_pages`,
    query: {
      access_token: accessToken,
      fields: "id,name,category,business{id,name}",
      limit: 100,
    },
  }).catch(() => []);

  return [...ownedPages, ...clientPages];
};

const fetchLeadgenFormsForPage = async ({ pageId, pageAccessToken, graphApiVersion }) => {
  if (!trimString(pageId) || !trimString(pageAccessToken)) return [];

  return fetchMetaGraphCollection({
    version: graphApiVersion,
    path: `${trimString(pageId)}/leadgen_forms`,
    query: {
      access_token: pageAccessToken,
      fields: "id,name,status,locale,created_time,questions,follow_up_action_url",
      limit: 100,
    },
  });
};

const fetchSubscribedApps = async ({ pageId, pageAccessToken, graphApiVersion }) => {
  if (!trimString(pageId) || !trimString(pageAccessToken)) return [];

  return fetchMetaGraphCollection({
    version: graphApiVersion,
    path: `${trimString(pageId)}/subscribed_apps`,
    query: {
      access_token: pageAccessToken,
      fields: "id,name,subscribed_fields",
      limit: 100,
    },
  });
};

const ensureLeadgenWebhookSubscription = async ({
  pageId,
  pageAccessToken,
  graphApiVersion,
  appId,
} = {}) => {
  const callbackStatus = {
    status: "not_subscribed",
    selectedPageSubscribed: false,
    selectedPageId: trimString(pageId),
    subscribedFields: [],
    lastVerifiedAt: null,
    lastEventAt: null,
    lastProcessedAt: null,
    lastErrorAt: null,
    lastErrorMessage: "",
  };

  if (!trimString(pageId)) {
    callbackStatus.status = "warning";
    callbackStatus.lastErrorMessage = "No Meta Page is selected for leadgen webhook subscription.";
    return callbackStatus;
  }

  if (!trimString(pageAccessToken)) {
    callbackStatus.status = "warning";
    callbackStatus.lastErrorMessage = "Selected Meta Page does not have a usable page access token.";
    return callbackStatus;
  }

  const subscribedApps = await fetchSubscribedApps({
    pageId,
    pageAccessToken,
    graphApiVersion,
  });
  const existing = subscribedApps.find((item) => trimString(item?.id) === trimString(appId));

  if (existing && Array.isArray(existing.subscribed_fields) && existing.subscribed_fields.includes("leadgen")) {
    callbackStatus.status = "subscribed";
    callbackStatus.selectedPageSubscribed = true;
    callbackStatus.subscribedFields = existing.subscribed_fields;
    return callbackStatus;
  }

  await metaGraphRequest({
    version: graphApiVersion,
    path: `${trimString(pageId)}/subscribed_apps`,
    method: "POST",
    body: {
      access_token: pageAccessToken,
      subscribed_fields: "leadgen",
    },
  });

  const refreshed = await fetchSubscribedApps({
    pageId,
    pageAccessToken,
    graphApiVersion,
  });
  const subscribed = refreshed.find((item) => trimString(item?.id) === trimString(appId));

  callbackStatus.status = subscribed ? "subscribed" : "warning";
  callbackStatus.selectedPageSubscribed = Boolean(subscribed);
  callbackStatus.subscribedFields = Array.isArray(subscribed?.subscribed_fields)
    ? subscribed.subscribed_fields
    : ["leadgen"];
  if (!subscribed) {
    callbackStatus.lastErrorAt = new Date();
    callbackStatus.lastErrorMessage = "Meta did not confirm the Page leadgen subscription after the sync attempt.";
  }
  return callbackStatus;
};

const saveAdminConnection = async (admin, connection, auditLabel = "") => {
  admin.settings = admin.settings || {};
  admin.settings.metaLeadAdsConnection = prepareMetaLeadAdsConnectionForPersistence(connection);
  if (auditLabel) {
    admin.auditLogs = admin.auditLogs || [];
    admin.auditLogs.unshift({
      when: new Date(),
      what: auditLabel,
      who: "You",
      ip: "",
    });
    if (admin.auditLogs.length > 50) {
      admin.auditLogs = admin.auditLogs.slice(0, 50);
    }
  }
  await admin.save();
  const normalizedConnection = normalizeMetaLeadAdsConnection(admin.settings.metaLeadAdsConnection);
  syncMetaLeadAdsConnectionCache(normalizedConnection);
  return normalizedConnection;
};

const resolveSelectedAsset = (items = [], explicitId = "", savedId = "") => {
  const requestedId = trimString(explicitId) || trimString(savedId);
  if (requestedId) {
    return items.find((item) => trimString(item?.id) === requestedId) || null;
  }
  return items[0] || null;
};

const selectForms = (forms = [], preferredIds = []) => {
  const normalizedPreferredIds = normalizeArray(preferredIds);
  if (!forms.length) return [];
  if (!normalizedPreferredIds.length) return forms;
  const byId = new Set(normalizedPreferredIds);
  const selected = forms.filter((item) => byId.has(trimString(item?.id)));
  return selected.length ? selected : forms;
};

const normalizeAdAccountAsset = (account = {}) => ({
  id: trimString(account?.id),
  name: trimString(account?.name),
  accountStatus: trimString(account?.account_status),
  businessId: trimString(account?.business?.id),
  businessName: trimString(account?.business?.name),
});

const normalizeCampaignAsset = (campaign = {}, adAccount = {}, page = {}) => ({
  id: trimString(campaign?.id),
  name: trimString(campaign?.name),
  objective: trimString(campaign?.objective),
  configuredStatus: trimString(campaign?.configured_status || campaign?.configuredStatus),
  effectiveStatus: trimString(campaign?.effective_status || campaign?.effectiveStatus),
  status: normalizeMetaCampaignStatus(campaign),
  isLeadGeneration: isLeadGenerationCampaign(campaign),
  isActive: normalizeMetaCampaignStatus(campaign) === "active",
  adAccountId: trimString(adAccount?.id),
  adAccountName: trimString(adAccount?.name),
  businessId: trimString(adAccount?.businessId || adAccount?.business?.id),
  businessName: trimString(adAccount?.businessName || adAccount?.business?.name),
  pageId: trimString(page?.id),
  pageName: trimString(page?.name),
  startTime: campaign?.start_time || null,
  stopTime: campaign?.stop_time || null,
  updatedTime: campaign?.updated_time || null,
});

const upsertMetaCampaignRecords = async ({ campaigns = [] } = {}) => {
  const items = [];

  for (const campaign of Array.isArray(campaigns) ? campaigns : []) {
    if (!trimString(campaign?.id)) continue;

    const record = await MetaLeadAdsCampaign.findOneAndUpdate(
      { campaignId: trimString(campaign.id) },
      {
        $set: {
          adAccountId: trimString(campaign.adAccountId),
          adAccountName: trimString(campaign.adAccountName),
          businessId: trimString(campaign.businessId),
          businessName: trimString(campaign.businessName),
          pageId: trimString(campaign.pageId),
          pageName: trimString(campaign.pageName),
          campaignName: trimString(campaign.name),
          objective: trimString(campaign.objective),
          configuredStatus: trimString(campaign.configuredStatus),
          effectiveStatus: trimString(campaign.effectiveStatus),
          status: trimString(campaign.status || "inactive"),
          isLeadGeneration: Boolean(campaign.isLeadGeneration),
          isActive: Boolean(campaign.isActive),
          crmSynchronized: true,
          syncedAt: new Date(),
          lastSeenAt: new Date(),
          startTime: campaign.startTime ? new Date(campaign.startTime) : null,
          stopTime: campaign.stopTime ? new Date(campaign.stopTime) : null,
          sourcePayload: campaign,
        },
        $setOnInsert: {
          campaignId: trimString(campaign.id),
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    items.push({
      id: trimString(record?.campaignId || campaign.id),
      name: trimString(record?.campaignName || campaign.name),
      objective: trimString(record?.objective || campaign.objective),
      configuredStatus: trimString(record?.configuredStatus || campaign.configuredStatus),
      effectiveStatus: trimString(record?.effectiveStatus || campaign.effectiveStatus),
      status: trimString(record?.status || campaign.status),
      isLeadGeneration: Boolean(record?.isLeadGeneration ?? campaign.isLeadGeneration),
      isActive: Boolean(record?.isActive ?? campaign.isActive),
      adAccountId: trimString(record?.adAccountId || campaign.adAccountId),
      adAccountName: trimString(record?.adAccountName || campaign.adAccountName),
      businessId: trimString(record?.businessId || campaign.businessId),
      businessName: trimString(record?.businessName || campaign.businessName),
      pageId: trimString(record?.pageId || campaign.pageId),
      pageName: trimString(record?.pageName || campaign.pageName),
      startTime: record?.startTime || campaign.startTime || null,
      stopTime: record?.stopTime || campaign.stopTime || null,
      syncedAt: record?.syncedAt || new Date(),
    });
  }

  return items;
};

const listStoredMetaLeadAdsCampaigns = async ({ activeOnly = false } = {}) => {
  const query = activeOnly ? { isLeadGeneration: true, isActive: true } : {};
  const campaigns = await MetaLeadAdsCampaign.find(query).sort({ updatedAt: -1 }).lean();
  return campaigns.map((campaign) => ({
    id: trimString(campaign?.campaignId),
    name: trimString(campaign?.campaignName),
    objective: trimString(campaign?.objective),
    configuredStatus: trimString(campaign?.configuredStatus),
    effectiveStatus: trimString(campaign?.effectiveStatus),
    status: trimString(campaign?.status),
    isLeadGeneration: Boolean(campaign?.isLeadGeneration),
    isActive: Boolean(campaign?.isActive),
    adAccountId: trimString(campaign?.adAccountId),
    adAccountName: trimString(campaign?.adAccountName),
    businessId: trimString(campaign?.businessId),
    businessName: trimString(campaign?.businessName),
    pageId: trimString(campaign?.pageId),
    pageName: trimString(campaign?.pageName),
    syncedAt: campaign?.syncedAt || null,
    startTime: campaign?.startTime || null,
    stopTime: campaign?.stopTime || null,
  }));
};

const buildSyncHistoryItem = (item = {}) => ({
  id: trimString(item?._id || item?.id || item?.eventKey || item?.metaLeadId),
  status: trimString(item?.status) || "unknown",
  title: trimString(item?.title),
  summary: trimString(item?.summary || item?.errorMessage),
  occurredAt: item?.occurredAt || item?.processedAt || item?.updatedAt || item?.createdAt || item?.receivedAt || null,
  metaLeadId: trimString(item?.metaLeadId),
  pageId: trimString(item?.pageId),
  pageName: trimString(item?.pageName),
  formId: trimString(item?.formId),
  formName: trimString(item?.formName),
  campaignId: trimString(item?.campaignId),
  campaignName: trimString(item?.campaignName),
  attempts: Math.max(1, Number(item?.attempts || 1)),
  nextRetryAt: item?.nextRetryAt || null,
});

const mapSubmissionToLeadLogItem = (submission = {}) => ({
  id: trimString(submission?._id || submission?.metaLeadId),
  status: trimString(submission?.status) || "received",
  title:
    trimString(submission?.status) === "created"
      ? "Lead synced to CRM"
      : trimString(submission?.status) === "pending_review"
        ? "Lead stored for review"
        : "Lead ingestion updated",
  summary:
    trimString(submission?.status) === "created"
      ? "Meta lead was created or updated in CRM."
      : trimString(submission?.status) === "pending_review"
        ? "Meta lead was stored without creating a CRM lead because auto-create is disabled."
        : buildSafeMetaErrorMessage(submission?.errorMessage || "Meta lead submission updated."),
  occurredAt: submission?.processedAt || submission?.updatedAt || submission?.createdAt || submission?.receivedAt || null,
  metaLeadId: trimString(submission?.metaLeadId),
  pageId: trimString(submission?.pageId),
  pageName: trimString(submission?.pageName),
  formId: trimString(submission?.formId),
  formName: trimString(submission?.formName),
  campaignId: trimString(submission?.campaignId),
  campaignName: trimString(submission?.campaignName),
  attempts: Math.max(1, Number(submission?.attempts || 1)),
  nextRetryAt: null,
});

const mapFailedEventToLogItem = (eventLog = {}) =>
  buildSyncHistoryItem({
    ...eventLog,
    title: trimString(eventLog?.title) || "Lead sync failed",
    summary: trimString(eventLog?.summary) || buildSafeMetaErrorMessage(eventLog?.errorMessage || "Meta lead sync failed."),
  });

const getMetaLeadAdsLogs = async ({ limit = DEFAULT_LOG_LIMIT } = {}) => {
  const normalizedLimit = Math.max(1, Math.min(Number(limit || DEFAULT_LOG_LIMIT), 100));
  const [syncHistoryRows, submissionRows, failedRows] = await Promise.all([
    MetaLeadAdsSyncLog.find({})
      .sort({ occurredAt: -1, createdAt: -1 })
      .lean(),
    MetaLeadAdsSubmission.find({
      status: { $in: [...SUCCESSFUL_SUBMISSION_STATUSES] },
    })
      .sort({ processedAt: -1, updatedAt: -1, createdAt: -1 })
      .lean(),
    MetaLeadAdsEventLog.find({
      status: { $in: [...RETRYABLE_EVENT_STATUSES] },
      retryable: true,
    })
      .sort({ nextRetryAt: 1, updatedAt: -1 })
      .lean(),
  ]);

  const syncHistory = (Array.isArray(syncHistoryRows) ? syncHistoryRows : [])
    .slice(0, normalizedLimit)
    .map(buildSyncHistoryItem);
  const syncedLeads = (Array.isArray(submissionRows) ? submissionRows : [])
    .slice(0, normalizedLimit)
    .map(mapSubmissionToLeadLogItem);
  const failedSyncs = (Array.isArray(failedRows) ? failedRows : [])
    .slice(0, normalizedLimit)
    .map(mapFailedEventToLogItem);

  const [totalSyncedLeads, failedSyncCount] = await Promise.all([
    MetaLeadAdsSubmission.countDocuments({
      status: { $in: [...SUCCESSFUL_SUBMISSION_STATUSES] },
    }).catch(() => syncedLeads.length),
    MetaLeadAdsEventLog.countDocuments({
      status: { $in: [...RETRYABLE_EVENT_STATUSES] },
      retryable: true,
    }).catch(() => failedSyncs.length),
  ]);

  const lastSuccessfulSyncAt =
    syncedLeads[0]?.occurredAt ||
    syncHistory.find((item) => ["success", "processed"].includes(trimString(item?.status)))?.occurredAt ||
    null;

  return {
    syncHistory,
    syncedLeads,
    failedSyncs,
    syncSummary: {
      totalSyncedLeads: Number(totalSyncedLeads || 0),
      failedSyncCount: Number(failedSyncCount || 0),
      lastSuccessfulSyncAt,
    },
  };
};

const buildMetaLeadAdsStatusPayload = async (connection = {}, { includeLogs = false, logsLimit = STATUS_LOG_LIMIT } = {}) => {
  const safe = buildSafeConnectionResponse(connection);
  if (!Array.isArray(safe?.assets?.campaigns) || !safe.assets.campaigns.length) {
    safe.assets = {
      ...(safe.assets || {}),
      campaigns: await listStoredMetaLeadAdsCampaigns({ activeOnly: false }),
    };
  }

  const logs = await getMetaLeadAdsLogs({ limit: includeLogs ? logsLimit : STATUS_LOG_LIMIT });
  const settings = {
    ...safe,
    tokenHealth: buildTokenHealth(connection),
    syncSummary: logs.syncSummary,
    campaignLauncher: getMetaLeadAdsCampaignLauncherState({ connection }),
  };

  return includeLogs ? applyCompactLogCollections(settings, logs, logsLimit) : settings;
};

const syncMetaLeadAdsAssets = async ({ adminId, input = {} } = {}) => {
  const admin = await assertMainAdminDoc(adminId);
  let connection = applyConnectionInput(getCurrentConnectionForAdmin(admin), input);
  const syncMode = trimString(input.syncMode) === "campaigns" ? "campaign_sync" : "asset_sync";

  assertMetaLeadAdsReadyForExchange(connection);
  assertMetaLeadAdsConnected(connection);

  try {
    const graphApiVersion = connection.graphApiVersion;
    const accessToken = connection.accessToken;
    const permissions = await fetchGrantedPermissions({ accessToken, graphApiVersion });
    const scopeSummary = buildScopeSummary(permissions);
    const businesses = (await fetchMetaBusinesses({ accessToken, graphApiVersion }))
      .map((business) => ({
        id: trimString(business?.id),
        name: trimString(business?.name),
      }))
      .filter((business) => business.id);

    const accessiblePages = await fetchAccessiblePages({ accessToken, graphApiVersion });
    const accessiblePageTokenMap = accessiblePages.reduce((acc, page) => {
      const pageId = trimString(page?.id);
      const pageToken = trimString(page?.access_token);
      if (pageId && pageToken) {
        acc[pageId] = pageToken;
      }
      return acc;
    }, {});

    const selectedBusiness = resolveSelectedAsset(
      businesses,
      input.selectedBusinessId,
      connection.selectedBusinessId
    );
    if (trimString(input.selectedBusinessId) && !selectedBusiness) {
      throw createIntegrationError(
        "Selected Meta business was not found in the connected account.",
        400,
        "META_LEAD_ADS_INVALID_BUSINESS"
      );
    }

    const businessPages = await fetchBusinessPages({
      businessId: selectedBusiness?.id || "",
      accessToken,
      graphApiVersion,
    });

    const mergedPages = dedupeById(
      [
        ...accessiblePages.map((page) => normalizePageAsset(page, page)),
        ...businessPages.map((page) =>
          normalizePageAsset(
            page,
            accessiblePages.find((candidate) => trimString(candidate?.id) === trimString(page?.id)) || {}
          )
        ),
      ].filter((page) => page.id)
    );

    const pageList = selectedBusiness?.id
      ? mergedPages.filter((page) => !page.businessId || page.businessId === selectedBusiness.id)
      : mergedPages;
    const selectedPage = resolveSelectedAsset(pageList, input.selectedPageId, connection.selectedPageId);
    if (trimString(input.selectedPageId) && !selectedPage) {
      throw createIntegrationError(
        "Selected Meta Page was not found in the connected account.",
        400,
        "META_LEAD_ADS_INVALID_PAGE"
      );
    }

    const selectedPageToken = trimString(
      accessiblePageTokenMap[selectedPage?.id || ""] || connection.pageAccessTokens?.[selectedPage?.id || ""] || ""
    );
    const forms = selectedPage?.id
      ? (await fetchLeadgenFormsForPage({
          pageId: selectedPage.id,
          pageAccessToken: selectedPageToken,
          graphApiVersion,
        }))
          .map((form) => ({
            id: trimString(form?.id),
            name: trimString(form?.name),
            status: trimString(form?.status),
            locale: trimString(form?.locale),
            createdTime: form?.created_time || null,
            pageId: trimString(selectedPage.id),
            pageName: trimString(selectedPage.name),
            questionCount: Array.isArray(form?.questions) ? form.questions.length : 0,
          }))
          .filter((form) => form.id)
      : [];
    const selectedForms = selectForms(
      forms,
      input.selectedFormIds?.length ? input.selectedFormIds : connection.selectedFormIds
    );
    if (Array.isArray(input.selectedFormIds) && input.selectedFormIds.length) {
      const requestedFormIds = new Set(input.selectedFormIds.map(trimString));
      const matchedForms = selectedForms.filter((form) => requestedFormIds.has(trimString(form.id)));
      if (!matchedForms.length) {
        throw createIntegrationError(
          "Selected Meta form was not found on the selected Page.",
          400,
          "META_LEAD_ADS_INVALID_FORM"
        );
      }
    }

    const syncDiagnostics = [];
    let adAccounts = [];
    let syncedCampaigns = [];
    const grantedScopes = Array.isArray(scopeSummary.granted) ? scopeSummary.granted : [];

    if (hasAnyCampaignReadScope(grantedScopes)) {
      try {
        adAccounts = (await fetchMetaAdAccounts({
          accessToken,
          graphApiVersion,
        }))
          .map(normalizeAdAccountAsset)
          .filter((account) => account.id);

        const pageLookup = new Map(pageList.map((page) => [trimString(page.id), page]));
        const rawCampaigns = [];

        for (const adAccount of adAccounts) {
          const campaigns = await fetchMetaCampaignsForAdAccount({
            adAccountId: adAccount.id,
            accessToken,
            graphApiVersion,
          });

          for (const campaign of campaigns) {
            const fallbackPage = selectedPage || pageLookup.get(trimString(connection.selectedPageId)) || null;
            rawCampaigns.push(normalizeCampaignAsset(campaign, adAccount, fallbackPage || {}));
          }
        }

        syncedCampaigns = await upsertMetaCampaignRecords({
          campaigns: rawCampaigns.filter(
            (campaign) => campaign.isLeadGeneration && (campaign.isActive || campaign.status === "paused")
          ),
        });
      } catch (error) {
        const campaignError = normalizeMetaApiError(error, "campaign_sync");
        syncDiagnostics.push({
          level: "warning",
          code:
            campaignError.category === "permissions"
              ? "campaign_scopes_missing"
              : "campaign_sync_failed",
          message: campaignError.message,
        });
      }
    } else {
      syncDiagnostics.push({
        level: "warning",
        code: "campaign_scopes_missing",
        message: "Meta campaign sync requires ads_read or ads_management permission.",
      });
    }

    let webhookStatus = {
      ...(connection.webhookStatus || {}),
      status: "not_subscribed",
      selectedPageSubscribed: false,
      selectedPageId: trimString(selectedPage?.id),
      subscribedFields: [],
      lastErrorAt: null,
      lastErrorMessage: "",
    };

    try {
      if (selectedPage?.id) {
        webhookStatus = await ensureLeadgenWebhookSubscription({
          pageId: selectedPage.id,
          pageAccessToken: selectedPageToken,
          graphApiVersion,
          appId: connection.appId,
        });
      }
    } catch (error) {
      webhookStatus = {
        ...webhookStatus,
        status: "error",
        selectedPageId: trimString(selectedPage?.id),
        lastErrorAt: new Date(),
        lastErrorMessage: buildSafeMetaErrorMessage(
          error?.message || "Failed to subscribe the selected Page to leadgen webhooks."
        ),
      };
    }

    connection = clearConnectionErrorState(
      normalizeMetaLeadAdsConnection({
        ...connection,
        status: "connected",
        lastSyncAt: new Date(),
        lastPreparedAt: new Date(),
        selectedBusinessId: trimString(selectedBusiness?.id),
        selectedBusinessName: trimString(selectedBusiness?.name),
        selectedPageId: trimString(selectedPage?.id),
        selectedPageName: trimString(selectedPage?.name),
        selectedFormIds: selectedForms.map((form) => trimString(form.id)),
        selectedFormNames: selectedForms.map((form) => trimString(form.name)),
        scopeSummary,
        grantedScopes: scopeSummary.granted,
        pageAccessTokens: {
          ...(connection.pageAccessTokens || {}),
          ...accessiblePageTokenMap,
        },
        assets: {
          businesses,
          pages: pageList,
          forms,
          adAccounts,
          campaigns: syncedCampaigns,
        },
        webhookStatus: {
          ...webhookStatus,
          verifyTokenConfigured: Boolean(trimString(connection.webhookVerifyToken)),
          callbackUrl: buildWebhookCallbackUrl(connection),
        },
      })
    );
    connection.diagnostics = [...buildConnectionDiagnostics(connection), ...syncDiagnostics];

    await saveAdminConnection(
      admin,
      connection,
      syncMode === "campaign_sync" ? "Synced Meta Lead Ads campaigns" : "Synced Meta Lead Ads Pages and forms"
    );
    await recordMetaLeadAdsSyncLog({
      adminId: admin._id,
      source: syncMode === "campaign_sync" ? "campaign_sync" : "manual_sync",
      runType: syncMode,
      status: syncDiagnostics.length ? "warning" : "success",
      title: syncMode === "campaign_sync" ? "Campaign sync completed" : "Page and form sync completed",
      summary:
        syncMode === "campaign_sync"
          ? `Synced ${syncedCampaigns.length} Meta campaigns.`
          : `Synced ${pageList.length} Pages and ${forms.length} forms from Meta.`,
      pageId: trimString(selectedPage?.id),
      pageName: trimString(selectedPage?.name),
      attempts: 1,
      diagnostics: syncDiagnostics,
      occurredAt: new Date(),
    });

    return buildMetaLeadAdsStatusPayload(connection, { includeLogs: true, logsLimit: STATUS_LOG_LIMIT });
  } catch (error) {
    connection = updateConnectionErrorState(connection, error, syncMode);
    connection.diagnostics = buildConnectionDiagnostics(connection);
    await saveAdminConnection(admin, connection);
    await recordMetaLeadAdsSyncLog({
      adminId: admin._id,
      source: syncMode === "campaign_sync" ? "campaign_sync" : "manual_sync",
      runType: syncMode,
      status: "failed",
      title: syncMode === "campaign_sync" ? "Campaign sync failed" : "Page and form sync failed",
      summary: error?.message || "Meta Lead Ads sync failed.",
      attempts: 1,
      diagnostics: [normalizeMetaApiError(error, syncMode)],
      occurredAt: new Date(),
    });

    const normalizedError = normalizeMetaApiError(error, syncMode);
    throw createIntegrationError(
      normalizedError.message,
      error?.status || 400,
      normalizedError.needsReconnect ? "META_LEAD_ADS_TOKEN_EXPIRED" : normalizedError.code,
      {
        category: normalizedError.category,
        needsReconnect: normalizedError.needsReconnect,
        tokenHealth: buildTokenHealth(connection),
      }
    );
  }
};

const exchangeMetaLeadAdsCode = async ({ adminId, input = {} } = {}) => {
  const admin = await assertMainAdminDoc(adminId);
  let connection = applyConnectionInput(getCurrentConnectionForAdmin(admin), input);
  assertMetaLeadAdsReadyForExchange(connection);

  const code = trimString(input.code);
  if (!code) {
    throw createIntegrationError(
      "Authorization code is required for Meta Business Login exchange.",
      400,
      "META_LEAD_ADS_MISSING_CODE"
    );
  }

  try {
    const graphApiVersion = connection.graphApiVersion;
    const redirectUri = trimString(input.redirectUri);
    const shortTokenResponse = await metaGraphRequest({
      version: graphApiVersion,
      path: "oauth/access_token",
      query: {
        client_id: connection.appId,
        client_secret: connection.appSecret,
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        code,
      },
    });

    let accessToken = trimString(shortTokenResponse?.access_token);
    if (!accessToken) {
      throw createIntegrationError(
        "Meta code exchange did not return an access token.",
        400,
        "META_LEAD_ADS_CODE_EXCHANGE_FAILED"
      );
    }

    try {
      const longLivedResponse = await metaGraphRequest({
        version: graphApiVersion,
        path: "oauth/access_token",
        query: {
          grant_type: "fb_exchange_token",
          client_id: connection.appId,
          client_secret: connection.appSecret,
          fb_exchange_token: accessToken,
        },
      });
      accessToken = trimString(longLivedResponse?.access_token) || accessToken;
    } catch (_error) {
      // Keep the short-lived token if Meta does not allow an exchange here.
    }

    const [accountData, permissions, tokenDebug] = await Promise.all([
      metaGraphRequest({
        version: graphApiVersion,
        path: "me",
        query: {
          access_token: accessToken,
          fields: "id,name",
        },
      }),
      fetchGrantedPermissions({ accessToken, graphApiVersion }),
      fetchTokenDebugMetadata({
        accessToken,
        appId: connection.appId,
        appSecret: connection.appSecret,
        graphApiVersion,
      }).catch(() => ({})),
    ]);

    const scopeSummary = buildScopeSummary(permissions);
    connection = clearConnectionErrorState(
      normalizeMetaLeadAdsConnection({
        ...connection,
        accessToken,
        tokenType: trimString(shortTokenResponse?.token_type || "Bearer"),
        tokenExpiresAt: tokenDebug?.expires_at ? new Date(Number(tokenDebug.expires_at) * 1000) : null,
        accountId: trimString(accountData?.id),
        accountName: trimString(accountData?.name),
        connectedAt: connection.connectedAt || new Date(),
        connectedByAdminId: admin._id,
        connectionMethod: "business_login",
        status: "connected",
        grantedScopes: scopeSummary.granted,
        scopeSummary,
      })
    );
    connection.diagnostics = buildConnectionDiagnostics(connection);

    await saveAdminConnection(admin, connection, "Connected Meta Lead Ads via Business Login");
    await recordMetaLeadAdsSyncLog({
      adminId: admin._id,
      source: "oauth_exchange",
      runType: "connection",
      status: "success",
      title: "Meta account connected",
      summary: "Meta Business Login code exchange completed successfully.",
      occurredAt: new Date(),
    });

    if (parseBoolean(input.syncFormsOnConnect, connection.syncFormsOnConnect)) {
      return syncMetaLeadAdsAssets({ adminId, input });
    }

    return buildMetaLeadAdsStatusPayload(connection, { includeLogs: true, logsLimit: STATUS_LOG_LIMIT });
  } catch (error) {
    connection = updateConnectionErrorState(connection, error, "exchange");
    connection.diagnostics = buildConnectionDiagnostics(connection);
    await saveAdminConnection(admin, connection);
    await recordMetaLeadAdsSyncLog({
      adminId: admin._id,
      source: "oauth_exchange",
      runType: "connection",
      status: "failed",
      title: "Meta account connection failed",
      summary: error?.message || "Meta Business Login code exchange failed.",
      diagnostics: [normalizeMetaApiError(error, "exchange")],
      occurredAt: new Date(),
    });

    const normalizedError = normalizeMetaApiError(error, "exchange");
    throw createIntegrationError(
      normalizedError.message,
      error?.status || 400,
      normalizedError.needsReconnect ? "META_LEAD_ADS_TOKEN_EXPIRED" : normalizedError.code,
      {
        category: normalizedError.category,
        needsReconnect: normalizedError.needsReconnect,
        tokenHealth: buildTokenHealth(connection),
      }
    );
  }
};

const disconnectMetaLeadAds = async ({ adminId } = {}) => {
  const admin = await assertMainAdminDoc(adminId);
  const currentConnection = getCurrentConnectionForAdmin(admin);

  if (trimString(currentConnection.accessToken)) {
    await metaGraphRequest({
      version: currentConnection.graphApiVersion,
      path: "me/permissions",
      method: "DELETE",
      body: {
        access_token: currentConnection.accessToken,
      },
    }).catch(() => null);
  }

  const disconnected = normalizeMetaLeadAdsConnection({
    ...currentConnection,
    accessToken: "",
    tokenType: "",
    tokenExpiresAt: null,
    pageAccessTokens: {},
    grantedScopes: [],
    status: "disconnected",
    connectedAt: null,
    lastSyncAt: null,
    connectedByAdminId: currentConnection.connectedByAdminId || null,
    accountId: "",
    accountName: "",
    selectedBusinessId: "",
    selectedBusinessName: "",
    selectedPageId: "",
    selectedPageName: "",
    selectedFormIds: [],
    selectedFormNames: [],
    scopeSummary: {
      required: [...REQUIRED_META_LEAD_ADS_SCOPES],
      granted: [],
      declined: [],
      missingRequired: [...REQUIRED_META_LEAD_ADS_SCOPES],
      grantedCount: 0,
      lastCheckedAt: null,
    },
    assets: {
      businesses: [],
      pages: [],
      forms: [],
    },
    webhookStatus: {
      ...currentConnection.webhookStatus,
      status: "not_configured",
      selectedPageSubscribed: false,
      selectedPageId: "",
      subscribedFields: [],
      lastProcessedAt: currentConnection?.webhookStatus?.lastProcessedAt || null,
      lastErrorMessage: "",
      lastErrorAt: null,
    },
    lastApiError: null,
  });
  disconnected.diagnostics = buildConnectionDiagnostics(disconnected);

  await saveAdminConnection(admin, disconnected, "Disconnected Meta Lead Ads connection");
  await recordMetaLeadAdsSyncLog({
    adminId: admin._id,
    source: "disconnect",
    runType: "connection",
    status: "success",
    title: "Meta account disconnected",
    summary: "Meta Lead Ads connection was disconnected and local tokens were cleared.",
    occurredAt: new Date(),
  });
  return buildMetaLeadAdsStatusPayload(disconnected, { includeLogs: true, logsLimit: STATUS_LOG_LIMIT });
};

const getMetaLeadAdsStatus = async ({ refresh = false } = {}) => {
  const connection = await loadMetaLeadAdsConnection({ refresh });
  return buildMetaLeadAdsStatusPayload(connection, { includeLogs: true, logsLimit: STATUS_LOG_LIMIT });
};

const getMetaLeadAdsCampaigns = async ({ activeOnly = false } = {}) =>
  listStoredMetaLeadAdsCampaigns({ activeOnly });

const verifyMetaLeadAdsWebhookSignature = async ({ rawBody, signatureHeader }) => {
  const connection = await loadMetaLeadAdsConnection({ refresh: true });
  if (!trimString(connection.appSecret)) {
    throw createIntegrationError(
      "Meta Lead Ads app secret is not configured on the server.",
      500,
      "META_LEAD_ADS_MISSING_APP_SECRET"
    );
  }
  const { verifyMetaSignature } = require("./whatsappWebhookService");
  return verifyMetaSignature({
    rawBody,
    signatureHeader,
    appSecret: connection.appSecret,
  });
};

const extractLeadgenEvents = (payload = {}) => {
  const events = [];

  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (trimString(change?.field) !== "leadgen") continue;
      const value = change?.value || {};
      const metaLeadId = trimString(value.leadgen_id);
      const pageId = trimString(value.page_id || entry?.id);
      const formId = trimString(value.form_id);

      if (!metaLeadId || !pageId) continue;

      events.push({
        eventKey: `${pageId}:${metaLeadId}`,
        metaLeadId,
        pageId,
        formId,
        createdTime: value?.created_time ? new Date(Number(value.created_time) * 1000) : new Date(),
        payload: value,
      });
    }
  }

  return events;
};

const buildEventHeadersSnapshot = (headers = {}) => ({
  "x-hub-signature-256": trimString(headers?.["x-hub-signature-256"]),
  "user-agent": trimString(headers?.["user-agent"]),
});

const findAssetById = (items = [], id = "") =>
  items.find((item) => trimString(item?.id) === trimString(id)) || null;

const buildFieldLookup = (fieldData = []) => {
  const lookup = {};
  const normalizedRows = [];

  for (const field of Array.isArray(fieldData) ? fieldData : []) {
    const originalName = trimString(field?.name);
    const key = normalizeFieldKey(originalName);
    const values = Array.isArray(field?.values) ? field.values.map(trimString).filter(Boolean) : [];
    if (!key) continue;
    if (!lookup[key] && values.length) {
      lookup[key] = values.join(", ");
    }
    normalizedRows.push({
      name: originalName,
      key,
      values,
    });
  }

  return {
    lookup,
    rows: normalizedRows,
  };
};

const buildMetaFieldValueMap = (rows = []) =>
  (Array.isArray(rows) ? rows : []).reduce((acc, row) => {
    const key = trimString(row?.key);
    if (!key) return acc;
    const values = Array.isArray(row?.values) ? row.values.map(trimString).filter(Boolean) : [];
    acc[key] = values.length > 1 ? values : values[0] || "";
    return acc;
  }, {});

const extractMetaLeadContext = ({ leadPayload = {}, mapped = {}, customFields = [], rows = [] } = {}) => {
  const fieldValues = buildMetaFieldValueMap(rows);
  const additionalNotes = pickFirstNonEmpty(
    fieldValues.additional_notes,
    fieldValues.additional_note,
    fieldValues.notes,
    fieldValues.note,
    fieldValues.message,
    fieldValues.comments,
    fieldValues.comment,
    fieldValues.remarks,
    fieldValues.additional_information
  );
  const jobPosition = pickFirstNonEmpty(
    fieldValues.job_position,
    fieldValues.applied_role,
    fieldValues.role,
    fieldValues.position,
    fieldValues.job_title
  );
  const postName = pickFirstNonEmpty(
    trimString(leadPayload?.ad_name),
    trimString(leadPayload?.post_name),
    trimString(leadPayload?.adset_name),
    fieldValues.post_name,
    fieldValues.post,
    fieldValues.ad_name
  );
  const customFieldValues = (Array.isArray(customFields) ? customFields : []).reduce((acc, item) => {
    const key = trimString(item?.key);
    if (!key) return acc;
    const values = Array.isArray(item?.values) ? item.values.map(trimString).filter(Boolean) : [];
    acc[key] = values.length > 1 ? values : values[0] || "";
    return acc;
  }, {});

  return {
    fullName: pickFirstNonEmpty(mapped?.name),
    phoneNumber: pickFirstNonEmpty(mapped?.phone),
    email: pickFirstNonEmpty(mapped?.email).toLowerCase(),
    additionalNotes,
    jobPosition,
    postName,
    adId: trimString(leadPayload?.ad_id),
    adName: trimString(leadPayload?.ad_name),
    adsetName: trimString(leadPayload?.adset_name),
    campaignId: trimString(leadPayload?.campaign_id),
    campaignName: trimString(leadPayload?.campaign_name),
    metaLeadTimestamp: leadPayload?.created_time || null,
    fetchedAt: new Date().toISOString(),
    fieldValues,
    customFieldValues,
    customFields: Array.isArray(customFields) ? customFields : [],
  };
};

const mapMetaLeadFields = ({ fieldData = [], fieldMapping = {} } = {}) => {
  const mergedFieldMapping = {
    ...DEFAULT_META_LEAD_FIELD_MAPPING,
    ...(fieldMapping && typeof fieldMapping === "object" ? fieldMapping : {}),
  };
  const { lookup, rows } = buildFieldLookup(fieldData);
  const mapped = {};
  const consumedKeys = new Set();

  for (const [sourceField, targetField] of Object.entries(mergedFieldMapping)) {
    const normalizedSource = normalizeFieldKey(sourceField);
    const value = trimString(lookup[normalizedSource]);
    if (!value || !SUPPORTED_LEAD_FIELDS.has(String(targetField))) continue;
    if (!mapped[targetField]) {
      mapped[targetField] = value;
    }
    consumedKeys.add(normalizedSource);
  }

  if (!trimString(mapped.name)) {
    const fullName = trimString(lookup.full_name || lookup.full_name_1);
    const firstName = trimString(mapped.firstName || lookup.first_name);
    const lastName = trimString(mapped.lastName || lookup.last_name);
    mapped.name = trimString(fullName || `${firstName} ${lastName}`.trim());
  }

  mapped.email = trimString(mapped.email || lookup.email || lookup.email_address).toLowerCase();
  mapped.phone = trimString(mapped.phone || lookup.phone || lookup.phone_number || lookup.whatsapp_number);
  mapped.company = trimString(mapped.company || lookup.company || lookup.company_name);
  mapped.website = trimString(mapped.website || lookup.website);
  mapped.city = trimString(mapped.city || lookup.city);
  mapped.state = trimString(mapped.state || lookup.state);
  mapped.country = trimString(mapped.country || lookup.country);
  mapped.zipCode = trimString(mapped.zipCode || lookup.zip_code || lookup.postal_code);

  const customFields = rows
    .filter((row) => !consumedKeys.has(row.key))
    .map((row) => ({
      name: row.name,
      key: row.key,
      values: row.values,
    }));

  return {
    mapped,
    customFields,
    rows,
    fieldValues: buildMetaFieldValueMap(rows),
  };
};

const resolveLeadOwnership = async (connection = {}) => {
  const preferredAdminId = connection.connectedByAdminId;
  let admin = null;

  if (preferredAdminId && Types.ObjectId.isValid(String(preferredAdminId))) {
    admin = await AdminUser.findById(preferredAdminId).select("_id role reportsTo").lean();
  }

  if (!admin?._id) {
    admin = await AdminUser.findOne({ role: "MainAdmin" }).select("_id role reportsTo").lean();
  }

  if (!admin?._id) {
    throw createIntegrationError(
      "No MainAdmin account is available for Meta Lead Ads ownership.",
      500,
      "META_LEAD_ADS_OWNER_NOT_FOUND"
    );
  }

  return {
    ownerAdmin: admin._id,
    assignedTo: connection.autoAssignToOwner === true ? admin._id : null,
    teamAdmin: admin.role === "SalesStaff" ? admin.reportsTo || admin._id : admin._id,
    assignmentMode: connection.autoAssignToOwner === true ? "owner" : "unassigned",
  };
};

const buildLeadDescription = ({ sourceMetadata = {}, customFields = [] } = {}) => {
  const parts = [
    `Meta lead ID: ${trimString(sourceMetadata.metaLeadId)}`,
    trimString(sourceMetadata.pageName) ? `Page: ${trimString(sourceMetadata.pageName)}` : "",
    trimString(sourceMetadata.formName) ? `Form: ${trimString(sourceMetadata.formName)}` : "",
    trimString(sourceMetadata.campaignName) ? `Campaign: ${trimString(sourceMetadata.campaignName)}` : "",
    trimString(sourceMetadata.postName) ? `Post: ${trimString(sourceMetadata.postName)}` : "",
    trimString(sourceMetadata.jobPosition) ? `Job Position: ${trimString(sourceMetadata.jobPosition)}` : "",
    trimString(sourceMetadata.additionalNotes) ? `Additional Notes: ${trimString(sourceMetadata.additionalNotes)}` : "",
    customFields.length
      ? `Extra fields: ${customFields.map((item) => `${trimString(item.name || item.key)}=${item.values.join(", ")}`).join("; ")}`
      : "",
  ].filter(Boolean);

  return parts.join("\n");
};

const persistMetaLeadSubmission = async ({
  submission,
  sourceMetadata,
  fieldRows,
  mappedLeadFields,
  rawPayload,
  status,
  crmLeadId = null,
  ownership = null,
  errorMessage = "",
  eventKey = "",
  attempts = 1,
  lastEventSource = "webhook",
} = {}) => {
  const nextSubmission =
    submission ||
    (await MetaLeadAdsSubmission.create({
      metaLeadId: trimString(sourceMetadata.metaLeadId),
      receivedAt: new Date(),
    }));

  nextSubmission.formId = trimString(sourceMetadata.formId);
  nextSubmission.formName = trimString(sourceMetadata.formName);
  nextSubmission.pageId = trimString(sourceMetadata.pageId);
  nextSubmission.pageName = trimString(sourceMetadata.pageName);
  nextSubmission.campaignId = trimString(sourceMetadata.campaignId);
  nextSubmission.campaignName = trimString(sourceMetadata.campaignName);
  nextSubmission.status = trimString(status) || nextSubmission.status || "received";
  nextSubmission.crmLeadId = crmLeadId || nextSubmission.crmLeadId || null;
  nextSubmission.teamAdmin = ownership?.teamAdmin || nextSubmission.teamAdmin || null;
  nextSubmission.ownerAdmin = ownership?.ownerAdmin || nextSubmission.ownerAdmin || null;
  nextSubmission.assignedTo = ownership?.assignedTo || nextSubmission.assignedTo || null;
  nextSubmission.sourceLabel = trimString(sourceMetadata.sourceLabel);
  nextSubmission.attempts = Math.max(1, Number(attempts || nextSubmission.attempts || 1));
  nextSubmission.lastEventSource = trimString(lastEventSource || nextSubmission.lastEventSource || "webhook");
  nextSubmission.fieldData = Array.isArray(fieldRows) ? fieldRows : [];
  nextSubmission.mappedLeadFields = mappedLeadFields || {};
  nextSubmission.sourceMetadata = sourceMetadata || {};
  nextSubmission.rawPayload = rawPayload || null;
  nextSubmission.processedAt = ["created", "pending_review", "ignored"].includes(nextSubmission.status)
    ? new Date()
    : nextSubmission.processedAt;
  nextSubmission.errorMessage = trimString(errorMessage);
  nextSubmission.eventKeys = [
    ...new Set([...(Array.isArray(nextSubmission.eventKeys) ? nextSubmission.eventKeys : []), trimString(eventKey)].filter(Boolean)),
  ];
  await nextSubmission.save();

  return nextSubmission;
};

const createOrUpdateLeadFromMetaSubmission = async ({
  connection,
  sourceMetadata,
  mappedLeadFields,
  customFields,
  submission,
} = {}) => {
  const ownership = await resolveLeadOwnership(connection);
  const integrationKey = `meta_lead_ads:${trimString(sourceMetadata.metaLeadId)}`;
  const leadName = trimString(
    mappedLeadFields.name ||
      mappedLeadFields.company ||
      mappedLeadFields.email ||
      mappedLeadFields.phone ||
      `Meta Lead ${trimString(sourceMetadata.metaLeadId).slice(-6)}`
  );
  const description = buildLeadDescription({ sourceMetadata, customFields });

  let lead = submission?.crmLeadId ? await Lead.findById(submission.crmLeadId) : null;
  if (!lead) {
    lead = await Lead.findOne({ integrationKey });
  }

  if (lead) {
    lead.ownerAdmin = ownership.ownerAdmin;
    const previousAssignedTo = lead.assignedTo || null;
    lead.assignedTo = ownership.assignedTo || lead.assignedTo || null;
    lead.teamAdmin = ownership.teamAdmin;
    if (ownership.assignedTo && String(previousAssignedTo || "") !== String(ownership.assignedTo || "")) {
      lead.assignedBy = connection.connectedByAdminId || ownership.ownerAdmin || null;
      lead.assignedAt = new Date();
      lead.assignmentHistory = Array.isArray(lead.assignmentHistory) ? lead.assignmentHistory : [];
      lead.assignmentHistory.push({
        action: previousAssignedTo ? "reassigned" : "assigned",
        assignedTo: ownership.assignedTo,
        previousAssignedTo: previousAssignedTo || null,
        assignedBy: connection.connectedByAdminId || ownership.ownerAdmin || null,
        assignedAt: new Date(),
      });
    }
    lead.source = trimString(connection.crmSourceLabel || "Meta Ads");
    lead.sourceDetails = [trimString(sourceMetadata.campaignName), trimString(sourceMetadata.formName)].filter(Boolean).join(" | ");
    lead.name = leadName;
    lead.email = trimString(mappedLeadFields.email || lead.email).toLowerCase();
    lead.phone = trimString(mappedLeadFields.phone || lead.phone);
    lead.company = trimString(mappedLeadFields.company || lead.company);
    lead.website = trimString(mappedLeadFields.website || lead.website);
    lead.address = trimString(mappedLeadFields.address || lead.address);
    lead.city = trimString(mappedLeadFields.city || lead.city);
    lead.state = trimString(mappedLeadFields.state || lead.state);
    lead.country = trimString(mappedLeadFields.country || lead.country);
    lead.zipCode = trimString(mappedLeadFields.zipCode || lead.zipCode);
    lead.description = trimString(lead.description) || description;
    lead.sourceMetadata = sourceMetadata;
    lead.integrationKey = integrationKey;
    lead.tags = normalizeLeadTags(
      [
        ...(Array.isArray(lead.tags) ? lead.tags : []),
        "meta-lead-ads",
        trimString(sourceMetadata.formName),
        trimString(sourceMetadata.pageName),
      ].filter(Boolean)
    );
    lead.lastContactAt = new Date();
    await lead.save();
    return { lead, ownership, created: false };
  }

  const nextLeadNumber = 2000 + (await Lead.countDocuments({ teamAdmin: ownership.teamAdmin })) + 1;

  try {
    lead = await Lead.create({
      teamAdmin: ownership.teamAdmin,
      ownerAdmin: ownership.ownerAdmin,
      assignedTo: ownership.assignedTo,
      assignedBy: ownership.assignedTo ? connection.connectedByAdminId || ownership.ownerAdmin || null : null,
      assignedAt: ownership.assignedTo ? new Date() : null,
      leadNumber: nextLeadNumber,
      status: DEFAULT_LEAD_STATUS,
      source: trimString(connection.crmSourceLabel || "Meta Ads"),
      sourceDetails: [trimString(sourceMetadata.campaignName), trimString(sourceMetadata.formName)].filter(Boolean).join(" | "),
      integrationKey,
      sourceMetadata,
      name: leadName,
      email: trimString(mappedLeadFields.email).toLowerCase(),
      phone: trimString(mappedLeadFields.phone),
      website: trimString(mappedLeadFields.website),
      address: trimString(mappedLeadFields.address),
      city: trimString(mappedLeadFields.city),
      state: trimString(mappedLeadFields.state),
      country: trimString(mappedLeadFields.country),
      zipCode: trimString(mappedLeadFields.zipCode),
      company: trimString(mappedLeadFields.company),
      description,
      tags: normalizeLeadTags(
        ["meta-lead-ads", trimString(sourceMetadata.formName), trimString(sourceMetadata.pageName)].filter(Boolean)
      ),
      assignmentHistory: ownership.assignedTo
        ? [
            {
              action: "assigned",
              assignedTo: ownership.assignedTo,
              previousAssignedTo: null,
              assignedBy: connection.connectedByAdminId || ownership.ownerAdmin || null,
              assignedAt: new Date(),
            },
          ]
        : [],
      lastContactAt: new Date(),
    });
  } catch (error) {
    if (error?.code === 11000) {
      lead = await Lead.findOne({ integrationKey });
      if (lead) {
        return { lead, ownership, created: false };
      }
    }
    throw error;
  }

  return { lead, ownership, created: true };
};

const fetchMetaLeadPayload = async ({ metaLeadId, pageAccessToken, graphApiVersion }) => {
  const data = await metaGraphRequest({
    version: graphApiVersion,
    path: trimString(metaLeadId),
    query: {
      access_token: pageAccessToken,
      fields: "id,created_time,field_data,form_id,campaign_name,ad_id,ad_name,adset_name,campaign_id,is_organic,platform",
    },
  });

  return data || {};
};

const fetchRecentLeadsForForm = async ({
  formId,
  pageId,
  pageAccessToken,
  graphApiVersion,
  since = null,
} = {}) => {
  if (!trimString(formId) || !trimString(pageAccessToken)) return [];

  const leads = await fetchMetaGraphCollection({
    version: graphApiVersion,
    path: `${trimString(formId)}/leads`,
    query: {
      access_token: pageAccessToken,
      fields: "id,created_time",
      limit: 100,
    },
  });

  const sinceTime = since ? new Date(since).getTime() : null;
  return (Array.isArray(leads) ? leads : [])
    .map((lead) => ({
      metaLeadId: trimString(lead?.id),
      formId: trimString(formId),
      pageId: trimString(pageId),
      createdTime: lead?.created_time || null,
    }))
    .filter((lead) => lead.metaLeadId)
    .filter((lead) => {
      if (!sinceTime || !lead.createdTime) return true;
      const createdAt = new Date(lead.createdTime).getTime();
      return Number.isFinite(createdAt) ? createdAt >= sinceTime : true;
    });
};

const processSingleLeadgenEvent = async ({ connection, event, headers, forceRetry = false } = {}) => {
  const eventSource = trimString(event?.source || (headers?.["user-agent"] === "meta-lead-ads-poller" ? "polling" : "webhook")) || "webhook";
  let eventLog = await MetaLeadAdsEventLog.findOne({ eventKey: event.eventKey });

  if (eventLog) {
    eventLog.deliveryCount = Number(eventLog.deliveryCount || 0) + 1;
    eventLog.receivedAt = new Date();
    eventLog.lastAttemptAt = new Date();
    eventLog.attempts = Math.max(1, Number(eventLog.attempts || 1)) + (forceRetry ? 1 : 0);
    eventLog.source = eventSource;
    eventLog.payload = event.payload;
    eventLog.headers = buildEventHeadersSnapshot(headers);
    await eventLog.save();

    if (["processed", "ignored", "duplicate"].includes(trimString(eventLog.status)) && !forceRetry) {
      return {
        status: trimString(eventLog.status),
        duplicate: trimString(eventLog.status) === "duplicate",
        eventLog,
      };
    }
  } else {
    eventLog = await MetaLeadAdsEventLog.create({
      eventKey: event.eventKey,
      metaLeadId: event.metaLeadId,
      pageId: event.pageId,
      formId: event.formId,
      status: "received",
      source: eventSource,
      attempts: Math.max(1, Number(event?.attempts || 1)),
      receivedAt: new Date(),
      lastAttemptAt: new Date(),
      signatureVerified: true,
      payload: event.payload,
      headers: buildEventHeadersSnapshot(headers),
    });
  }

  const selectedFormIds = Array.isArray(connection.selectedFormIds) ? connection.selectedFormIds : [];
  const isSelectedForm = !selectedFormIds.length || selectedFormIds.includes(trimString(event.formId));
  const pageAsset = findAssetById(connection.assets?.pages || [], event.pageId);
  const formAsset = findAssetById(connection.assets?.forms || [], event.formId);
  const sourceMetadata = {
    provider: "meta_lead_ads",
    integrationProvider: "meta_lead_ads",
    metaLeadId: trimString(event.metaLeadId),
    pageId: trimString(event.pageId),
    pageName: trimString(pageAsset?.name || connection.selectedPageName),
    formId: trimString(event.formId),
    formName: trimString(formAsset?.name || ""),
    campaignId: trimString(event.payload?.campaign_id),
    campaignName: trimString(event.payload?.campaign_name),
    sourceLabel: trimString(connection.crmSourceLabel || "Meta Ads"),
    fetchedAt: new Date().toISOString(),
    syncStatus: "received",
    receivedAt: new Date().toISOString(),
  };

  eventLog.pageName = sourceMetadata.pageName;
  eventLog.formName = sourceMetadata.formName;
  eventLog.campaignId = sourceMetadata.campaignId;
  eventLog.campaignName = sourceMetadata.campaignName;
  eventLog.title = "Lead received from Meta";
  eventLog.summary = "Meta lead event received and queued for ingestion.";
  await eventLog.save();

  let submission = await MetaLeadAdsSubmission.findOne({ metaLeadId: event.metaLeadId });
  if (submission?.crmLeadId || SUCCESSFUL_SUBMISSION_STATUSES.has(trimString(submission?.status))) {
    eventLog.status = "duplicate";
    eventLog.retryable = false;
    eventLog.nextRetryAt = null;
    eventLog.submissionId = submission._id;
    eventLog.processedAt = new Date();
    eventLog.title = "Duplicate Meta lead skipped";
    eventLog.summary = "This Meta lead was already processed earlier.";
    eventLog.errorCode = "";
    eventLog.errorMessage = "";
    await eventLog.save();
    await recordMetaLeadAdsSyncLog({
      adminId: connection.connectedByAdminId || null,
      source: eventSource,
      runType: "lead_ingestion",
      status: "duplicate",
      title: eventLog.title,
      summary: eventLog.summary,
      metaLeadId: sourceMetadata.metaLeadId,
      pageId: sourceMetadata.pageId,
      pageName: sourceMetadata.pageName,
      formId: sourceMetadata.formId,
      formName: sourceMetadata.formName,
      campaignId: sourceMetadata.campaignId,
      campaignName: sourceMetadata.campaignName,
      attempts: eventLog.attempts,
      occurredAt: new Date(),
    });
    return {
      status: "duplicate",
      duplicate: true,
      eventLog,
      submission,
    };
  }

  if (!isSelectedForm) {
    submission = await persistMetaLeadSubmission({
      submission,
      sourceMetadata,
      fieldRows: [],
      mappedLeadFields: {},
      rawPayload: event.payload,
      status: "ignored",
      eventKey: event.eventKey,
      errorMessage: "Lead event ignored because the Meta form is not selected for ingestion.",
      attempts: eventLog.attempts,
      lastEventSource: eventSource,
    });
    eventLog.status = "ignored";
    eventLog.retryable = false;
    eventLog.nextRetryAt = null;
    eventLog.submissionId = submission._id;
    eventLog.processedAt = new Date();
    eventLog.title = "Meta lead ignored";
    eventLog.summary = "Lead event ignored because the Meta form is not selected for ingestion.";
    eventLog.errorCode = "";
    eventLog.errorMessage = "Lead event ignored because the Meta form is not selected for ingestion.";
    await eventLog.save();
    await recordMetaLeadAdsSyncLog({
      adminId: connection.connectedByAdminId || null,
      source: eventSource,
      runType: "lead_ingestion",
      status: "ignored",
      title: eventLog.title,
      summary: eventLog.summary,
      metaLeadId: sourceMetadata.metaLeadId,
      pageId: sourceMetadata.pageId,
      pageName: sourceMetadata.pageName,
      formId: sourceMetadata.formId,
      formName: sourceMetadata.formName,
      campaignId: sourceMetadata.campaignId,
      campaignName: sourceMetadata.campaignName,
      attempts: eventLog.attempts,
      occurredAt: new Date(),
    });
    return {
      status: "ignored",
      eventLog,
      submission,
    };
  }

  const pageAccessToken = trimString(
    connection.pageAccessTokens?.[event.pageId] || connection.pageAccessTokens?.[connection.selectedPageId] || ""
  );
  if (!pageAccessToken) {
    throw createIntegrationError(
      "No page access token is available for the selected Meta Page.",
      400,
      "META_LEAD_ADS_MISSING_PAGE_TOKEN"
    );
  }

  const leadPayload = await fetchMetaLeadPayload({
    metaLeadId: event.metaLeadId,
    pageAccessToken,
    graphApiVersion: connection.graphApiVersion,
  });
  sourceMetadata.formName = trimString(sourceMetadata.formName || formAsset?.name || "");
  sourceMetadata.campaignId = trimString(sourceMetadata.campaignId || leadPayload?.campaign_id);
  sourceMetadata.campaignName = trimString(sourceMetadata.campaignName || leadPayload?.campaign_name);
  const { mapped, customFields, rows, fieldValues } = mapMetaLeadFields({
    fieldData: leadPayload?.field_data || [],
    fieldMapping: connection.fieldMapping,
  });
  const leadContext = extractMetaLeadContext({
    leadPayload,
    mapped,
    customFields,
    rows,
  });
  Object.assign(sourceMetadata, {
    campaignId: trimString(sourceMetadata.campaignId || leadContext.campaignId),
    campaignName: trimString(sourceMetadata.campaignName || leadContext.campaignName),
    postName: trimString(leadContext.postName),
    adId: trimString(leadContext.adId),
    adName: trimString(leadContext.adName),
    adsetName: trimString(leadContext.adsetName),
    jobPosition: trimString(leadContext.jobPosition),
    additionalNotes: trimString(leadContext.additionalNotes),
    metaLeadTimestamp: leadContext.metaLeadTimestamp || null,
    fetchedAt: leadContext.fetchedAt,
    fieldValues,
    customFieldValues: leadContext.customFieldValues,
    customFields: leadContext.customFields,
  });
  sourceMetadata.metaLeadAds = {
    integrationProvider: "meta_lead_ads",
    metaLeadId: sourceMetadata.metaLeadId,
    pageId: sourceMetadata.pageId,
    pageName: sourceMetadata.pageName,
    formId: sourceMetadata.formId,
    formName: sourceMetadata.formName,
    campaignId: sourceMetadata.campaignId,
    campaignName: sourceMetadata.campaignName,
    postName: sourceMetadata.postName,
    jobPosition: sourceMetadata.jobPosition,
    additionalNotes: sourceMetadata.additionalNotes,
    metaLeadTimestamp: sourceMetadata.metaLeadTimestamp,
    fetchedAt: sourceMetadata.fetchedAt,
    fieldValues: sourceMetadata.fieldValues,
    customFieldValues: sourceMetadata.customFieldValues,
    customFields: sourceMetadata.customFields,
  };

  if (!connection.autoCreateLeads) {
    sourceMetadata.syncStatus = "pending";
    sourceMetadata.metaLeadAds.syncStatus = "pending";
    const pendingOwnership = await resolveLeadOwnership(connection);
    submission = await persistMetaLeadSubmission({
      submission,
      sourceMetadata,
      fieldRows: rows,
      mappedLeadFields: mapped,
      rawPayload: leadPayload,
      status: "pending_review",
      ownership: pendingOwnership,
      eventKey: event.eventKey,
      attempts: eventLog.attempts,
      lastEventSource: eventSource,
    });
    eventLog.status = "processed";
    eventLog.retryable = false;
    eventLog.nextRetryAt = null;
    eventLog.submissionId = submission._id;
    eventLog.processedAt = new Date();
    eventLog.campaignId = sourceMetadata.campaignId;
    eventLog.campaignName = sourceMetadata.campaignName;
    eventLog.title = "Meta lead stored for review";
    eventLog.summary = "Meta lead was stored without creating a CRM lead.";
    eventLog.errorCode = "";
    eventLog.errorMessage = "";
    await eventLog.save();
    await recordMetaLeadAdsSyncLog({
      adminId: connection.connectedByAdminId || null,
      source: eventSource,
      runType: "lead_ingestion",
      status: "success",
      title: eventLog.title,
      summary: eventLog.summary,
      metaLeadId: sourceMetadata.metaLeadId,
      pageId: sourceMetadata.pageId,
      pageName: sourceMetadata.pageName,
      formId: sourceMetadata.formId,
      formName: sourceMetadata.formName,
      campaignId: sourceMetadata.campaignId,
      campaignName: sourceMetadata.campaignName,
      attempts: eventLog.attempts,
      occurredAt: new Date(),
    });
    return {
      status: "pending_review",
      eventLog,
      submission,
    };
  }

  sourceMetadata.syncStatus = "synced";
  sourceMetadata.metaLeadAds.syncStatus = "synced";
  const { lead, ownership } = await createOrUpdateLeadFromMetaSubmission({
    connection,
    sourceMetadata,
    mappedLeadFields: mapped,
    customFields,
    submission,
  });

  submission = await persistMetaLeadSubmission({
    submission,
    sourceMetadata,
    fieldRows: rows,
    mappedLeadFields: mapped,
    rawPayload: leadPayload,
    status: "created",
    crmLeadId: lead?._id || null,
    ownership,
    eventKey: event.eventKey,
    attempts: eventLog.attempts,
    lastEventSource: eventSource,
  });

  eventLog.status = "processed";
  eventLog.retryable = false;
  eventLog.nextRetryAt = null;
  eventLog.submissionId = submission._id;
  eventLog.processedAt = new Date();
  eventLog.campaignId = sourceMetadata.campaignId;
  eventLog.campaignName = sourceMetadata.campaignName;
  eventLog.title = "Lead synced to CRM";
  eventLog.summary = "Meta lead was created or updated in CRM.";
  eventLog.errorCode = "";
  eventLog.errorMessage = "";
  await eventLog.save();
  await recordMetaLeadAdsSyncLog({
    adminId: connection.connectedByAdminId || null,
    source: eventSource,
    runType: "lead_ingestion",
    status: "success",
    title: eventLog.title,
    summary: eventLog.summary,
    metaLeadId: sourceMetadata.metaLeadId,
    pageId: sourceMetadata.pageId,
    pageName: sourceMetadata.pageName,
    formId: sourceMetadata.formId,
    formName: sourceMetadata.formName,
    campaignId: sourceMetadata.campaignId,
    campaignName: sourceMetadata.campaignName,
    attempts: eventLog.attempts,
    occurredAt: new Date(),
  });

  return {
    status: "created",
    eventLog,
    submission,
    lead,
  };
};

const buildRetryEventFromLog = (eventLog = {}) => ({
  eventKey: trimString(eventLog?.eventKey),
  metaLeadId: trimString(eventLog?.metaLeadId),
  pageId: trimString(eventLog?.pageId),
  formId: trimString(eventLog?.formId),
  source: "retry",
  attempts: Math.max(1, Number(eventLog?.attempts || 1)),
  payload: eventLog?.payload || {
    leadgen_id: trimString(eventLog?.metaLeadId),
    page_id: trimString(eventLog?.pageId),
    form_id: trimString(eventLog?.formId),
    campaign_id: trimString(eventLog?.campaignId),
    campaign_name: trimString(eventLog?.campaignName),
  },
});

const processMetaLeadAdsWebhookPayload = async ({ payload, headers = {} } = {}) => {
  const connection = await loadMetaLeadAdsConnection({ refresh: true });
  assertMetaLeadAdsConnected(connection);

  const events = extractLeadgenEvents(payload).map((event) => ({
    ...event,
    source: "webhook",
  }));
  if (!events.length) {
    return { processed: 0, succeeded: 0, failed: 0, duplicates: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  let duplicates = 0;
  let latestFailure = null;

  for (const event of events) {
    try {
      const result = await processSingleLeadgenEvent({
        connection,
        event,
        headers,
      });
      if (trimString(result?.status) === "duplicate") duplicates += 1;
      else succeeded += 1;
    } catch (error) {
      failed += 1;
      latestFailure = normalizeMetaApiError(error, "webhook");
      const eventLog = await MetaLeadAdsEventLog.findOne({ eventKey: event.eventKey });
      if (eventLog) {
        eventLog.status = latestFailure.retryable ? "retry_pending" : "failed";
        eventLog.retryable = Boolean(latestFailure.retryable);
        eventLog.nextRetryAt = latestFailure.retryable ? computeNextRetryAt(eventLog.attempts) : null;
        eventLog.errorCode = trimString(latestFailure.code);
        eventLog.errorMessage = trimString(latestFailure.message);
        eventLog.title = "Webhook ingestion failed";
        eventLog.summary = latestFailure.message;
        eventLog.processedAt = new Date();
        eventLog.diagnostics = [toSafeDiagnostic(latestFailure)];
        await eventLog.save();
        await recordMetaLeadAdsSyncLog({
          adminId: connection.connectedByAdminId || null,
          source: "webhook",
          runType: "lead_ingestion",
          status: "failed",
          title: eventLog.title,
          summary: eventLog.summary,
          metaLeadId: trimString(eventLog.metaLeadId),
          pageId: trimString(eventLog.pageId),
          pageName: trimString(eventLog.pageName),
          formId: trimString(eventLog.formId),
          formName: trimString(eventLog.formName),
          campaignId: trimString(eventLog.campaignId),
          campaignName: trimString(eventLog.campaignName),
          attempts: eventLog.attempts,
          retryable: eventLog.retryable,
          nextRetryAt: eventLog.nextRetryAt,
          diagnostics: [latestFailure],
          occurredAt: new Date(),
        });
      }
    }
  }

  const admin = await AdminUser.findOne({ role: "MainAdmin" });
  if (admin) {
    let nextConnection = normalizeMetaLeadAdsConnection(admin?.settings?.metaLeadAdsConnection || {});
    nextConnection = latestFailure ? updateConnectionErrorState(nextConnection, latestFailure, "webhook") : clearConnectionErrorState(nextConnection);
    nextConnection.webhookStatus = {
      ...(nextConnection.webhookStatus || {}),
      status: latestFailure ? "error" : "subscribed",
      selectedPageId: trimString(nextConnection.selectedPageId),
      lastEventAt: new Date(),
      lastProcessedAt: new Date(),
      lastErrorAt: latestFailure ? new Date() : null,
      lastErrorMessage: latestFailure ? latestFailure.message : "",
    };
    nextConnection.diagnostics = buildConnectionDiagnostics(nextConnection);
    await saveAdminConnection(admin, nextConnection);
  }

  await recordMetaLeadAdsSyncLog({
    adminId: connection.connectedByAdminId || null,
    source: "webhook",
    runType: "webhook_batch",
    status: failed ? "warning" : "success",
    title: "Webhook batch processed",
    summary: `Processed ${events.length} webhook lead events (${succeeded} succeeded, ${duplicates} duplicates, ${failed} failed).`,
    attempts: 1,
    diagnostics: latestFailure ? [latestFailure] : [],
    occurredAt: new Date(),
  });

  return {
    processed: events.length,
    succeeded,
    failed,
    duplicates,
  };
};

const pollMetaLeadAdsLeads = async ({ lookbackMinutes = 30 } = {}) => {
  const connection = await loadMetaLeadAdsConnection({ refresh: true });
  assertMetaLeadAdsConnected(connection);

  try {
    const forms = Array.isArray(connection?.assets?.forms) ? connection.assets.forms : [];
    const selectedFormIds = Array.isArray(connection.selectedFormIds) && connection.selectedFormIds.length
      ? new Set(connection.selectedFormIds.map(trimString))
      : null;
    const selectedForms = forms.filter((form) => {
      if (!selectedFormIds) return true;
      return selectedFormIds.has(trimString(form?.id));
    });

    if (!selectedForms.length) {
      await recordMetaLeadAdsSyncLog({
        adminId: connection.connectedByAdminId || null,
        source: "polling",
        runType: "poll_cycle",
        status: "warning",
        title: "Polling skipped",
        summary: "No selected Meta forms are available for automatic lead polling.",
        occurredAt: new Date(),
      });
      return { processed: 0, discovered: 0, succeeded: 0, failed: 0, duplicates: 0 };
    }

    const since = connection?.webhookStatus?.lastProcessedAt
      ? new Date(connection.webhookStatus.lastProcessedAt)
      : new Date(Date.now() - Math.max(1, Number(lookbackMinutes || 30)) * 60 * 1000);

    const syntheticEvents = [];
    for (const form of selectedForms) {
      const pageId = trimString(form?.pageId || connection.selectedPageId);
      const pageAccessToken = trimString(connection.pageAccessTokens?.[pageId] || "");
      const recentLeads = await fetchRecentLeadsForForm({
        formId: trimString(form?.id),
        pageId,
        pageAccessToken,
        graphApiVersion: connection.graphApiVersion,
        since,
      });

      for (const lead of recentLeads) {
        syntheticEvents.push({
          eventKey: `${trimString(lead.pageId)}:${trimString(lead.metaLeadId)}`,
          metaLeadId: trimString(lead.metaLeadId),
          pageId: trimString(lead.pageId),
          formId: trimString(lead.formId),
          createdTime: lead.createdTime ? new Date(lead.createdTime) : new Date(),
          source: "polling",
          payload: {
            leadgen_id: trimString(lead.metaLeadId),
            page_id: trimString(lead.pageId),
            form_id: trimString(lead.formId),
          },
        });
      }
    }

    let succeeded = 0;
    let failed = 0;
    let duplicates = 0;
    let latestFailure = null;

    for (const event of syntheticEvents) {
      try {
        const result = await processSingleLeadgenEvent({
          connection,
          event,
          headers: { "user-agent": "meta-lead-ads-poller" },
        });
        if (trimString(result?.status) === "duplicate") duplicates += 1;
        else succeeded += 1;
      } catch (error) {
        failed += 1;
        latestFailure = normalizeMetaApiError(error, "polling");
        const eventLog = await MetaLeadAdsEventLog.findOne({ eventKey: event.eventKey });
        if (eventLog) {
          eventLog.status = latestFailure.retryable ? "retry_pending" : "failed";
          eventLog.retryable = Boolean(latestFailure.retryable);
          eventLog.nextRetryAt = latestFailure.retryable ? computeNextRetryAt(eventLog.attempts) : null;
          eventLog.errorCode = trimString(latestFailure.code);
          eventLog.errorMessage = trimString(latestFailure.message);
          eventLog.title = "Polling ingestion failed";
          eventLog.summary = latestFailure.message;
          eventLog.processedAt = new Date();
          eventLog.diagnostics = [toSafeDiagnostic(latestFailure)];
          await eventLog.save();
          await recordMetaLeadAdsSyncLog({
            adminId: connection.connectedByAdminId || null,
            source: "polling",
            runType: "lead_ingestion",
            status: "failed",
            title: eventLog.title,
            summary: eventLog.summary,
            metaLeadId: trimString(eventLog.metaLeadId),
            pageId: trimString(eventLog.pageId),
            pageName: trimString(eventLog.pageName),
            formId: trimString(eventLog.formId),
            formName: trimString(eventLog.formName),
            campaignId: trimString(eventLog.campaignId),
            campaignName: trimString(eventLog.campaignName),
            attempts: eventLog.attempts,
            retryable: eventLog.retryable,
            nextRetryAt: eventLog.nextRetryAt,
            diagnostics: [latestFailure],
            occurredAt: new Date(),
          });
        }
      }
    }

    const admin = await AdminUser.findOne({ role: "MainAdmin" });
    if (admin) {
      let nextConnection = normalizeMetaLeadAdsConnection(admin?.settings?.metaLeadAdsConnection || {});
      nextConnection = latestFailure ? updateConnectionErrorState(nextConnection, latestFailure, "polling") : clearConnectionErrorState(nextConnection);
      nextConnection.webhookStatus = {
        ...(nextConnection.webhookStatus || {}),
        status: latestFailure ? "error" : "subscribed",
        lastEventAt: syntheticEvents.length ? new Date() : nextConnection?.webhookStatus?.lastEventAt || null,
        lastProcessedAt: new Date(),
        lastErrorAt: latestFailure ? new Date() : null,
        lastErrorMessage: latestFailure ? latestFailure.message : "",
      };
      nextConnection.diagnostics = buildConnectionDiagnostics(nextConnection);
      await saveAdminConnection(admin, nextConnection);
    }

    await recordMetaLeadAdsSyncLog({
      adminId: connection.connectedByAdminId || null,
      source: "polling",
      runType: "poll_cycle",
      status: failed ? "warning" : "success",
      title: "Polling cycle completed",
      summary: `Discovered ${syntheticEvents.length} Meta leads (${succeeded} succeeded, ${duplicates} duplicates, ${failed} failed).`,
      attempts: 1,
      diagnostics: latestFailure ? [latestFailure] : [],
      occurredAt: new Date(),
    });

    return {
      processed: syntheticEvents.length,
      discovered: syntheticEvents.length,
      succeeded,
      failed,
      duplicates,
    };
  } catch (error) {
    const normalizedError = normalizeMetaApiError(error, "polling");
    const admin = await AdminUser.findOne({ role: "MainAdmin" });
    if (admin) {
      const nextConnection = updateConnectionErrorState(
        normalizeMetaLeadAdsConnection(admin?.settings?.metaLeadAdsConnection || {}),
        normalizedError,
        "polling"
      );
      nextConnection.webhookStatus = {
        ...(nextConnection.webhookStatus || {}),
        status: "error",
        lastErrorAt: new Date(),
        lastErrorMessage: normalizedError.message,
      };
      nextConnection.diagnostics = buildConnectionDiagnostics(nextConnection);
      await saveAdminConnection(admin, nextConnection);
    }

    await recordMetaLeadAdsSyncLog({
      adminId: connection.connectedByAdminId || null,
      source: "polling",
      runType: "poll_cycle",
      status: "failed",
      title: "Polling cycle failed",
      summary: normalizedError.message,
      diagnostics: [normalizedError],
      occurredAt: new Date(),
    });

    throw createIntegrationError(
      normalizedError.message,
      error?.status || 400,
      normalizedError.needsReconnect ? "META_LEAD_ADS_TOKEN_EXPIRED" : normalizedError.code,
      {
        category: normalizedError.category,
        needsReconnect: normalizedError.needsReconnect,
        tokenHealth: buildTokenHealth(connection),
      }
    );
  }
};

const retryFailedMetaLeadAdsSyncs = async ({ adminId, limit = DEFAULT_LOG_LIMIT } = {}) => {
  const admin = await assertMainAdminDoc(adminId);
  const connection = getCurrentConnectionForAdmin(admin);
  assertMetaLeadAdsConnected(connection);

  const retryLimit = Math.max(1, Math.min(Number(limit || DEFAULT_LOG_LIMIT), 50));
  const now = new Date();
  const retryableLogs = await MetaLeadAdsEventLog.find({
    status: { $in: [...RETRYABLE_EVENT_STATUSES] },
    retryable: true,
  })
    .sort({ nextRetryAt: 1, updatedAt: -1 })
    .lean();

  const dueLogs = (Array.isArray(retryableLogs) ? retryableLogs : [])
    .filter((item) => !item?.nextRetryAt || new Date(item.nextRetryAt).getTime() <= now.getTime())
    .slice(0, retryLimit);

  let retried = 0;
  let resolved = 0;
  let failed = 0;
  let latestFailure = null;

  for (const item of dueLogs) {
    retried += 1;
    try {
      await processSingleLeadgenEvent({
        connection,
        event: buildRetryEventFromLog(item),
        headers: { "user-agent": "meta-lead-ads-retry-worker" },
        forceRetry: true,
      });
      const updatedEventLog = await MetaLeadAdsEventLog.findOne({ eventKey: item.eventKey });
      if (updatedEventLog) {
        updatedEventLog.retryable = false;
        updatedEventLog.nextRetryAt = null;
        updatedEventLog.errorCode = "";
        updatedEventLog.errorMessage = "";
        await updatedEventLog.save();
      }
      resolved += 1;
    } catch (error) {
      failed += 1;
      latestFailure = normalizeMetaApiError(error, "retry");
      const failedEventLog = await MetaLeadAdsEventLog.findOne({ eventKey: item.eventKey });
      if (failedEventLog) {
        failedEventLog.status = latestFailure.retryable && failedEventLog.attempts < MAX_RETRY_ATTEMPTS ? "retry_pending" : "failed";
        failedEventLog.retryable = Boolean(latestFailure.retryable && failedEventLog.attempts < MAX_RETRY_ATTEMPTS);
        failedEventLog.nextRetryAt = failedEventLog.retryable ? computeNextRetryAt(failedEventLog.attempts) : null;
        failedEventLog.errorCode = trimString(latestFailure.code);
        failedEventLog.errorMessage = trimString(latestFailure.message);
        failedEventLog.title = "Lead sync retry failed";
        failedEventLog.summary = latestFailure.message;
        failedEventLog.processedAt = new Date();
        failedEventLog.diagnostics = [toSafeDiagnostic(latestFailure)];
        await failedEventLog.save();
        await recordMetaLeadAdsSyncLog({
          adminId: admin._id,
          source: "retry",
          runType: "lead_retry",
          status: "failed",
          title: failedEventLog.title,
          summary: failedEventLog.summary,
          metaLeadId: trimString(failedEventLog.metaLeadId),
          pageId: trimString(failedEventLog.pageId),
          pageName: trimString(failedEventLog.pageName),
          formId: trimString(failedEventLog.formId),
          formName: trimString(failedEventLog.formName),
          campaignId: trimString(failedEventLog.campaignId),
          campaignName: trimString(failedEventLog.campaignName),
          attempts: failedEventLog.attempts,
          retryable: failedEventLog.retryable,
          nextRetryAt: failedEventLog.nextRetryAt,
          diagnostics: [latestFailure],
          occurredAt: new Date(),
        });
      }
    }
  }

  let nextConnection = getCurrentConnectionForAdmin(admin);
  nextConnection = latestFailure ? updateConnectionErrorState(nextConnection, latestFailure, "retry") : clearConnectionErrorState(nextConnection);
  nextConnection.diagnostics = buildConnectionDiagnostics(nextConnection);
  await saveAdminConnection(admin, nextConnection);

  await recordMetaLeadAdsSyncLog({
    adminId: admin._id,
    source: "retry",
    runType: "retry_batch",
    status: failed ? "warning" : "success",
    title: "Failed lead retry batch completed",
    summary: `Retried ${retried} failed lead syncs (${resolved} resolved, ${failed} still failing).`,
    attempts: retried || 1,
    diagnostics: latestFailure ? [latestFailure] : [],
    occurredAt: new Date(),
  });

  return {
    retried,
    resolved,
    failed,
    settings: await buildMetaLeadAdsStatusPayload(nextConnection, { includeLogs: true, logsLimit: STATUS_LOG_LIMIT }),
    logs: await getMetaLeadAdsLogs({ limit: DEFAULT_LOG_LIMIT }),
  };
};

module.exports = {
  buildSafeConnectionResponse,
  buildScopeSummary,
  buildConnectionDiagnostics,
  createIntegrationError,
  getMetaLeadAdsStatus,
  getMetaLeadAdsLogs,
  getMetaLeadAdsCampaigns,
  exchangeMetaLeadAdsCode,
  syncMetaLeadAdsAssets,
  disconnectMetaLeadAds,
  retryFailedMetaLeadAdsSyncs,
  verifyMetaLeadAdsWebhookSignature,
  processMetaLeadAdsWebhookPayload,
  pollMetaLeadAdsLeads,
  extractLeadgenEvents,
  mapMetaLeadFields,
};

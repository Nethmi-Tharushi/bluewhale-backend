const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const trimString = (value) => String(value || "").trim();

const createDoc = (initial = {}) => ({
  ...initial,
  select() {
    return {
      lean: async () => this,
    };
  },
  lean: async function lean() {
    return this;
  },
  async save() {
    return this;
  },
});

const normalizeDateValue = (value) => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

const matchesCondition = (value, condition) => {
  if (condition && typeof condition === "object" && !Array.isArray(condition)) {
    if (Array.isArray(condition.$in)) {
      return condition.$in.map(trimString).includes(trimString(value));
    }
  }
  return trimString(value) === trimString(condition);
};

const matchesQuery = (doc = {}, query = {}) =>
  Object.entries(query || {}).every(([key, condition]) => {
    if (condition && typeof condition === "object" && !Array.isArray(condition) && "$in" in condition) {
      return matchesCondition(doc?.[key], condition);
    }
    return matchesCondition(doc?.[key], condition);
  });

const createQuery = (items = []) => ({
  sort(sortSpec = {}) {
    const entries = Array.from(items);
    const keys = Object.entries(sortSpec);
    entries.sort((left, right) => {
      for (const [key, direction] of keys) {
        const leftValue = left?.[key];
        const rightValue = right?.[key];
        if (leftValue === rightValue) continue;
        const leftScore =
          leftValue instanceof Date || rightValue instanceof Date
            ? normalizeDateValue(leftValue)
            : typeof leftValue === "number" || typeof rightValue === "number"
              ? Number(leftValue || 0)
              : String(leftValue || "");
        const rightScore =
          leftValue instanceof Date || rightValue instanceof Date
            ? normalizeDateValue(rightValue)
            : typeof leftValue === "number" || typeof rightValue === "number"
              ? Number(rightValue || 0)
              : String(rightValue || "");
        if (leftScore === rightScore) continue;
        if (direction < 0) return leftScore > rightScore ? -1 : 1;
        return leftScore < rightScore ? -1 : 1;
      }
      return 0;
    });
    return createQuery(entries);
  },
  async lean() {
    return items.map((item) => ({ ...item }));
  },
});

const loadServiceScenario = ({
  connection,
  leadPayload,
  existingSubmission = null,
  existingEventLogs = [],
  existingLead = null,
  fetchMetaGraphCollection = async () => [],
  metaGraphRequestOverride = null,
} = {}) => {
  const eventStore = new Map();
  const submissionStore = new Map();
  const campaignStore = new Map();
  const syncLogStore = [];
  const leadStore = new Map();
  const leadCreates = [];
  let metaGraphRequestCalls = 0;

  if (existingSubmission) {
    submissionStore.set(
      trimString(existingSubmission.metaLeadId),
      createDoc({
        ...existingSubmission,
      })
    );
  }

  for (const eventLog of existingEventLogs) {
    eventStore.set(trimString(eventLog.eventKey), createDoc({ ...eventLog }));
  }

  if (existingLead) {
    leadStore.set(trimString(existingLead.integrationKey), createDoc({ ...existingLead }));
  }

  const adminDoc = createDoc({
    _id: "admin-main",
    role: "MainAdmin",
    settings: {
      metaLeadAdsConnection: connection,
    },
    auditLogs: [],
  });

  const service = loadWithMocks(path.resolve(__dirname, "../services/metaLeadAdsService.js"), {
    "../models/AdminUser": {
      findOne: (query) => {
        if (query?.role === "MainAdmin") return createDoc(adminDoc);
        return null;
      },
      findById: () => createDoc(adminDoc),
    },
    "../models/Lead": {
      findById: async (id) => {
        for (const lead of leadStore.values()) {
          if (trimString(lead?._id) === trimString(id)) return lead;
        }
        return null;
      },
      findOne: async (query) => leadStore.get(trimString(query?.integrationKey)) || null,
      countDocuments: async () => leadStore.size,
      create: async (payload) => {
        leadCreates.push(payload);
        const doc = createDoc({ _id: `crm-lead-${leadCreates.length}`, ...payload });
        leadStore.set(trimString(payload.integrationKey), doc);
        return doc;
      },
    },
    "../models/MetaLeadAdsCampaign": {
      find: (query = {}) => createQuery(Array.from(campaignStore.values()).filter((item) => matchesQuery(item, query))),
      findOneAndUpdate: async (query, update) => {
        const existing = campaignStore.get(trimString(query?.campaignId)) || {};
        const next = {
          ...existing,
          ...(update?.$setOnInsert || {}),
          ...(update?.$set || {}),
          campaignId: trimString(query?.campaignId),
        };
        campaignStore.set(trimString(query?.campaignId), next);
        return {
          lean: async () => next,
        };
      },
    },
    "../models/MetaLeadAdsEventLog": {
      findOne: async ({ eventKey }) => eventStore.get(trimString(eventKey)) || null,
      find: (query = {}) => createQuery(Array.from(eventStore.values()).filter((item) => matchesQuery(item, query))),
      countDocuments: async (query = {}) => Array.from(eventStore.values()).filter((item) => matchesQuery(item, query)).length,
      create: async (payload) => {
        const doc = createDoc({ _id: `event-${eventStore.size + 1}`, ...payload });
        eventStore.set(trimString(payload.eventKey), doc);
        return doc;
      },
    },
    "../models/MetaLeadAdsSubmission": {
      findOne: async ({ metaLeadId }) => submissionStore.get(trimString(metaLeadId)) || null,
      find: (query = {}) => createQuery(Array.from(submissionStore.values()).filter((item) => matchesQuery(item, query))),
      countDocuments: async (query = {}) => Array.from(submissionStore.values()).filter((item) => matchesQuery(item, query)).length,
      create: async (payload) => {
        const doc = createDoc({ _id: `submission-${submissionStore.size + 1}`, eventKeys: [], attempts: 1, ...payload });
        submissionStore.set(trimString(payload.metaLeadId), doc);
        return doc;
      },
    },
    "../models/MetaLeadAdsSyncLog": {
      find: (query = {}) => createQuery(syncLogStore.filter((item) => matchesQuery(item, query))),
      create: async (payload) => {
        const doc = createDoc({ _id: `sync-log-${syncLogStore.length + 1}`, ...payload });
        syncLogStore.push(doc);
        return doc;
      },
    },
    "./metaLeadAdsConnectionService": {
      DEFAULT_META_LEAD_FIELD_MAPPING: {
        full_name: "name",
        email: "email",
        phone_number: "phone",
      },
      REQUIRED_META_LEAD_ADS_SCOPES: [
        "business_management",
        "leads_retrieval",
        "pages_manage_ads",
        "pages_read_engagement",
        "pages_manage_metadata",
      ],
      loadMetaLeadAdsConnection: async () => adminDoc.settings.metaLeadAdsConnection,
      normalizeMetaLeadAdsConnection: (value) => value,
      prepareMetaLeadAdsConnectionForPersistence: (value) => value,
      sanitizeMetaLeadAdsConnection: (value) => ({
        ...value,
        webhookVerifyToken: "abc***yz",
      }),
      syncMetaLeadAdsConnectionCache: (value) => {
        adminDoc.settings.metaLeadAdsConnection = value;
        return value;
      },
    },
    "./metaGraphService": {
      buildMetaAppAccessToken: () => "",
      fetchMetaGraphCollection,
      metaGraphRequest: async (...args) => {
        metaGraphRequestCalls += 1;
        if (typeof metaGraphRequestOverride === "function") {
          return metaGraphRequestOverride(...args);
        }
        return leadPayload;
      },
      trimString,
      maskSecret: (value) => value,
    },
    "../utils/leadSupport": {
      formatLeadForApi: (value) => {
        const plain = value && typeof value.toObject === "function" ? value.toObject() : value;
        return { ...plain, _id: String(plain?._id || "") };
      },
      normalizeLeadTags: (value) => Array.from(new Set((Array.isArray(value) ? value : []).map(trimString).filter(Boolean))),
    },
  });

  return {
    service,
    eventStore,
    submissionStore,
    campaignStore,
    syncLogStore,
    leadStore,
    leadCreates,
    adminDoc,
    getMetaGraphRequestCalls: () => metaGraphRequestCalls,
  };
};

module.exports = async () => {
  const baseConnection = {
    accessToken: "user-token",
    appId: "app-1",
    appSecret: "secret-1",
    graphApiVersion: "v21.0",
    crmSourceLabel: "Meta Lead Ads",
    autoCreateLeads: false,
    autoAssignToOwner: true,
    selectedPageId: "page-1",
    selectedPageName: "Lead Page",
    selectedFormIds: ["form-1"],
    pageAccessTokens: { "page-1": "page-token" },
    fieldMapping: { full_name: "name", email: "email" },
    assets: {
      pages: [{ id: "page-1", name: "Lead Page" }],
      forms: [{ id: "form-1", name: "Visa Form", pageId: "page-1", pageName: "Lead Page" }],
    },
    webhookStatus: { status: "subscribed" },
    scopeSummary: { granted: ["leads_retrieval"], missingRequired: [] },
    diagnostics: [],
    connectedByAdminId: "admin-main",
  };

  const leadPayload = {
    id: "meta-lead-1",
    form_id: "form-1",
    campaign_id: "cmp-1",
    campaign_name: "Campaign Alpha",
    field_data: [
      { name: "full_name", values: ["Jane Lead"] },
      { name: "email", values: ["jane@example.com"] },
    ],
  };

  const pendingScenario = loadServiceScenario({
    connection: baseConnection,
    leadPayload,
  });

  const pendingResult = await pendingScenario.service.processMetaLeadAdsWebhookPayload({
    payload: {
      object: "page",
      entry: [
        {
          id: "page-1",
          changes: [
            {
              field: "leadgen",
              value: {
                leadgen_id: "meta-lead-1",
                page_id: "page-1",
                form_id: "form-1",
                campaign_id: "cmp-1",
                campaign_name: "Campaign Alpha",
              },
            },
          ],
        },
      ],
    },
    headers: {},
  });

  assert.equal(pendingResult.processed, 1);
  assert.equal(pendingScenario.leadCreates.length, 0);
  assert.equal(pendingScenario.submissionStore.get("meta-lead-1").status, "pending_review");
  assert.equal(pendingScenario.eventStore.get("page-1:meta-lead-1").status, "processed");
  assert.equal(pendingScenario.syncLogStore.some((item) => item.source === "webhook" && item.runType === "webhook_batch"), true);

  const pendingLogs = await pendingScenario.service.getMetaLeadAdsLogs({});
  assert.equal(Array.isArray(pendingLogs.syncHistory), true);
  assert.equal(Array.isArray(pendingLogs.syncedLeads), true);
  assert.equal(Array.isArray(pendingLogs.failedSyncs), true);
  assert.equal(pendingLogs.syncSummary.totalSyncedLeads, 1);

  const autoCreateScenario = loadServiceScenario({
    connection: {
      ...baseConnection,
      autoCreateLeads: true,
      autoAssignToOwner: false,
    },
    leadPayload: {
      id: "meta-lead-created",
      created_time: "2026-05-07T03:00:00.000Z",
      form_id: "form-1",
      campaign_id: "cmp-1",
      campaign_name: "Campaign Alpha",
      ad_id: "ad-1",
      ad_name: "Sales Ad Creative",
      adset_name: "Hiring Adset",
      field_data: [
        { name: "full_name", values: ["Meta Applicant"] },
        { name: "email", values: ["meta@example.com"] },
        { name: "phone_number", values: ["+971500000009"] },
        { name: "additional_notes", values: ["Night shift preferred"] },
        { name: "job_position", values: ["Sales Executive"] },
        { name: "portfolio", values: ["https://example.com"] },
      ],
    },
  });

  const autoCreateResult = await autoCreateScenario.service.processMetaLeadAdsWebhookPayload({
    payload: {
      object: "page",
      entry: [
        {
          id: "page-1",
          changes: [
            {
              field: "leadgen",
              value: {
                leadgen_id: "meta-lead-created",
                page_id: "page-1",
                form_id: "form-1",
                campaign_id: "cmp-1",
                campaign_name: "Campaign Alpha",
              },
            },
          ],
        },
      ],
    },
    headers: {},
  });

  assert.equal(autoCreateResult.succeeded, 1);
  assert.equal(autoCreateScenario.leadCreates.length, 1);
  assert.equal(autoCreateScenario.leadCreates[0].assignedTo, null);
  assert.equal(autoCreateScenario.leadCreates[0].name, "Meta Applicant");
  assert.equal(autoCreateScenario.leadCreates[0].email, "meta@example.com");
  assert.equal(autoCreateScenario.leadCreates[0].phone, "+971500000009");
  assert.equal(autoCreateScenario.leadCreates[0].sourceDetails, "Campaign Alpha | Visa Form");
  assert.equal(autoCreateScenario.leadCreates[0].sourceMetadata.additionalNotes, "Night shift preferred");
  assert.equal(autoCreateScenario.leadCreates[0].sourceMetadata.jobPosition, "Sales Executive");
  assert.equal(autoCreateScenario.leadCreates[0].sourceMetadata.postName, "Sales Ad Creative");
  assert.equal(autoCreateScenario.leadCreates[0].sourceMetadata.metaLeadTimestamp, "2026-05-07T03:00:00.000Z");
  assert.equal(autoCreateScenario.leadCreates[0].sourceMetadata.syncStatus, "synced");
  assert.equal(autoCreateScenario.leadCreates[0].sourceMetadata.customFieldValues.portfolio, "https://example.com");
  assert.equal(autoCreateScenario.submissionStore.get("meta-lead-created").assignedTo, null);

  const preservedAssignmentScenario = loadServiceScenario({
    connection: {
      ...baseConnection,
      autoCreateLeads: true,
      autoAssignToOwner: false,
    },
    leadPayload: {
      id: "meta-lead-preserve",
      created_time: "2026-05-07T04:00:00.000Z",
      form_id: "form-1",
      campaign_id: "cmp-2",
      campaign_name: "Campaign Beta",
      field_data: [
        { name: "full_name", values: ["Existing Meta Lead"] },
        { name: "email", values: ["existing@example.com"] },
      ],
    },
    existingLead: {
      _id: "crm-lead-preserve",
      integrationKey: "meta_lead_ads:meta-lead-preserve",
      assignedTo: "sales-staff-manual",
      assignedBy: "sales-admin-manual",
      assignedAt: "2026-05-07T05:00:00.000Z",
      ownerAdmin: "admin-main",
      teamAdmin: "admin-main",
      tags: [],
      save() {
        return this;
      },
    },
  });

  await preservedAssignmentScenario.service.processMetaLeadAdsWebhookPayload({
    payload: {
      object: "page",
      entry: [
        {
          id: "page-1",
          changes: [
            {
              field: "leadgen",
              value: {
                leadgen_id: "meta-lead-preserve",
                page_id: "page-1",
                form_id: "form-1",
                campaign_id: "cmp-2",
                campaign_name: "Campaign Beta",
              },
            },
          ],
        },
      ],
    },
    headers: {},
  });

  assert.equal(
    preservedAssignmentScenario.leadStore.get("meta_lead_ads:meta-lead-preserve").assignedTo,
    "sales-staff-manual"
  );

  const duplicateScenario = loadServiceScenario({
    connection: {
      ...baseConnection,
      autoCreateLeads: true,
    },
    leadPayload,
    existingSubmission: {
      _id: "submission-existing",
      metaLeadId: "meta-lead-1",
      status: "created",
      crmLeadId: "crm-lead-1",
      eventKeys: [],
    },
  });

  await duplicateScenario.service.processMetaLeadAdsWebhookPayload({
    payload: {
      object: "page",
      entry: [
        {
          id: "page-1",
          changes: [
            {
              field: "leadgen",
              value: {
                leadgen_id: "meta-lead-1",
                page_id: "page-1",
                form_id: "form-1",
              },
            },
          ],
        },
      ],
    },
    headers: {},
  });

  assert.equal(duplicateScenario.eventStore.get("page-1:meta-lead-1").status, "duplicate");
  assert.equal(duplicateScenario.leadCreates.length, 0);
  assert.equal(duplicateScenario.getMetaGraphRequestCalls(), 0);

  const campaignFetchScenario = loadServiceScenario({
    connection: {
      ...baseConnection,
      selectedBusinessId: "biz-1",
      selectedBusinessName: "Biz 1",
      selectedFormIds: [],
      assets: {
        pages: [{ id: "page-1", name: "Lead Page" }],
        forms: [{ id: "form-1", name: "Visa Form", pageId: "page-1" }],
      },
      scopeSummary: {
        granted: [
          "ads_read",
          "business_management",
          "leads_retrieval",
          "pages_manage_metadata",
          "pages_manage_ads",
          "pages_read_engagement",
        ],
        missingRequired: [],
      },
    },
    leadPayload,
    fetchMetaGraphCollection: async ({ path }) => {
      if (path === "me/businesses") return [{ id: "biz-1", name: "Biz 1" }];
      if (path === "me/accounts") return [{ id: "page-1", name: "Lead Page", access_token: "page-token", business: { id: "biz-1", name: "Biz 1" } }];
      if (path === "biz-1/owned_pages") return [{ id: "page-1", name: "Lead Page", business: { id: "biz-1", name: "Biz 1" } }];
      if (path === "biz-1/client_pages") return [];
      if (path === "page-1/leadgen_forms") return [{ id: "form-1", name: "Visa Form", questions: [] }];
      if (path === "page-1/subscribed_apps") return [{ id: "app-1", subscribed_fields: ["leadgen"] }];
      if (path === "me/adaccounts") return [{ id: "act_1", name: "Main Ad Account", business: { id: "biz-1", name: "Biz 1" } }];
      if (path === "act_1/campaigns") {
        return [
          {
            id: "cmp-1",
            name: "Lead Campaign",
            objective: "OUTCOME_LEADS",
            effective_status: "ACTIVE",
            configured_status: "ACTIVE",
          },
        ];
      }
      if (path === "form-1/leads") return [{ id: "meta-lead-2", created_time: new Date().toISOString() }];
      return [];
    },
    metaGraphRequestOverride: async ({ path }) => {
      if (path === "me/permissions") {
        return {
          data: [
            { permission: "ads_read", status: "granted" },
            { permission: "leads_retrieval", status: "granted" },
            { permission: "business_management", status: "granted" },
            { permission: "pages_manage_metadata", status: "granted" },
            { permission: "pages_manage_ads", status: "granted" },
            { permission: "pages_read_engagement", status: "granted" },
          ],
        };
      }
      return leadPayload;
    },
  });

  const syncedSettings = await campaignFetchScenario.service.syncMetaLeadAdsAssets({
    adminId: "admin-main",
    input: {},
  });
  assert.equal(Array.isArray(syncedSettings.assets.campaigns), true);
  assert.equal(syncedSettings.campaignLauncher.enabled, false);
  assert.equal(syncedSettings.tokenHealth.status, "ok");

  const storedCampaigns = await campaignFetchScenario.service.getMetaLeadAdsCampaigns({});
  assert.equal(storedCampaigns.length, 1);
  assert.equal(storedCampaigns[0].name, "Lead Campaign");

  const pollResult = await campaignFetchScenario.service.pollMetaLeadAdsLeads({
    lookbackMinutes: 60,
  });
  assert.equal(pollResult.discovered, 1);
  assert.equal(campaignFetchScenario.syncLogStore.some((item) => item.source === "polling" && item.runType === "poll_cycle"), true);

  const retryScenario = loadServiceScenario({
    connection: {
      ...baseConnection,
      autoCreateLeads: true,
    },
    leadPayload,
    existingSubmission: {
      _id: "submission-existing",
      metaLeadId: "meta-lead-retry",
      status: "created",
      crmLeadId: "crm-lead-99",
      eventKeys: [],
    },
    existingEventLogs: [
      {
        _id: "event-existing",
        eventKey: "page-1:meta-lead-retry",
        metaLeadId: "meta-lead-retry",
        pageId: "page-1",
        pageName: "Lead Page",
        formId: "form-1",
        formName: "Visa Form",
        status: "retry_pending",
        retryable: true,
        attempts: 1,
        payload: {
          leadgen_id: "meta-lead-retry",
          page_id: "page-1",
          form_id: "form-1",
        },
      },
    ],
  });

  const retryResult = await retryScenario.service.retryFailedMetaLeadAdsSyncs({
    adminId: "admin-main",
    limit: 10,
  });
  assert.equal(retryResult.retried, 1);
  assert.equal(retryResult.failed, 0);
  assert.equal(retryScenario.eventStore.get("page-1:meta-lead-retry").status, "duplicate");
  assert.equal(retryScenario.leadCreates.length, 0);

  const tokenFailureScenario = loadServiceScenario({
    connection: {
      ...baseConnection,
      scopeSummary: { granted: ["ads_read"], missingRequired: [] },
    },
    leadPayload,
    fetchMetaGraphCollection: async ({ path }) => {
      if (path === "me/businesses") {
        const error = new Error("Error validating access token: Session has expired");
        error.code = "190";
        error.details = { code: 190 };
        error.status = 401;
        throw error;
      }
      return [];
    },
    metaGraphRequestOverride: async ({ path }) => {
      if (path === "me/permissions") return { data: [{ permission: "ads_read", status: "granted" }] };
      return leadPayload;
    },
  });

  let expiredError = null;
  try {
    await tokenFailureScenario.service.syncMetaLeadAdsAssets({
      adminId: "admin-main",
      input: {},
    });
  } catch (error) {
    expiredError = error;
  }

  assert.ok(expiredError);
  assert.equal(expiredError.code, "META_LEAD_ADS_TOKEN_EXPIRED");

  const failureStatus = await tokenFailureScenario.service.getMetaLeadAdsStatus({ refresh: true });
  assert.equal(failureStatus.tokenHealth.needsReconnect, true);
  assert.equal(failureStatus.tokenHealth.status, "expired");

  const missingCampaignScopeScenario = loadServiceScenario({
    connection: {
      ...baseConnection,
      scopeSummary: {
        granted: [
          "business_management",
          "leads_retrieval",
          "pages_manage_metadata",
          "pages_manage_ads",
          "pages_read_engagement",
        ],
        missingRequired: [],
      },
    },
    leadPayload,
    fetchMetaGraphCollection: async ({ path }) => {
      if (path === "me/businesses") return [];
      if (path === "me/accounts") return [];
      return [];
    },
    metaGraphRequestOverride: async ({ path }) => {
      if (path === "me/permissions") {
        return {
          data: [
            { permission: "leads_retrieval", status: "granted" },
            { permission: "business_management", status: "granted" },
            { permission: "pages_manage_metadata", status: "granted" },
            { permission: "pages_manage_ads", status: "granted" },
            { permission: "pages_read_engagement", status: "granted" },
          ],
        };
      }
      return leadPayload;
    },
  });

  const scopeWarningStatus = await missingCampaignScopeScenario.service.syncMetaLeadAdsAssets({
    adminId: "admin-main",
    input: {},
  });
  assert.equal(
    scopeWarningStatus.diagnostics.some((item) => item.code === "campaign_scopes_missing"),
    true
  );
  assert.equal(scopeWarningStatus.campaignLauncher.status, "coming_soon");
};

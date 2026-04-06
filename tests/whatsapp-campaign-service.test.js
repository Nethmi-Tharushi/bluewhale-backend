const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const createQuery = (resolver) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  sort(sortSpec) {
    this._sortSpec = sortSpec;
    return this;
  },
  async lean() {
    const result = resolver(this._sortSpec || {});
    return deepClone(result);
  },
});

const createCampaignModelMock = () => {
  const store = [];
  let counter = 0;

  const now = () => new Date(`2026-04-03T10:00:${String(counter).padStart(2, "0")}.000Z`);

  const normalizeRecord = (value = {}) => ({
    ...deepClone(value),
    _id: String(value._id || `campaign_${++counter}`),
    createdAt: value.createdAt ? new Date(value.createdAt) : now(),
    updatedAt: value.updatedAt ? new Date(value.updatedAt) : now(),
  });

  const matchFilter = (record, filter = {}) => {
    const plainFilter = { ...filter };
    delete plainFilter.$or;

    const plainMatch = Object.entries(plainFilter).every(([key, expected]) => String(record[key] || "") === String(expected || ""));
    if (!plainMatch) {
      return false;
    }

    if (Array.isArray(filter.$or) && filter.$or.length > 0) {
      return filter.$or.some((condition) =>
        Object.entries(condition).some(([field, expression]) => expression.test(String(record[field] || "")))
      );
    }

    return true;
  };

  const compareValues = (left, right, direction) => {
    if (left === right) return 0;
    if (left === undefined || left === null) return 1 * direction;
    if (right === undefined || right === null) return -1 * direction;
    if (left > right) return 1 * direction;
    if (left < right) return -1 * direction;
    return 0;
  };

  class FakeCampaignDocument {
    constructor(value) {
      Object.assign(this, normalizeRecord(value));
    }

    toObject() {
      return deepClone(this);
    }

    async save() {
      this.updatedAt = now();
      const index = store.findIndex((item) => String(item._id) === String(this._id));
      if (index >= 0) {
        store[index] = deepClone(this);
      } else {
        store.push(deepClone(this));
      }
      return this;
    }
  }

  const model = {
    WHATSAPP_CAMPAIGN_STATUS_OPTIONS: ["Draft", "Scheduled", "Running", "Sent", "Failed", "Paused", "Cancelled"],
    WHATSAPP_CAMPAIGN_TYPE_OPTIONS: ["Broadcast", "Promotional", "Reminder", "Follow-up", "Custom"],
    WHATSAPP_CAMPAIGN_CHANNEL_OPTIONS: ["WhatsApp", "Instagram", "Both"],
    WHATSAPP_CAMPAIGN_SCHEDULE_TYPE_OPTIONS: ["draft", "send_now", "later"],
    WHATSAPP_CAMPAIGN_CONTENT_MODE_OPTIONS: ["template", "compose"],
    WHATSAPP_CAMPAIGN_AUDIENCE_TYPE_OPTIONS: ["all_contacts", "segments", "manual"],
    __store: store,
    find(filter = {}) {
      return createQuery((sortSpec) => {
        const items = store.filter((item) => matchFilter(item, filter));
        const sorted = [...items].sort((left, right) => {
          for (const [field, rawDirection] of Object.entries(sortSpec || {})) {
            const direction = Number(rawDirection) < 0 ? -1 : 1;
            const result = compareValues(left[field], right[field], direction);
            if (result !== 0) {
              return result;
            }
          }
          return 0;
        });
        return sorted;
      });
    },
    findOne(filter = {}) {
      return createQuery(() => store.find((item) => matchFilter(item, filter)) || null);
    },
    async findById(id) {
      const record = store.find((item) => String(item._id) === String(id));
      return record ? new FakeCampaignDocument(record) : null;
    },
    async create(payload) {
      const document = new FakeCampaignDocument(payload);
      store.push(deepClone(document));
      return new FakeCampaignDocument(document);
    },
    async findByIdAndDelete(id) {
      const index = store.findIndex((item) => String(item._id) === String(id));
      if (index < 0) {
        return null;
      }
      const [deleted] = store.splice(index, 1);
      return new FakeCampaignDocument(deleted);
    },
  };

  return model;
};

const createAudienceModelMock = (records = []) => ({
  find() {
    return createQuery(() => records);
  },
});

const loadCampaignService = ({
  campaignModelMock,
  sendCalls,
  setCampaignStatus,
  contacts = [],
  conversations = [],
  campaignJobCount = 0,
} = {}) =>
  loadWithMocks(path.resolve(__dirname, "../services/whatsappCampaignService.js"), {
    "../models/WhatsAppCampaign": campaignModelMock,
    "../models/WhatsAppContact": createAudienceModelMock(contacts),
    "../models/WhatsAppConversation": createAudienceModelMock(conversations),
    "../models/WhatsAppCampaignJob": {
      countDocuments: async () => campaignJobCount,
    },
    "./whatsappTemplateService": {
      getTemplateById: async (templateId) => (
        templateId === "tpl_missing" ? null : { id: templateId, name: "Approved Template" }
      ),
      prepareTemplateMessage: async (payload) => payload.template,
    },
    "./whatsappService": {
      normalizePhone: (value) => String(value || "").replace(/[^\d+]/g, "").replace(/^00/, "+"),
      sendMessage: async (payload) => {
        sendCalls.push(payload);
        return { response: { messages: [{ id: "wamid.campaign.test" }] } };
      },
    },
    "./whatsappCampaignRuntimeService": {
      launchCampaign: async ({ campaignId, actorId }) => {
        setCampaignStatus(campaignId, {
          status: "Running",
          launchedAt: new Date("2026-04-03T11:00:00.000Z"),
          launchedBy: actorId,
          updatedBy: actorId,
          audienceSize: 2,
          stats: { sent: 1, delivered: 0, read: 0, clicked: 0, failed: 0 },
        });
      },
      pauseCampaignJobs: async (campaignId) => {
        setCampaignStatus(campaignId, {
          status: "Paused",
          pausedAt: new Date("2026-04-03T11:01:00.000Z"),
        });
      },
      resumeCampaignJobs: async (campaignId) => {
        setCampaignStatus(campaignId, {
          status: "Running",
          resumedAt: new Date("2026-04-03T11:02:00.000Z"),
        });
      },
      cancelCampaignJobs: async (campaignId) => {
        setCampaignStatus(campaignId, {
          status: "Cancelled",
          cancelledAt: new Date("2026-04-03T11:03:00.000Z"),
        });
      },
      deleteCampaignJobs: async () => {},
    },
  });

module.exports = async () => {
  const campaignModelMock = createCampaignModelMock();
  const sendCalls = [];
  const audienceContacts = [
    {
      _id: "contact_1",
      name: "",
      phone: "+94770000001",
      source: "Nothing selected",
      profile: { name: "Alice", whatsappOptIn: false },
    },
    {
      _id: "contact_2",
      name: "Bob",
      phone: "+94770000002",
      source: "Manual import",
      profile: {},
    },
  ];
  const audienceConversations = [
    {
      _id: "conversation_1",
      contactId: "contact_1",
      tags: ["VIP", " follow up "],
      lastIncomingAt: "2020-04-03T09:00:00.000Z",
      automationState: { lastCustomerMessageAt: "2020-04-03T09:00:00.000Z" },
      linkedLeadId: { _id: "lead_1", name: "Lead Alice", source: "Facebook Ads" },
    },
    {
      _id: "conversation_2",
      contactId: "contact_2",
      tags: ["vip", "Student"],
      linkedLeadId: null,
    },
  ];
  const setCampaignStatus = (campaignId, updates = {}) => {
    const record = campaignModelMock.__store.find((item) => String(item._id) === String(campaignId));
    if (!record) {
      throw new Error("Campaign not found");
    }

    Object.assign(record, updates, {
      updatedAt: new Date("2026-04-03T11:00:00.000Z"),
    });
  };
  const whatsappCampaignService = loadCampaignService({
    campaignModelMock,
    sendCalls,
    setCampaignStatus,
    contacts: audienceContacts,
    conversations: audienceConversations,
  });

  const created = await whatsappCampaignService.createWhatsAppCampaign(
    {
      name: "Blue Whale April Outreach",
      type: "Promotional",
      channel: "WhatsApp",
      audienceType: "manual",
      manualContactIds: ["contact_1", "contact_2"],
      contentMode: "compose",
      bodyText: "Hello from Blue Whale",
      quickReplies: ["Book now", "Need help"],
      scheduleType: "draft",
    },
    "admin_1"
  );

  assert.equal(created.name, "Blue Whale April Outreach");
  assert.equal(created.status, "Draft");
  assert.equal(created._id, created.id);
  assert.deepEqual(created.manualContactIds, ["contact_1", "contact_2"]);
  assert.deepEqual(created.quickReplies, ["Book now", "Need help"]);
  assert.deepEqual(created.templateVariables, {});
  assert.deepEqual(created.stats, { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 });
  assert.equal(created.createdBy._id, "admin_1");

  await assert.rejects(
    () => whatsappCampaignService.testSendWhatsAppCampaign(created.id, {
      phoneNumber: "+94770000001",
    }),
    /24-hour customer care window/
  );
  assert.equal(sendCalls.length, 0);

  campaignModelMock.__store.push({
    _id: "legacy_campaign",
    name: "Legacy Campaign",
    type: "Custom",
    channel: "Both",
    status: "Sent",
    audienceType: "all_contacts",
    audienceSize: 42,
    template: { name: "Legacy Template Name" },
    templateId: "tpl_legacy",
    contentMode: "template",
    scheduleType: "send_now",
    templateVariables: null,
    quickReplies: null,
    sentCount: 5,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
  });

  const listed = await whatsappCampaignService.listWhatsAppCampaigns();
  assert.equal(listed.length, 2);
  const sortedByName = await whatsappCampaignService.listWhatsAppCampaigns({ sortBy: "name", sortOrder: "asc" });
  assert.equal(sortedByName[0].name, "Blue Whale April Outreach");

  const fetchedLegacy = await whatsappCampaignService.getWhatsAppCampaignById("legacy_campaign");
  assert.equal(fetchedLegacy.templateName, "Legacy Template Name");
  assert.equal(fetchedLegacy.stats.sent, 5);
  assert.equal(fetchedLegacy.sentCount, 5);
  assert.deepEqual(fetchedLegacy.quickReplies, []);

  const updated = await whatsappCampaignService.updateWhatsAppCampaign(
    created.id,
    {
      contentMode: "template",
      templateId: "tpl_approved_1",
      templateName: "Approved Template 1",
      bodyText: "",
      scheduleType: "later",
      scheduleAt: "2026-05-01T10:00:00.000Z",
      stopIfTemplateMissing: true,
    },
    "admin_2"
  );

  assert.equal(updated.contentMode, "template");
  assert.equal(updated.templateId, "tpl_approved_1");
  assert.equal(updated.status, "Scheduled");
  assert.equal(updated.scheduledAt, "2026-05-01T10:00:00.000Z");
  assert.equal(updated.scheduleAt, "2026-05-01T10:00:00.000Z");
  assert.equal(updated.stopIfTemplateMissing, true);

  const statsBeforeTest = deepClone(updated.stats);
  const preview = await whatsappCampaignService.testSendWhatsAppCampaign(created.id, {
    phoneNumber: "+94770000000",
  });
  assert.equal(preview.campaignId, created.id);
  assert.equal(preview.phoneNumber, "+94770000000");
  assert.equal(preview.previewMode, false);
  assert.equal(preview.sent, true);
  assert.equal(preview.modeUsed, "template");
  assert.equal(preview.messageId, "wamid.campaign.test");
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].type, "template");
  assert.equal(sendCalls[0].template.id, "tpl_approved_1");

  const afterPreview = await whatsappCampaignService.getWhatsAppCampaignById(created.id);
  assert.deepEqual(afterPreview.stats, statsBeforeTest);

  const launched = await whatsappCampaignService.launchWhatsAppCampaign(created.id, "admin_3");
  assert.equal(launched.status, "Running");
  assert.equal(launched.launchedBy._id, "admin_3");
  assert.equal(launched.stats.sent, 1);

  campaignModelMock.__store.push({
    _id: "stale_running_campaign",
    name: "Stale Running Campaign",
    type: "Custom",
    channel: "WhatsApp",
    status: "Running",
    audienceType: "manual",
    manualContactIds: ["contact_1"],
    contentMode: "template",
    templateId: "tpl_approved_1",
    templateName: "Approved Template 1",
    templateVariables: {},
    scheduleType: "draft",
    stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 },
    createdBy: { _id: "admin_1", name: "", email: "" },
    updatedBy: { _id: "admin_1", name: "", email: "" },
  });

  const relaunched = await whatsappCampaignService.launchWhatsAppCampaign("stale_running_campaign", "admin_5");
  assert.equal(relaunched.status, "Running");
  assert.equal(relaunched.launchedBy._id, "admin_5");

  const paused = await whatsappCampaignService.pauseWhatsAppCampaign(created.id, "admin_4");
  assert.equal(paused.status, "Paused");
  assert.ok(paused.pausedAt);

  const resumed = await whatsappCampaignService.resumeWhatsAppCampaign(created.id, "admin_5");
  assert.equal(resumed.status, "Running");
  assert.ok(resumed.resumedAt);

  const cancelled = await whatsappCampaignService.cancelWhatsAppCampaign(created.id, "admin_6");
  assert.equal(cancelled.status, "Cancelled");
  assert.ok(cancelled.cancelledAt);

  await assert.rejects(
    () => whatsappCampaignService.launchWhatsAppCampaign(created.id, "admin_7"),
    /Cancelled campaigns cannot be launched/
  );

  const deleted = await whatsappCampaignService.deleteWhatsAppCampaign(created.id);
  assert.equal(deleted.success, true);

  const missing = await whatsappCampaignService.getWhatsAppCampaignById(created.id);
  assert.equal(missing, null);

  const audienceResources = await whatsappCampaignService.listWhatsAppCampaignAudienceResources();
  assert.equal(audienceResources.contacts.length, 2);
  assert.equal(audienceResources.contacts[0].id, "contact_1");
  assert.equal(audienceResources.contacts[0].name, "Alice");
  assert.equal(audienceResources.contacts[0].source, "Facebook Ads");
  assert.equal(audienceResources.contacts[0].tag, "VIP");
  assert.equal(audienceResources.contacts[0].optedIn, false);
  assert.equal(audienceResources.summary.totalContacts, 2);
  assert.equal(audienceResources.summary.optedInContacts, 1);
  assert.equal(audienceResources.summary.totalTags, 3);
  assert.deepEqual(
    audienceResources.segments.map((segment) => ({ name: segment.name, audienceSize: segment.audienceSize })),
    [
      { name: "VIP", audienceSize: 2 },
      { name: "follow up", audienceSize: 1 },
      { name: "Student", audienceSize: 1 },
    ]
  );

  const searchableAudience = await whatsappCampaignService.listWhatsAppCampaignAudienceContacts({ search: "face", limit: 10 });
  assert.equal(searchableAudience.items.length, 1);
  assert.equal(searchableAudience.items[0].id, "contact_1");

  const emptyAudienceService = loadCampaignService({
    campaignModelMock: createCampaignModelMock(),
    sendCalls: [],
    setCampaignStatus: () => {},
    contacts: [],
    conversations: [],
  });
  const emptyAudienceResources = await emptyAudienceService.listWhatsAppCampaignAudienceResources();
  assert.deepEqual(emptyAudienceResources, {
    contacts: [],
    segments: [],
    summary: {
      totalContacts: 0,
      optedInContacts: 0,
      totalTags: 0,
    },
  });
};

const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const getComparableValue = (record, key) => {
  if (key.includes(".")) {
    return key.split(".").reduce((current, segment) => current?.[segment], record);
  }
  return record?.[key];
};

const sortItems = (items, sortSpec = {}) => {
  const entries = Object.entries(sortSpec || {});
  if (!entries.length) {
    return [...items];
  }

  return [...items].sort((left, right) => {
    for (const [field, directionValue] of entries) {
      const direction = Number(directionValue) < 0 ? -1 : 1;
      const leftValue = getComparableValue(left, field);
      const rightValue = getComparableValue(right, field);

      if (leftValue === rightValue) {
        continue;
      }

      if (leftValue === undefined || leftValue === null) {
        return 1 * direction;
      }

      if (rightValue === undefined || rightValue === null) {
        return -1 * direction;
      }

      if (leftValue > rightValue) {
        return 1 * direction;
      }

      if (leftValue < rightValue) {
        return -1 * direction;
      }
    }

    return 0;
  });
};

const matchValue = (actual, expected) => {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if (expected.$in) {
      return expected.$in.some((item) => String(item) === String(actual));
    }
    if (expected.$lte !== undefined) {
      return new Date(actual) <= new Date(expected.$lte);
    }
    if (expected.$gte !== undefined) {
      return new Date(actual) >= new Date(expected.$gte);
    }
    return Object.entries(expected).every(([key, value]) => matchValue(actual?.[key], value));
  }

  if (Array.isArray(actual)) {
    return actual.some((item) => String(item) === String(expected));
  }

  return String(actual) === String(expected);
};

const matchesQuery = (record, query = {}) =>
  Object.entries(query).every(([key, expected]) => {
    if (key === "$or") {
      return expected.some((condition) => matchesQuery(record, condition));
    }
    return matchValue(getComparableValue(record, key), expected);
  });

const createQuery = (resolver) => ({
  _sortSpec: {},
  _limit: null,
  _populate: null,
  sort(sortSpec) {
    this._sortSpec = sortSpec || {};
    return this;
  },
  limit(limitValue) {
    this._limit = limitValue;
    return this;
  },
  populate(populateValue) {
    this._populate = populateValue;
    return this;
  },
  async lean() {
    return deepClone(await resolver({
      sortSpec: this._sortSpec,
      limit: this._limit,
      populateValue: this._populate,
      lean: true,
    }));
  },
  then(resolve, reject) {
    return Promise.resolve(resolver({
      sortSpec: this._sortSpec,
      limit: this._limit,
      populateValue: this._populate,
      lean: false,
    })).then(resolve, reject);
  },
});

const createModelMocks = () => {
  const campaigns = [
    {
      _id: "campaign_1",
      name: "Manual Campaign",
      status: "Draft",
      audienceType: "manual",
      manualContactIds: ["507f1f77bcf86cd799439011", "+94770000002"],
      segmentIds: [],
      channel: "WhatsApp",
      contentMode: "compose",
      bodyText: "Hello from Blue Whale",
      scheduleType: "draft",
      batchEnabled: false,
      stopIfTemplateMissing: false,
      stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 },
      createdAt: "2026-04-03T08:00:00.000Z",
      updatedAt: "2026-04-03T08:00:00.000Z",
    },
    {
      _id: "campaign_2",
      name: "Scheduled Campaign",
      status: "Scheduled",
      audienceType: "manual",
      manualContactIds: ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"],
      segmentIds: [],
      channel: "WhatsApp",
      contentMode: "compose",
      bodyText: "Scheduled hello",
      scheduleType: "later",
      scheduledAt: "2026-04-01T08:30:00.000Z",
      batchEnabled: false,
      stopIfTemplateMissing: false,
      stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 },
      createdAt: "2026-04-03T08:10:00.000Z",
      updatedAt: "2026-04-03T08:10:00.000Z",
    },
    {
      _id: "campaign_3",
      name: "Expired Compose Campaign",
      status: "Draft",
      audienceType: "manual",
      manualContactIds: ["507f1f77bcf86cd799439013"],
      segmentIds: [],
      channel: "WhatsApp",
      contentMode: "compose",
      bodyText: "This should be blocked",
      scheduleType: "draft",
      batchEnabled: false,
      stopIfTemplateMissing: false,
      stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 },
      createdAt: "2026-04-03T08:20:00.000Z",
      updatedAt: "2026-04-03T08:20:00.000Z",
    },
    {
      _id: "campaign_4",
      name: "Filtered Campaign",
      status: "Draft",
      audienceType: "manual",
      manualContactIds: [
        "507f1f77bcf86cd799439011",
        "507f1f77bcf86cd799439013",
        "507f1f77bcf86cd799439014",
      ],
      segmentIds: [],
      channel: "WhatsApp",
      contentMode: "compose",
      bodyText: "Only eligible contacts should be queued",
      scheduleType: "draft",
      batchEnabled: false,
      skipInactiveContacts: true,
      stopIfTemplateMissing: false,
      stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 },
      createdAt: "2026-04-03T08:25:00.000Z",
      updatedAt: "2026-04-03T08:25:00.000Z",
    },
    {
      _id: "campaign_5",
      name: "Manual Phone Campaign",
      status: "Draft",
      audienceType: "manual",
      manualContactIds: [],
      manualPhones: ["+94770000099"],
      segmentIds: [],
      channel: "WhatsApp",
      contentMode: "template",
      templateId: "tpl_1",
      templateName: "Approved Template",
      bodyText: "",
      scheduleType: "draft",
      batchEnabled: false,
      skipInactiveContacts: false,
      stopIfTemplateMissing: false,
      stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 },
      createdAt: "2026-04-03T08:30:00.000Z",
      updatedAt: "2026-04-03T08:30:00.000Z",
    },
  ];

  const contacts = [
    {
      _id: "507f1f77bcf86cd799439011",
      phone: "+94770000001",
      waId: "+94770000001",
      name: "Alice",
      lastActivityAt: "2026-04-02T10:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439012",
      phone: "+94770000002",
      waId: "+94770000002",
      name: "Bob",
      lastActivityAt: "2026-04-02T11:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439013",
      phone: "+94770000003",
      waId: "+94770000003",
      name: "Charlie",
      lastActivityAt: "2026-04-01T11:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439014",
      phone: "+94770000004",
      waId: "+94770000004",
      name: "Dana",
      profile: { whatsappOptIn: false },
      lastActivityAt: "2026-04-02T12:00:00.000Z",
    },
  ];

  const conversations = [
    {
      _id: "conversation_1",
      contactId: "507f1f77bcf86cd799439011",
      agentId: null,
      channel: "whatsapp",
      lastIncomingAt: new Date().toISOString(),
      automationState: { lastCustomerMessageAt: new Date().toISOString() },
    },
    {
      _id: "conversation_2",
      contactId: "507f1f77bcf86cd799439012",
      agentId: null,
      channel: "whatsapp",
      lastIncomingAt: new Date().toISOString(),
      automationState: { lastCustomerMessageAt: new Date().toISOString() },
    },
    {
      _id: "conversation_3",
      contactId: "507f1f77bcf86cd799439013",
      agentId: null,
      channel: "whatsapp",
      lastIncomingAt: "2020-04-01T08:00:00.000Z",
      automationState: { lastCustomerMessageAt: "2020-04-01T08:00:00.000Z" },
    },
    {
      _id: "conversation_4",
      contactId: "507f1f77bcf86cd799439014",
      agentId: null,
      channel: "whatsapp",
      lastIncomingAt: new Date().toISOString(),
      automationState: { lastCustomerMessageAt: new Date().toISOString() },
    },
  ];
  const jobs = [];
  let messageCounter = 0;

  class FakeDocument {
    constructor(store, value) {
      this.__store = store;
      Object.assign(this, deepClone(value));
    }

    toPlainObject() {
      const { __store, ...rest } = this;
      return deepClone(rest);
    }

    toObject() {
      return this.toPlainObject();
    }

    async save() {
      this.updatedAt = "2026-04-03T12:00:00.000Z";
      const index = this.__store.findIndex((item) => String(item._id) === String(this._id));
      if (index >= 0) {
        this.__store[index] = this.toPlainObject();
      } else {
        this.__store.push(this.toPlainObject());
      }
      return this;
    }
  }

  const CampaignModel = {
    async findById(id) {
      const campaign = campaigns.find((item) => String(item._id) === String(id));
      return campaign ? new FakeDocument(campaigns, campaign) : null;
    },
    find(query = {}) {
      return createQuery(({ sortSpec, limit, lean }) => {
        const items = sortItems(campaigns.filter((item) => matchesQuery(item, query)), sortSpec).slice(0, limit || undefined);
        if (lean) {
          return items;
        }
        return items.map((item) => new FakeDocument(campaigns, item));
      });
    },
  };

  const ContactModel = {
    async findById(id) {
      const contact = contacts.find((item) => String(item._id) === String(id));
      return contact ? deepClone(contact) : null;
    },
    find(query = {}) {
      return createQuery(({ sortSpec, limit }) => sortItems(
        contacts.filter((item) => matchesQuery(item, query)),
        sortSpec
      ).slice(0, limit || undefined));
    },
    async findOneAndUpdate(query = {}, update = {}, options = {}) {
      const existing = contacts.find((item) => matchesQuery(item, query));
      if (existing) {
        if (update.$set) {
          Object.assign(existing, deepClone(update.$set));
        }
        return deepClone(existing);
      }

      if (!options.upsert) {
        return null;
      }

      const created = {
        _id: `507f1f77bcf86cd7994390${String(contacts.length + 11).padStart(2, "0")}`,
        ...(update.$setOnInsert ? deepClone(update.$setOnInsert) : {}),
        ...(update.$set ? deepClone(update.$set) : {}),
      };
      contacts.push(created);
      return deepClone(created);
    },
  };

  const ConversationModel = {
    async findById(id) {
      const conversation = conversations.find((item) => String(item._id) === String(id));
      return conversation ? deepClone(conversation) : null;
    },
    find(query = {}) {
      return createQuery(({ populateValue }) => {
        const matched = conversations.filter((item) => matchesQuery(item, query)).map((item) => deepClone(item));
        if (populateValue === "contactId") {
          return matched.map((item) => ({
            ...item,
            contactId: contacts.find((contact) => String(contact._id) === String(item.contactId)) || null,
          }));
        }
        return matched;
      });
    },
  };

  const JobModel = {
    async findById(id) {
      const job = jobs.find((item) => String(item._id) === String(id));
      return job ? new FakeDocument(jobs, job) : null;
    },
    find(query = {}) {
      return createQuery(({ sortSpec, limit, lean }) => {
        const matched = sortItems(jobs.filter((item) => matchesQuery(item, query)), sortSpec).slice(0, limit || undefined);
        if (lean) {
          return matched;
        }
        return matched.map((item) => new FakeDocument(jobs, item));
      });
    },
    async findOne(query = {}) {
      const job = jobs.find((item) => matchesQuery(item, query));
      return job ? new FakeDocument(jobs, job) : null;
    },
    async create(payload) {
      const record = {
        _id: payload._id || `job_${jobs.length + 1}`,
        attemptCount: 0,
        createdAt: "2026-04-03T12:00:00.000Z",
        updatedAt: "2026-04-03T12:00:00.000Z",
        ...deepClone(payload),
      };
      jobs.push(record);
      return new FakeDocument(jobs, record);
    },
    async updateMany(query = {}, update = {}) {
      let modifiedCount = 0;
      for (const item of jobs) {
        if (!matchesQuery(item, query)) {
          continue;
        }
        if (update.$set) {
          Object.assign(item, deepClone(update.$set));
        }
        modifiedCount += 1;
      }
      return { modifiedCount };
    },
    async deleteMany(query = {}) {
      let deletedCount = 0;
      for (let index = jobs.length - 1; index >= 0; index -= 1) {
        if (!matchesQuery(jobs[index], query)) {
          continue;
        }
        jobs.splice(index, 1);
        deletedCount += 1;
      }
      return { deletedCount };
    },
  };

  const crmService = {
    ensureConversation: async ({ contactId }) => {
      const existing = conversations.find((item) => String(item.contactId) === String(contactId));
      if (existing) {
        return deepClone(existing);
      }
      const created = {
        _id: `conversation_${conversations.length + 1}`,
        contactId,
        agentId: null,
      };
      conversations.push(created);
      return deepClone(created);
    },
    saveOutgoingMessage: async ({ contact, additionalMetadata, response }) => {
      messageCounter += 1;
      return {
        _id: `message_${messageCounter}`,
        externalMessageId: response?.messages?.[0]?.id || `wamid.mock.${messageCounter}`,
        metadata: additionalMetadata || {},
        contactId: contact._id,
      };
    },
  };

  return {
    CampaignModel,
    ContactModel,
    ConversationModel,
    JobModel,
    crmService,
    stores: {
      campaigns,
      contacts,
      conversations,
      jobs,
    },
  };
};

module.exports = async () => {
  const {
    CampaignModel,
    ContactModel,
    ConversationModel,
    JobModel,
    crmService,
    stores,
  } = createModelMocks();

  let sendCounter = 0;

  const runtimeService = loadWithMocks(path.resolve(__dirname, "../services/whatsappCampaignRuntimeService.js"), {
    "../models/WhatsAppCampaign": CampaignModel,
    "../models/WhatsAppCampaignJob": JobModel,
    "../models/WhatsAppContact": ContactModel,
    "../models/WhatsAppConversation": ConversationModel,
    "./whatsappCRMService": crmService,
    "./whatsappTemplateService": {
      getTemplateById: async () => ({ id: "tpl_1" }),
      prepareTemplateMessage: async ({ template }) => template,
    },
    "./whatsappService": {
      normalizePhone: (value) => String(value || "").replace(/[^\d+]/g, "").replace(/^00/, "+"),
      sendMessage: async (payload) => {
        sendCounter += 1;
        return {
          payload,
          response: {
            messages: [{ id: `wamid.runtime.${sendCounter}` }],
          },
        };
      },
    },
    "./whatsappCampaignService": {
      __private: {
        buildComposeCampaignText: (campaign) => String(campaign.bodyText || "").trim(),
        buildTemplateSendComponents: () => [],
        inferAudienceOptIn: (contact) => contact?.profile?.whatsappOptIn !== false,
      },
    },
  });

  const launched = await runtimeService.launchCampaign({ campaignId: "campaign_1", actorId: "admin_1" });
  assert.equal(launched.campaignId, "campaign_1");
  assert.equal(launched.audienceSize, 2);
  assert.equal(stores.jobs.length, 2);
  assert.ok(stores.jobs.every((job) => job.status === "pending"));

  const processed = await runtimeService.processPendingCampaignJobs(null);
  assert.equal(processed.processed, 2);
  assert.equal(processed.sent, 2);
  assert.equal(sendCounter, 2);
  assert.ok(stores.jobs.every((job) => job.status === "sent"));

  const campaignAfterSend = stores.campaigns.find((item) => item._id === "campaign_1");
  assert.equal(campaignAfterSend.status, "Sent");
  assert.deepEqual(campaignAfterSend.stats, {
    sent: 2,
    delivered: 0,
    read: 0,
    clicked: 0,
    failed: 0,
  });

  await runtimeService.trackCampaignMessageStatus({
    message: {
      _id: "message_1",
      externalMessageId: "wamid.runtime.1",
      status: "delivered",
      errorMessage: "",
      metadata: {
        campaign: {
          campaignId: "campaign_1",
          campaignJobId: "job_1",
        },
        lastStatusWebhookAt: "2026-04-03T12:10:00.000Z",
      },
    },
  });

  await runtimeService.trackCampaignMessageStatus({
    message: {
      _id: "message_2",
      externalMessageId: "wamid.runtime.2",
      status: "read",
      errorMessage: "",
      metadata: {
        campaign: {
          campaignId: "campaign_1",
          campaignJobId: "job_2",
        },
        lastStatusWebhookAt: "2026-04-03T12:11:00.000Z",
      },
    },
  });

  const campaignAfterStatus = stores.campaigns.find((item) => item._id === "campaign_1");
  assert.equal(campaignAfterStatus.stats.delivered, 2);
  assert.equal(campaignAfterStatus.stats.read, 1);

  const scheduledLaunchCount = await runtimeService.processDueScheduledCampaigns();
  assert.equal(scheduledLaunchCount, 1);
  const scheduledCampaign = stores.campaigns.find((item) => item._id === "campaign_2");
  assert.equal(scheduledCampaign.status, "Running");
  assert.equal(scheduledCampaign.audienceSize, 2);
  assert.equal(stores.jobs.filter((job) => job.campaignId === "campaign_2").length, 2);
  const scheduledProcessed = await runtimeService.processPendingCampaignJobs(null);
  assert.equal(scheduledProcessed.processed, 2);
  assert.equal(scheduledProcessed.sent, 2);
  assert.equal(scheduledProcessed.failed, 0);

  const expiredLaunch = await runtimeService.launchCampaign({ campaignId: "campaign_3", actorId: "admin_2" });
  assert.equal(expiredLaunch.campaignId, "campaign_3");
  assert.equal(expiredLaunch.audienceSize, 1);

  const expiredProcessed = await runtimeService.processPendingCampaignJobs(null);
  assert.equal(expiredProcessed.processed, 1);
  assert.equal(expiredProcessed.sent, 0);
  assert.equal(expiredProcessed.failed, 1);

  const expiredJob = stores.jobs.find((job) => job.campaignId === "campaign_3");
  assert.equal(expiredJob.status, "failed");
  assert.match(expiredJob.errorMessage, /24-hour customer care window/);

  const expiredCampaign = stores.campaigns.find((item) => item._id === "campaign_3");
  assert.equal(expiredCampaign.status, "Failed");
  assert.equal(expiredCampaign.stats.failed, 1);

  const filteredLaunch = await runtimeService.launchCampaign({ campaignId: "campaign_4", actorId: "admin_3" });
  assert.equal(filteredLaunch.campaignId, "campaign_4");
  assert.equal(filteredLaunch.audienceSize, 1);

  const filteredJobs = stores.jobs.filter((job) => job.campaignId === "campaign_4");
  assert.equal(filteredJobs.length, 1);
  assert.equal(filteredJobs[0].contactId, "507f1f77bcf86cd799439011");

  const manualPhoneLaunch = await runtimeService.launchCampaign({ campaignId: "campaign_5", actorId: "admin_4" });
  assert.equal(manualPhoneLaunch.campaignId, "campaign_5");
  assert.equal(manualPhoneLaunch.audienceSize, 1);

  const manualPhoneJob = stores.jobs.find((job) => job.campaignId === "campaign_5");
  assert.ok(manualPhoneJob);
  assert.equal(manualPhoneJob.recipientPhone, "+94770000099");
  const createdManualPhoneContact = stores.contacts.find((contact) => contact.phone === "+94770000099");
  assert.ok(createdManualPhoneContact);
};

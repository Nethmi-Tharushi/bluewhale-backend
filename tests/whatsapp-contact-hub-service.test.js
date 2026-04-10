const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const sortWithSpec = (items, sortSpec = {}) => {
  const entries = Object.entries(sortSpec || {});
  if (!entries.length) return [...items];

  return [...items].sort((left, right) => {
    for (const [field, rawDirection] of entries) {
      const direction = Number(rawDirection) < 0 ? -1 : 1;
      const leftValue = left[field];
      const rightValue = right[field];

      if (leftValue === rightValue) continue;
      if (leftValue === undefined || leftValue === null) return 1 * direction;
      if (rightValue === undefined || rightValue === null) return -1 * direction;
      if (leftValue > rightValue) return 1 * direction;
      if (leftValue < rightValue) return -1 * direction;
    }

    return 0;
  });
};

const matchesFilter = (record, filter = {}) => {
  if (!filter || Object.keys(filter).length === 0) return true;

  if (Array.isArray(filter.$or) && filter.$or.length > 0) {
    const orMatches = filter.$or.some((condition) => matchesFilter(record, condition));
    if (!orMatches) return false;
  }

  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") return true;

    const actual = record[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if (Object.prototype.hasOwnProperty.call(expected, "$ne")) {
        return String(actual || "") !== String(expected.$ne || "");
      }

      if (Object.prototype.hasOwnProperty.call(expected, "$in")) {
        return expected.$in.some((item) => String(item || "") === String(actual || ""));
      }
    }

    return String(actual || "") === String(expected || "");
  });
};

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
    return deepClone(resolver(this._sortSpec || {}));
  },
});

const createAdminModelMock = (owners = []) => ({
  findById(id) {
    return {
      async select() {
        return deepClone(owners.find((owner) => String(owner._id) === String(id)) || null);
      },
    };
  },
  find(filter = {}) {
    return createQuery((sortSpec) => sortWithSpec(owners.filter((owner) => matchesFilter(owner, filter)), sortSpec));
  },
});

const createReadOnlyModelMock = (records = []) => ({
  find(filter = {}) {
    return createQuery((sortSpec) => sortWithSpec(records.filter((record) => matchesFilter(record, filter)), sortSpec));
  },
});

const createContactModelMock = (records = []) => {
  const store = records.map((record, index) => ({
    email: "",
    tags: [],
    status: "",
    accountOwner: "",
    accountOwnerId: null,
    source: "WhatsApp",
    b2cConfirmation: "Confirmed",
    optedIn: true,
    city: "",
    notes: "",
    lastSeenAt: null,
    totalMessages: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: `2026-04-0${index + 1}T10:00:00.000Z`,
    updatedAt: `2026-04-0${index + 1}T10:00:00.000Z`,
    ...deepClone(record),
  }));
  let counter = store.length;

  class FakeContactDocument {
    constructor(value) {
      Object.assign(this, deepClone(value));
    }

    toObject() {
      return deepClone(this);
    }

    async save() {
      this.updatedAt = "2026-04-08T10:00:00.000Z";
      const index = store.findIndex((item) => String(item._id) === String(this._id));
      if (index >= 0) {
        store[index] = deepClone(this);
      } else {
        store.push(deepClone(this));
      }
      return this;
    }
  }

  return {
    __store: store,
    find(filter = {}) {
      return createQuery((sortSpec) => sortWithSpec(store.filter((record) => matchesFilter(record, filter)), sortSpec));
    },
    async findOne(filter = {}) {
      const record = store.find((item) => matchesFilter(item, filter));
      return record ? new FakeContactDocument(record) : null;
    },
    async findById(id) {
      const record = store.find((item) => String(item._id) === String(id));
      return record ? new FakeContactDocument(record) : null;
    },
    async create(payload = {}) {
      const document = new FakeContactDocument({
        _id: payload._id || `507f1f77bcf86cd7994390${String(++counter).padStart(2, "0")}`,
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:00:00.000Z",
        ...deepClone(payload),
      });
      store.push(deepClone(document));
      return document;
    },
  };
};

const loadService = ({ contacts, conversations, messages, owners }) =>
  loadWithMocks(path.resolve(__dirname, "../services/whatsappContactHubService.js"), {
    mongoose: { Types: { ObjectId: { isValid: (value) => typeof value === "string" && value.length === 24 } } },
    "../models/AdminUser": createAdminModelMock(owners),
    "../models/WhatsAppContact": createContactModelMock(contacts),
    "../models/WhatsAppConversation": createReadOnlyModelMock(conversations),
    "../models/WhatsAppMessage": createReadOnlyModelMock(messages),
    "./whatsappWebhookService": {
      normalizePhone: (value) => String(value || "").replace(/[^\d]/g, ""),
    },
  });

module.exports = async () => {
  const owners = [
    {
      _id: "507f1f77bcf86cd799439021",
      name: "Sam Sales",
      email: "sam@bluewhale.test",
      role: "SalesAdmin",
    },
    {
      _id: "507f1f77bcf86cd799439022",
      name: "Nora Staff",
      email: "nora@bluewhale.test",
      role: "SalesStaff",
    },
  ];

  const contacts = [
    {
      _id: "507f1f77bcf86cd799439011",
      name: "",
      phone: "94770000001",
      normalizedPhone: "94770000001",
      source: "Nothing selected",
      profile: {
        name: "Alice",
        email: "alice@lead.test",
        whatsappOptIn: false,
      },
      createdAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-01T10:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439012",
      name: "Bob",
      phone: "94770000002",
      normalizedPhone: "94770000002",
      source: "Manual import",
      status: "Qualified",
      optedIn: true,
      accountOwner: "Nora Staff",
      accountOwnerId: "507f1f77bcf86cd799439022",
      createdAt: "2026-04-02T10:00:00.000Z",
      updatedAt: "2026-04-02T10:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439013",
      name: "Cara",
      phone: "94770000003",
      normalizedPhone: "94770000003",
      source: "WhatsApp",
      status: "New Lead",
      optedIn: true,
      createdAt: "2026-04-03T10:00:00.000Z",
      updatedAt: "2026-04-03T10:00:00.000Z",
    },
  ];

  const conversations = [
    {
      _id: "507f1f77bcf86cd799439101",
      channel: "whatsapp",
      contactId: "507f1f77bcf86cd799439011",
      tags: ["VIP", " follow up "],
      linkedLeadId: {
        _id: "507f1f77bcf86cd799439201",
        name: "Lead Alice",
        email: "lead-alice@crm.test",
        phone: "94770000001",
        source: "Facebook Ads",
        status: "Follow-up Required",
        city: "Colombo",
      },
      agentId: {
        _id: "507f1f77bcf86cd799439021",
        name: "Sam Sales",
        email: "sam@bluewhale.test",
        role: "SalesAdmin",
      },
      notes: [{ text: "Needs brochure" }],
      lastIncomingAt: "2026-04-05T09:00:00.000Z",
      lastMessageAt: "2026-04-06T11:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439102",
      channel: "whatsapp",
      contactId: "507f1f77bcf86cd799439012",
      tags: ["Student"],
      linkedLeadId: null,
      agentId: null,
      lastMessageAt: "2026-04-04T08:00:00.000Z",
    },
  ];

  const messages = [
    {
      _id: "507f1f77bcf86cd799439301",
      contactId: "507f1f77bcf86cd799439011",
      timestamp: "2026-04-05T09:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439302",
      contactId: "507f1f77bcf86cd799439011",
      timestamp: "2026-04-06T11:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439303",
      contactId: "507f1f77bcf86cd799439012",
      timestamp: "2026-04-04T08:00:00.000Z",
    },
  ];

  const service = loadService({ contacts, conversations, messages, owners });

  const filtered = await service.listWhatsAppContactHub({
    search: "bob",
    status: "Qualified",
    optedIn: "true",
    sortBy: "name:asc",
    page: 1,
    limit: 10,
  });

  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].id, "507f1f77bcf86cd799439012");
  assert.equal(filtered.items[0].name, "Bob");
  assert.equal(filtered.items[0].source, "Manual import");
  assert.deepEqual(filtered.items[0].tags, ["Student"]);
  assert.equal(filtered.items[0].status, "Qualified");
  assert.equal(filtered.items[0].accountOwner, "Nora Staff");
  assert.equal(filtered.items[0].city, "");
  assert.equal(filtered.items[0].notes, "");
  assert.equal(filtered.items[0].totalMessages, 1);
  assert.equal(filtered.items[0].lastSeenAt, "2026-04-04T08:00:00.000Z");
  assert.equal(filtered.summary.totalContacts, 1);
  assert.equal(filtered.summary.optedInContacts, 1);
  assert.equal(filtered.pagination.total, 1);

  const upserted = await service.createWhatsAppContactHubRecord(
    {
      name: "Alice Updated",
      phone: "+94 770 000 001",
      tags: "VIP, vip, Warm",
      city: "Colombo",
      notes: "Warm lead",
      optedIn: false,
      accountOwnerId: "507f1f77bcf86cd799439022",
    },
    "507f1f77bcf86cd799439021"
  );

  assert.equal(upserted.created, false);
  assert.equal(upserted.item.name, "Alice Updated");
  assert.deepEqual(upserted.item.tags, ["VIP", "Warm", "follow up"]);
  assert.equal(upserted.item.b2cConfirmation, "Opted Out");
  assert.equal(upserted.item.accountOwner, "Nora Staff");
  assert.equal(upserted.item.email, "alice@lead.test");
  assert.equal(upserted.item.source, "Facebook Ads");

  const created = await service.createWhatsAppContactHubRecord(
    {
      name: "Dina",
      phone: "+94 770 000 004",
      email: "dina@crm.test",
      tags: ["New", "Priority", "new"],
      status: "Qualified",
      source: "WhatsApp",
      accountOwnerId: "507f1f77bcf86cd799439021",
      city: "Kandy",
      notes: "Requested price list",
    },
    "507f1f77bcf86cd799439021"
  );

  assert.equal(created.created, true);
  assert.equal(created.item.phone, "94770000004");
  assert.deepEqual(created.item.tags, ["New", "Priority"]);
  assert.equal(created.item.status, "Qualified");
  assert.equal(created.item.accountOwner, "Sam Sales");

  const updated = await service.updateWhatsAppContactHubRecord(
    "507f1f77bcf86cd799439012",
    {
      phone: "+94 770 000 020",
      notes: "Qualified and ready",
      lastSeenAt: "2026-04-08T07:30:00.000Z",
    },
    "507f1f77bcf86cd799439021"
  );

  assert.equal(updated.phone, "94770000020");
  assert.equal(updated.notes, "Qualified and ready");
  assert.equal(updated.lastSeenAt, "2026-04-08T07:30:00.000Z");

  const statusUpdated = await service.updateWhatsAppContactHubStatus(
    "507f1f77bcf86cd799439013",
    "Inactive",
    "507f1f77bcf86cd799439021"
  );
  assert.equal(statusUpdated.status, "Inactive");

  const bulkStatus = await service.bulkUpdateWhatsAppContactHub({
    ids: [
      "507f1f77bcf86cd799439012",
      "507f1f77bcf86cd799439013",
    ],
    action: "update_status",
    payload: { status: "Customer" },
    actorId: "507f1f77bcf86cd799439021",
  });
  assert.equal(bulkStatus.count, 2);
  assert.ok(bulkStatus.items.every((item) => item.status === "Customer"));

  const bulkToggle = await service.bulkUpdateWhatsAppContactHub({
    ids: [
      "507f1f77bcf86cd799439012",
      "507f1f77bcf86cd799439013",
    ],
    action: "toggle_opt_in",
    payload: {},
    actorId: "507f1f77bcf86cd799439021",
  });
  assert.equal(bulkToggle.count, 2);
  assert.equal(bulkToggle.items[0].optedIn, false);
  assert.equal(bulkToggle.items[0].b2cConfirmation, "Opted Out");

  const csv = await service.exportWhatsAppContactHubCsv({ search: "alice" });
  assert.match(csv, /id,name,phone,email,tags,createdAt,status/);
  assert.match(csv, /Alice Updated/);
  assert.match(csv, /Facebook Ads/);

  const meta = await service.getWhatsAppContactHubMeta();
  assert.deepEqual(meta.statuses, ["New Lead", "Qualified", "Follow-up", "Customer", "Inactive"]);
  assert.ok(meta.sources.includes("Facebook Ads"));
  assert.ok(meta.owners.some((owner) => owner.name === "Sam Sales"));
};

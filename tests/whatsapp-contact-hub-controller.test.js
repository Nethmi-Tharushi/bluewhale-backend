const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const createResponse = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
  send(payload) {
    this.body = payload;
    return this;
  },
  setHeader(name, value) {
    this.headers[name] = value;
    return this;
  },
});

const loadController = (serviceOverrides = {}) =>
  loadWithMocks(path.resolve(__dirname, "../controllers/whatsappContactHubController.js"), {
    "../services/whatsappContactHubService": {
      listWhatsAppContactHub: async () => ({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        summary: { totalContacts: 0, optedInContacts: 0, newLeadCount: 0, qualifiedCount: 0 },
      }),
      getWhatsAppContactHubProfile: async () => ({
        contact: { id: "507f1f77bcf86cd799439011", name: "Alice", phone: "94770000001" },
        conversation: { id: "507f1f77bcf86cd799439101" },
        messages: [],
        latestTask: null,
        latestMeeting: null,
        summary: { touchpoints: 0, messageCount: 0, noteCount: 0, taskCount: 0, meetingCount: 0 },
      }),
      createWhatsAppContactHubRecord: async () => ({
        created: true,
        item: { id: "507f1f77bcf86cd799439011", name: "Alice", phone: "94770000001" },
      }),
      updateWhatsAppContactHubRecord: async () => ({
        id: "507f1f77bcf86cd799439011",
        name: "Alice",
        phone: "94770000001",
      }),
      updateWhatsAppContactHubStatus: async () => ({
        id: "507f1f77bcf86cd799439011",
        status: "Qualified",
      }),
      bulkUpdateWhatsAppContactHub: async () => ({
        count: 2,
        action: "update_status",
        items: [],
      }),
      exportWhatsAppContactHubCsv: async () => "id,name\n507f1f77bcf86cd799439011,Alice",
      getWhatsAppContactHubMeta: async () => ({
        statuses: ["New Lead", "Qualified"],
        sources: ["WhatsApp"],
        owners: [],
      }),
      ...serviceOverrides,
    },
  });

module.exports = async () => {
  const controller = loadController();

  const createRes = createResponse();
  await controller.createContactHubRecord(
    {
      body: { name: "Alice", phone: "+94770000001" },
      admin: { _id: "507f1f77bcf86cd799439021", role: "SalesAdmin" },
    },
    createRes
  );
  assert.equal(createRes.statusCode, 201);
  assert.equal(createRes.body.success, true);
  assert.equal(createRes.body.data.name, "Alice");

  const exportRes = createResponse();
  await controller.exportContactHubCsv({ query: { status: "Qualified" } }, exportRes);
  assert.equal(exportRes.statusCode, 200);
  assert.equal(exportRes.headers["Content-Type"], "text/csv; charset=utf-8");
  assert.match(exportRes.headers["Content-Disposition"], /whatsapp-contact-hub\.csv/);
  assert.match(exportRes.body, /Alice/);

  const profileRes = createResponse();
  await controller.getContactHubProfile({ params: { id: "507f1f77bcf86cd799439011" } }, profileRes);
  assert.equal(profileRes.statusCode, 200);
  assert.equal(profileRes.body.success, true);
  assert.equal(profileRes.body.data.contact.name, "Alice");

  const errorController = loadController({
    listWhatsAppContactHub: async () => {
      const error = new Error("sortBy must be one of: createdAt:desc, lastSeenAt:desc, name:asc, status:asc");
      error.status = 400;
      error.code = "INVALID_SORT";
      throw error;
    },
  });

  const errorRes = createResponse();
  await errorController.listContactHub({ query: { sortBy: "bad" } }, errorRes);
  assert.equal(errorRes.statusCode, 400);
  assert.equal(errorRes.body.success, false);
  assert.equal(errorRes.body.code, "INVALID_SORT");

  const notFoundController = loadController({
    getWhatsAppContactHubProfile: async () => {
      const error = new Error("WhatsApp customer not found for the provided contact id or phone");
      error.status = 404;
      error.code = "CONTACT_HUB_NOT_FOUND";
      throw error;
    },
  });

  const notFoundRes = createResponse();
  await notFoundController.getContactHubProfile({ params: { id: "unknown" } }, notFoundRes);
  assert.equal(notFoundRes.statusCode, 404);
  assert.equal(notFoundRes.body.success, false);
  assert.equal(notFoundRes.body.code, "CONTACT_HUB_NOT_FOUND");
};

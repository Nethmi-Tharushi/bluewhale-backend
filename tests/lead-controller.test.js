const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const createQuery = (result) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  sort() {
    return this;
  },
  lean: async () => result,
});

module.exports = async () => {
  const leadDoc = {
    _id: "507f1f77bcf86cd799439021",
    status: "Leads",
    leadValue: 0,
    saveCalled: false,
    async save() {
      this.saveCalled = true;
      return this;
    },
  };

  const controller = loadWithMocks(path.resolve(__dirname, "../controllers/leadController.js"), {
    "express-async-handler": (fn) => fn,
    "../models/AdminUser": {
      find: () =>
        createQuery([
          {
            _id: "507f1f77bcf86cd799439031",
            name: "Sales One",
            role: "SalesStaff",
            whatsappInbox: { allowAutoAssignment: false },
          },
        ]),
    },
    "../models/Campaign": {
      find: () =>
        createQuery([
          {
            _id: "507f1f77bcf86cd799439032",
            campaignName: "Spring Campaign",
            campaignCode: "CMP-1",
          },
        ]),
    },
    "../models/Lead": {
      find: () =>
        createQuery([
          {
            _id: "507f1f77bcf86cd799439022",
            leadNumber: 2001,
            name: "Legacy Paid Client",
            email: "legacy@example.com",
            phone: "+971500000001",
            company: "Blue Whale",
            status: "Paid Clients",
            source: "",
            sourceDetails: "",
            assignedTo: {
              _id: "507f1f77bcf86cd799439031",
              name: "Sales One",
              email: "sales1@example.com",
              role: "SalesStaff",
            },
            leadValue: "1250",
            currency: "AED",
            tags: ["vip", "VIP", "uae"],
            description: "Existing lead",
            lastContactAt: new Date("2026-04-01T10:00:00.000Z"),
            createdAt: new Date("2026-03-30T10:00:00.000Z"),
          },
        ]),
      findOne: async () => leadDoc,
      findById: () =>
        createQuery({
          _id: "507f1f77bcf86cd799439021",
          leadNumber: 2002,
          name: "Pipeline Lead",
          status: "Paid Client",
          source: "Campaign",
          assignedTo: {
            _id: "507f1f77bcf86cd799439031",
            name: "Sales One",
          },
          leadValue: 500,
          currency: "AED",
          tags: [],
          description: "",
          lastContactAt: new Date("2026-04-16T10:00:00.000Z"),
          createdAt: new Date("2026-04-10T10:00:00.000Z"),
        }),
    },
  });

  const metaRes = createResponse();
  await controller.getLeadMeta(
    {
      admin: {
        _id: "507f1f77bcf86cd799439011",
        role: "SalesAdmin",
      },
    },
    metaRes
  );
  assert.equal(metaRes.statusCode, 200);
  assert.deepEqual(metaRes.body.data.statuses, [
    "Leads",
    "Prospects",
    "Follow-up Required",
    "Converted Leads",
    "Paid Client",
    "Not Interested",
  ]);
  assert.equal(metaRes.body.data.assignableAdmins[0].canAutoAssign, false);

  const listRes = createResponse();
  await controller.listLeads(
    {
      admin: {
        _id: "507f1f77bcf86cd799439011",
        role: "SalesAdmin",
      },
    },
    listRes
  );
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.data[0].status, "Paid Client");
  assert.equal(listRes.body.data[0].source, "Nothing selected");
  assert.equal(listRes.body.data[0].leadValue, 1250);
  assert.deepEqual(listRes.body.data[0].tags, ["vip", "uae"]);
  assert.equal(listRes.body.data[0].assignedTo.name, "Sales One");

  const statusRes = createResponse();
  await controller.updateLeadStatus(
    {
      params: { id: "507f1f77bcf86cd799439021" },
      body: { status: "Paid Clients" },
      admin: {
        _id: "507f1f77bcf86cd799439011",
        role: "SalesAdmin",
      },
    },
    statusRes
  );
  assert.equal(statusRes.statusCode, 200);
  assert.equal(leadDoc.saveCalled, true);
  assert.equal(leadDoc.status, "Paid Client");
  assert.equal(statusRes.body.data.status, "Paid Client");
};

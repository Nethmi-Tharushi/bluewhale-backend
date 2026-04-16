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
  populate() {
    return this;
  },
  sort() {
    return this;
  },
  lean: async () => result,
});

module.exports = async () => {
  const controller = loadWithMocks(path.resolve(__dirname, "../controllers/salesCrmReportController.js"), {
    "express-async-handler": (fn) => fn,
    "../models/Lead": {
      find: () =>
        createQuery([
          {
            _id: "507f1f77bcf86cd799439101",
            name: "Lead One",
            status: "Leads",
            source: "Website",
            assignedTo: { _id: "507f1f77bcf86cd799439201", name: "Agent Alpha" },
            leadValue: 1000,
            createdAt: new Date("2026-04-10T10:00:00.000Z"),
          },
          {
            _id: "507f1f77bcf86cd799439102",
            name: "Lead Two",
            status: "Converted Leads",
            source: "Campaign",
            assignedTo: { _id: "507f1f77bcf86cd799439202", name: "Agent Beta" },
            leadValue: 2500,
            createdAt: new Date("2026-04-11T10:00:00.000Z"),
          },
          {
            _id: "507f1f77bcf86cd799439103",
            name: "Lead Three",
            status: "Paid Clients",
            source: "Campaign",
            assignedTo: { _id: "507f1f77bcf86cd799439202", name: "Agent Beta" },
            leadValue: 3500,
            createdAt: new Date("2026-04-12T10:00:00.000Z"),
          },
        ]),
    },
  });

  const res = createResponse();
  await controller.getSalesCrmReports(
    {
      query: {
        timeframe: "all",
        dateField: "createdAt",
      },
      admin: {
        _id: "507f1f77bcf86cd799439011",
        role: "SalesAdmin",
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.overview.contacts, 3);
  assert.equal(res.body.data.overview.owners, 2);
  assert.equal(res.body.data.overview.wonConverted, 2);
  assert.equal(res.body.data.overview.pipelineValue, 7000);

  assert.equal(res.body.data.agentPerformance[0].owner, "Agent Beta");
  assert.equal(res.body.data.agentPerformance[0].contacts, 2);
  assert.equal(res.body.data.agentPerformance[0].won, 2);
  assert.equal(res.body.data.agentPerformance[0].conversionRate, 100);

  const funnel = Object.fromEntries(res.body.data.salesFunnel.map((item) => [item.stage, item]));
  assert.equal(funnel["Leads"].contacts, 1);
  assert.equal(funnel["Converted Leads"].contacts, 1);
  assert.equal(funnel["Paid Client"].contacts, 1);
};

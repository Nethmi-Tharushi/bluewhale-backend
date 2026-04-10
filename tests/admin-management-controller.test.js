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

const loadController = (serviceOverrides = {}) =>
  loadWithMocks(path.resolve(__dirname, "../controllers/adminManagementController.js"), {
    "../services/adminManagementService": {
      listAgentSettings: async () => ({
        items: [
          {
            id: "507f1f77bcf86cd799439014",
            name: "Ajo Philip",
            role: "SalesStaff",
            roleLabel: "Sales Agent",
            createdBy: "Sarah Sales",
            createdById: "507f1f77bcf86cd799439013",
            teamName: "B2B",
            teamId: "607f1f77bcf86cd799439011",
            teamMemberCount: 2,
            lastLogin: "2026-04-08T08:30:00.000Z",
            createdAt: "2026-04-03T10:00:00.000Z",
            isSalesCrmSeat: true,
          },
        ],
        summary: {
          totalAgents: 3,
          salesCrmAgents: 3,
          superAdmins: 0,
          totalTeams: 1,
        },
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
        },
      }),
      getAgentSettingsMeta: async () => ({
        roles: [{ value: "MainAdmin", label: "Super Admin" }],
      }),
      ...serviceOverrides,
    },
  });

module.exports = async () => {
  const controller = loadController();

  const listRes = createResponse();
  await controller.getAgentSettings(
    {
      query: { tab: "sales" },
      admin: { _id: "507f1f77bcf86cd799439013", role: "SalesAdmin" },
    },
    listRes
  );
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.success, true);
  assert.equal(listRes.body.data.items[0].teamName, "B2B");

  const metaRes = createResponse();
  await controller.getAgentSettingsMetadata({}, metaRes);
  assert.equal(metaRes.statusCode, 200);
  assert.equal(metaRes.body.success, true);
  assert.equal(metaRes.body.data.roles[0].label, "Super Admin");

  const errorController = loadController({
    listAgentSettings: async () => {
      const error = new Error("tab must be all or sales");
      error.status = 400;
      error.code = "INVALID_TAB";
      throw error;
    },
  });

  const errorRes = createResponse();
  await errorController.getAgentSettings({ query: { tab: "wrong" } }, errorRes);
  assert.equal(errorRes.statusCode, 400);
  assert.equal(errorRes.body.success, false);
  assert.equal(errorRes.body.code, "INVALID_TAB");
};

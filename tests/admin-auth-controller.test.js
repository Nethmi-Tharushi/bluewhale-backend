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

const loadController = (serviceOverrides = {}, adminModelOverrides = {}) =>
  loadWithMocks(path.resolve(__dirname, "../controllers/AdminAuthController.js"), {
    jsonwebtoken: {
      sign: () => "token-123",
    },
    bcryptjs: {
      compare: async () => true,
    },
    "../models/AdminUser": {
      findOne: async () => null,
      ...adminModelOverrides,
    },
    "../services/adminManagementService": {
      listAdminsForLegacyEndpoint: async () => [{ _id: "507f1f77bcf86cd799439014", name: "Ajo Philip" }],
      createAdminRecord: async () => ({ _id: "507f1f77bcf86cd799439014", name: "Ajo Philip", role: "SalesStaff" }),
      updateAdminRecord: async () => ({ _id: "507f1f77bcf86cd799439014", name: "Ajo Updated", role: "SalesStaff" }),
      deleteAdminRecord: async () => ({ success: true }),
      ...serviceOverrides,
    },
    "../services/whatsappWalletService": {
      getWalletSummary: async () => ({}),
      listWalletTransactions: async () => [],
      topUpWallet: async () => ({}),
      updateWalletConfig: async () => ({}),
    },
  });

module.exports = async () => {
  const controller = loadController();

  const registerRes = createResponse();
  await controller.registerAdmin(
    {
      body: {
        name: "Ajo Philip",
        email: "ajo@bluewhale.test",
        password: "secret123",
        role: "SalesStaff",
      },
      admin: { _id: "507f1f77bcf86cd799439013", role: "SalesAdmin" },
    },
    registerRes
  );
  assert.equal(registerRes.statusCode, 201);
  assert.equal(registerRes.body.message, "Admin registered successfully");
  assert.equal(registerRes.body.admin.name, "Ajo Philip");

  const listRes = createResponse();
  await controller.getAllAdmins(
    { admin: { _id: "507f1f77bcf86cd799439013", role: "SalesAdmin" } },
    listRes
  );
  assert.equal(listRes.statusCode, 200);
  assert.equal(Array.isArray(listRes.body), true);

  const updateRes = createResponse();
  await controller.updateAdmin(
    {
      params: { id: "507f1f77bcf86cd799439014" },
      body: { name: "Ajo Updated" },
      admin: { _id: "507f1f77bcf86cd799439013", role: "SalesAdmin" },
    },
    updateRes
  );
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.admin.name, "Ajo Updated");

  const deleteErrorController = loadController({
    deleteAdminRecord: async () => {
      const error = new Error("You cannot delete the account you are currently using");
      error.status = 400;
      error.code = "SELF_DELETE_BLOCKED";
      throw error;
    },
  });

  const deleteRes = createResponse();
  await deleteErrorController.deleteAdmin(
    {
      params: { id: "507f1f77bcf86cd799439013" },
      admin: { _id: "507f1f77bcf86cd799439013", role: "SalesAdmin" },
    },
    deleteRes
  );
  assert.equal(deleteRes.statusCode, 400);
  assert.equal(deleteRes.body.code, "SELF_DELETE_BLOCKED");

  const loginAdmin = {
    _id: "507f1f77bcf86cd799439013",
    name: "Sarah Sales",
    email: "sarah@bluewhale.test",
    role: "SalesAdmin",
    password: "hashed",
    auditLogs: [],
    saveCalled: false,
    async save() {
      this.saveCalled = true;
      return this;
    },
  };

  const loginController = loadController(
    {},
    {
      findOne: async ({ email, role }) =>
        email === "sarah@bluewhale.test" && role === "SalesAdmin" ? loginAdmin : null,
    }
  );

  const loginRes = createResponse();
  await loginController.loginAdmin(
    {
      body: { email: "sarah@bluewhale.test", password: "secret123", role: "SalesAdmin" },
      headers: {},
      ip: "::1",
    },
    loginRes
  );
  assert.equal(loginRes.statusCode, 200);
  assert.equal(loginRes.body.token, "token-123");
  assert.ok(loginAdmin.lastLogin instanceof Date);
  assert.equal(loginAdmin.saveCalled, true);
};

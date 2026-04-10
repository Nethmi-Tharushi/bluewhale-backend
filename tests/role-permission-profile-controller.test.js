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
  loadWithMocks(path.resolve(__dirname, "../controllers/rolePermissionProfileController.js"), {
    "../services/rolePermissionProfileService": {
      listRolePermissionProfiles: async () => ({
        profiles: [
          {
            profileKey: "MainAdmin",
            label: "Super Admin",
            permissions: { contactHubAccess: true },
            updatedBy: null,
            updatedAt: "2026-04-08T10:00:00.000Z",
          },
        ],
      }),
      getRolePermissionProfile: async () => ({
        profileKey: "SalesAdmin",
        label: "Sales Lead",
        permissions: { contactHubAccess: true },
        updatedBy: null,
        updatedAt: "2026-04-08T10:00:00.000Z",
      }),
      updateRolePermissionProfile: async () => ({
        profileKey: "SalesAdmin",
        label: "Sales Lead",
        permissions: { contactHubAccess: false },
        updatedBy: { id: "507f1f77bcf86cd799439011", name: "Admin User" },
        updatedAt: "2026-04-08T11:00:00.000Z",
      }),
      resetRolePermissionProfiles: async () => ({
        profiles: [
          {
            profileKey: "SalesAdmin",
            label: "Sales Lead",
            permissions: { contactHubAccess: true },
            updatedBy: { id: "507f1f77bcf86cd799439011", name: "Admin User" },
            updatedAt: "2026-04-08T11:10:00.000Z",
          },
        ],
      }),
      ...serviceOverrides,
    },
  });

module.exports = async () => {
  const controller = loadController();

  const listRes = createResponse();
  await controller.listRolePermissions(
    { admin: { _id: "507f1f77bcf86cd799439011", role: "MainAdmin" } },
    listRes
  );
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.success, true);
  assert.equal(listRes.body.data.profiles.length, 1);

  const singleRes = createResponse();
  await controller.getRolePermission(
    {
      params: { profileKey: "SalesAdmin" },
      admin: { _id: "507f1f77bcf86cd799439011", role: "MainAdmin" },
    },
    singleRes
  );
  assert.equal(singleRes.statusCode, 200);
  assert.equal(singleRes.body.data.profileKey, "SalesAdmin");

  const updateRes = createResponse();
  await controller.updateRolePermission(
    {
      params: { profileKey: "SalesAdmin" },
      body: { permissions: { contactHubAccess: false } },
      admin: { _id: "507f1f77bcf86cd799439011", role: "MainAdmin" },
    },
    updateRes
  );
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.data.permissions.contactHubAccess, false);

  const resetRes = createResponse();
  await controller.resetRolePermissions(
    {
      body: { profileKey: "SalesAdmin" },
      admin: { _id: "507f1f77bcf86cd799439011", role: "MainAdmin" },
    },
    resetRes
  );
  assert.equal(resetRes.statusCode, 200);
  assert.equal(resetRes.body.data.profiles[0].profileKey, "SalesAdmin");

  const errorController = loadController({
    updateRolePermissionProfile: async () => {
      const error = new Error("Unknown permission key: nope");
      error.status = 400;
      error.code = "UNKNOWN_PERMISSION_KEY";
      throw error;
    },
  });

  const errorRes = createResponse();
  await errorController.updateRolePermission(
    {
      params: { profileKey: "SalesAdmin" },
      body: { permissions: { nope: true } },
    },
    errorRes
  );
  assert.equal(errorRes.statusCode, 400);
  assert.equal(errorRes.body.success, false);
  assert.equal(errorRes.body.code, "UNKNOWN_PERMISSION_KEY");
};

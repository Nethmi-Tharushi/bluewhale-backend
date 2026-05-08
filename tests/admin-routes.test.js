const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const createRouterMock = () => {
  const routes = [];

  const pushRoute = (method, routePath, handlers) => {
    routes.push({ method, path: routePath, handlers });
  };

  return {
    routes,
    get(routePath, ...handlers) {
      pushRoute("get", routePath, handlers);
      return this;
    },
    post(routePath, ...handlers) {
      pushRoute("post", routePath, handlers);
      return this;
    },
    put(routePath, ...handlers) {
      pushRoute("put", routePath, handlers);
      return this;
    },
    patch(routePath, ...handlers) {
      pushRoute("patch", routePath, handlers);
      return this;
    },
    delete(routePath, ...handlers) {
      pushRoute("delete", routePath, handlers);
      return this;
    },
  };
};

module.exports = async () => {
  const router = createRouterMock();
  const protectAdmin = Symbol("protectAdmin");
  const authorizeAdmin = (...roles) => ({ type: "authorizeAdmin", roles });

  loadWithMocks(path.resolve(__dirname, "../routes/AdminRoutes.js"), {
    express: {
      Router: () => router,
    },
    "../controllers/AdminAuthController": new Proxy({}, { get: () => () => {} }),
    "../controllers/adminManagementController": new Proxy({}, { get: () => () => {} }),
    "../controllers/rolePermissionProfileController": new Proxy({}, { get: () => () => {} }),
    "../controllers/meetingController": new Proxy({}, { get: () => () => {} }),
    "../controllers/metaLeadAdsController": new Proxy({}, { get: () => () => {} }),
    "../middlewares/AdminAuth": {
      protectAdmin,
      authorizeAdmin,
    },
    "../middlewares/adminManagementValidation": new Proxy({}, { get: () => () => {} }),
    "../middlewares/rolePermissionProfileValidation": new Proxy({}, { get: () => () => {} }),
    "../middlewares/metaLeadAdsValidation": new Proxy({}, { get: () => () => {} }),
  });

  const findRoute = (method, routePath) =>
    router.routes.find((route) => route.method === method && route.path === routePath);

  const registerRoute = findRoute("post", "/register");
  assert.ok(registerRoute);
  assert.equal(registerRoute.handlers[0], protectAdmin);
  assert.deepEqual(registerRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const legacyListRoute = findRoute("get", "/");
  assert.ok(legacyListRoute);
  assert.equal(legacyListRoute.handlers[0], protectAdmin);
  assert.deepEqual(legacyListRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin", "SalesStaff"]);

  const agentSettingsRoute = findRoute("get", "/agent-settings");
  assert.ok(agentSettingsRoute);
  assert.deepEqual(agentSettingsRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin", "SalesStaff"]);

  const agentSettingsMetaRoute = findRoute("get", "/agent-settings/meta");
  assert.ok(agentSettingsMetaRoute);
  assert.deepEqual(agentSettingsMetaRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin", "SalesStaff"]);

  const rolePermissionsRoute = findRoute("get", "/role-permissions");
  assert.ok(rolePermissionsRoute);
  assert.deepEqual(rolePermissionsRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const rolePermissionItemRoute = findRoute("get", "/role-permissions/:profileKey");
  assert.ok(rolePermissionItemRoute);
  assert.deepEqual(rolePermissionItemRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const rolePermissionUpdateRoute = findRoute("put", "/role-permissions/:profileKey");
  assert.ok(rolePermissionUpdateRoute);
  assert.deepEqual(rolePermissionUpdateRoute.handlers[1].roles, ["MainAdmin"]);

  const rolePermissionResetRoute = findRoute("post", "/role-permissions/reset");
  assert.ok(rolePermissionResetRoute);
  assert.deepEqual(rolePermissionResetRoute.handlers[1].roles, ["MainAdmin"]);

  const updateRoute = findRoute("put", "/:id");
  assert.ok(updateRoute);
  assert.deepEqual(updateRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const deleteRoute = findRoute("delete", "/:id");
  assert.ok(deleteRoute);
  assert.deepEqual(deleteRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const leadAdsStatusRoute = findRoute("get", "/me/meta-lead-ads/status");
  assert.ok(leadAdsStatusRoute);
  assert.equal(leadAdsStatusRoute.handlers[0], protectAdmin);
  assert.deepEqual(leadAdsStatusRoute.handlers[1].roles, ["MainAdmin"]);

  const leadAdsExchangeRoute = findRoute("post", "/me/meta-lead-ads/exchange");
  assert.ok(leadAdsExchangeRoute);
  assert.deepEqual(leadAdsExchangeRoute.handlers[1].roles, ["MainAdmin"]);

  const leadAdsSyncRoute = findRoute("post", "/me/meta-lead-ads/sync");
  assert.ok(leadAdsSyncRoute);
  assert.deepEqual(leadAdsSyncRoute.handlers[1].roles, ["MainAdmin"]);

  const leadAdsLeadSyncRoute = findRoute("post", "/me/meta-lead-ads/leads/sync");
  assert.ok(leadAdsLeadSyncRoute);
  assert.deepEqual(leadAdsLeadSyncRoute.handlers[1].roles, ["MainAdmin"]);

  const leadAdsCampaignsRoute = findRoute("get", "/me/meta-lead-ads/campaigns");
  assert.ok(leadAdsCampaignsRoute);
  assert.deepEqual(leadAdsCampaignsRoute.handlers[1].roles, ["MainAdmin"]);

  const leadAdsLogsRoute = findRoute("get", "/me/meta-lead-ads/logs");
  assert.ok(leadAdsLogsRoute);
  assert.deepEqual(leadAdsLogsRoute.handlers[1].roles, ["MainAdmin"]);

  const leadAdsCampaignsSyncRoute = findRoute("post", "/me/meta-lead-ads/campaigns/sync");
  assert.ok(leadAdsCampaignsSyncRoute);
  assert.deepEqual(leadAdsCampaignsSyncRoute.handlers[1].roles, ["MainAdmin"]);

  const leadAdsRetryRoute = findRoute("post", "/me/meta-lead-ads/retry-failed-syncs");
  assert.ok(leadAdsRetryRoute);
  assert.deepEqual(leadAdsRetryRoute.handlers[1].roles, ["MainAdmin"]);

  const leadAdsDisconnectRoute = findRoute("post", "/me/meta-lead-ads/disconnect");
  assert.ok(leadAdsDisconnectRoute);
  assert.deepEqual(leadAdsDisconnectRoute.handlers[1].roles, ["MainAdmin"]);
};

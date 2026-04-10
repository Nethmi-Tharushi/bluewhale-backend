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

  loadWithMocks(path.resolve(__dirname, "../routes/whatsapp.js"), {
    express: {
      Router: () => router,
    },
    "../controllers/whatsappController": new Proxy({}, { get: () => () => {} }),
    "../controllers/whatsappContactHubController": new Proxy({}, { get: () => () => {} }),
    "../controllers/whatsappProfileController": new Proxy({}, { get: () => () => {} }),
    "../middlewares/AdminAuth": {
      protectAdmin,
      authorizeAdmin,
    },
    "../middlewares/whatsappUpload": {
      single: () => () => {},
    },
    "../middlewares/whatsappTemplateMediaUpload": {
      single: () => () => {},
    },
    "../middlewares/whatsappProfileLogoUpload": {
      uploadWhatsAppProfileLogo: () => {},
    },
    "../middlewares/whatsappContactHubValidation": new Proxy({}, { get: () => () => {} }),
    "../middlewares/whatsappProfileValidation": new Proxy({}, { get: () => () => {} }),
  });

  const findRoute = (method, routePath) =>
    router.routes.find((route) => route.method === method && route.path === routePath);

  const readRoute = findRoute("get", "/contact-hub");
  assert.ok(readRoute);
  assert.equal(readRoute.handlers[0], protectAdmin);
  assert.deepEqual(readRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin", "SalesStaff"]);

  const metaRoute = findRoute("get", "/contact-hub/meta");
  assert.ok(metaRoute);
  assert.deepEqual(metaRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin", "SalesStaff"]);

  const createRoute = findRoute("post", "/contact-hub");
  assert.ok(createRoute);
  assert.deepEqual(createRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const bulkRoute = findRoute("post", "/contact-hub/bulk");
  assert.ok(bulkRoute);
  assert.deepEqual(bulkRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const statusRoute = findRoute("patch", "/contact-hub/:id/status");
  assert.ok(statusRoute);
  assert.deepEqual(statusRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const exportRoute = findRoute("get", "/contact-hub/export");
  assert.ok(exportRoute);
  assert.deepEqual(exportRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const resetConversationRoute = findRoute("post", "/conversations/:conversationId/reset");
  assert.ok(resetConversationRoute);
  assert.equal(resetConversationRoute.handlers[0], protectAdmin);
};

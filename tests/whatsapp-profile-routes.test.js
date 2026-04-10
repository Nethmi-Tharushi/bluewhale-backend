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

  const readRoute = findRoute("get", "/profile");
  assert.ok(readRoute);
  assert.equal(readRoute.handlers[0], protectAdmin);
  assert.deepEqual(readRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const updateRoute = findRoute("put", "/profile");
  assert.ok(updateRoute);
  assert.deepEqual(updateRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const uploadRoute = findRoute("post", "/profile/logo");
  assert.ok(uploadRoute);
  assert.deepEqual(uploadRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const deleteRoute = findRoute("delete", "/profile/logo");
  assert.ok(deleteRoute);
  assert.deepEqual(deleteRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);
};

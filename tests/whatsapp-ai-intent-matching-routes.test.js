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
  };
};

module.exports = async () => {
  const router = createRouterMock();
  const protectAdmin = Symbol("protectAdmin");
  const authorizeAdmin = (...roles) => ({ type: "authorizeAdmin", roles });

  loadWithMocks(path.resolve(__dirname, "../routes/whatsappAiIntentMatching.js"), {
    express: {
      Router: () => router,
    },
    "../middlewares/AdminAuth": {
      protectAdmin,
      authorizeAdmin,
    },
    "../controllers/whatsappAiIntentMatchingController": new Proxy({}, { get: () => () => {} }),
  });

  const findRoute = (method, routePath) =>
    router.routes.find((route) => route.method === method && route.path === routePath);

  const getRoute = findRoute("get", "/");
  assert.ok(getRoute);
  assert.equal(getRoute.handlers[0], protectAdmin);
  assert.deepEqual(getRoute.handlers[1].roles, []);

  const putRoute = findRoute("put", "/");
  assert.ok(putRoute);
  assert.deepEqual(putRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const historyRoute = findRoute("get", "/history");
  assert.ok(historyRoute);
  assert.deepEqual(historyRoute.handlers[1].roles, []);

  const testRoute = findRoute("post", "/test");
  assert.ok(testRoute);
  assert.deepEqual(testRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);
};

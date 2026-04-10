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
  };
};

module.exports = async () => {
  const router = createRouterMock();
  const protectAdmin = Symbol("protectAdmin");
  const authorizeAdmin = (...roles) => ({ type: "authorizeAdmin", roles });

  loadWithMocks(path.resolve(__dirname, "../routes/whatsappAiAgent.js"), {
    express: {
      Router: () => router,
    },
    "../middlewares/AdminAuth": {
      protectAdmin,
      authorizeAdmin,
    },
    "../controllers/whatsappAiAgentController": new Proxy({}, { get: () => () => {} }),
  });

  const findRoute = (method, routePath) =>
    router.routes.find((route) => route.method === method && route.path === routePath);

  assert.equal(findRoute("get", "/").handlers[0], protectAdmin);
  assert.deepEqual(findRoute("get", "/").handlers[1].roles, []);
  assert.deepEqual(findRoute("put", "/").handlers[1].roles, ["MainAdmin", "SalesAdmin"]);
  assert.deepEqual(findRoute("post", "/interest").handlers[1].roles, ["MainAdmin", "SalesAdmin"]);
  assert.deepEqual(findRoute("get", "/interests").handlers[1].roles, []);
  assert.deepEqual(findRoute("patch", "/interests/:id/status").handlers[1].roles, ["MainAdmin", "SalesAdmin"]);
  assert.deepEqual(findRoute("patch", "/interests/:id").handlers[1].roles, ["MainAdmin", "SalesAdmin"]);
  assert.deepEqual(findRoute("post", "/test").handlers[1].roles, ["MainAdmin", "SalesAdmin"]);
  assert.deepEqual(findRoute("get", "/history").handlers[1].roles, []);
};

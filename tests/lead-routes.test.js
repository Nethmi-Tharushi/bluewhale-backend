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
    patch(routePath, ...handlers) {
      pushRoute("patch", routePath, handlers);
      return this;
    },
    put(routePath, ...handlers) {
      pushRoute("put", routePath, handlers);
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

  loadWithMocks(path.resolve(__dirname, "../routes/leads.js"), {
    express: {
      Router: () => router,
    },
    "../middlewares/AdminAuth": {
      protectAdmin,
      authorizeAdmin,
    },
    "../controllers/leadController": new Proxy({}, { get: () => () => {} }),
  });

  const findRoute = (method, routePath) =>
    router.routes.find((route) => route.method === method && route.path === routePath);

  const listRoute = findRoute("get", "/");
  assert.ok(listRoute);
  assert.equal(listRoute.handlers[0], protectAdmin);
  assert.deepEqual(listRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin", "SalesStaff"]);

  const detailRoute = findRoute("get", "/:id");
  assert.ok(detailRoute);
  assert.deepEqual(detailRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin", "SalesStaff"]);

  const assignRoute = findRoute("patch", "/:id/assign");
  assert.ok(assignRoute);
  assert.deepEqual(assignRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const bulkAssignRoute = findRoute("post", "/bulk-assign");
  assert.ok(bulkAssignRoute);
  assert.deepEqual(bulkAssignRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin"]);

  const updateRoute = findRoute("put", "/:id");
  assert.ok(updateRoute);
  assert.deepEqual(updateRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin", "SalesStaff"]);
};

const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const createRouterMock = () => {
  const routes = [];

  return {
    routes,
    get(routePath, ...handlers) {
      routes.push({ method: "get", path: routePath, handlers });
      return this;
    },
  };
};

module.exports = async () => {
  const router = createRouterMock();
  const protectAdmin = Symbol("protectAdmin");
  const authorizeAdmin = (...roles) => ({ type: "authorizeAdmin", roles });

  loadWithMocks(path.resolve(__dirname, "../routes/salesCrm.js"), {
    express: {
      Router: () => router,
    },
    "../middlewares/AdminAuth": {
      protectAdmin,
      authorizeAdmin,
    },
    "../controllers/salesCrmReportController": {
      getSalesCrmReports: () => {},
    },
  });

  const reportsRoute = router.routes.find((route) => route.method === "get" && route.path === "/reports");
  assert.ok(reportsRoute);
  assert.equal(reportsRoute.handlers[0], protectAdmin);
  assert.deepEqual(reportsRoute.handlers[1].roles, ["MainAdmin", "SalesAdmin", "SalesStaff"]);
};

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
  };
};

module.exports = async () => {
  const router = createRouterMock();

  loadWithMocks(path.resolve(__dirname, "../routes/metaLeadAds.js"), {
    express: {
      Router: () => router,
    },
    "../controllers/metaLeadAdsController": new Proxy({}, { get: () => () => {} }),
  });

  const webhookGetRoute = router.routes.find((route) => route.method === "get" && route.path === "/webhook");
  const webhookPostRoute = router.routes.find((route) => route.method === "post" && route.path === "/webhook");

  assert.ok(webhookGetRoute);
  assert.ok(webhookPostRoute);
  assert.equal(webhookGetRoute.handlers.length, 1);
  assert.equal(webhookPostRoute.handlers.length, 1);
};

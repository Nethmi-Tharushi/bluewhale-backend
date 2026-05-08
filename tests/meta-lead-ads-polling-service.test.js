const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

module.exports = async () => {
  const previousRunOnStartup = process.env.META_LEAD_ADS_POLL_RUN_ON_STARTUP;
  process.env.META_LEAD_ADS_POLL_RUN_ON_STARTUP = "false";
  let pollCalls = 0;
  let scheduledExpression = "";
  let scheduledCallback = null;
  let stopped = false;
  let destroyed = false;

  const service = loadWithMocks(path.resolve(__dirname, "../services/metaLeadAdsPollingService.js"), {
    "node-cron": {
      validate: () => true,
      schedule: (expression, callback) => {
        scheduledExpression = expression;
        scheduledCallback = callback;
        return {
          stop() {
            stopped = true;
          },
          destroy() {
            destroyed = true;
          },
        };
      },
    },
    "./metaLeadAdsService": {
      pollMetaLeadAdsLeads: async () => {
        pollCalls += 1;
        return { processed: 1 };
      },
    },
    "./metaLeadAdsConnectionService": {
      loadMetaLeadAdsConnection: async () => ({
        autoSyncEnabled: true,
        syncIntervalMinutes: 20,
        pollLookbackMinutes: 30,
      }),
    },
  });

  await service.runMetaLeadAdsPollingCycle();
  assert.equal(pollCalls, 1);
  assert.equal(await service.__private.getWorkerCronExpression(), "*/20 * * * *");
  assert.equal(await service.__private.getLookbackMinutes(), 30);

  const task = await service.startMetaLeadAdsPollingWorker();
  assert.ok(task);
  assert.equal(scheduledExpression, "*/20 * * * *");
  assert.equal(typeof scheduledCallback, "function");

  service.stopMetaLeadAdsPollingWorker();
  assert.equal(stopped, true);
  assert.equal(destroyed, true);

  if (previousRunOnStartup === undefined) {
    delete process.env.META_LEAD_ADS_POLL_RUN_ON_STARTUP;
  } else {
    process.env.META_LEAD_ADS_POLL_RUN_ON_STARTUP = previousRunOnStartup;
  }
};

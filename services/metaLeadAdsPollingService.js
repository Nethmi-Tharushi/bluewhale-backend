const cron = require("node-cron");

const { pollMetaLeadAdsLeads } = require("./metaLeadAdsService");
const { loadMetaLeadAdsConnection } = require("./metaLeadAdsConnectionService");

let workerTask = null;
let workerInFlight = false;
let workerSignature = "";

const isWorkerEnabled = () => {
  const value = String(process.env.META_LEAD_ADS_POLL_ENABLED || "true").trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(value);
};

const getWorkerCronExpression = async () => {
  const connection = await loadMetaLeadAdsConnection({ refresh: true }).catch(() => null);
  const syncIntervalMinutes = Number(connection?.syncIntervalMinutes || 0);
  if (connection?.autoSyncEnabled !== false && Number.isInteger(syncIntervalMinutes) && syncIntervalMinutes >= 5 && syncIntervalMinutes <= 59) {
    return `*/${syncIntervalMinutes} * * * *`;
  }

  const configured = String(process.env.META_LEAD_ADS_POLL_CRON || "").trim();
  if (configured && cron.validate(configured)) {
    return configured;
  }
  return "*/20 * * * *";
};

const getLookbackMinutes = async () => {
  const connection = await loadMetaLeadAdsConnection({ refresh: true }).catch(() => null);
  const configuredFromDb = Number(connection?.pollLookbackMinutes || 0);
  if (Number.isFinite(configuredFromDb) && configuredFromDb >= 5) {
    return configuredFromDb;
  }
  const value = Number(process.env.META_LEAD_ADS_POLL_LOOKBACK_MINUTES || 30);
  return Number.isFinite(value) && value > 0 ? value : 30;
};

const shouldRunOnStartup = () => {
  const value = String(process.env.META_LEAD_ADS_POLL_RUN_ON_STARTUP || "true").trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(value);
};

const runMetaLeadAdsPollingCycle = async () => {
  if (workerInFlight) return { skipped: true };
  workerInFlight = true;

  try {
    const connection = await loadMetaLeadAdsConnection({ refresh: true }).catch(() => null);
    if (connection?.autoSyncEnabled === false) {
      return { skipped: true, reason: "auto_sync_disabled" };
    }

    const result = await pollMetaLeadAdsLeads({
      lookbackMinutes: await getLookbackMinutes(),
    });
    return result;
  } catch (error) {
    if (String(error?.code || "") !== "META_LEAD_ADS_MISSING_ACCESS_TOKEN") {
      console.error("[MetaLeadAdsPollingWorker] Poll cycle failed:", error.message || error);
    }
    return { error: true };
  } finally {
    workerInFlight = false;
  }
};

const buildWorkerSignature = (cronExpression) => `${cronExpression}`;

const startMetaLeadAdsPollingWorker = async () => {
  if (!isWorkerEnabled()) return null;
  const cronExpression = await getWorkerCronExpression();
  const nextSignature = buildWorkerSignature(cronExpression);

  if (workerTask && workerSignature === nextSignature) return workerTask;
  if (workerTask) {
    stopMetaLeadAdsPollingWorker();
  }

  workerTask = cron.schedule(cronExpression, () => {
    runMetaLeadAdsPollingCycle().catch((error) => {
      console.error("[MetaLeadAdsPollingWorker] Unhandled failure:", error.message || error);
    });
  });
  workerSignature = nextSignature;

  if (shouldRunOnStartup()) {
    setImmediate(() => {
      runMetaLeadAdsPollingCycle().catch((error) => {
        console.error("[MetaLeadAdsPollingWorker] Startup poll failed:", error.message || error);
      });
    });
  }

  return workerTask;
};

const restartMetaLeadAdsPollingWorker = async () => {
  stopMetaLeadAdsPollingWorker();
  return startMetaLeadAdsPollingWorker();
};

const stopMetaLeadAdsPollingWorker = () => {
  if (workerTask) {
    workerTask.stop();
    workerTask.destroy();
    workerTask = null;
  }
  workerSignature = "";
};

module.exports = {
  runMetaLeadAdsPollingCycle,
  startMetaLeadAdsPollingWorker,
  restartMetaLeadAdsPollingWorker,
  stopMetaLeadAdsPollingWorker,
  __private: {
    getWorkerCronExpression,
    getLookbackMinutes,
    shouldRunOnStartup,
  },
};

const { trimString } = require("./metaGraphService");

const REQUIRED_META_CAMPAIGN_LAUNCH_SCOPES = Object.freeze(["ads_read", "ads_management"]);

const getMetaLeadAdsCampaignLauncherState = ({ connection = {} } = {}) => ({
  enabled: false,
  canLaunch: false,
  status: "coming_soon",
  message: "Campaign launch from CRM is not enabled yet. Meta campaign sync and readiness checks are available.",
  requiredScopes: [...REQUIRED_META_CAMPAIGN_LAUNCH_SCOPES],
  lastPreparedAt: connection?.lastPreparedAt || connection?.lastSyncAt || null,
  selectedBusinessId: trimString(connection?.selectedBusinessId),
  selectedPageId: trimString(connection?.selectedPageId),
});

module.exports = {
  REQUIRED_META_CAMPAIGN_LAUNCH_SCOPES,
  getMetaLeadAdsCampaignLauncherState,
};

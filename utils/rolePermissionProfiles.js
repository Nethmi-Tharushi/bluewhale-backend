const ROLE_PERMISSION_PROFILE_KEYS = Object.freeze([
  "MainAdmin",
  "SalesAdmin",
  "SalesStaff",
  "Owner",
  "Admin",
  "Teammate",
]);

const ROLE_PERMISSION_PROFILE_LABELS = Object.freeze({
  MainAdmin: "Super Admin",
  SalesAdmin: "Sales Lead",
  SalesStaff: "Sales Agent",
  Owner: "Owner",
  Admin: "Admin",
  Teammate: "Teammate",
});

const ROLE_PERMISSION_KEYS = Object.freeze([
  "contactHubAccess",
  "exportContacts",
  "addContacts",
  "deleteContacts",
  "bulkTagContacts",
  "hideLegacyPhone",
  "hidePhone",
  "hideFieldData",
  "inboxAll",
  "inboxUnassigned",
  "createCampaign",
  "exportCampaignReport",
  "viewCampaignReports",
  "smartButtons",
  "templateCreation",
  "templateEditing",
  "templateDeletion",
  "agentSettings",
  "apiKey",
  "businessSetup",
  "invoiceHistory",
  "subscriptionDetails",
  "manageTags",
  "manageAddOns",
  "numberReconnection",
  "conversationAnalytics",
  "exportAnalytics",
  "agentPerformanceAnalytics",
  "orderPanelExport",
  "workflowReportExport",
  "welcomeMessage",
  "outOfOffice",
  "delayedMessage",
  "customAutoReply",
  "workflows",
  "ctwaAdsPage",
]);

const buildAllFalsePermissions = () =>
  ROLE_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {});

const createPreset = (enabledKeys = [], disabledKeys = []) => {
  const permissions = buildAllFalsePermissions();

  enabledKeys.forEach((key) => {
    permissions[key] = true;
  });

  disabledKeys.forEach((key) => {
    permissions[key] = false;
  });

  return permissions;
};

const ROLE_PERMISSION_DEFAULTS = Object.freeze({
  MainAdmin: createPreset(
    ROLE_PERMISSION_KEYS.filter((key) => !["hideLegacyPhone", "hidePhone", "hideFieldData"].includes(key)),
    ["hideLegacyPhone", "hidePhone", "hideFieldData"]
  ),
  SalesAdmin: createPreset(
    [
      "contactHubAccess",
      "exportContacts",
      "addContacts",
      "deleteContacts",
      "bulkTagContacts",
      "inboxAll",
      "inboxUnassigned",
      "createCampaign",
      "exportCampaignReport",
      "viewCampaignReports",
      "smartButtons",
      "templateCreation",
      "templateEditing",
      "templateDeletion",
      "agentSettings",
      "apiKey",
      "businessSetup",
      "invoiceHistory",
      "subscriptionDetails",
      "manageTags",
      "manageAddOns",
      "numberReconnection",
      "conversationAnalytics",
      "exportAnalytics",
      "agentPerformanceAnalytics",
      "orderPanelExport",
      "workflowReportExport",
      "welcomeMessage",
      "outOfOffice",
      "delayedMessage",
      "customAutoReply",
      "workflows",
      "ctwaAdsPage",
    ],
    ["hideLegacyPhone", "hidePhone", "hideFieldData"]
  ),
  SalesStaff: createPreset(
    [
      "contactHubAccess",
      "exportContacts",
      "addContacts",
      "bulkTagContacts",
      "inboxAll",
      "inboxUnassigned",
      "createCampaign",
      "exportCampaignReport",
      "viewCampaignReports",
      "smartButtons",
      "templateCreation",
      "templateEditing",
      "templateDeletion",
      "conversationAnalytics",
      "exportAnalytics",
      "agentPerformanceAnalytics",
      "orderPanelExport",
      "workflowReportExport",
      "welcomeMessage",
      "outOfOffice",
      "delayedMessage",
      "customAutoReply",
      "workflows",
      "ctwaAdsPage",
    ],
    [
      "deleteContacts",
      "hideLegacyPhone",
      "hidePhone",
      "hideFieldData",
      "agentSettings",
      "apiKey",
      "businessSetup",
      "invoiceHistory",
      "subscriptionDetails",
      "manageTags",
      "manageAddOns",
      "numberReconnection",
    ]
  ),
  Owner: createPreset(
    [
      "contactHubAccess",
      "exportContacts",
      "addContacts",
      "deleteContacts",
      "bulkTagContacts",
      "inboxAll",
      "createCampaign",
      "exportCampaignReport",
      "viewCampaignReports",
      "smartButtons",
      "templateCreation",
      "templateEditing",
      "templateDeletion",
      "agentSettings",
      "apiKey",
      "businessSetup",
      "invoiceHistory",
      "subscriptionDetails",
      "manageTags",
      "manageAddOns",
      "numberReconnection",
      "conversationAnalytics",
      "exportAnalytics",
      "agentPerformanceAnalytics",
      "orderPanelExport",
      "workflowReportExport",
      "welcomeMessage",
      "outOfOffice",
      "delayedMessage",
      "customAutoReply",
      "workflows",
      "ctwaAdsPage",
    ],
    ["hideLegacyPhone", "hidePhone", "hideFieldData", "inboxUnassigned"]
  ),
  Admin: createPreset(
    [
      "contactHubAccess",
      "exportContacts",
      "addContacts",
      "inboxAll",
      "createCampaign",
      "exportCampaignReport",
      "viewCampaignReports",
      "templateCreation",
      "templateEditing",
      "agentSettings",
      "businessSetup",
      "invoiceHistory",
      "subscriptionDetails",
      "manageTags",
      "conversationAnalytics",
      "exportAnalytics",
      "orderPanelExport",
      "workflowReportExport",
      "welcomeMessage",
      "outOfOffice",
      "delayedMessage",
      "customAutoReply",
      "workflows",
    ],
    [
      "deleteContacts",
      "bulkTagContacts",
      "hideLegacyPhone",
      "hidePhone",
      "hideFieldData",
      "inboxUnassigned",
      "smartButtons",
      "templateDeletion",
      "apiKey",
      "manageAddOns",
      "numberReconnection",
      "agentPerformanceAnalytics",
      "ctwaAdsPage",
    ]
  ),
  Teammate: createPreset(
    ["contactHubAccess", "hideLegacyPhone", "hidePhone", "hideFieldData"],
    [
      "exportContacts",
      "addContacts",
      "deleteContacts",
      "bulkTagContacts",
      "inboxAll",
      "inboxUnassigned",
      "createCampaign",
      "exportCampaignReport",
      "viewCampaignReports",
      "smartButtons",
      "templateCreation",
      "templateEditing",
      "templateDeletion",
      "agentSettings",
      "apiKey",
      "businessSetup",
      "invoiceHistory",
      "subscriptionDetails",
      "manageTags",
      "manageAddOns",
      "numberReconnection",
      "conversationAnalytics",
      "exportAnalytics",
      "agentPerformanceAnalytics",
      "orderPanelExport",
      "workflowReportExport",
      "welcomeMessage",
      "outOfOffice",
      "delayedMessage",
      "customAutoReply",
      "workflows",
      "ctwaAdsPage",
    ]
  ),
});

const ROLE_PERMISSION_KEYS_SET = new Set(ROLE_PERMISSION_KEYS);
const ROLE_PERMISSION_PROFILE_KEYS_SET = new Set(ROLE_PERMISSION_PROFILE_KEYS);

const isSupportedProfileKey = (value) => ROLE_PERMISSION_PROFILE_KEYS_SET.has(String(value || "").trim());
const isSupportedPermissionKey = (value) => ROLE_PERMISSION_KEYS_SET.has(String(value || "").trim());

const getRolePermissionLabel = (profileKey) =>
  ROLE_PERMISSION_PROFILE_LABELS[String(profileKey || "").trim()] || String(profileKey || "").trim();

const getDefaultPermissionsForProfile = (profileKey) => {
  const key = String(profileKey || "").trim();
  return {
    ...buildAllFalsePermissions(),
    ...(ROLE_PERMISSION_DEFAULTS[key] || {}),
  };
};

const fillPermissionDefaults = (profileKey, permissions = {}) => ({
  ...getDefaultPermissionsForProfile(profileKey),
  ...(permissions && typeof permissions === "object" ? permissions : {}),
});

module.exports = {
  ROLE_PERMISSION_PROFILE_KEYS,
  ROLE_PERMISSION_PROFILE_LABELS,
  ROLE_PERMISSION_KEYS,
  ROLE_PERMISSION_KEYS_SET,
  ROLE_PERMISSION_PROFILE_KEYS_SET,
  ROLE_PERMISSION_DEFAULTS,
  getRolePermissionLabel,
  getDefaultPermissionsForProfile,
  fillPermissionDefaults,
  isSupportedProfileKey,
  isSupportedPermissionKey,
};

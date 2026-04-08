# Role Permissions Backend

Blue Whale CRM now persists the frontend Role Permissions matrix under `/api/admins/role-permissions`.

## Profiles

These UI profile keys are stored exactly as the frontend uses them:

- `MainAdmin`
- `SalesAdmin`
- `SalesStaff`
- `Owner`
- `Admin`
- `Teammate`

## Permission Keys

- `contactHubAccess`
- `exportContacts`
- `addContacts`
- `deleteContacts`
- `bulkTagContacts`
- `hideLegacyPhone`
- `hidePhone`
- `hideFieldData`
- `inboxAll`
- `inboxUnassigned`
- `createCampaign`
- `exportCampaignReport`
- `viewCampaignReports`
- `smartButtons`
- `templateCreation`
- `templateEditing`
- `templateDeletion`
- `agentSettings`
- `apiKey`
- `businessSetup`
- `invoiceHistory`
- `subscriptionDetails`
- `manageTags`
- `manageAddOns`
- `numberReconnection`
- `conversationAnalytics`
- `exportAnalytics`
- `agentPerformanceAnalytics`
- `orderPanelExport`
- `workflowReportExport`
- `welcomeMessage`
- `outOfOffice`
- `delayedMessage`
- `customAutoReply`
- `workflows`
- `ctwaAdsPage`

## Endpoints

- `GET /api/admins/role-permissions`
  - Roles: `MainAdmin`, `SalesAdmin`
- `GET /api/admins/role-permissions/:profileKey`
  - Roles: `MainAdmin`, `SalesAdmin`
- `PUT /api/admins/role-permissions/:profileKey`
  - Roles: `MainAdmin`
- `POST /api/admins/role-permissions/reset`
  - Roles: `MainAdmin`

## Behavior

- Missing profiles are auto-seeded with default presets the first time the list or single-profile APIs are used.
- Unknown permission keys are rejected with `400`.
- Permission values must be boolean.
- Responses always include the full permission object for each profile.
- `updatedBy` is stored from the authenticated admin when profiles are updated or reset.

## Future Helpers

The backend also exposes reusable service helpers for future runtime enforcement:

- `getRolePermissionProfile(profileKey)`
- `getEffectivePermissionsForRole(profileKey)`
- `hasPermission(profileKey, permissionKey)`

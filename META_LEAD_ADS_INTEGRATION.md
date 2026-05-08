# Meta Lead Ads Backend Integration

This backend now supports a production-style Meta Business Manager + Meta Lead Ads integration for the CRM.

## Admin Endpoints

- `GET /api/admins/me/meta-lead-ads/status`
  - Role: `MainAdmin`
  - Returns a normalized Lead Ads settings object with safe defaults even before Meta is configured.
- `POST /api/admins/me/meta-lead-ads/exchange`
  - Role: `MainAdmin`
  - Accepts the Meta Business Login `code`, exchanges it server-side, stores tokens securely, and optionally syncs Pages/forms immediately.
- `POST /api/admins/me/meta-lead-ads/sync`
  - Role: `MainAdmin`
  - Refreshes Meta businesses, Pages, forms, ad accounts, active lead campaigns, selected asset names, scope diagnostics, and Page leadgen webhook subscription state.
- `GET /api/admins/me/meta-lead-ads/campaigns`
  - Role: `MainAdmin`
  - Returns Meta campaigns already synchronized into the CRM backend.
- `GET /api/admins/me/meta-lead-ads/logs`
  - Role: `MainAdmin`
  - Returns normalized `syncHistory`, `syncedLeads`, `failedSyncs`, and `syncSummary` data for the Meta Lead Ads admin panel.
- `POST /api/admins/me/meta-lead-ads/campaigns/sync`
  - Role: `MainAdmin`
  - Re-runs Meta campaign synchronization and returns the latest campaign snapshot.
- `POST /api/admins/me/meta-lead-ads/retry-failed-syncs`
  - Role: `MainAdmin`
  - Retries due failed lead ingestions using the same idempotent pipeline as webhook and polling ingestion.
- `POST /api/admins/me/meta-lead-ads/disconnect`
  - Role: `MainAdmin`
  - Clears Lead Ads access tokens, selected assets, synced snapshots, and marks the integration disconnected without affecting WhatsApp settings.

## Webhook Endpoint

- `GET /api/meta-lead-ads/webhook`
  - Meta verification challenge endpoint.
- `POST /api/meta-lead-ads/webhook`
  - Receives `leadgen` events from Meta Pages.
  - Verifies `X-Hub-Signature-256` with the configured Meta app secret.
  - Acknowledges quickly, then processes the lead asynchronously.

## Required Environment Variables

- `META_LEAD_ADS_APP_ID`
- `META_LEAD_ADS_APP_SECRET`
- `META_LEAD_ADS_BUSINESS_LOGIN_CONFIG_ID`
- `META_LEAD_ADS_WEBHOOK_VERIFY_TOKEN`
- `META_LEAD_ADS_GRAPH_API_VERSION`
- `META_LEAD_ADS_WEBHOOK_CALLBACK_BASE_URL`

Optional:

- `META_LEAD_ADS_CRM_SOURCE_LABEL`
- `META_LEAD_ADS_AUTO_CREATE_LEADS`
- `META_LEAD_ADS_AUTO_ASSIGN_TO_OWNER`
- `META_LEAD_ADS_SYNC_FORMS_ON_CONNECT`
- `META_LEAD_ADS_POLL_ENABLED`
- `META_LEAD_ADS_POLL_CRON`
- `META_LEAD_ADS_POLL_LOOKBACK_MINUTES`
- `META_LEAD_ADS_POLL_RUN_ON_STARTUP`

Fallback behavior:

- If dedicated Lead Ads env vars are missing, the backend can reuse generic Meta / existing WhatsApp Meta env values where appropriate.

## Meta Permissions / App Review

The integration expects these permissions at minimum:

- `business_management`
- `leads_retrieval`
- `pages_manage_ads`
- `pages_read_engagement`
- `pages_manage_metadata`

For production use, make sure these permissions are approved in Meta App Review for the app connected through Business Login.

## What Gets Stored

On the `MainAdmin` settings record:

- app/public integration settings
- user access token
- page access tokens
- selected business/page/form ids and names
- granted scope summary
- webhook subscription status
- synced asset snapshots
- last API error snapshot for safe admin diagnostics
- token expiry / sync timing metadata
- diagnostics and sync timestamps

Dedicated integration records:

- `MetaLeadAdsEventLog`
  - event-level lead ingestion record keyed by `pageId:metaLeadId`
  - stores retryability, attempts, next retry time, and safe failure diagnostics
- `MetaLeadAdsSubmission`
  - normalized inbound lead submission, idempotency record, CRM link, and audit payload
- `MetaLeadAdsCampaign`
  - synchronized Meta lead campaign snapshot stored inside the CRM backend for campaign display and reuse
- `MetaLeadAdsSyncLog`
  - sync history record for manual syncs, campaign syncs, webhook batches, polling cycles, per-lead failures, and retry attempts

CRM lead records:

- `Lead.integrationKey`
  - unique key like `meta_lead_ads:<metaLeadId>`
- `Lead.sourceMetadata`
  - page/form/campaign/meta lead metadata

## Lead Creation Behavior

When a Meta lead arrives:

1. The webhook event is deduplicated using `pageId:metaLeadId`.
2. The backend fetches the full lead payload from Meta Graph server-side with the stored page token.
3. Fields are mapped using the stored `fieldMapping`.
4. If `autoCreateLeads=true`, the CRM lead is created or updated idempotently using `integrationKey`.
5. If `autoCreateLeads=false`, the submission is stored as `pending_review` in `MetaLeadAdsSubmission` without creating the CRM lead.

Current defaults:

- `autoCreateLeads=true`
- `autoAssignToOwner=false`

That means Meta leads are created automatically by default, but they remain unassigned unless an admin explicitly enables owner auto-assignment.
If a lead is manually assigned later in the CRM, later Meta webhook/poll/retry resyncs preserve that manual assignment.

## CRM Lead Mapping

Meta Lead Ads submissions are mapped into the CRM lead structure with these behaviors:

- `Lead.name`
  - mapped from Meta full name / first+last name when available
- `Lead.phone`
  - mapped from Meta phone fields
- `Lead.email`
  - mapped from Meta email fields
- `Lead.source`
  - uses `crmSourceLabel` when configured, otherwise a stable Meta source label
- `Lead.sourceDetails`
  - stores campaign/form context for quick visibility in CRM
- `Lead.description`
  - stores a readable Meta-origin summary including campaign, form, post/job context, additional notes, and extra fields
- `Lead.integrationKey`
  - `meta_lead_ads:<metaLeadId>`
- `Lead.sourceMetadata`
  - structured Meta metadata used by the frontend and for audit/debugging

Meta metadata persisted on CRM leads includes:

- `metaLeadId`
- `campaignId`
- `campaignName`
- `formId`
- `formName`
- `pageId`
- `pageName`
- `postName`
- `jobPosition`
- `additionalNotes`
- `metaLeadTimestamp`
- `fetchedAt`
- `syncStatus`
- `fieldValues`
- `customFieldValues`
- `customFields`

This metadata is also exposed in API responses under flexible shapes such as:

- top-level lead fields like `metaLeadId`, `campaignName`, `formName`, `postName`, `jobPosition`, `additionalNotes`, `metaLeadTimestamp`, `syncStatus`
- `integrationMeta`
- `metaLeadAds`

## Campaign Sync Behavior

When campaign sync runs:

1. The backend reads connected ad accounts from Meta.
2. It fetches campaigns from each connected ad account.
3. Lead-generation campaigns are filtered and normalized.
4. The results are saved in `MetaLeadAdsCampaign`.
5. The latest campaign snapshot is returned under `assets.campaigns` and from `GET /api/admins/me/meta-lead-ads/campaigns`.

Campaign sync note:

- Meta campaign reads typically require `ads_read` or `ads_management`.
- If those permissions are missing, the rest of the Lead Ads connection still works, but campaign sync diagnostics will warn instead of failing the whole integration.

## Status And Admin Visibility

`GET /api/admins/me/meta-lead-ads/status` now also returns:

- `tokenHealth`
  - `status`, `expiresAt`, `lastError`, `needsReconnect`
- `syncSummary`
  - `totalSyncedLeads`, `failedSyncCount`, `lastSuccessfulSyncAt`
- `campaignLauncher`
  - disabled placeholder state for future campaign launch support from CRM
- compact `syncHistory`, `syncedLeads`, and `failedSyncs`

`campaignLauncher` intentionally stays disabled for now:

- `enabled=false`
- `canLaunch=false`
- `status=coming_soon`
- required scopes are exposed so the frontend can show launch-readiness context without enabling actual campaign creation yet

## Logs And Retry Behavior

The Meta Lead Ads admin panel can now show:

- sync history for manual sync, campaign sync, webhook batches, polling cycles, and retries
- recently synced lead items
- failed sync queue with retry metadata
- token-expired / reconnect-needed state

Retry behavior:

1. Failed lead ingestions are marked retryable only for safe API/access failures.
2. Retry attempts reuse the same `MetaLeadAdsEventLog`, `MetaLeadAdsSubmission`, and `Lead.integrationKey` idempotency keys.
3. If a lead was already created before retry, the retry is recorded as a duplicate/no-op instead of creating a second CRM lead.
4. Each retry updates `attempts`, `nextRetryAt`, and sync history visibility for the admin.

## Periodic Lead Fetch

The backend now includes a polling worker as a fallback for webhook misses and delayed delivery.

- Worker service: `services/metaLeadAdsPollingService.js`
- Startup: automatically started with the server
- Scheduler: cron-based background job
- Default interval: every 20 minutes
- Default lookback window: 30 minutes
- Default startup behavior: one sync attempt shortly after boot

Recommended scheduler range:

- every 20 minutes: `*/20 * * * *`
- every 30 minutes: `*/30 * * * *`

It polls recent leads from the selected Meta forms using stored page tokens and reuses the same idempotent ingestion path as the webhook flow.
Each poll cycle also writes sync history records and safe diagnostics for the admin panel.

## Duplicate Prevention

Duplicate protection is already enforced during both webhook delivery and scheduled polling:

- event-level idempotency: `MetaLeadAdsEventLog.eventKey = pageId:metaLeadId`
- submission-level idempotency: `MetaLeadAdsSubmission.metaLeadId`
- CRM lead-level idempotency: `Lead.integrationKey = meta_lead_ads:<metaLeadId>`

This means repeated webhook deliveries, overlapping poll windows, and repeated background sync cycles should not create duplicate CRM leads.
The same duplicate protection also applies when retrying failed Meta lead sync items.

Current assignment rule:

- Leads are owned by the connected admin context, but new Meta-origin leads are unassigned by default.
- If `autoAssignToOwner=true`, the connected owner can still be assigned automatically.
- Manual CRM assignment flows remain unchanged.

## Webhook Setup Steps In Meta

1. In Meta for Developers, open your app.
2. Add the Webhooks product if it is not already enabled.
3. Configure the callback URL:
   - `${META_LEAD_ADS_WEBHOOK_CALLBACK_BASE_URL}/api/meta-lead-ads/webhook`
4. Configure the verify token:
   - `META_LEAD_ADS_WEBHOOK_VERIFY_TOKEN`
5. Subscribe the app to the `Page` object and the `leadgen` field.
6. Complete Business Login in the CRM.
7. Use `Sync Pages & Forms` in the CRM so the backend subscribes the selected Page to `leadgen`.

## Manual Meta Setup Still Required

- Create or reuse a Meta app with Business Login enabled.
- Configure the Business Login configuration and allowed redirect URI(s).
- Add the webhook callback URL and verify token in Meta.
- Complete App Review for the required permissions before going live.
- Ensure the target Page and Lead Ads form are owned or shared correctly in Business Manager.

## Notes

- App secrets and access tokens are never returned to the browser.
- The existing WhatsApp Meta integration remains separate and unchanged.
- The status endpoint masks the webhook verify token in responses.
- Token-expired and permission failures are normalized into safe diagnostics; raw Meta tokens are never persisted in error messages.
- Standard lead list/detail payloads now expose Meta Lead Ads context so the frontend can render source, campaign/form metadata, additional notes, fetched timestamps, sync status, and unassigned state without a dedicated lead-format shim.

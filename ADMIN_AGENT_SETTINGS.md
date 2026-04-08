# Agent Settings Backend

Blue Whale CRM now exposes a dedicated backend resource for the Manage Agents page while keeping the existing admin and team endpoints working.

## Endpoints

- `GET /api/admins/agent-settings`
  - Roles: `MainAdmin`, `SalesAdmin`, `SalesStaff`
  - Query: `search`, `tab=all|sales`, `role`, `page`, `limit`
- `GET /api/admins/agent-settings/meta`
  - Roles: `MainAdmin`, `SalesAdmin`, `SalesStaff`
- `GET /api/admins`
  - Backward-compatible legacy list, now scope-aware for `MainAdmin`, `SalesAdmin`, `SalesStaff`
- `POST /api/admins/register`
  - Roles: `MainAdmin`, `SalesAdmin`
- `PUT /api/admins/:id`
  - Roles: `MainAdmin`, `SalesAdmin`
- `DELETE /api/admins/:id`
  - Roles: `MainAdmin`, `SalesAdmin`

## Behavior Notes

- `createdBy` is now stored on newly created admin users via `POST /api/admins/register`.
- `lastLogin` is refreshed on successful admin login.
- `SalesAdmin` can only create, update, or delete `SalesStaff` users assigned to them.
- Deletes are blocked for:
  - the currently authenticated user
  - the last remaining `MainAdmin`
- `GET /api/admins/agent-settings?tab=sales` returns only `SalesAdmin` and `SalesStaff` rows.

## Migration

No migration is required. Existing admin users continue to work, but older records may have `createdBy: null` until they are recreated or updated through the new flow.

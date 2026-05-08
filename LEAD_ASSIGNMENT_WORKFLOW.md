# Lead Assignment Workflow

This backend now supports CRM lead assignment with assignment history and admin-only ownership controls.

## Who Can Assign Leads

- `MainAdmin`
  - can assign, reassign, and unassign leads
- `SalesAdmin`
  - can assign, reassign, and unassign leads within their sales scope
- `SalesStaff`
  - can view leads and update normal lead fields where allowed
  - cannot change `assignedTo`

## Default Meta Lead Behavior

- New Meta Lead Ads leads remain unassigned by default.
- This is controlled by `META_LEAD_ADS_AUTO_ASSIGN_TO_OWNER`, which now defaults to `false`.
- If Meta auto-assignment is explicitly enabled later, assignment metadata is still tracked.
- Manual CRM assignments are preserved during later Meta webhook, polling, or retry resyncs.

## Routes

- `GET /api/leads`
  - returns lead list with assignment metadata
  - supports optional `?assigned=assigned` or `?assigned=unassigned`
- `GET /api/leads/:id`
  - returns one lead with assignment metadata and history
- `PATCH /api/leads/:id/assign`
  - roles: `MainAdmin`, `SalesAdmin`
  - body:
    - `{ "assignedTo": "<adminId>" }` to assign/reassign
    - `{ "assignedTo": "" }` or `{ "assignedTo": null }` to unassign
- `POST /api/leads/bulk-assign`
  - roles: `MainAdmin`, `SalesAdmin`
  - body:
    - `{ "leadIds": ["..."], "assignedTo": "<adminId>" }`
    - `{ "leadIds": ["..."], "assignedTo": "" }` to bulk unassign

## Assignment History Structure

Each lead now stores:

- `assignedTo`
- `assignedBy`
- `assignedAt`
- `assignmentHistory`

Each `assignmentHistory` item includes:

- `action`
  - `assigned`
  - `reassigned`
  - `unassigned`
- `assignedTo`
- `previousAssignedTo`
- `assignedBy`
- `assignedAt`

## Lead Payload Fields

Standard lead list and detail payloads now expose:

- `assignedTo`
- `assignedBy`
- `assignedAt`
- `assignmentHistory`
- `leadAssignments`
- `assignments`
- `assignmentState`
- `isUnassigned`

These fields are returned alongside existing Meta Lead Ads fields such as:

- `metaLeadId`
- `integrationKey`
- `integrationProvider`
- `campaignName`
- `formName`
- `postName`
- `jobPosition`
- `additionalNotes`
- `metaLeadTimestamp`
- `syncStatus`

## Validation And Errors

Assignment endpoints return clear errors for:

- invalid lead id
- invalid assignee id
- assignee not found / outside allowed sales scope
- unauthorized `SalesStaff` assignment attempts
- bulk assignment partial failures

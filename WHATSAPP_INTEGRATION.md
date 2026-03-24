# WhatsApp CRM Integration

This CRM now includes an in-house WhatsApp Business Cloud API module with:

- `GET /webhook` for Meta verification
- `POST /webhook` for inbound webhook events

- `GET /conversations`
- `GET /messages/:conversationId`
- `GET /agents`
- `GET /templates`

- `POST /assign-agent`
- `POST /send-message`
- `POST /conversations/:conversationId/status`

## Environment variables

Set these in `server/.env`:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_GRAPH_API_VERSION`

## Webhook setup

1. In Meta Developer Console, configure the callback URL to:
   `https://your-domain.com/webhook`
2. Set the verify token to match `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
3. Subscribe to `messages` events.

## Agent assignment

- Assignable chat handlers are pulled from `AdminUser`.
- Auto-assignment uses round robin across available `SalesStaff` users where:
  - `whatsappInbox.allowAutoAssignment = true`
  - `whatsappInbox.status` is `available` or `busy`
- `SalesAdmin` can manually reassign chats to a preferred `SalesStaff` member.
- `SalesStaff` can only work chats assigned to them.
- `MainAdmin` retains override visibility and management access.

## Conversation lifecycle

- New inbound message creates or updates a `WhatsAppContact`
- A `WhatsAppConversation` is created per contact
- First unassigned conversation is auto-assigned round-robin
- Conversation status is tracked as `open`, `assigned`, or `closed`
- Approved WhatsApp templates are fetched from Meta and can be selected from the CRM
- Media messages can be previewed and downloaded in the CRM inbox

## Example send message payload

### Text message

```json
{
  "conversationId": "660000000000000000000001",
  "type": "text",
  "text": "Hello, how can we help you today?"
}
```

### Template message

```json
{
  "conversationId": "660000000000000000000001",
  "type": "template",
  "template": {
    "name": "hello_world",
    "languageCode": "en_US",
    "components": []
  }
}
```

## Collection mapping

The original request described SQL-style tables. In this CRM, the equivalent MongoDB collections are:

- `whatsappcontacts`
- `whatsappconversations`
- `whatsappmessages`
- `adminusers`
- `whatsappeventlogs`
- `whatsappassignmentstates`

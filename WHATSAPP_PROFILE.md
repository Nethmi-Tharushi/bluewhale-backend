# WhatsApp Profile Backend

Blue Whale CRM now persists the WhatsApp Business Profile used by:

- `/admin-dashboard/whatsapp-profile`
- `/sales-dashboard/whatsapp-profile`

## Endpoints

- `GET /api/whatsapp/profile`
  - Roles: `MainAdmin`, `SalesAdmin`
- `PUT /api/whatsapp/profile`
  - Roles: `MainAdmin`, `SalesAdmin`
- `POST /api/whatsapp/profile/logo`
  - Roles: `MainAdmin`, `SalesAdmin`
  - `multipart/form-data`
  - field: `file`
- `DELETE /api/whatsapp/profile/logo`
  - Roles: `MainAdmin`, `SalesAdmin`

## Stored Fields

- `businessName`
- `businessType`
- `businessDescription`
- `address`
- `email`
- `website`
- `phone`
- `logoUrl`

## Behavior

- The profile is stored as a singleton document.
- If no profile exists yet, the backend auto-seeds a default profile on first read.
- `businessName` is required.
- `email` must be valid if provided.
- `website` must be a valid `http` or `https` URL if provided.
- Unsupported fields are rejected with `400`.
- Logo uploads use a dedicated endpoint and are stored in Cloudinary under `bluewhale/whatsapp/profile`.
- Logo files must be images and 5MB or smaller.

## Default Profile

```json
{
  "businessName": "Blue Whale CRM",
  "businessType": "Professional Services",
  "businessDescription": "",
  "address": "",
  "email": "",
  "website": "",
  "phone": "",
  "logoUrl": ""
}
```

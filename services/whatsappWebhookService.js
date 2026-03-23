const crypto = require("crypto");

const normalizePhone = (phone) => String(phone || "").replace(/[^\d]/g, "");

const verifyMetaSignature = ({ rawBody, signatureHeader, appSecret }) => {
  if (!appSecret) {
    throw new Error("Missing WHATSAPP_APP_SECRET environment variable");
  }

  if (!rawBody || !signatureHeader) return false;

  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(String(signatureHeader));

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
};

const extractMessageContent = (message) => {
  if (!message || typeof message !== "object") {
    return { content: "", type: "unknown" };
  }

  switch (message.type) {
    case "text":
      return { content: message.text?.body || "", type: "text" };
    case "interactive":
      return {
        content:
          message.interactive?.button_reply?.title ||
          message.interactive?.list_reply?.title ||
          "[interactive]",
        type: "interactive",
      };
    case "button":
      return { content: message.button?.text || "[button]", type: "interactive" };
    case "image":
    case "audio":
    case "video":
    case "document":
      return {
        content: message[message.type]?.caption || `[${message.type}]`,
        type: message.type,
      };
    default:
      return { content: `[${message.type || "unknown"}]`, type: "unknown" };
  }
};

const parseWebhookPayload = (payload) => {
  const inboundMessages = [];
  const statusEvents = [];

  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];

      for (const message of messages) {
        const contact = contacts.find((item) => item.wa_id === message.from) || contacts[0] || {};
        const { content, type } = extractMessageContent(message);

        inboundMessages.push({
          phone: normalizePhone(message.from || contact.wa_id),
          waId: String(contact.wa_id || message.from || ""),
          name: contact.profile?.name || "",
          text: content,
          type,
          messageId: message.id || "",
          timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date(),
          phoneNumberId: value.metadata?.phone_number_id || "",
          rawMessage: message,
          rawValue: value,
        });
      }

      for (const status of statuses) {
        statusEvents.push({
          externalMessageId: status.id || "",
          status: status.status || "",
          timestamp: status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date(),
          recipientId: status.recipient_id || "",
          rawStatus: status,
        });
      }
    }
  }

  return { inboundMessages, statusEvents };
};

module.exports = {
  verifyMetaSignature,
  parseWebhookPayload,
  normalizePhone,
};

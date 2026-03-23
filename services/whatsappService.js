const WhatsAppEventLog = require("../models/WhatsAppEventLog");

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizePhone = (phone) => String(phone || "").replace(/[^\d+]/g, "").replace(/^00/, "+");

const buildSendPayload = ({ to, type = "text", text, template }) => {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizePhone(to).replace(/^\+/, ""),
    type,
  };

  if (type === "text") {
    payload.text = { preview_url: false, body: String(text || "").trim() };
  } else if (type === "template") {
    payload.template = {
      name: template?.name,
      language: {
        code: template?.languageCode || "en_US",
      },
      components: Array.isArray(template?.components) ? template.components : [],
    };
  } else {
    throw new Error(`Unsupported WhatsApp message type: ${type}`);
  }

  return payload;
};

const sendGraphRequest = async ({ payload, accessToken, phoneNumberId, retries = 3 }) => {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data?.error?.message || "WhatsApp API request failed");
        error.status = response.status;
        error.payload = data;
        throw error;
      }

      return data;
    } catch (error) {
      lastError = error;
      const canRetry = attempt < retries && (!error.status || error.status >= 500);
      if (!canRetry) break;
      await sleep(300 * attempt);
    }
  }

  throw lastError;
};

const sendMessage = async ({ to, type = "text", text, template, context = {} }) => {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    throw new Error("Missing WhatsApp Cloud API credentials in environment variables");
  }

  const payload = buildSendPayload({ to, type, text, template });

  const eventLog = await WhatsAppEventLog.create({
    direction: "outgoing",
    eventType: "message.send",
    status: "received",
    payload: {
      context,
      payload,
    },
  });

  try {
    const response = await sendGraphRequest({ payload, accessToken, phoneNumberId });
    eventLog.status = "processed";
    eventLog.payload = { ...eventLog.payload, response };
    await eventLog.save();
    return { payload, response };
  } catch (error) {
    eventLog.status = "failed";
    eventLog.errorMessage = error.message;
    eventLog.payload = { ...eventLog.payload, errorPayload: error.payload || null };
    await eventLog.save();
    throw error;
  }
};

module.exports = {
  sendMessage,
  normalizePhone,
};

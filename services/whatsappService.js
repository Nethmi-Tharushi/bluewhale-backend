const WhatsAppEventLog = require("../models/WhatsAppEventLog");
const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0";
const SUPPORTED_MEDIA_TYPES = ["image", "document", "audio", "video"];
const SUPPORTED_INTERACTIVE_TYPES = ["flow"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizePhone = (phone) => String(phone || "").replace(/[^\d+]/g, "").replace(/^00/, "+");

const buildMetaErrorMessage = (data, fallbackMessage) => {
  const message = String(
    data?.error?.error_user_msg ||
      data?.error?.error_user_title ||
      data?.error?.error_data?.details ||
      data?.error?.message ||
      fallbackMessage ||
      ""
  ).trim();
  const lowerMessage = message.toLowerCase();
  const errorCode = Number(data?.error?.code || 0);

  if (errorCode === 190 || lowerMessage.includes("access token") || lowerMessage.includes("session has expired")) {
    return "WhatsApp access token is invalid or expired";
  }

  return message || fallbackMessage || "WhatsApp API request failed";
};

const buildInteractivePayload = (interactive = {}) => {
  const interactiveType = String(interactive?.type || "").trim().toLowerCase();
  if (!SUPPORTED_INTERACTIVE_TYPES.includes(interactiveType)) {
    throw new Error(`Unsupported WhatsApp interactive type: ${interactiveType || "unknown"}`);
  }

  if (interactiveType === "flow") {
    const ctaText = String(interactive?.action?.parameters?.flow_cta || "").trim();
    const flowToken = String(interactive?.action?.parameters?.flow_token || "").trim();
    const flowAction = String(interactive?.action?.parameters?.flow_action || "navigate").trim().toLowerCase();
    const flowMode = String(interactive?.action?.parameters?.mode || "published").trim().toLowerCase();
    const flowId = String(interactive?.action?.parameters?.flow_id || "").trim();
    const flowName = String(interactive?.action?.parameters?.flow_name || "").trim();
    const flowMessageVersion = String(interactive?.action?.parameters?.flow_message_version || "3").trim() || "3";
    const bodyText = String(interactive?.body?.text || "").trim();

    if (!ctaText) {
      throw new Error("WhatsApp flow interactive messages require action.parameters.flow_cta");
    }

    if (!flowToken) {
      throw new Error("WhatsApp flow interactive messages require action.parameters.flow_token");
    }

    if (flowMode === "draft" && !flowName) {
      throw new Error("WhatsApp draft flow messages require action.parameters.flow_name");
    }

    if (flowMode !== "draft" && !flowId) {
      throw new Error("WhatsApp published flow messages require action.parameters.flow_id");
    }

    const payload = {
      type: "flow",
      body: bodyText ? { text: bodyText } : undefined,
      action: {
        name: "flow",
        parameters: {
          flow_message_version: flowMessageVersion,
          flow_token: flowToken,
          flow_cta: ctaText,
          flow_action: flowAction || "navigate",
          mode: flowMode || "published",
          ...(flowMode === "draft"
            ? { flow_name: flowName }
            : { flow_id: flowId }),
        },
      },
    };

    const screen = String(interactive?.action?.parameters?.flow_action_payload?.screen || "").trim();
    const data = interactive?.action?.parameters?.flow_action_payload?.data;

    if (flowAction === "navigate" && (screen || (data && typeof data === "object" && Object.keys(data).length))) {
      payload.action.parameters.flow_action_payload = {
        ...(screen ? { screen } : {}),
        ...(data && typeof data === "object" && Object.keys(data).length ? { data } : {}),
      };
    }

    if (interactive?.footer?.text) {
      payload.footer = { text: String(interactive.footer.text).trim() };
    }

    if (interactive?.header?.type === "text" && String(interactive?.header?.text || "").trim()) {
      payload.header = {
        type: "text",
        text: String(interactive.header.text).trim(),
      };
    }

    return payload;
  }

  throw new Error(`Unsupported WhatsApp interactive type: ${interactiveType}`);
};

const buildSendPayload = ({ to, type = "text", text, template, media, interactive, interactive }) => {
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
  } else if (type === "interactive") {
    if (!interactive || typeof interactive !== "object") {
      throw new Error("interactive payload is required for interactive messages");
    }
    payload.interactive = interactive;
  } else if (type === "interactive") {
    payload.interactive = buildInteractivePayload(interactive);
  } else if (SUPPORTED_MEDIA_TYPES.includes(type)) {
    const mediaLink = media?.link || media?.url;

    if (!mediaLink) {
      throw new Error(`media.link is required for ${type} messages`);
    }

    payload[type] = {
      link: mediaLink,
    };

    if (["image", "video", "document"].includes(type) && String(media?.caption || text || "").trim()) {
      payload[type].caption = String(media?.caption || text || "").trim();
    }

    if (type === "document" && String(media?.filename || "").trim()) {
      payload[type].filename = String(media.filename).trim();
    }
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
        const error = new Error(buildMetaErrorMessage(data, "WhatsApp API request failed"));
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

const getMediaMetadata = async ({ mediaId, accessToken }) => {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(buildMetaErrorMessage(data, "Failed to fetch WhatsApp media metadata"));
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
};

const downloadMedia = async ({ mediaId, accessToken }) => {
  const metadata = await getMediaMetadata({ mediaId, accessToken });
  const response = await fetch(metadata.url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(buildMetaErrorMessage(data, "Failed to download WhatsApp media"));
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  const arrayBuffer = await response.arrayBuffer();

  return {
    buffer: Buffer.from(arrayBuffer),
    metadata,
    contentType: response.headers.get("content-type") || metadata.mime_type || "application/octet-stream",
    contentLength: response.headers.get("content-length") || String(Buffer.byteLength(Buffer.from(arrayBuffer))),
  };
};

const uploadBufferToCloudinary = ({ buffer, resourceType, publicId, filename }) =>
  new Promise((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream(
      {
        folder: "bluewhale/whatsapp/inbound",
        resource_type: resourceType,
        public_id: publicId,
        use_filename: !publicId,
        filename_override: filename || undefined,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(upload);
  });

const getCloudinaryResourceType = (mimeType = "") => {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "raw";
};

const cacheInboundMedia = async ({ mediaId, mimeType = "", filename = "" }) => {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken || !mediaId) {
    throw new Error("Missing WhatsApp access token or media id");
  }

  const downloaded = await downloadMedia({ mediaId, accessToken });
  const uploadResult = await uploadBufferToCloudinary({
    buffer: downloaded.buffer,
    resourceType: getCloudinaryResourceType(mimeType || downloaded.metadata?.mime_type || ""),
    publicId: `wa_${mediaId}_${Date.now()}`,
    filename,
  });

  return {
    url: uploadResult.secure_url,
    publicId: uploadResult.public_id,
    resourceType: uploadResult.resource_type,
    bytes: uploadResult.bytes,
    mimeType: mimeType || downloaded.metadata?.mime_type || downloaded.contentType || "",
  };
};

const sendMessage = async ({ to, type = "text", text, template, media, interactive, context = {} }) => {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    throw new Error("Missing WhatsApp Cloud API credentials in environment variables");
  }

  const payload = buildSendPayload({ to, type, text, template, media, interactive });

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
  downloadMedia,
  cacheInboundMedia,
  getMediaMetadata,
  SUPPORTED_MEDIA_TYPES,
  SUPPORTED_INTERACTIVE_TYPES,
};

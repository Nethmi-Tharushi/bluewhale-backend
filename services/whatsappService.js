const WhatsAppEventLog = require("../models/WhatsAppEventLog");
const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0";
const SUPPORTED_MEDIA_TYPES = ["image", "document", "audio", "video"];

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

const buildSendPayload = ({ to, type = "text", text, template, media }) => {
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

const sendMessage = async ({ to, type = "text", text, template, media, context = {} }) => {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    throw new Error("Missing WhatsApp Cloud API credentials in environment variables");
  }

  const payload = buildSendPayload({ to, type, text, template, media });

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
};

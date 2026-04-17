const axios = require("axios");
const WhatsAppEventLog = require("../models/WhatsAppEventLog");
const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");
const { loadWhatsAppMetaConnection } = require("./whatsappMetaConnectionService");
const {
  getWalletSummary,
  reserveWalletAmount,
  commitWalletReservation,
  releaseWalletReservation,
  resolveTemplateChargeMinor,
} = require("./whatsappWalletService");

const FLOW_GRAPH_API_VERSION = "v19.0";
const SUPPORTED_MEDIA_TYPES = ["image", "document", "audio", "video"];
const SUPPORTED_INTERACTIVE_TYPES = ["button", "flow", "list", "product_list"];

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

const isWhatsAppTokenError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  return (
    Number(error?.status || 0) === 401 ||
    Number(error?.payload?.error?.code || 0) === 190 ||
    message.includes("whatsapp access token is invalid or expired") ||
    message.includes("access token") ||
    message.includes("session has expired")
  );
};

const normalizeWhatsAppApiError = (error) => {
  if (!error || typeof error !== "object") return error;
  if (isWhatsAppTokenError(error)) {
    error.status = 503;
    error.code = "WHATSAPP_TOKEN_EXPIRED";
  }
  return error;
};

const createStructuredError = (message, status = 400, code = "WHATSAPP_SEND_ERROR", details = {}) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
};

const trimString = (value) => String(value || "").trim();

const isFlowInteractivePayload = (payload = {}) =>
  payload?.type === "interactive" && payload?.interactive?.type === "flow";
const isListInteractivePayload = (payload = {}) =>
  payload?.type === "interactive" && payload?.interactive?.type === "list";
const isProductListInteractivePayload = (payload = {}) =>
  payload?.type === "interactive" && payload?.interactive?.type === "product_list";

const buildInteractivePayload = (interactive = {}) => {
  const interactiveType = trimString(interactive?.type).toLowerCase();
  if (!SUPPORTED_INTERACTIVE_TYPES.includes(interactiveType)) {
    throw new Error(`Unsupported WhatsApp interactive type: ${interactiveType || "unknown"}`);
  }

  if (interactiveType === "button") {
    const bodyText = String(interactive?.body?.text || "").trim();
    const buttons = Array.isArray(interactive?.action?.buttons) ? interactive.action.buttons : [];

    if (!bodyText) {
      throw new Error("WhatsApp button interactive messages require body.text");
    }

    if (!buttons.length) {
      throw new Error("WhatsApp button interactive messages require action.buttons");
    }

    const payload = {
      type: "button",
      body: { text: bodyText },
      action: { buttons },
    };

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

  if (interactiveType === "flow") {
    const flowConfig = interactive?.flow && typeof interactive.flow === "object" ? interactive.flow : {};
    const actionParameters = interactive?.action?.parameters || {};
    const ctaText = trimString(interactive?.ctaText || flowConfig.ctaText || actionParameters.flow_cta);
    const flowToken = trimString(interactive?.flowToken || actionParameters.flow_token);
    const flowAction = trimString(interactive?.flowAction || actionParameters.flow_action || "navigate").toLowerCase();
    const flowMode = trimString(
      flowConfig.mode
      || interactive?.mode
      || actionParameters.mode
      || (flowConfig.name || actionParameters.flow_name ? "draft" : "published")
    ).toLowerCase() || "published";
    const flowName = trimString(flowConfig.name || actionParameters.flow_name);
    const flowId = trimString(flowConfig.id || actionParameters.flow_id);
    const flowMessageVersion = trimString(interactive?.flowMessageVersion || actionParameters.flow_message_version || "3") || "3";
    const bodyText = trimString(interactive?.body?.text);
    const flowActionPayload = interactive?.flowActionPayload || actionParameters.flow_action_payload;

    if (!ctaText) {
      throw new Error("WhatsApp flow interactive messages require flow_cta");
    }

    if (!flowToken) {
      throw new Error("WhatsApp flow interactive messages require flow_token");
    }

    if (flowMode === "draft" && !flowName) {
      throw new Error("WhatsApp draft flow messages require flow.name");
    }

    if (flowMode !== "draft" && !flowId) {
      throw new Error("WhatsApp published flow messages require flow.id");
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
          mode: flowMode,
          ...(flowMode === "draft"
            ? { flow_name: flowName }
            : { flow_id: flowId }),
        },
      },
    };

    if (flowAction === "navigate" && flowActionPayload && typeof flowActionPayload === "object" && Object.keys(flowActionPayload).length) {
      payload.action.parameters.flow_action_payload = flowActionPayload;
    }

    return payload;
  }

  if (interactiveType === "list") {
    const bodyText = trimString(interactive?.body?.text || interactive?.bodyText);
    const buttonText = trimString(interactive?.action?.button || interactive?.buttonText);
    const sections = Array.isArray(interactive?.action?.sections)
      ? interactive.action.sections
      : Array.isArray(interactive?.sections)
        ? interactive.sections
        : [];
    const headerText = trimString(interactive?.header?.text || interactive?.headerText);
    const footerText = trimString(interactive?.footer?.text || interactive?.footerText);
    const normalizedSections = sections
      .map((section) => ({
        title: trimString(section?.title),
        rows: (Array.isArray(section?.rows) ? section.rows : [])
          .map((row) => ({
            id: trimString(row?.id),
            title: trimString(row?.title),
            ...(trimString(row?.description) ? { description: trimString(row.description) } : {}),
          }))
          .filter((row) => row.id && row.title),
      }))
      .filter((section) => section.rows.length > 0);

    if (!bodyText) {
      throw new Error("WhatsApp interactive list messages require body.text");
    }

    if (!buttonText) {
      throw new Error("WhatsApp interactive list messages require action.button");
    }

    if (buttonText.length > 20) {
      throw new Error("WhatsApp interactive list button text must be 20 characters or fewer");
    }

    if (normalizedSections.length < 1) {
      throw new Error("WhatsApp interactive list messages require at least one section");
    }

    if (normalizedSections.length > 10) {
      throw new Error("WhatsApp interactive list messages support at most 10 sections");
    }

    const totalRows = normalizedSections.reduce((total, section) => total + section.rows.length, 0);
    if (totalRows < 1) {
      throw new Error("WhatsApp interactive list messages require at least one row");
    }

    return {
      type: "list",
      ...(headerText ? { header: { type: "text", text: headerText } } : {}),
      body: { text: bodyText },
      ...(footerText ? { footer: { text: footerText } } : {}),
      action: {
        button: buttonText,
        sections: normalizedSections,
      },
    };
  }

  if (interactiveType === "product_list") {
    const bodyText = trimString(interactive?.body?.text || interactive?.bodyText);
    const headerText = trimString(interactive?.header?.text || interactive?.headerText);
    const footerText = trimString(interactive?.footer?.text || interactive?.footerText);
    const catalogId = trimString(interactive?.action?.catalog_id || interactive?.catalogId);
    const sections = Array.isArray(interactive?.action?.sections)
      ? interactive.action.sections
      : Array.isArray(interactive?.sections)
        ? interactive.sections
        : [];
    const normalizedSections = sections
      .map((section) => ({
        title: trimString(section?.title),
        product_items: (Array.isArray(section?.product_items) ? section.product_items : Array.isArray(section?.items) ? section.items : [])
          .map((item) => ({
            product_retailer_id: trimString(item?.product_retailer_id || item?.id || item?.productRetailerId),
          }))
          .filter((item) => item.product_retailer_id),
      }))
      .filter((section) => section.title && section.product_items.length > 0);

    if (!headerText) {
      throw new Error("WhatsApp product collection messages require header.text");
    }

    if (!bodyText) {
      throw new Error("WhatsApp product collection messages require body.text");
    }

    if (!catalogId) {
      throw new Error("WhatsApp product collection messages require action.catalog_id");
    }

    if (normalizedSections.length < 1) {
      throw new Error("WhatsApp product collection messages require at least one section");
    }

    if (normalizedSections.length > 10) {
      throw new Error("WhatsApp product collection messages support at most 10 sections");
    }

    const totalProducts = normalizedSections.reduce(
      (total, section) => total + section.product_items.length,
      0
    );

    if (totalProducts < 1) {
      throw new Error("WhatsApp product collection messages require at least one product");
    }

    if (totalProducts > 30) {
      throw new Error("WhatsApp product collection messages support at most 30 products");
    }

    return {
      type: "product_list",
      header: { type: "text", text: headerText },
      body: { text: bodyText },
      ...(footerText ? { footer: { text: footerText } } : {}),
      action: {
        catalog_id: catalogId,
        sections: normalizedSections,
      },
    };
  }

  throw new Error(`Unsupported WhatsApp interactive type: ${interactiveType}`);
};

const buildSendPayload = ({ to, type = "text", text, template, media, interactive }) => {
  if (type === "interactive") {
    const interactivePayload = buildInteractivePayload(interactive);
    return {
      messaging_product: "whatsapp",
      to: normalizePhone(to).replace(/^\+/, ""),
      type: "interactive",
      interactive: interactivePayload,
    };
  }

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

const logFlowRequest = (message, details = {}) => {
  console.info(`[WhatsAppFlow] ${message}`, JSON.parse(JSON.stringify(details)));
};

const summarizeInteractiveListPayload = (payload = {}) => {
  const sections = Array.isArray(payload?.interactive?.action?.sections) ? payload.interactive.action.sections : [];
  const rowCount = sections.reduce(
    (total, section) => total + (Array.isArray(section?.rows) ? section.rows.length : 0),
    0
  );

  return {
    to: payload?.to || "",
    buttonText: trimString(payload?.interactive?.action?.button),
    sectionCount: sections.length,
    rowCount,
  };
};

const summarizeProductListPayload = (payload = {}) => {
  const sections = Array.isArray(payload?.interactive?.action?.sections) ? payload.interactive.action.sections : [];
  const productCount = sections.reduce(
    (total, section) => total + (Array.isArray(section?.product_items) ? section.product_items.length : 0),
    0
  );

  return {
    to: payload?.to || "",
    catalogId: trimString(payload?.interactive?.action?.catalog_id),
    sectionCount: sections.length,
    productCount,
  };
};

const sendGraphRequest = async ({ payload, accessToken, phoneNumberId, graphApiVersion = "v21.0", retries = 3 }) => {
  const url = `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`;
  let lastError = null;
  const isListPayload = isListInteractivePayload(payload);
  const isProductListPayload = isProductListInteractivePayload(payload);

  if (isListPayload) {
    console.info("[WhatsAppInteractiveList] Sending interactive list", {
      phoneNumberId,
      ...summarizeInteractiveListPayload(payload),
    });
  }

  if (isProductListPayload) {
    console.info("[WhatsAppProductCollection] Sending product collection", {
      phoneNumberId,
      ...summarizeProductListPayload(payload),
    });
  }

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
        throw normalizeWhatsAppApiError(error);
      }

      if (isListPayload) {
        console.info("[WhatsAppInteractiveList] Meta response received", {
          phoneNumberId,
          ...summarizeInteractiveListPayload(payload),
          response: data,
        });
      }

      if (isProductListPayload) {
        console.info("[WhatsAppProductCollection] Meta response received", {
          phoneNumberId,
          ...summarizeProductListPayload(payload),
          response: data,
        });
      }

      return data;
    } catch (error) {
      if (isListPayload) {
        console.error("[WhatsAppInteractiveList] Failed to send interactive list", {
          phoneNumberId,
          ...summarizeInteractiveListPayload(payload),
          error: error.message,
          response: error.payload || null,
          attempt,
        });
      }
      if (isProductListPayload) {
        console.error("[WhatsAppProductCollection] Failed to send product collection", {
          phoneNumberId,
          ...summarizeProductListPayload(payload),
          error: error.message,
          response: error.payload || null,
          attempt,
        });
      }
      lastError = normalizeWhatsAppApiError(error);
      const canRetry = attempt < retries && (!error.status || error.status >= 500);
      if (!canRetry) break;
      await sleep(300 * attempt);
    }
  }

  throw lastError;
};

const sendFlowGraphRequest = async ({ payload, accessToken, phoneNumberId }) => {
  const url = `https://graph.facebook.com/${FLOW_GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  const mode = trimString(payload?.interactive?.action?.parameters?.mode || "published") || "published";

  logFlowRequest(`Sending ${mode} flow`, {
    mode,
    phoneNumberId,
    to: payload?.to || "",
    payload,
  });

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    logFlowRequest("Meta response received", {
      mode,
      response: response.data,
    });

    return response.data;
  } catch (error) {
    const data = error.response?.data || error.payload || {};
    const wrappedError = new Error(buildMetaErrorMessage(data, "WhatsApp Flow API request failed"));
    wrappedError.status = error.response?.status || error.status;
    wrappedError.payload = data;

    console.error("[WhatsAppFlow] Failed to send flow", {
      mode,
      payload,
      error: wrappedError.message,
      response: data,
    });

    throw normalizeWhatsAppApiError(wrappedError);
  }
};

const getMediaMetadata = async ({ mediaId, accessToken, graphApiVersion = "v21.0" }) => {
  const response = await fetch(`https://graph.facebook.com/${graphApiVersion}/${mediaId}`, {
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
    throw normalizeWhatsAppApiError(error);
  }

  return data;
};

const downloadMedia = async ({ mediaId, accessToken, graphApiVersion = "v21.0" }) => {
  const metadata = await getMediaMetadata({ mediaId, accessToken, graphApiVersion });
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
    throw normalizeWhatsAppApiError(error);
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
  const connection = await loadWhatsAppMetaConnection();
  const accessToken = connection.accessToken;
  if (!accessToken || !mediaId) {
    throw new Error("Missing WhatsApp access token or media id");
  }

  const downloaded = await downloadMedia({ mediaId, accessToken, graphApiVersion: connection.graphApiVersion });
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
  const connection = await loadWhatsAppMetaConnection();
  const accessToken = connection.accessToken;
  const phoneNumberId = connection.phoneNumberId;
  let walletReservation = null;
  let walletChargeMinor = 0;
  let walletCurrency = "";
  const templateCategory = trimString(template?.category || template?.templateCategory || template?.messageCategory || "").toUpperCase();

  if (!accessToken || !phoneNumberId) {
    throw new Error("Missing WhatsApp Cloud API credentials in environment variables");
  }

  if (type === "template") {
    const wallet = await getWalletSummary();
    walletChargeMinor = context?.walletChargeMinor !== undefined ? Number(context.walletChargeMinor) : resolveTemplateChargeMinor(template, wallet);
    walletCurrency = wallet.currency;
    walletReservation = await reserveWalletAmount({
      amountMinor: walletChargeMinor,
      actorId: context?.actorId || null,
      note: `Reserved for WhatsApp template send to ${normalizePhone(to)}`,
      description: `Reserved for template send: ${String(template?.name || template?.id || "template").trim() || "template"}`,
      metadata: {
        to: normalizePhone(to),
        type,
        context,
      },
    });
  }

  let payload;
  try {
    payload = buildSendPayload({ to, type, text, template, media, interactive });
  } catch (error) {
    let releaseInfo = null;
    if (walletReservation?.reservationId) {
      releaseInfo = await releaseWalletReservation({
        reservationId: walletReservation.reservationId,
        note: `Template payload build failed: ${error.message}`,
        metadata: { context },
      }).catch((releaseError) => {
        console.warn("[WhatsAppWallet] Failed to release reservation after payload build error:", releaseError.message);
        return null;
      });
    }
    throw Object.assign(
      createStructuredError(error.message || "Failed to build WhatsApp payload", error.status || 400, error.code || "WHATSAPP_PAYLOAD_BUILD_FAILED", {
        reservationReleased: Boolean(releaseInfo),
        releasedAmountMinor: Number(releaseInfo?.amountMinor || 0),
        releasedAmount: Number(releaseInfo?.amount || 0),
        currency: walletCurrency,
        templateCategory,
      }),
      { payload: error.payload || null }
    );
  }

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
    const response = isFlowInteractivePayload(payload)
      ? await sendFlowGraphRequest({ payload, accessToken, phoneNumberId, graphApiVersion: connection.graphApiVersion })
      : await sendGraphRequest({ payload, accessToken, phoneNumberId, graphApiVersion: connection.graphApiVersion });
    let walletCommit = null;
    if (walletReservation?.reservationId) {
      try {
        walletCommit = await commitWalletReservation({
          reservationId: walletReservation.reservationId,
          note: `Template send completed for ${normalizePhone(to)}`,
          metadata: {
            context,
            responseMessageId: response?.messages?.[0]?.id || "",
          },
        });
      } catch (commitError) {
        console.error("[WhatsAppWallet] Failed to commit template reservation:", commitError.message);
      }
    }
    eventLog.status = "processed";
    eventLog.payload = { ...eventLog.payload, response };
    await eventLog.save();
    return {
      payload,
      response,
      wallet: walletReservation
        ? {
            reservationId: walletReservation.reservationId,
            reservedAmountMinor: Number(walletReservation.amountMinor || walletChargeMinor || 0),
            reservedAmount: Number(walletReservation.amount || 0),
            deductedAmountMinor: Number(walletCommit?.amountMinor || 0),
            deductedAmount: Number(walletCommit?.amount || 0),
            currency: walletCommit?.wallet?.currency || walletCurrency,
            templateCategory,
            reservationMode: walletReservation.reservationMode || "template_send",
            reservationReleased: false,
          }
        : null,
    };
  } catch (error) {
    let releaseInfo = null;
    if (walletReservation?.reservationId) {
      releaseInfo = await releaseWalletReservation({
        reservationId: walletReservation.reservationId,
        note: `Template send failed: ${error.message}`,
        metadata: {
          context,
          error: error.message,
        },
      }).catch((releaseError) => {
        console.warn("[WhatsAppWallet] Failed to release reservation after send error:", releaseError.message);
        return null;
      });
    }
    eventLog.status = "failed";
    eventLog.errorMessage = error.message;
    eventLog.payload = { ...eventLog.payload, errorPayload: error.payload || null };
    await eventLog.save();
    throw Object.assign(
      createStructuredError(
        error.message || "Failed to send WhatsApp message",
        error.status || 500,
        error.code || "WHATSAPP_SEND_FAILED",
        {
          ...(error.details && typeof error.details === "object" ? error.details : {}),
          reservationReleased: Boolean(releaseInfo),
          releasedAmountMinor: Number(releaseInfo?.amountMinor || 0),
          releasedAmount: Number(releaseInfo?.amount || 0),
          reservationId: walletReservation?.reservationId || "",
          currency: walletCurrency,
          templateCategory,
        }
      ),
      { payload: error.payload || null }
    );
  }
};

module.exports = {
  sendMessage,
  sendFlowGraphRequest,
  normalizePhone,
  downloadMedia,
  cacheInboundMedia,
  getMediaMetadata,
  SUPPORTED_MEDIA_TYPES,
  SUPPORTED_INTERACTIVE_TYPES,
};

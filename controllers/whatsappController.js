const { Types } = require("mongoose");
const AdminUser = require("../models/AdminUser");
const Lead = require("../models/Lead");
const WhatsAppEventLog = require("../models/WhatsAppEventLog");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppContact = require("../models/WhatsAppContact");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const { getAvailableAgents, getAssignmentSettings, updateAssignmentSettings } = require("../services/whatsappAssignmentService");
const { sendBasicAutomationTestMessage } = require("../services/whatsappBasicAutomationRuntimeService");
const {
  saveInboundMessage,
  saveOutgoingMessage,
  updateMessageStatusFromWebhook,
  listConversations,
  listMessages,
  assignConversation,
  updateConversationStatus,
  addConversationNote: createConversationNote,
  replaceConversationTags,
  linkConversationLead,
  emitConversationEvents,
  ensureConversation,
  getConversationById,
  upsertContact,
} = require("../services/whatsappCRMService");
const { sendMessage, downloadMedia, cacheInboundMedia, SUPPORTED_MEDIA_TYPES } = require("../services/whatsappService");
const {
  listQuickReplies,
  listQuickReplyFolders,
  listQuickReplySuggestions,
  getQuickReplyById,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  toggleQuickReply,
  toggleQuickReplyPin,
  markQuickReplyUsed,
} = require("../services/whatsappQuickReplyService");
const {
  listWhatsAppForms,
  getWhatsAppFormById,
  createWhatsAppForm,
  updateWhatsAppForm,
  deleteWhatsAppForm,
  toggleWhatsAppForm,
} = require("../services/whatsappFormService");
const {
  getBasicAutomationSettings,
  updateWorkingHours,
  updateOutOfOfficeAutomation,
  updateWelcomeAutomation,
  updateDelayedResponseAutomation,
  listAvailableBasicAutomationForms,
  listAvailableBasicAutomationTemplates,
  listBasicAutomationHistory,
  previewBasicAutomation,
} = require("../services/whatsappBasicAutomationService");
const {
  listTemplates,
  syncTemplatesFromMeta,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getTemplateById,
  getTemplateHistory,
  uploadTemplateHeaderMedia,
  saveTemplateDefaultMedia,
  removeTemplateDefaultMedia,
  uploadDefaultHeaderMedia,
  prepareTemplateMessage,
} = require("../services/whatsappTemplateService");
const { verifyMetaSignature, parseWebhookPayload, normalizePhone } = require("../services/whatsappWebhookService");
const { SALES_ROLES, buildOwnedFilter } = require("../utils/salesScope");

const inferMediaMessageType = (file) => {
  if (!file?.mimetype) return null;
  if (file.mimetype.startsWith("image/")) return "image";
  if (file.mimetype.startsWith("audio/")) return "audio";
  if (file.mimetype.startsWith("video/")) return "video";
  return "document";
};

const isMainAdmin = (admin) => String(admin?.role || "") === "MainAdmin";
const isSalesAdmin = (admin) => String(admin?.role || "") === "SalesAdmin";
const isSalesStaff = (admin) => String(admin?.role || "") === "SalesStaff";
const isDuplicateShortcutError = (error) => error?.code === 11000 && Object.prototype.hasOwnProperty.call(error?.keyPattern || {}, "shortcut");
const isDuplicateWhatsAppFormSlugError = (error) => error?.code === 11000 && Object.prototype.hasOwnProperty.call(error?.keyPattern || {}, "slug");

const canManageAssignments = (admin) => isMainAdmin(admin) || isSalesAdmin(admin);
const canManageTemplates = (admin) => isMainAdmin(admin) || isSalesAdmin(admin) || isSalesStaff(admin);
const isValidObjectId = (value) => Types.ObjectId.isValid(String(value || ""));

const canSendConversationMessage = ({ admin, conversation }) => {
  if (canManageAssignments(admin)) return true;

  if (isSalesStaff(admin)) {
    return String(conversation?.agentId || "") === String(admin?._id || "");
  }

  return false;
};

const canUpdateConversationStatus = ({ admin, conversation }) => {
  if (canManageAssignments(admin)) return true;

  if (isSalesStaff(admin)) {
    return String(conversation?.agentId || "") === String(admin?._id || "");
  }

  return false;
};

const getAuthenticatedActor = (req) => req.admin || req.user || null;

const parseOptionalJson = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const parseArrayInput = (value) => {
  if (Array.isArray(value)) return value;
  const parsed = parseOptionalJson(value);
  return Array.isArray(parsed) ? parsed : [];
};

const pickTemplateComponent = (template, type) =>
  Array.isArray(template?.components)
    ? template.components.find((component) => String(component?.type || "").toUpperCase() === type)
    : null;

const extractTemplateDraft = (template) => {
  const header = pickTemplateComponent(template, "HEADER");
  const body = pickTemplateComponent(template, "BODY");
  const footer = pickTemplateComponent(template, "FOOTER");
  const buttons = pickTemplateComponent(template, "BUTTONS");

  return {
    name: template?.name || "",
    category: template?.category || "",
    language: template?.language || "en_US",
    headerType: header?.format || "NONE",
    headerText: header?.format === "TEXT" ? header?.text || "" : "",
    headerExamples: Array.isArray(header?.example?.header_text) ? header.example.header_text : [],
    headerMediaHandle: Array.isArray(header?.example?.header_handle) ? header.example.header_handle[0] || "" : "",
    defaultHeaderMedia: template?.defaultHeaderMedia || null,
    bodyText: body?.text || "",
    bodyExamples: Array.isArray(body?.example?.body_text) ? body.example.body_text : [],
    footerText: footer?.text || "",
    buttons: Array.isArray(buttons?.buttons) ? buttons.buttons : [],
  };
};

const findAccessibleLead = async (req, leadId) => {
  const query =
    req.admin && SALES_ROLES.includes(req.admin.role)
      ? { _id: leadId, ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin") }
      : { _id: leadId };

  return Lead.findOne(query).select("_id");
};

const hydrateMediaMessage = async (messageDoc) => {
  const message = messageDoc?.toObject ? messageDoc.toObject() : messageDoc;
  const media = message?.metadata?.media;

  if (!media?.id || media?.url) {
    return message;
  }

  try {
    const cachedMedia = await cacheInboundMedia({
      mediaId: media.id,
      mimeType: media.mimeType || "",
      filename: media.filename || "",
    });

    await WhatsAppMessage.updateOne(
      { _id: message._id },
      {
        $set: {
          "metadata.media": {
            ...media,
            ...cachedMedia,
          },
        },
      }
    );

    return {
      ...message,
      metadata: {
        ...(message.metadata || {}),
        media: {
          ...media,
          ...cachedMedia,
        },
      },
    };
  } catch (error) {
    console.error("Failed to hydrate WhatsApp media message:", error);
    return message;
  }
};

const getWebhookChallenge = async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode !== "subscribe" || token !== process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(403).json({ message: "Webhook verification failed" });
  }

  return res.status(200).send(challenge);
};

const receiveWebhook = async (req, res) => {
  let eventLog = null;

  try {
    eventLog = await WhatsAppEventLog.create({
      direction: "webhook",
      eventType: "webhook.received",
      status: "received",
      headers: {
        "x-hub-signature-256": req.headers["x-hub-signature-256"] || "",
      },
      payload: req.body,
    });

    const isValidSignature = verifyMetaSignature({
      rawBody: req.rawBody,
      signatureHeader: req.headers["x-hub-signature-256"],
      appSecret: process.env.WHATSAPP_APP_SECRET,
    });

    if (!isValidSignature) {
      eventLog.status = "failed";
      eventLog.errorMessage = "Invalid Meta signature";
      await eventLog.save();
      return res.status(401).json({ message: "Invalid webhook signature" });
    }

    const { inboundMessages, statusEvents } = parseWebhookPayload(req.body);

    for (const inboundMessage of inboundMessages) {
      await saveInboundMessage({ app: req.app, message: inboundMessage });
    }

    for (const statusEvent of statusEvents) {
      await updateMessageStatusFromWebhook(statusEvent);
    }

    eventLog.status = "processed";
    eventLog.payload = {
      inboundMessages: inboundMessages.length,
      statusEvents: statusEvents.length,
    };
    await eventLog.save();

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("WhatsApp webhook processing failed:", error);
    if (eventLog) {
      eventLog.status = "failed";
      eventLog.errorMessage = error.message;
      await eventLog.save();
    }
    return res.status(500).json({ message: "Webhook processing failed" });
  }
};

const getConversations = async (req, res) => {
  try {
    const conversations = await listConversations({
      status: req.query.status,
      search: req.query.search,
      admin: req.admin,
    });
    return res.json({ success: true, data: conversations });
  } catch (error) {
    console.error("Failed to fetch WhatsApp conversations:", error);
    return res.status(500).json({ message: "Failed to fetch conversations" });
  }
};

const getConversationMessages = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.conversationId)) {
      return res.status(400).json({ message: "Invalid conversationId" });
    }

    const conversation = await WhatsAppConversation.findById(req.params.conversationId).select("_id");
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const messages = await listMessages({
      conversationId: req.params.conversationId,
      admin: req.admin,
    });
    const hydratedMessages = await Promise.all(messages.map((message) => hydrateMediaMessage(message)));
    const conversationData = await getConversationById(req.params.conversationId);

    return res.json({
      success: true,
      data: hydratedMessages,
      conversation: conversationData,
    });
  } catch (error) {
    console.error("Failed to fetch WhatsApp messages:", error);
    return res.status(error.message?.includes("Access denied") ? 403 : 500).json({ message: error.message || "Failed to fetch messages" });
  }
};

const getMessageMedia = async (req, res) => {
  try {
    const message = await WhatsAppMessage.findById(req.params.messageId).lean();
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    const media = message.metadata?.media;
    if (!media) {
      return res.status(404).json({ message: "No media found for this message" });
    }

    if (!media.url && media.id) {
      const cachedMedia = await cacheInboundMedia({
        mediaId: media.id,
        mimeType: media.mimeType || "",
        filename: media.filename || "",
      });

      await WhatsAppMessage.updateOne(
        { _id: message._id },
        {
          $set: {
            "metadata.media": {
              ...media,
              ...cachedMedia,
            },
          },
        }
      );

      media.url = cachedMedia.url;
      media.mimeType = cachedMedia.mimeType || media.mimeType || "";
    }

    if (media.url) {
      return res.redirect(media.url);
    }

    if (!media.id) {
      return res.status(404).json({ message: "Media reference is missing" });
    }

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!accessToken) {
      return res.status(500).json({ message: "Missing WhatsApp access token" });
    }

    const { buffer, contentType } = await downloadMedia({
      mediaId: media.id,
      accessToken,
    });

    if (media.filename) {
      res.setHeader("Content-Disposition", `inline; filename="${media.filename.replace(/"/g, "")}"`);
    }
    res.setHeader("Content-Type", media.mimeType || contentType || "application/octet-stream");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Failed to load WhatsApp media:", error);
    return res.status(500).json({ message: error.message || "Failed to load WhatsApp media" });
  }
};

const getAgents = async (_req, res) => {
  try {
    const autoAssignableAgents = await getAvailableAgents();
    const assignmentSettings = await getAssignmentSettings();
    const allAgents = await AdminUser.find({ role: "SalesStaff" })
      .select("_id name email role whatsappInbox createdAt")
      .sort({ createdAt: 1 })
      .lean();

    return res.json({
      success: true,
      data: allAgents.map((agent) => ({
        ...agent,
        canAutoAssign: autoAssignableAgents.some((item) => String(item._id) === String(agent._id)),
        selectedForRoundRobin: assignmentSettings.selectionMode === "preferred"
          ? assignmentSettings.preferredAgentIds.includes(String(agent._id))
          : true,
      })),
    });
  } catch (error) {
    console.error("Failed to fetch WhatsApp agents:", error);
    return res.status(500).json({ message: "Failed to fetch agents" });
  }
};

const getRoundRobinSettings = async (_req, res) => {
  try {
    if (!canManageAssignments(_req.admin)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const settings = await getAssignmentSettings();
    return res.json({ success: true, data: settings });
  } catch (error) {
    console.error("Failed to fetch WhatsApp assignment settings:", error);
    return res.status(500).json({ message: "Failed to fetch assignment settings" });
  }
};

const saveRoundRobinSettings = async (req, res) => {
  try {
    if (!canManageAssignments(req.admin)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const settings = await updateAssignmentSettings({
      selectionMode: req.body?.selectionMode,
      preferredAgentIds: req.body?.preferredAgentIds,
      autoAssignmentEnabled: typeof req.body?.autoAssignmentEnabled === "boolean" ? req.body.autoAssignmentEnabled : undefined,
    });
    return res.json({ success: true, data: settings });
  } catch (error) {
    console.error("Failed to update WhatsApp assignment settings:", error);
    return res.status(500).json({ message: "Failed to update assignment settings" });
  }
};

const getWhatsAppQuickReplies = async (req, res) => {
  try {
    const result = await listQuickReplies(req.query || {});
    return res.json({
      success: true,
      data: result.items,
      items: result.items,
      pagination: result.pagination,
      filters: result.filters,
      page: result.pagination.page,
      limit: result.pagination.limit,
      total: result.pagination.total,
      totalPages: result.pagination.totalPages,
      hasNextPage: result.pagination.hasNextPage,
      hasPrevPage: result.pagination.hasPrevPage,
    });
  } catch (error) {
    console.error("Failed to fetch WhatsApp quick replies:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch quick replies" });
  }
};

const getWhatsAppBasicAutomations = async (_req, res) => {
  try {
    const settings = await getBasicAutomationSettings();
    return res.json({ success: true, data: settings });
  } catch (error) {
    console.error("Failed to fetch WhatsApp basic automations:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch basic automations" });
  }
};

const getWhatsAppBasicAutomationForms = async (_req, res) => {
  try {
    const forms = await listAvailableBasicAutomationForms();
    return res.json({ success: true, data: forms });
  } catch (error) {
    console.error("Failed to fetch WhatsApp automation forms:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch automation forms" });
  }
};

const getWhatsAppBasicAutomationTemplates = async (_req, res) => {
  try {
    const templates = await listAvailableBasicAutomationTemplates();
    return res.json({ success: true, data: templates });
  } catch (error) {
    console.error("Failed to fetch WhatsApp automation templates:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch automation templates" });
  }
};

const getWhatsAppBasicAutomationHistory = async (req, res) => {
  try {
    const history = await listBasicAutomationHistory(req.query || {});
    return res.json({ success: true, data: history });
  } catch (error) {
    console.error("Failed to fetch WhatsApp automation history:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to fetch automation history" });
  }
};

const testWhatsAppBasicAutomation = async (req, res) => {
  try {
    const preview = await previewBasicAutomation(req.body || {});
    return res.json({ success: true, data: preview });
  } catch (error) {
    console.error("Failed to preview WhatsApp automation:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to preview automation" });
  }
};

const testSendWhatsAppBasicAutomation = async (req, res) => {
  try {
    const actor = getAuthenticatedActor(req);
    const result = await sendBasicAutomationTestMessage({
      ...(req.body || {}),
      actorId: actor?._id || null,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Failed to send WhatsApp automation test message:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to send automation test message" });
  }
};

const getWhatsAppForms = async (req, res) => {
  try {
    const result = await listWhatsAppForms(req.query || {});
    return res.json({
      success: true,
      data: result.items,
      items: result.items,
      pagination: result.pagination,
      filters: result.filters,
      page: result.pagination.page,
      limit: result.pagination.limit,
      total: result.pagination.total,
      totalPages: result.pagination.totalPages,
      hasNextPage: result.pagination.hasNextPage,
      hasPrevPage: result.pagination.hasPrevPage,
    });
  } catch (error) {
    console.error("Failed to fetch WhatsApp forms:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch WhatsApp forms" });
  }
};

const getWhatsAppForm = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid WhatsApp form id" });
    }

    const form = await getWhatsAppFormById(req.params.id);
    if (!form) {
      return res.status(404).json({ message: "WhatsApp form not found" });
    }

    return res.json({ success: true, data: form });
  } catch (error) {
    console.error("Failed to fetch WhatsApp form:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch WhatsApp form" });
  }
};

const createWhatsAppFormDefinition = async (req, res) => {
  try {
    const actor = getAuthenticatedActor(req);
    const form = await createWhatsAppForm(req.body || {}, actor?._id || null);
    return res.status(201).json({ success: true, data: form });
  } catch (error) {
    console.error("Failed to create WhatsApp form:", error);

    if (isDuplicateWhatsAppFormSlugError(error)) {
      return res.status(400).json({ message: "A WhatsApp form with this slug already exists" });
    }

    return res.status(error.status || 400).json({ message: error.message || "Failed to create WhatsApp form" });
  }
};

const updateWhatsAppFormDefinition = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid WhatsApp form id" });
    }

    const actor = getAuthenticatedActor(req);
    const form = await updateWhatsAppForm(req.params.id, req.body || {}, actor?._id || null);
    return res.json({ success: true, data: form });
  } catch (error) {
    console.error("Failed to update WhatsApp form:", error);

    if (isDuplicateWhatsAppFormSlugError(error)) {
      return res.status(400).json({ message: "A WhatsApp form with this slug already exists" });
    }

    return res.status(error.status || 400).json({ message: error.message || "Failed to update WhatsApp form" });
  }
};

const deleteWhatsAppFormDefinition = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid WhatsApp form id" });
    }

    await deleteWhatsAppForm(req.params.id);
    return res.json({ success: true, message: "WhatsApp form deleted successfully" });
  } catch (error) {
    console.error("Failed to delete WhatsApp form:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to delete WhatsApp form" });
  }
};

const toggleWhatsAppFormDefinition = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid WhatsApp form id" });
    }

    const actor = getAuthenticatedActor(req);
    const form = await toggleWhatsAppForm(req.params.id, actor?._id || null);
    return res.json({ success: true, data: form });
  } catch (error) {
    console.error("Failed to toggle WhatsApp form:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to toggle WhatsApp form" });
  }
};

const updateWhatsAppWorkingHours = async (req, res) => {
  try {
    const actor = getAuthenticatedActor(req);
    const settings = await updateWorkingHours(req.body || {}, actor?._id || null);
    return res.json({ success: true, data: settings });
  } catch (error) {
    console.error("Failed to update WhatsApp working hours:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to update working hours" });
  }
};

const updateWhatsAppOutOfOffice = async (req, res) => {
  try {
    const actor = getAuthenticatedActor(req);
    const settings = await updateOutOfOfficeAutomation(req.body || {}, actor?._id || null);
    return res.json({ success: true, data: settings });
  } catch (error) {
    console.error("Failed to update WhatsApp out of office automation:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to update out of office automation" });
  }
};

const updateWhatsAppWelcomeAutomation = async (req, res) => {
  try {
    const actor = getAuthenticatedActor(req);
    const settings = await updateWelcomeAutomation(req.body || {}, actor?._id || null);
    return res.json({ success: true, data: settings });
  } catch (error) {
    console.error("Failed to update WhatsApp welcome automation:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to update welcome automation" });
  }
};

const updateWhatsAppDelayedResponseAutomation = async (req, res) => {
  try {
    const actor = getAuthenticatedActor(req);
    const settings = await updateDelayedResponseAutomation(req.body || {}, actor?._id || null);
    return res.json({ success: true, data: settings });
  } catch (error) {
    console.error("Failed to update WhatsApp delayed response automation:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to update delayed response automation" });
  }
};

const getWhatsAppQuickReplyFolders = async (_req, res) => {
  try {
    const folders = await listQuickReplyFolders();
    return res.json({ success: true, data: folders });
  } catch (error) {
    console.error("Failed to fetch WhatsApp quick reply folders:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch quick reply folders" });
  }
};

const getWhatsAppQuickReplySuggestions = async (req, res) => {
  try {
    const suggestions = await listQuickReplySuggestions(req.query || {});
    return res.json({ success: true, data: suggestions, items: suggestions });
  } catch (error) {
    console.error("Failed to fetch WhatsApp quick reply suggestions:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch quick reply suggestions" });
  }
};

const getWhatsAppQuickReply = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid quick reply id" });
    }

    const quickReply = await getQuickReplyById(req.params.id);
    if (!quickReply) {
      return res.status(404).json({ message: "Quick reply not found" });
    }

    return res.json({ success: true, data: quickReply });
  } catch (error) {
    console.error("Failed to fetch WhatsApp quick reply:", error);
    return res.status(500).json({ message: "Failed to fetch quick reply" });
  }
};

const createWhatsAppQuickReply = async (req, res) => {
  try {
    const actor = getAuthenticatedActor(req);
    const quickReply = await createQuickReply(req.body || {}, actor?._id || null);
    return res.status(201).json({ success: true, data: quickReply });
  } catch (error) {
    console.error("Failed to create WhatsApp quick reply:", error);
    if (isDuplicateShortcutError(error)) {
      return res.status(400).json({ message: "shortcut must be unique" });
    }
    return res.status(error.status || 400).json({ message: error.message || "Failed to create quick reply" });
  }
};

const updateWhatsAppQuickReply = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid quick reply id" });
    }

    const actor = getAuthenticatedActor(req);
    const quickReply = await updateQuickReply(req.params.id, req.body || {}, actor?._id || null);
    return res.json({ success: true, data: quickReply });
  } catch (error) {
    console.error("Failed to update WhatsApp quick reply:", error);
    if (isDuplicateShortcutError(error)) {
      return res.status(400).json({ message: "shortcut must be unique" });
    }
    return res.status(error.status || 400).json({ message: error.message || "Failed to update quick reply" });
  }
};

const deleteWhatsAppQuickReply = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid quick reply id" });
    }

    await deleteQuickReply(req.params.id);
    return res.json({ success: true, message: "Quick reply deleted successfully" });
  } catch (error) {
    console.error("Failed to delete WhatsApp quick reply:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to delete quick reply" });
  }
};

const toggleWhatsAppQuickReply = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid quick reply id" });
    }

    const actor = getAuthenticatedActor(req);
    const quickReply = await toggleQuickReply(req.params.id, actor?._id || null);
    return res.json({ success: true, data: quickReply });
  } catch (error) {
    console.error("Failed to toggle WhatsApp quick reply:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to toggle quick reply" });
  }
};

const pinWhatsAppQuickReply = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid quick reply id" });
    }

    const actor = getAuthenticatedActor(req);
    const quickReply = await toggleQuickReplyPin(req.params.id, actor?._id || null);
    return res.json({ success: true, data: quickReply });
  } catch (error) {
    console.error("Failed to pin WhatsApp quick reply:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to pin quick reply" });
  }
};

const useWhatsAppQuickReply = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid quick reply id" });
    }

    const actor = getAuthenticatedActor(req);
    const quickReply = await markQuickReplyUsed(req.params.id, actor?._id || null);
    return res.json({ success: true, data: quickReply });
  } catch (error) {
    console.error("Failed to mark WhatsApp quick reply as used:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to update quick reply usage" });
  }
};

const getTemplates = async (req, res) => {
  try {
    const templates = await listTemplates({
      search: req.query.search || "",
      status: req.query.status || "",
    });
    return res.json({ data: templates });
  } catch (error) {
    console.error("Failed to fetch WhatsApp templates:", error);
    return res.status(500).json({ message: error.message || "Failed to fetch WhatsApp templates" });
  }
};

const createWhatsAppTemplate = async (req, res) => {
  try {
    if (!canManageTemplates(req.admin)) {
      return res.status(403).json({ message: "Access denied: only sales team users can create templates" });
    }

    const defaultHeaderMedia = parseOptionalJson(req.body?.defaultHeaderMedia);
    const template = await createTemplate({
      name: req.body?.name,
      category: req.body?.category,
      language: req.body?.language,
      bodyText: req.body?.bodyText,
      bodyExamples: parseArrayInput(req.body?.bodyExamples),
      headerType: req.body?.headerType,
      headerText: req.body?.headerText,
      headerExamples: parseArrayInput(req.body?.headerExamples),
      headerMediaHandle: req.body?.headerMediaHandle,
      footerText: req.body?.footerText,
      buttons: parseArrayInput(req.body?.buttons),
      allowCategoryChange: req.body?.allowCategoryChange !== false,
      adminId: req.admin?._id || null,
    });

    const normalizedHeaderFormat = String(req.body?.headerType || "").toUpperCase();
    if (["IMAGE", "VIDEO", "DOCUMENT"].includes(normalizedHeaderFormat) && defaultHeaderMedia?.url) {
      const savedDefaultHeaderMedia = await saveTemplateDefaultMedia({
        templateId: template.id,
        templateName: template.name,
        headerFormat: normalizedHeaderFormat,
        defaultMedia: defaultHeaderMedia,
        adminId: req.admin?._id || null,
      });

      template.defaultHeaderMedia = savedDefaultHeaderMedia;
    }

    return res.status(201).json({ data: { id: template.id } });
  } catch (error) {
    console.error("Failed to create WhatsApp template:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to create WhatsApp template" });
  }
};

const uploadWhatsAppTemplateMedia = async (req, res) => {
  try {
    if (!canManageTemplates(req.admin)) {
      return res.status(403).json({ message: "Access denied: only sales team users can upload template media" });
    }

    const uploadedFile = req.file;
    if (!uploadedFile?.buffer?.length) {
      return res.status(400).json({ message: "Please choose a media file to upload" });
    }

    const media = await uploadTemplateHeaderMedia({
      buffer: uploadedFile.buffer,
      filename: uploadedFile.originalname,
      mimeType: uploadedFile.mimetype,
    });

    return res.status(201).json({ data: media });
  } catch (error) {
    console.error("Failed to upload WhatsApp template media:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to upload WhatsApp template media" });
  }
};

const setWhatsAppTemplateDefaultMedia = async (req, res) => {
  try {
    if (!canManageTemplates(req.admin)) {
      return res.status(403).json({ message: "Access denied: only sales team users can update default template media" });
    }

    const uploadedFile = req.file;
    if (!uploadedFile?.buffer?.length) {
      return res.status(400).json({ message: "Please choose a media file to upload" });
    }

    const templateId = String(req.params?.templateId || "").trim();
    const templateName = String(req.body?.templateName || "").trim();
    const headerFormat = String(req.body?.headerFormat || "").trim().toUpperCase();

    if (!templateId) {
      return res.status(400).json({ message: "Template id is required" });
    }

    const defaultMedia = await uploadDefaultHeaderMedia({
      buffer: uploadedFile.buffer,
      filename: uploadedFile.originalname,
      mimeType: uploadedFile.mimetype,
      publicId: `wa_template_default_${templateId}_${Date.now()}`,
    });

    const savedDefaultHeaderMedia = await saveTemplateDefaultMedia({
      templateId,
      templateName,
      headerFormat,
      defaultMedia,
      adminId: req.admin?._id || null,
    });

    return res.status(201).json({
      data: {
        defaultHeaderMedia: savedDefaultHeaderMedia,
      },
    });
  } catch (error) {
    console.error("Failed to save WhatsApp template default media:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to save default template media" });
  }
};

const deleteWhatsAppTemplateDefaultMedia = async (req, res) => {
  try {
    if (!canManageTemplates(req.admin)) {
      return res.status(403).json({ message: "Access denied: only sales team users can remove default template media" });
    }

    const templateId = String(req.params?.templateId || "").trim();
    if (!templateId) {
      return res.status(400).json({ message: "Template id is required" });
    }

    await removeTemplateDefaultMedia({ templateId });
    return res.json({ message: "Default media removed" });
  } catch (error) {
    console.error("Failed to remove WhatsApp template default media:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to remove default template media" });
  }
};

const syncWhatsAppTemplates = async (req, res) => {
  try {
    if (!canManageTemplates(req.admin)) {
      return res.status(403).json({ message: "Access denied: only sales team users can sync templates" });
    }

    const templates = await syncTemplatesFromMeta({
      search: req.query.search || "",
      status: req.query.status || "",
      adminId: req.admin?._id || null,
    });

    return res.json({ data: templates });
  } catch (error) {
    console.error("Failed to sync WhatsApp templates:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to sync WhatsApp templates" });
  }
};

const resubmitWhatsAppTemplate = async (req, res) => {
  try {
    if (!canManageTemplates(req.admin)) {
      return res.status(403).json({ message: "Access denied: only sales team users can resubmit templates" });
    }

    const templateId = String(req.params?.templateId || "").trim();
    if (!templateId) {
      return res.status(400).json({ message: "Template id is required" });
    }

    const existingTemplate = await getTemplateById(templateId);
    if (!existingTemplate) {
      return res.status(404).json({ message: "Template not found" });
    }

    const fallbackDraft = extractTemplateDraft(existingTemplate);
    const template = await updateTemplate({
      templateId,
      name: req.body?.name || fallbackDraft.name,
      category: req.body?.category || fallbackDraft.category,
      language: req.body?.language || fallbackDraft.language,
      bodyText: req.body?.bodyText || fallbackDraft.bodyText,
      bodyExamples: parseArrayInput(req.body?.bodyExamples).length
        ? parseArrayInput(req.body?.bodyExamples)
        : fallbackDraft.bodyExamples,
      headerType: req.body?.headerType || fallbackDraft.headerType,
      headerText: req.body?.headerText || fallbackDraft.headerText,
      headerExamples: parseArrayInput(req.body?.headerExamples).length
        ? parseArrayInput(req.body?.headerExamples)
        : fallbackDraft.headerExamples,
      headerMediaHandle: req.body?.headerMediaHandle || fallbackDraft.headerMediaHandle,
      footerText: req.body?.footerText ?? fallbackDraft.footerText,
      buttons: parseArrayInput(req.body?.buttons).length ? parseArrayInput(req.body?.buttons) : fallbackDraft.buttons,
      allowCategoryChange: req.body?.allowCategoryChange !== false,
      adminId: req.admin?._id || null,
    });

    return res.status(201).json({ data: { id: template.id } });
  } catch (error) {
    console.error("Failed to resubmit WhatsApp template:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to resubmit WhatsApp template" });
  }
};

const removeWhatsAppTemplate = async (req, res) => {
  try {
    if (!canManageTemplates(req.admin)) {
      return res.status(403).json({ message: "Access denied: only sales team users can delete templates" });
    }

    const templateId = String(req.params?.templateId || "").trim();
    if (!templateId) {
      return res.status(400).json({ message: "Template id is required" });
    }

    await deleteTemplate({
      templateId,
      adminId: req.admin?._id || null,
    });

    return res.json({ message: "Template deleted" });
  } catch (error) {
    console.error("Failed to delete WhatsApp template:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to delete WhatsApp template" });
  }
};

const getWhatsAppTemplateHistory = async (req, res) => {
  try {
    const templateId = String(req.params?.templateId || "").trim();
    if (!templateId) {
      return res.status(400).json({ message: "Template id is required" });
    }

    const history = await getTemplateHistory({ templateId });
    return res.json({ data: history });
  } catch (error) {
    console.error("Failed to fetch WhatsApp template history:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to fetch template history" });
  }
};

const testSendWhatsAppTemplate = async (req, res) => {
  req.body = {
    ...(req.body || {}),
    type: "template",
    template: {
      ...(parseOptionalJson(req.body?.template) || {}),
      id: String(req.params?.templateId || "").trim(),
    },
  };

  return sendOutgoingMessage(req, res);
};

const assignAgent = async (req, res) => {
  try {
    if (!canManageAssignments(req.admin)) {
      return res.status(403).json({ message: "Access denied: only SalesAdmin or MainAdmin can assign chats" });
    }

    const { conversationId, agentId } = req.body || {};
    if (!conversationId || !agentId) {
      return res.status(400).json({ message: "conversationId and agentId are required" });
    }
    if (!isValidObjectId(conversationId) || !isValidObjectId(agentId)) {
      return res.status(400).json({ message: "Invalid conversationId or agentId" });
    }

    const conversation = await assignConversation({
      conversationId,
      agentId,
      assignedBy: req.admin?._id || null,
      method: "manual",
    });

    await emitConversationEvents(req.app, conversation._id);
    return res.json({ success: true, data: conversation });
  } catch (error) {
    console.error("Failed to assign WhatsApp conversation:", error);
    return res.status(400).json({ message: error.message || "Failed to assign agent" });
  }
};

const setConversationStatus = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.conversationId)) {
      return res.status(400).json({ message: "Invalid conversationId" });
    }

    const { status } = req.body || {};
    if (!["open", "assigned", "closed"].includes(status)) {
      return res.status(400).json({ message: "status must be open, assigned, or closed" });
    }

    const conversation = await WhatsAppConversation.findById(req.params.conversationId).select("_id agentId");
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    if (!canUpdateConversationStatus({ admin: req.admin, conversation })) {
      return res.status(403).json({ message: "Access denied: you cannot update this conversation" });
    }

    const updatedConversation = await updateConversationStatus({
      conversationId: req.params.conversationId,
      status,
    });

    await emitConversationEvents(req.app, updatedConversation._id);
    return res.json({ success: true, data: updatedConversation });
  } catch (error) {
    console.error("Failed to update WhatsApp conversation status:", error);
    return res.status(400).json({ message: error.message || "Failed to update conversation status" });
  }
};

const addConversationNote = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.conversationId)) {
      return res.status(400).json({ message: "Invalid conversationId" });
    }

    const text = String(req.body?.text || "").trim();
    if (!text) {
      return res.status(400).json({ message: "text is required" });
    }

    const actor = getAuthenticatedActor(req);
    const result = await createConversationNote({
      conversationId: req.params.conversationId,
      text,
      authorId: actor?._id || null,
      authorName: actor?.name || actor?.email || "",
    });

    await emitConversationEvents(req.app, result.conversation?._id || req.params.conversationId);

    return res.status(201).json({
      success: true,
      note: result.note,
      conversation: result.conversation,
    });
  } catch (error) {
    console.error("Failed to add WhatsApp conversation note:", error);
    return res.status(400).json({ message: error.message || "Failed to add conversation note" });
  }
};

const updateConversationTags = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.conversationId)) {
      return res.status(400).json({ message: "Invalid conversationId" });
    }

    if (!Array.isArray(req.body?.tags)) {
      return res.status(400).json({ message: "tags must be an array" });
    }

    const result = await replaceConversationTags({
      conversationId: req.params.conversationId,
      tags: req.body.tags,
    });

    await emitConversationEvents(req.app, result.conversation?._id || req.params.conversationId);

    return res.json({
      success: true,
      tags: result.tags,
      conversation: result.conversation,
    });
  } catch (error) {
    console.error("Failed to update WhatsApp conversation tags:", error);
    return res.status(400).json({ message: error.message || "Failed to update conversation tags" });
  }
};

const setConversationLinkedLead = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.conversationId)) {
      return res.status(400).json({ message: "Invalid conversationId" });
    }

    const leadId = req.body?.leadId;
    if (!isValidObjectId(leadId)) {
      return res.status(400).json({ message: "Valid leadId is required" });
    }

    const lead = await findAccessibleLead(req, leadId);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    const conversation = await linkConversationLead({
      conversationId: req.params.conversationId,
      leadId: lead._id,
    });

    await emitConversationEvents(req.app, conversation._id);

    return res.json({
      success: true,
      data: conversation,
      linkedLead: conversation.linkedLead,
    });
  } catch (error) {
    console.error("Failed to link WhatsApp conversation to lead:", error);
    return res.status(error.statusCode || 400).json({ message: error.message || "Failed to link conversation lead" });
  }
};

const sendOutgoingMessage = async (req, res) => {
  try {
    const {
      conversationId,
      contactId,
      phone,
      text,
      type: requestedType = "text",
      template: rawTemplate,
    } = req.body || {};
    const uploadedFile = req.file || null;
    const inferredType = uploadedFile ? inferMediaMessageType(uploadedFile) : null;
    const type = requestedType === "template" ? "template" : inferredType || requestedType;
    let template = rawTemplate;

    if (typeof template === "string") {
      try {
        template = JSON.parse(template);
      } catch (_error) {
        return res.status(400).json({ message: "Invalid template payload" });
      }
    }

    let conversation = null;
    let contact = null;

    if (conversationId) {
      if (!isValidObjectId(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation id" });
      }
      conversation = await WhatsAppConversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      if (!canSendConversationMessage({ admin: req.admin, conversation })) {
        return res.status(403).json({ message: "Access denied: only the assigned SalesStaff member can chat on this conversation" });
      }
      contact = await WhatsAppContact.findById(conversation.contactId);
    } else {
      if (!contactId && !phone) {
        return res.status(400).json({ message: "conversationId or contactId or phone is required" });
      }

      if (!canManageAssignments(req.admin) && !isMainAdmin(req.admin)) {
        return res.status(403).json({ message: "Access denied: only SalesAdmin or MainAdmin can start a new outbound chat" });
      }

      if (contactId) {
        contact = await WhatsAppContact.findById(contactId);
      }

      if (!contact && phone) {
        contact = await upsertContact({
          phone: normalizePhone(phone),
          waId: normalizePhone(phone),
          name: "",
          profile: {},
        });
      }

      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }

      conversation = await ensureConversation({ contactId: contact._id, autoAssign: true });
    }

    if (!contact) {
      return res.status(404).json({ message: "Contact not found" });
    }

    if (type === "text" && !String(text || "").trim()) {
      return res.status(400).json({ message: "text is required for text messages" });
    }

    if (type === "template" && !template?.name && !template?.id && !template?.templateId) {
      return res.status(400).json({ message: "template.name or template.id is required for template messages" });
    }

    if (!["text", "template", ...SUPPORTED_MEDIA_TYPES].includes(type)) {
      return res.status(400).json({ message: "Unsupported WhatsApp message type" });
    }

    const media = uploadedFile
      ? {
          url: uploadedFile.path || uploadedFile.secure_url,
          mimeType: uploadedFile.mimetype,
          filename: uploadedFile.originalname,
          size: uploadedFile.size || 0,
          publicId: uploadedFile.filename || "",
          caption: String(text || "").trim(),
        }
      : null;

    if (type === "template") {
      template = await prepareTemplateMessage({
        template,
        media,
      });
    }

    if (SUPPORTED_MEDIA_TYPES.includes(type) && !media?.url) {
      return res.status(400).json({ message: `attachment is required for ${type} messages` });
    }

    const { payload, response } = await sendMessage({
      to: contact.phone,
      type,
      text,
      template,
      media,
      context: {
        conversationId: conversation._id,
        contactId: contact._id,
        agentId: conversation.agentId || (isSalesStaff(req.admin) ? req.admin?._id : null),
      },
    });

    const savedMessage = await saveOutgoingMessage({
      app: req.app,
      conversation,
      contact,
      agentId: conversation.agentId || (isSalesStaff(req.admin) ? req.admin?._id : null),
      messageType: type,
      content:
        type === "text"
          ? String(text || "").trim()
          : type === "template"
            ? `Template: ${template.name}`
            : String(text || "").trim() || uploadedFile?.originalname || `[${type}]`,
      response,
      requestPayload: payload,
      media,
    });

    const conversationData = await getConversationById(conversation._id);

    return res.status(201).json({
      success: true,
      data: savedMessage,
      conversation: conversationData,
      response,
    });
  } catch (error) {
    console.error("Failed to send WhatsApp message:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to send WhatsApp message" });
  }
};

module.exports = {
  getWebhookChallenge,
  receiveWebhook,
  getConversations,
  getConversationMessages,
  getMessageMedia,
  getAgents,
  getRoundRobinSettings,
  saveRoundRobinSettings,
  getWhatsAppBasicAutomations,
  getWhatsAppBasicAutomationForms,
  getWhatsAppBasicAutomationTemplates,
  getWhatsAppBasicAutomationHistory,
  testWhatsAppBasicAutomation,
  testSendWhatsAppBasicAutomation,
  getWhatsAppForms,
  getWhatsAppForm,
  createWhatsAppFormDefinition,
  updateWhatsAppFormDefinition,
  deleteWhatsAppFormDefinition,
  toggleWhatsAppFormDefinition,
  updateWhatsAppWorkingHours,
  updateWhatsAppOutOfOffice,
  updateWhatsAppWelcomeAutomation,
  updateWhatsAppDelayedResponseAutomation,
  getWhatsAppQuickReplies,
  getWhatsAppQuickReplyFolders,
  getWhatsAppQuickReplySuggestions,
  getWhatsAppQuickReply,
  createWhatsAppQuickReply,
  updateWhatsAppQuickReply,
  deleteWhatsAppQuickReply,
  toggleWhatsAppQuickReply,
  pinWhatsAppQuickReply,
  useWhatsAppQuickReply,
  getTemplates,
  syncWhatsAppTemplates,
  createWhatsAppTemplate,
  uploadWhatsAppTemplateMedia,
  setWhatsAppTemplateDefaultMedia,
  deleteWhatsAppTemplateDefaultMedia,
  resubmitWhatsAppTemplate,
  removeWhatsAppTemplate,
  getWhatsAppTemplateHistory,
  testSendWhatsAppTemplate,
  assignAgent,
  setConversationStatus,
  addConversationNote,
  updateConversationTags,
  setConversationLinkedLead,
  sendOutgoingMessage,
};

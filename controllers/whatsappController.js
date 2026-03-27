const { Types } = require("mongoose");
const AdminUser = require("../models/AdminUser");
const Lead = require("../models/Lead");
const WhatsAppEventLog = require("../models/WhatsAppEventLog");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppContact = require("../models/WhatsAppContact");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const { getAvailableAgents } = require("../services/whatsappAssignmentService");
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
const { listTemplates, createTemplate, uploadTemplateHeaderMedia } = require("../services/whatsappTemplateService");
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
    const allAgents = await AdminUser.find({ role: "SalesStaff" })
      .select("_id name email role whatsappInbox createdAt")
      .sort({ createdAt: 1 })
      .lean();

    return res.json({
      success: true,
      data: allAgents.map((agent) => ({
        ...agent,
        canAutoAssign: autoAssignableAgents.some((item) => String(item._id) === String(agent._id)),
      })),
    });
  } catch (error) {
    console.error("Failed to fetch WhatsApp agents:", error);
    return res.status(500).json({ message: "Failed to fetch agents" });
  }
};

const getTemplates = async (req, res) => {
  try {
    const templates = await listTemplates({
      search: req.query.search || "",
      status: req.query.status || "",
    });
    return res.json({ success: true, data: templates });
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

    const template = await createTemplate({
      name: req.body?.name,
      category: req.body?.category,
      language: req.body?.language,
      bodyText: req.body?.bodyText,
      bodyExamples: Array.isArray(req.body?.bodyExamples) ? req.body.bodyExamples : [],
      headerType: req.body?.headerType,
      headerText: req.body?.headerText,
      headerExamples: Array.isArray(req.body?.headerExamples) ? req.body.headerExamples : [],
      headerMediaHandle: req.body?.headerMediaHandle,
      footerText: req.body?.footerText,
      buttons: Array.isArray(req.body?.buttons) ? req.body.buttons : [],
      allowCategoryChange: req.body?.allowCategoryChange !== false,
    });

    return res.status(201).json({ success: true, data: template });
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

    return res.status(201).json({ success: true, data: media });
  } catch (error) {
    console.error("Failed to upload WhatsApp template media:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to upload WhatsApp template media" });
  }
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
      template,
    } = req.body || {};
    const uploadedFile = req.file || null;
    const inferredType = uploadedFile ? inferMediaMessageType(uploadedFile) : null;
    const type = inferredType || requestedType;

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

    if (type === "template" && !template?.name) {
      return res.status(400).json({ message: "template.name is required for template messages" });
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
    return res.status(500).json({ message: error.message || "Failed to send WhatsApp message" });
  }
};

module.exports = {
  getWebhookChallenge,
  receiveWebhook,
  getConversations,
  getConversationMessages,
  getMessageMedia,
  getAgents,
  getTemplates,
  createWhatsAppTemplate,
  uploadWhatsAppTemplateMedia,
  assignAgent,
  setConversationStatus,
  addConversationNote,
  updateConversationTags,
  setConversationLinkedLead,
  sendOutgoingMessage,
};

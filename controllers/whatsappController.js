const AdminUser = require("../models/AdminUser");
const WhatsAppEventLog = require("../models/WhatsAppEventLog");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppContact = require("../models/WhatsAppContact");
const { getAvailableAgents } = require("../services/whatsappAssignmentService");
const {
  saveInboundMessage,
  saveOutgoingMessage,
  updateMessageStatusFromWebhook,
  listConversations,
  listMessages,
  assignConversation,
  updateConversationStatus,
  emitConversationEvents,
  ensureConversation,
  upsertContact,
} = require("../services/whatsappCRMService");
const { sendMessage } = require("../services/whatsappService");
const { verifyMetaSignature, parseWebhookPayload, normalizePhone } = require("../services/whatsappWebhookService");

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
    });
    return res.json({ success: true, data: conversations });
  } catch (error) {
    console.error("Failed to fetch WhatsApp conversations:", error);
    return res.status(500).json({ message: "Failed to fetch conversations" });
  }
};

const getConversationMessages = async (req, res) => {
  try {
    const conversation = await WhatsAppConversation.findById(req.params.conversationId).select("_id");
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const messages = await listMessages({ conversationId: req.params.conversationId });
    return res.json({ success: true, data: messages });
  } catch (error) {
    console.error("Failed to fetch WhatsApp messages:", error);
    return res.status(500).json({ message: "Failed to fetch messages" });
  }
};

const getAgents = async (_req, res) => {
  try {
    const autoAssignableAgents = await getAvailableAgents();
    const allAgents = await AdminUser.find({})
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

const assignAgent = async (req, res) => {
  try {
    const { conversationId, agentId } = req.body || {};
    if (!conversationId || !agentId) {
      return res.status(400).json({ message: "conversationId and agentId are required" });
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
    const { status } = req.body || {};
    if (!["open", "assigned", "closed"].includes(status)) {
      return res.status(400).json({ message: "status must be open, assigned, or closed" });
    }

    const conversation = await updateConversationStatus({
      conversationId: req.params.conversationId,
      status,
    });

    await emitConversationEvents(req.app, conversation._id);
    return res.json({ success: true, data: conversation });
  } catch (error) {
    console.error("Failed to update WhatsApp conversation status:", error);
    return res.status(400).json({ message: error.message || "Failed to update conversation status" });
  }
};

const sendOutgoingMessage = async (req, res) => {
  try {
    const {
      conversationId,
      contactId,
      phone,
      text,
      type = "text",
      template,
    } = req.body || {};

    let conversation = null;
    let contact = null;

    if (conversationId) {
      conversation = await WhatsAppConversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      contact = await WhatsAppContact.findById(conversation.contactId);
    } else {
      if (!contactId && !phone) {
        return res.status(400).json({ message: "conversationId or contactId or phone is required" });
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

    const { payload, response } = await sendMessage({
      to: contact.phone,
      type,
      text,
      template,
      context: {
        conversationId: conversation._id,
        contactId: contact._id,
        agentId: req.admin?._id || conversation.agentId || null,
      },
    });

    const savedMessage = await saveOutgoingMessage({
      app: req.app,
      conversation,
      contact,
      agentId: req.admin?._id || conversation.agentId || null,
      messageType: type,
      content: type === "text" ? String(text || "").trim() : `Template: ${template.name}`,
      response,
      requestPayload: payload,
    });

    return res.status(201).json({
      success: true,
      data: savedMessage,
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
  getAgents,
  assignAgent,
  setConversationStatus,
  sendOutgoingMessage,
};

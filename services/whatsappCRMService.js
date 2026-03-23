const AdminUser = require("../models/AdminUser");
const WhatsAppContact = require("../models/WhatsAppContact");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const { pickNextAgentRoundRobin } = require("./whatsappAssignmentService");
const { normalizePhone } = require("./whatsappWebhookService");

const conversationPopulate = [
  { path: "contactId", select: "name phone waId lastActivityAt" },
  { path: "agentId", select: "name email role whatsappInbox" },
];

const emitConversationEvents = async (app, conversationId) => {
  const io = app?.get?.("io");
  if (!io || !conversationId) return;

  const conversation = await WhatsAppConversation.findById(conversationId)
    .populate(conversationPopulate)
    .lean();

  if (!conversation) return;
  io.emit("whatsapp:conversation.updated", conversation);
};

const emitMessageEvent = (app, message) => {
  const io = app?.get?.("io");
  if (!io) return;
  io.emit("whatsapp:message.created", message);
};

const upsertContact = async ({ phone, waId, name, profile = {} }) => {
  const normalizedPhone = normalizePhone(phone || waId);
  if (!normalizedPhone) {
    throw new Error("WhatsApp contact phone is required");
  }

  return WhatsAppContact.findOneAndUpdate(
    { phone: normalizedPhone },
    {
      $set: {
        waId: String(waId || normalizedPhone),
        name: name || "",
        profile,
        lastActivityAt: new Date(),
      },
      $setOnInsert: {
        source: "whatsapp",
      },
    },
    {
      new: true,
      upsert: true,
    }
  );
};

const ensureConversation = async ({ contactId, autoAssign = true }) => {
  let conversation = await WhatsAppConversation.findOne({ contactId, channel: "whatsapp" });
  if (conversation) return conversation;

  conversation = await WhatsAppConversation.create({
    contactId,
    status: "open",
    assignmentMethod: "unassigned",
  });

  if (autoAssign) {
    const agent = await pickNextAgentRoundRobin();
    if (agent) {
      conversation.agentId = agent._id;
      conversation.status = "assigned";
      conversation.assignmentMethod = "round_robin";
      conversation.assignmentHistory.push({
        agentId: agent._id,
        assignedBy: null,
        method: "round_robin",
      });
      await conversation.save();
    }
  }

  return conversation;
};

const saveInboundMessage = async ({ app, message }) => {
  const contact = await upsertContact({
    phone: message.phone,
    waId: message.waId,
    name: message.name,
    profile: { name: message.name },
  });

  const conversation = await ensureConversation({ contactId: contact._id, autoAssign: true });

  const externalMessageId = message.messageId || `inbound:${contact.phone}:${message.timestamp.toISOString()}`;
  const savedMessage = await WhatsAppMessage.findOneAndUpdate(
    { externalMessageId },
    {
      $setOnInsert: {
        conversationId: conversation._id,
        contactId: contact._id,
        agentId: conversation.agentId || null,
        sender: "customer",
        direction: "inbound",
        content: message.text || "",
        type: message.type || "text",
        externalMessageId,
        timestamp: message.timestamp || new Date(),
        status: "received",
        metadata: {
          phoneNumberId: message.phoneNumberId || "",
        },
        rawPayload: {
          message: message.rawMessage || {},
          value: message.rawValue || {},
        },
      },
    },
    { new: true, upsert: true }
  );

  conversation.lastMessageAt = savedMessage.timestamp || new Date();
  conversation.lastIncomingAt = savedMessage.timestamp || new Date();
  conversation.lastMessagePreview = savedMessage.content || `[${savedMessage.type}]`;
  conversation.unreadCount = Number(conversation.unreadCount || 0) + 1;

  if (!conversation.agentId) {
    const agent = await pickNextAgentRoundRobin();
    if (agent) {
      conversation.agentId = agent._id;
      conversation.status = "assigned";
      conversation.assignmentMethod = "round_robin";
      conversation.assignmentHistory.push({
        agentId: agent._id,
        assignedBy: null,
        method: "round_robin",
      });
      savedMessage.agentId = agent._id;
      await savedMessage.save();
    }
  }

  await conversation.save();
  emitMessageEvent(app, savedMessage.toObject ? savedMessage.toObject() : savedMessage);
  await emitConversationEvents(app, conversation._id);

  return { contact, conversation, message: savedMessage };
};

const saveOutgoingMessage = async ({
  app,
  conversation,
  contact,
  agentId,
  messageType,
  content,
  response,
  requestPayload,
}) => {
  const externalMessageId = response?.messages?.[0]?.id || "";
  const savedMessage = await WhatsAppMessage.create({
    conversationId: conversation._id,
    contactId: contact._id,
    agentId: agentId || null,
    sender: "agent",
    direction: "outbound",
    content,
    type: messageType,
    externalMessageId,
    timestamp: new Date(),
    status: "sent",
    metadata: {
      contacts: response?.contacts || [],
    },
    rawPayload: {
      requestPayload,
      response,
    },
  });

  conversation.lastMessageAt = savedMessage.timestamp;
  conversation.lastOutgoingAt = savedMessage.timestamp;
  conversation.lastMessagePreview = savedMessage.content || `[${savedMessage.type}]`;
  conversation.unreadCount = 0;
  if (agentId && !conversation.agentId) {
    conversation.agentId = agentId;
    conversation.assignmentMethod = "manual";
    conversation.assignmentHistory.push({
      agentId,
      assignedBy: agentId,
      method: "manual",
    });
  }
  if (conversation.agentId) {
    conversation.status = "assigned";
  }
  await conversation.save();

  await contact.updateOne({
    $set: { lastActivityAt: savedMessage.timestamp },
  });

  emitMessageEvent(app, savedMessage.toObject ? savedMessage.toObject() : savedMessage);
  await emitConversationEvents(app, conversation._id);
  return savedMessage;
};

const updateMessageStatusFromWebhook = async ({ externalMessageId, status, timestamp, rawStatus }) => {
  if (!externalMessageId || !status) return null;
  const message = await WhatsAppMessage.findOne({ externalMessageId });
  if (!message) return null;

  const nextStatus = ["sent", "delivered", "read", "failed"].includes(status) ? status : message.status;
  message.status = nextStatus;
  if (rawStatus?.errors?.length) {
    message.errorMessage = rawStatus.errors.map((item) => item.title || item.message).filter(Boolean).join("; ");
  }
  message.metadata = {
    ...(message.metadata || {}),
    lastStatusWebhookAt: timestamp || new Date(),
    rawStatus,
  };
  await message.save();
  return message;
};

const listConversations = async ({ status, search }) => {
  const query = {};
  if (status) query.status = status;

  if (search) {
    const contacts = await WhatsAppContact.find({
      $or: [
        { phone: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
      ],
    }).select("_id");
    query.contactId = { $in: contacts.map((item) => item._id) };
  }

  return WhatsAppConversation.find(query)
    .populate(conversationPopulate)
    .sort({ lastMessageAt: -1 })
    .lean();
};

const listMessages = async ({ conversationId }) => {
  return WhatsAppMessage.find({ conversationId })
    .sort({ timestamp: 1, createdAt: 1 })
    .lean();
};

const assignConversation = async ({ conversationId, agentId, assignedBy, method = "manual" }) => {
  const agent = await AdminUser.findById(agentId).select("_id name email role");
  if (!agent) {
    throw new Error("Agent not found");
  }

  const conversation = await WhatsAppConversation.findById(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  conversation.agentId = agent._id;
  conversation.status = "assigned";
  conversation.assignmentMethod = method;
  conversation.assignmentHistory.push({
    agentId: agent._id,
    assignedBy: assignedBy || null,
    method: method === "manual" ? "manual" : "system",
  });
  await conversation.save();

  await AdminUser.findByIdAndUpdate(agent._id, {
    $set: { "whatsappInbox.lastAssignedAt": new Date() },
  });

  return conversation;
};

const updateConversationStatus = async ({ conversationId, status }) => {
  const conversation = await WhatsAppConversation.findById(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  conversation.status = status;
  if (status === "closed") {
    conversation.unreadCount = 0;
  }
  await conversation.save();
  return conversation;
};

module.exports = {
  upsertContact,
  ensureConversation,
  saveInboundMessage,
  saveOutgoingMessage,
  updateMessageStatusFromWebhook,
  listConversations,
  listMessages,
  assignConversation,
  updateConversationStatus,
  emitConversationEvents,
};

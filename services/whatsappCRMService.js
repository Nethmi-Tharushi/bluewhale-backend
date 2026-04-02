const AdminUser = require("../models/AdminUser");
const WhatsAppContact = require("../models/WhatsAppContact");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const { pickNextAgentRoundRobin } = require("./whatsappAssignmentService");
const { normalizePhone } = require("./whatsappWebhookService");
const { cacheInboundMedia, sendMessage } = require("./whatsappService");
const { processInboundAutomationEvent } = require("./whatsappAutomationService");
const { handleInboundAutomationEvent } = require("./whatsappBasicAutomationRuntimeService");

const conversationPopulate = [
  { path: "contactId", select: "name phone waId profile lastActivityAt" },
  { path: "agentId", select: "name email role whatsappInbox" },
  {
    path: "linkedLeadId",
    select: "leadNumber name email phone status source company tags assignedTo ownerAdmin teamAdmin createdAt updatedAt",
    populate: [
      { path: "assignedTo", select: "name email role" },
      { path: "ownerAdmin", select: "name email role" },
      { path: "teamAdmin", select: "name email role" },
    ],
  },
  { path: "notes.authorId", select: "name email role" },
];

const toIdString = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const normalizeConversationTags = (tags) => {
  const source = Array.isArray(tags)
    ? tags
    : typeof tags === "string"
      ? tags.split(",")
      : [];

  const seen = new Set();
  const normalized = [];

  for (const tag of source) {
    const trimmed = String(tag || "").trim();
    if (!trimmed) continue;

    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    normalized.push(trimmed);
  }

  return normalized;
};

const buildContactPayload = (contact) => {
  if (!contact || typeof contact !== "object") {
    return {
      name: "",
      phone: "",
      email: "",
    };
  }

  const profile = contact.profile && typeof contact.profile === "object" ? contact.profile : {};

  return {
    name: String(contact.name || profile.name || "").trim(),
    phone: String(contact.phone || contact.waId || "").trim(),
    email: String(contact.email || profile.email || "").trim(),
  };
};

const buildAssignedToPayload = (agent) => {
  const agentId = toIdString(agent);
  if (!agentId) return null;

  if (!agent || typeof agent !== "object") {
    return {
      _id: agentId,
      name: "",
    };
  }

  return {
    _id: agentId,
    name: String(agent.name || "").trim(),
    email: String(agent.email || "").trim(),
    role: String(agent.role || "").trim(),
  };
};

const formatConversationNote = (note) => {
  const base = note?.toObject ? note.toObject() : note;
  if (!base) return null;

  const authorSource =
    base.authorId && typeof base.authorId === "object" && (base.authorId._id || base.authorId.name)
      ? base.authorId
      : null;
  const authorId = toIdString(authorSource?._id || base.authorId);
  const authorName = String(base.authorName || authorSource?.name || "").trim();

  return {
    _id: toIdString(base._id),
    text: String(base.text || ""),
    createdAt: base.createdAt || null,
    author: authorId || authorName
      ? {
          _id: authorId,
          name: authorName,
        }
      : null,
    authorId,
    authorName,
  };
};

const buildLinkedLeadPayload = (lead) => {
  if (!lead || typeof lead !== "object") return null;

  return {
    _id: toIdString(lead._id),
    leadNumber: lead.leadNumber ?? null,
    name: String(lead.name || "").trim(),
    email: String(lead.email || "").trim(),
    phone: String(lead.phone || "").trim(),
    status: String(lead.status || "").trim(),
    source: String(lead.source || "").trim(),
    company: String(lead.company || "").trim(),
    tags: normalizeConversationTags(lead.tags),
    assignedTo: lead.assignedTo || null,
    ownerAdmin: lead.ownerAdmin || null,
    teamAdmin: lead.teamAdmin || null,
    createdAt: lead.createdAt || null,
    updatedAt: lead.updatedAt || null,
  };
};

const formatConversation = (conversation) => {
  const base = conversation?.toObject ? conversation.toObject() : conversation;
  if (!base) return null;

  const contactSource =
    base.contact && typeof base.contact === "object"
      ? base.contact
      : base.contactId && typeof base.contactId === "object"
        ? base.contactId
        : null;
  const assignedSource =
    base.assignedTo && typeof base.assignedTo === "object"
      ? base.assignedTo
      : base.agentId || null;
  const linkedLeadSource =
    base.linkedLead && typeof base.linkedLead === "object"
      ? base.linkedLead
      : base.linkedLeadId && typeof base.linkedLeadId === "object"
        ? base.linkedLeadId
        : null;
  const notes = Array.isArray(base.notes)
    ? base.notes.map(formatConversationNote).filter(Boolean)
    : [];
  const assignedTo = buildAssignedToPayload(assignedSource);
  const assigneeId = assignedTo?._id || toIdString(base.assigneeId) || null;

  return {
    ...base,
    _id: toIdString(base._id),
    contact: buildContactPayload(contactSource),
    lastMessage: {
      content: String(base.lastMessage?.content || base.lastMessagePreview || ""),
      timestamp: base.lastMessage?.timestamp || base.lastMessageAt || null,
    },
    unreadCount: Number(base.unreadCount || 0),
    status: String(base.status || "open"),
    workflowStatus: typeof base.workflowStatus === "string" ? base.workflowStatus : "",
    assigneeId,
    assignedTo,
    linkedLead: buildLinkedLeadPayload(linkedLeadSource),
    tags: normalizeConversationTags(base.tags),
    notes,
    counts: {
      notes: notes.length,
      tasks: Number(base.counts?.tasks || 0),
      meetings: Number(base.counts?.meetings || 0),
    },
  };
};

const getConversationById = async (conversationId) => {
  const conversation = await WhatsAppConversation.findById(conversationId)
    .populate(conversationPopulate)
    .lean();

  return formatConversation(conversation);
};

const emitConversationEvents = async (app, conversationId) => {
  const io = app?.get?.("io");
  if (!io || !conversationId) return;

  const conversation = await getConversationById(conversationId);
  if (!conversation) return;
  io.emit("whatsapp:conversation.updated", conversation);
};

const emitMessageEvent = (app, message) => {
  const io = app?.get?.("io");
  if (!io) return;
  io.emit("whatsapp:message.created", message);
};

const isSalesStaff = (admin) => String(admin?.role || "") === "SalesStaff";

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

const ensureConversation = async ({ contactId, autoAssign = true, returnMeta = false }) => {
  let conversation = await WhatsAppConversation.findOne({ contactId, channel: "whatsapp" });

  if (conversation) {
    return returnMeta ? { conversation, isNewConversation: false } : conversation;
  }

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

  return returnMeta ? { conversation, isNewConversation: true } : conversation;
};

const toPlainState = (value) => {
  if (!value) return {};
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};

const dispatchAutomationMessage = async ({
  app,
  conversation,
  contact,
  automationKey,
  messageType = "text",
  text,
  template = null,
  interactive = null,
  content = "",
  deliveryMeta = {},
}) => {
  const normalizedType = ["template", "interactive"].includes(messageType) ? messageType : "text";
  const trimmedText = String(text || "").trim();
  const normalizedContent =
    normalizedType === "template"
      ? String(content || `Template: ${template?.name || deliveryMeta?.templateName || automationKey}`).trim()
      : normalizedType === "interactive"
        ? String(content || trimmedText || `[interactive:${deliveryMeta?.replyActionType || "flow"}]`).trim()
        : trimmedText;

  if (!normalizedContent) {
    return null;
  }

  const { payload, response } = await sendMessage({
    to: contact.phone,
    type: normalizedType,
    text: normalizedType === "text" ? trimmedText : undefined,
    template: normalizedType === "template" ? template : undefined,
    interactive: normalizedType === "interactive" ? interactive : undefined,
    context: {
      conversationId: conversation._id,
      contactId: contact._id,
      agentId: conversation.agentId || null,
      automationKey,
      source: "basic_automation",
    },
  });

  return saveOutgoingMessage({
    app,
    conversation,
    contact,
    agentId: conversation.agentId || null,
    messageType: normalizedType,
    content: normalizedContent,
    response,
    requestPayload: payload,
    sender: "system",
    additionalMetadata: {
      automation: {
        key: automationKey,
        ...(deliveryMeta || {}),
      },
    },
  });
};

const saveInboundMessage = async ({ app, message }) => {
  let inboundMedia = message.media || null;

  if (inboundMedia?.id && !inboundMedia?.url) {
    try {
      const cachedMedia = await cacheInboundMedia({
        mediaId: inboundMedia.id,
        mimeType: inboundMedia.mimeType || "",
        filename: inboundMedia.filename || "",
      });

      inboundMedia = {
        ...inboundMedia,
        ...cachedMedia,
      };
    } catch (error) {
      console.error("Failed to cache inbound WhatsApp media:", error);
    }
  }

  const contact = await upsertContact({
    phone: message.phone,
    waId: message.waId,
    name: message.name,
    profile: { name: message.name },
  });

  const existingConversation = await WhatsAppConversation.findOne({ contactId: contact._id, channel: "whatsapp" }).select("_id");
  const {
    conversation,
    isNewConversation,
  } = await ensureConversation({ contactId: contact._id, autoAssign: true, returnMeta: true });
  const previousConversationStatus = String(conversation.status || "open");
  const previousAutomationState = toPlainState(conversation.automationState);

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
          media: inboundMedia,
          interactiveReply: message.interactiveReply || null,
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
  conversation.automationState = {
    ...toPlainState(conversation.automationState),
    lastCustomerMessageAt: savedMessage.timestamp || new Date(),
    lastCustomerMessageId: savedMessage._id,
  };

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
  try {
    await processInboundAutomationEvent({
      app,
      conversation,
      contact,
      inboundMessage: savedMessage,
      isNewConversation,
    });
  } catch (error) {
    console.error("Failed to process WhatsApp automations:", error);
  }

  try {
    await handleInboundAutomationEvent({
      app,
      conversation,
      contact,
      inboundMessage: savedMessage,
      isNewConversation,
      previousConversationStatus,
      previousAutomationState,
      dispatchAutomationMessage,
    });
  } catch (error) {
    console.error("Failed to process inbound WhatsApp automations:", error);
  }

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
  media = null,
  sender = "agent",
  additionalMetadata = null,
}) => {
  const externalMessageId = response?.messages?.[0]?.id || "";
  const messageTimestamp = new Date();
  const savedMessage = await WhatsAppMessage.create({
    conversationId: conversation._id,
    contactId: contact._id,
    agentId: agentId || null,
    sender,
    direction: "outbound",
    content,
    type: messageType,
    externalMessageId,
    timestamp: messageTimestamp,
    status: "sent",
    metadata: {
      contacts: response?.contacts || [],
      media: media || null,
      ...(additionalMetadata || {}),
    },
    rawPayload: {
      requestPayload,
      response,
    },
  });

  conversation.lastMessageAt = savedMessage.timestamp;
  conversation.lastOutgoingAt = savedMessage.timestamp;
  conversation.lastMessagePreview = savedMessage.content || `[${savedMessage.type}]`;
  if (sender !== "system") {
    conversation.unreadCount = 0;
    conversation.automationState = {
      ...toPlainState(conversation.automationState),
      lastTeamReplyAt: messageTimestamp,
      delayedResponse: {
        ...toPlainState(conversation.automationState?.delayedResponse),
        waitingForTeamReply: false,
        pendingSince: null,
        dueAt: null,
        pendingMessageId: null,
        resolvedAt: messageTimestamp,
      },
    };
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

const listConversations = async ({ status, search, admin }) => {
  const query = {};
  if (status) query.status = status;
  if (isSalesStaff(admin)) {
    query.agentId = admin._id;
  }

  if (search) {
    const contacts = await WhatsAppContact.find({
      $or: [
        { phone: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
      ],
    }).select("_id");
    query.contactId = { $in: contacts.map((item) => item._id) };
  }

  const conversations = await WhatsAppConversation.find(query)
    .populate(conversationPopulate)
    .sort({ lastMessageAt: -1 })
    .lean();

  return conversations.map((conversation) => formatConversation(conversation));
};

const listMessages = async ({ conversationId, admin }) => {
  const conversation = await WhatsAppConversation.findById(conversationId).select("_id agentId");
  if (!conversation) {
    return [];
  }

  if (isSalesStaff(admin) && String(conversation.agentId || "") !== String(admin._id || "")) {
    throw new Error("Access denied: conversation is not assigned to you");
  }

  return WhatsAppMessage.find({ conversationId })
    .sort({ timestamp: 1, createdAt: 1 })
    .lean();
};

const assignConversation = async ({ conversationId, agentId, assignedBy, method = "manual" }) => {
  const agent = await AdminUser.findById(agentId).select("_id name email role");
  if (!agent) {
    throw new Error("Agent not found");
  }
  if (agent.role !== "SalesStaff") {
    throw new Error("WhatsApp chats can only be assigned to SalesStaff members");
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

  return getConversationById(conversation._id);
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
  return getConversationById(conversation._id);
};

const addConversationNote = async ({ conversationId, text, authorId = null, authorName = "" }) => {
  const conversation = await WhatsAppConversation.findById(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  conversation.notes.push({
    text: String(text || "").trim(),
    authorId: authorId || null,
    authorName: String(authorName || "").trim(),
  });
  await conversation.save();

  const note = conversation.notes[conversation.notes.length - 1];

  return {
    note: formatConversationNote(note),
    conversation: await getConversationById(conversation._id),
  };
};

const replaceConversationTags = async ({ conversationId, tags }) => {
  const conversation = await WhatsAppConversation.findById(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  conversation.tags = normalizeConversationTags(tags);
  await conversation.save();

  return {
    tags: conversation.tags,
    conversation: await getConversationById(conversation._id),
  };
};

const linkConversationLead = async ({ conversationId, leadId }) => {
  const conversation = await WhatsAppConversation.findById(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  conversation.linkedLeadId = leadId;
  await conversation.save();

  return getConversationById(conversation._id);
};

module.exports = {
  upsertContact,
  ensureConversation,
  dispatchAutomationMessage,
  saveInboundMessage,
  saveOutgoingMessage,
  updateMessageStatusFromWebhook,
  listConversations,
  listMessages,
  assignConversation,
  updateConversationStatus,
  addConversationNote,
  replaceConversationTags,
  linkConversationLead,
  emitConversationEvents,
  getConversationById,
  formatConversation,
  formatConversationNote,
  normalizeConversationTags,
};

const cron = require("node-cron");
const WhatsAppContact = require("../models/WhatsAppContact");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const { sendMessage } = require("../services/whatsappService");
const { saveOutgoingMessage } = require("../services/whatsappCRMService");
const { processDueDelayedResponseAutomations } = require("../services/whatsappBasicAutomationRuntimeService");

const buildDispatchAutomationMessage = () => async ({
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
  const resolvedConversation =
    conversation?.contactId
      ? conversation
      : await WhatsAppConversation.findById(conversation?._id || conversation).select("_id contactId agentId status unreadCount lastMessageAt lastOutgoingAt lastMessagePreview assignmentMethod assignmentHistory automationState");
  const resolvedContact =
    contact?.phone
      ? contact
      : await WhatsAppContact.findById(contact?._id || resolvedConversation?.contactId).select("_id phone waId name profile");

  if (!resolvedConversation || !resolvedContact?.phone) {
    return null;
  }

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
    to: resolvedContact.phone,
    type: normalizedType,
    text: normalizedType === "text" ? trimmedText : undefined,
    template: normalizedType === "template" ? template : undefined,
    interactive: normalizedType === "interactive" ? interactive : undefined,
    context: {
      conversationId: resolvedConversation._id,
      contactId: resolvedContact._id,
      agentId: resolvedConversation.agentId || null,
      automationKey,
      source: "basic_automation_job",
    },
  });

  return saveOutgoingMessage({
    app,
    conversation: resolvedConversation,
    contact: resolvedContact,
    agentId: resolvedConversation.agentId || null,
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

cron.schedule("* * * * *", async () => {
  try {
    const result = await processDueDelayedResponseAutomations({
      app: null,
      dispatchAutomationMessage: buildDispatchAutomationMessage(),
    });

    if (result.processed || result.sent || result.skipped) {
      console.log(`[WhatsAppDelayedResponseJob] processed=${result.processed} sent=${result.sent} skipped=${result.skipped}`);
    }
  } catch (error) {
    console.error("[WhatsAppDelayedResponseJob] Error while processing delayed responses:", error);
  }
});

const express = require("express");
const router = express.Router();

const {
  getWebhookChallenge,
  receiveWebhook,
  getConversations,
  getConversationMessages,
  getMessageMedia,
  getAgents,
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
} = require("../controllers/whatsappController");
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const whatsappUpload = require("../middlewares/whatsappUpload");
const whatsappTemplateMediaUpload = require("../middlewares/whatsappTemplateMediaUpload");

router.get("/webhook", getWebhookChallenge);
router.post("/webhook", receiveWebhook);

router.get("/conversations", protectAdmin, authorizeAdmin(), getConversations);
router.get("/messages/:conversationId", protectAdmin, authorizeAdmin(), getConversationMessages);
router.get("/messages/:messageId/media", protectAdmin, authorizeAdmin(), getMessageMedia);

router.get("/agents", protectAdmin, authorizeAdmin(), getAgents);
router.get("/templates", protectAdmin, authorizeAdmin(), getTemplates);
router.post("/templates/sync", protectAdmin, authorizeAdmin(), syncWhatsAppTemplates);
router.post("/templates", protectAdmin, authorizeAdmin(), createWhatsAppTemplate);
router.post("/templates/media", protectAdmin, authorizeAdmin(), whatsappTemplateMediaUpload.single("file"), uploadWhatsAppTemplateMedia);
router.get("/templates/:templateId/history", protectAdmin, authorizeAdmin(), getWhatsAppTemplateHistory);
router.post("/templates/:templateId/resubmit", protectAdmin, authorizeAdmin(), resubmitWhatsAppTemplate);
router.post("/templates/:templateId/test-send", protectAdmin, authorizeAdmin(), whatsappUpload.single("attachment"), testSendWhatsAppTemplate);
router.post("/templates/:templateId/default-media", protectAdmin, authorizeAdmin(), whatsappTemplateMediaUpload.single("file"), setWhatsAppTemplateDefaultMedia);
router.delete("/templates/:templateId/default-media", protectAdmin, authorizeAdmin(), deleteWhatsAppTemplateDefaultMedia);
router.delete("/templates/:templateId", protectAdmin, authorizeAdmin(), removeWhatsAppTemplate);

router.post("/assign-agent", protectAdmin, authorizeAdmin(), assignAgent);
router.post("/send-message", protectAdmin, authorizeAdmin(), whatsappUpload.single("attachment"), sendOutgoingMessage);
router.post("/conversations/:conversationId/status", protectAdmin, authorizeAdmin(), setConversationStatus);
router.post("/conversations/:conversationId/notes", protectAdmin, authorizeAdmin(), addConversationNote);
router.put("/conversations/:conversationId/tags", protectAdmin, authorizeAdmin(), updateConversationTags);
router.patch("/conversations/:conversationId/link-lead", protectAdmin, authorizeAdmin(), setConversationLinkedLead);

module.exports = router;

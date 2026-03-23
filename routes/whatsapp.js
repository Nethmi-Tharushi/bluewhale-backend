const express = require("express");
const router = express.Router();

const {
  getWebhookChallenge,
  receiveWebhook,
  getConversations,
  getConversationMessages,
  getMessageMedia,
  getAgents,
  assignAgent,
  setConversationStatus,
  sendOutgoingMessage,
} = require("../controllers/whatsappController");
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const whatsappUpload = require("../middlewares/whatsappUpload");

router.get("/webhook", getWebhookChallenge);
router.post("/webhook", receiveWebhook);

router.get("/conversations", protectAdmin, authorizeAdmin(), getConversations);
router.get("/messages/:conversationId", protectAdmin, authorizeAdmin(), getConversationMessages);
router.get("/messages/:messageId/media", protectAdmin, authorizeAdmin(), getMessageMedia);
router.get("/agents", protectAdmin, authorizeAdmin(), getAgents);
router.post("/assign-agent", protectAdmin, authorizeAdmin(), assignAgent);
router.post("/send-message", protectAdmin, authorizeAdmin(), whatsappUpload.single("attachment"), sendOutgoingMessage);
router.post("/conversations/:conversationId/status", protectAdmin, authorizeAdmin(), setConversationStatus);

module.exports = router;

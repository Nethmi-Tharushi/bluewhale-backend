const express = require("express");
const router = express.Router();

const {
  getWebhookChallenge,
  receiveWebhook,
  getConversations,
  getConversationMessages,
  getMessageMedia,
  getAgents,
  getAgentAnalytics,
  getRoundRobinSettings,
  saveRoundRobinSettings,
  getWhatsAppBasicAutomations,
  getWhatsAppCampaigns,
  getWhatsAppCampaignAudienceResources,
  getWhatsAppCampaignAudienceContacts,
  getWhatsAppCampaign,
  createWhatsAppCampaignRecord,
  updateWhatsAppCampaignRecord,
  testSendWhatsAppCampaignRecord,
  launchWhatsAppCampaignRecord,
  pauseWhatsAppCampaignRecord,
  resumeWhatsAppCampaignRecord,
  cancelWhatsAppCampaignRecord,
  deleteWhatsAppCampaignRecord,
  duplicateWhatsAppCampaignRecord,
  getWhatsAppBasicAutomationForms,
  getWhatsAppBasicAutomationInteractiveLists,
  getWhatsAppBasicAutomationProductCollections,
  getWhatsAppBasicAutomationTemplates,
  getWhatsAppBasicAutomationHistory,
  testWhatsAppBasicAutomation,
  testSendWhatsAppBasicAutomation,
  getWhatsAppInteractiveLists,
  getWhatsAppProductCollections,
  createWhatsAppProductCollection,
  updateWhatsAppProductCollection,
  toggleWhatsAppProductCollection,
  deleteWhatsAppProductCollection,
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
  resetConversation,
  sendOutgoingMessage,
} = require("../controllers/whatsappController");
const {
  listContactHub,
  createContactHubRecord,
  updateContactHubRecord,
  updateContactHubStatus,
  bulkUpdateContactHub,
  exportContactHubCsv,
  getContactHubMeta,
} = require("../controllers/whatsappContactHubController");
const {
  getWhatsAppProfile,
  updateWhatsAppProfile,
  uploadWhatsAppProfileLogo,
  removeWhatsAppProfileLogo,
} = require("../controllers/whatsappProfileController");
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const {
  validateIdParam,
  validateCreateBody,
  validateUpdateBody,
  validateStatusBody,
  validateBulkBody,
} = require("../middlewares/whatsappContactHubValidation");
const {
  validateWhatsAppProfileBody,
} = require("../middlewares/whatsappProfileValidation");
const whatsappUpload = require("../middlewares/whatsappUpload");
const whatsappTemplateMediaUpload = require("../middlewares/whatsappTemplateMediaUpload");
const {
  uploadWhatsAppProfileLogo: uploadWhatsAppProfileLogoMiddleware,
} = require("../middlewares/whatsappProfileLogoUpload");

router.get("/webhook", getWebhookChallenge);
router.post("/webhook", receiveWebhook);

router.get("/conversations", protectAdmin, authorizeAdmin(), getConversations);
router.get("/messages/:messageId/media", protectAdmin, authorizeAdmin(), getMessageMedia);
router.get("/messages/:conversationId", protectAdmin, authorizeAdmin(), getConversationMessages);

router.get("/agents", protectAdmin, authorizeAdmin(), getAgents);
router.get("/agent-analytics", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), getAgentAnalytics);
router.get("/assignment-settings", protectAdmin, authorizeAdmin(), getRoundRobinSettings);
router.put("/assignment-settings", protectAdmin, authorizeAdmin(), saveRoundRobinSettings);
router.get("/profile", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), getWhatsAppProfile);
router.put("/profile", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), validateWhatsAppProfileBody, updateWhatsAppProfile);
router.post("/profile/logo", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), uploadWhatsAppProfileLogoMiddleware, uploadWhatsAppProfileLogo);
router.delete("/profile/logo", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), removeWhatsAppProfileLogo);
router.get("/contact-hub/meta", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), getContactHubMeta);
router.get("/contact-hub/export", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), exportContactHubCsv);
router.get("/contact-hub", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), listContactHub);
router.post("/contact-hub", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), validateCreateBody, createContactHubRecord);
router.post("/contact-hub/bulk", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), validateBulkBody, bulkUpdateContactHub);
router.patch("/contact-hub/:id/status", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), validateIdParam, validateStatusBody, updateContactHubStatus);
router.patch("/contact-hub/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), validateIdParam, validateUpdateBody, updateContactHubRecord);
router.get("/campaigns", protectAdmin, authorizeAdmin(), getWhatsAppCampaigns);
router.get("/campaigns/audience-resources", protectAdmin, authorizeAdmin(), getWhatsAppCampaignAudienceResources);
router.get("/campaigns/audience-contacts", protectAdmin, authorizeAdmin(), getWhatsAppCampaignAudienceContacts);
router.get("/campaigns/:id", protectAdmin, authorizeAdmin(), getWhatsAppCampaign);
router.post("/campaigns", protectAdmin, authorizeAdmin(), createWhatsAppCampaignRecord);
router.put("/campaigns/:id", protectAdmin, authorizeAdmin(), updateWhatsAppCampaignRecord);
router.post("/campaigns/:id/test-send", protectAdmin, authorizeAdmin(), testSendWhatsAppCampaignRecord);
router.post("/campaigns/:id/launch", protectAdmin, authorizeAdmin(), launchWhatsAppCampaignRecord);
router.post("/campaigns/:id/pause", protectAdmin, authorizeAdmin(), pauseWhatsAppCampaignRecord);
router.post("/campaigns/:id/resume", protectAdmin, authorizeAdmin(), resumeWhatsAppCampaignRecord);
router.post("/campaigns/:id/cancel", protectAdmin, authorizeAdmin(), cancelWhatsAppCampaignRecord);
router.post("/campaigns/:id/duplicate", protectAdmin, authorizeAdmin(), duplicateWhatsAppCampaignRecord);
router.delete("/campaigns/:id", protectAdmin, authorizeAdmin(), deleteWhatsAppCampaignRecord);
router.get("/basic-automations", protectAdmin, authorizeAdmin(), getWhatsAppBasicAutomations);
router.get("/basic-automations/forms", protectAdmin, authorizeAdmin(), getWhatsAppBasicAutomationForms);
router.get("/basic-automations/interactive-lists", protectAdmin, authorizeAdmin(), getWhatsAppBasicAutomationInteractiveLists);
router.get("/basic-automations/product-collections", protectAdmin, authorizeAdmin(), getWhatsAppBasicAutomationProductCollections);
router.get("/basic-automations/templates", protectAdmin, authorizeAdmin(), getWhatsAppBasicAutomationTemplates);
router.get("/basic-automations/history", protectAdmin, authorizeAdmin(), getWhatsAppBasicAutomationHistory);
router.post("/basic-automations/test", protectAdmin, authorizeAdmin(), testWhatsAppBasicAutomation);
router.post("/basic-automations/test-send", protectAdmin, authorizeAdmin(), testSendWhatsAppBasicAutomation);
router.get("/interactive-lists", protectAdmin, authorizeAdmin(), getWhatsAppInteractiveLists);
router.get("/product-collections", protectAdmin, authorizeAdmin(), getWhatsAppProductCollections);
router.post("/product-collections", protectAdmin, authorizeAdmin(), createWhatsAppProductCollection);
router.put("/product-collections/:id", protectAdmin, authorizeAdmin(), updateWhatsAppProductCollection);
router.patch("/product-collections/:id/toggle", protectAdmin, authorizeAdmin(), toggleWhatsAppProductCollection);
router.delete("/product-collections/:id", protectAdmin, authorizeAdmin(), deleteWhatsAppProductCollection);
router.get("/forms", protectAdmin, authorizeAdmin(), getWhatsAppForms);
router.get("/forms/:id", protectAdmin, authorizeAdmin(), getWhatsAppForm);
router.post("/forms", protectAdmin, authorizeAdmin(), createWhatsAppFormDefinition);
router.put("/forms/:id", protectAdmin, authorizeAdmin(), updateWhatsAppFormDefinition);
router.delete("/forms/:id", protectAdmin, authorizeAdmin(), deleteWhatsAppFormDefinition);
router.patch("/forms/:id/toggle", protectAdmin, authorizeAdmin(), toggleWhatsAppFormDefinition);
router.put("/basic-automations/working-hours", protectAdmin, authorizeAdmin(), updateWhatsAppWorkingHours);
router.put("/basic-automations/out-of-office", protectAdmin, authorizeAdmin(), updateWhatsAppOutOfOffice);
router.put("/basic-automations/welcome", protectAdmin, authorizeAdmin(), updateWhatsAppWelcomeAutomation);
router.put("/basic-automations/delayed-response", protectAdmin, authorizeAdmin(), updateWhatsAppDelayedResponseAutomation);
router.get("/quick-replies/folders", protectAdmin, authorizeAdmin(), getWhatsAppQuickReplyFolders);
router.get("/quick-replies/suggestions", protectAdmin, authorizeAdmin(), getWhatsAppQuickReplySuggestions);
router.get("/quick-replies", protectAdmin, authorizeAdmin(), getWhatsAppQuickReplies);
router.get("/quick-replies/:id", protectAdmin, authorizeAdmin(), getWhatsAppQuickReply);
router.post("/quick-replies", protectAdmin, authorizeAdmin(), createWhatsAppQuickReply);
router.put("/quick-replies/:id", protectAdmin, authorizeAdmin(), updateWhatsAppQuickReply);
router.delete("/quick-replies/:id", protectAdmin, authorizeAdmin(), deleteWhatsAppQuickReply);
router.patch("/quick-replies/:id/toggle", protectAdmin, authorizeAdmin(), toggleWhatsAppQuickReply);
router.patch("/quick-replies/:id/pin", protectAdmin, authorizeAdmin(), pinWhatsAppQuickReply);
router.post("/quick-replies/:id/use", protectAdmin, authorizeAdmin(), useWhatsAppQuickReply);
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
router.post("/conversations/:conversationId/reset", protectAdmin, authorizeAdmin(), resetConversation);

module.exports = router;

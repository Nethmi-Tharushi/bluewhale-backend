const express = require("express");

const router = express.Router();

const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const {
  getWhatsAppAiAgent,
  updateWhatsAppAiAgent,
  submitWhatsAppAiAgentInterest,
  getWhatsAppAiAgentInterests,
  patchWhatsAppAiAgentInterestStatus,
  patchWhatsAppAiAgentInterest,
  testWhatsAppAiAgent,
  getWhatsAppAiAgentHistory,
} = require("../controllers/whatsappAiAgentController");

router.get("/", protectAdmin, authorizeAdmin(), getWhatsAppAiAgent);
router.put("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), updateWhatsAppAiAgent);
router.post("/interest", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), submitWhatsAppAiAgentInterest);
router.get("/interests", protectAdmin, authorizeAdmin(), getWhatsAppAiAgentInterests);
router.patch("/interests/:id/status", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), patchWhatsAppAiAgentInterestStatus);
router.patch("/interests/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), patchWhatsAppAiAgentInterest);
router.post("/test", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), testWhatsAppAiAgent);
router.get("/history", protectAdmin, authorizeAdmin(), getWhatsAppAiAgentHistory);

module.exports = router;

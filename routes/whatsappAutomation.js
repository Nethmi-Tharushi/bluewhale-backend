const express = require("express");
const router = express.Router();

const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const {
  getWhatsAppAutomations,
  createWhatsAppAutomation,
  updateWhatsAppAutomation,
  setWhatsAppAutomationEnabled,
  removeWhatsAppAutomation,
} = require("../controllers/whatsappAutomationController");

router.get("/", protectAdmin, authorizeAdmin(), getWhatsAppAutomations);
router.post("/", protectAdmin, authorizeAdmin(), createWhatsAppAutomation);
router.put("/:automationId", protectAdmin, authorizeAdmin(), updateWhatsAppAutomation);
router.patch("/:automationId/enabled", protectAdmin, authorizeAdmin(), setWhatsAppAutomationEnabled);
router.delete("/:automationId", protectAdmin, authorizeAdmin(), removeWhatsAppAutomation);

module.exports = router;

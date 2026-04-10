const express = require("express");

const router = express.Router();

const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const {
  getWhatsAppAiIntentMatching,
  updateWhatsAppAiIntentMatching,
  getWhatsAppAiIntentMatchingHistory,
  testWhatsAppAiIntentMatching,
} = require("../controllers/whatsappAiIntentMatchingController");

router.get("/", protectAdmin, authorizeAdmin(), getWhatsAppAiIntentMatching);
router.put("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), updateWhatsAppAiIntentMatching);
router.get("/history", protectAdmin, authorizeAdmin(), getWhatsAppAiIntentMatchingHistory);
router.post("/test", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), testWhatsAppAiIntentMatching);

module.exports = router;

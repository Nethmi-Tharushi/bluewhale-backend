const express = require("express");

const {
  receiveMetaLeadAdsWebhookHandler,
  verifyMetaLeadAdsWebhookHandler,
} = require("../controllers/metaLeadAdsController");

const router = express.Router();

router.get("/webhook", verifyMetaLeadAdsWebhookHandler);
router.post("/webhook", receiveMetaLeadAdsWebhookHandler);

module.exports = router;

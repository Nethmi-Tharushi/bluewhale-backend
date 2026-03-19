const express = require("express");
const router = express.Router();
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const { listCampaigns, createCampaign, updateCampaign, deleteCampaign } = require("../controllers/campaignController");

router.get("/", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), listCampaigns);
router.post("/", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), createCampaign);
router.put("/:id", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), updateCampaign);
router.delete("/:id", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), deleteCampaign);

module.exports = router;

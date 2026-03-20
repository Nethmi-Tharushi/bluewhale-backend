const express = require("express");
const router = express.Router();
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const { listCampaigns, createCampaign, updateCampaign, deleteCampaign } = require("../controllers/campaignController");

router.get("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), listCampaigns);
router.post("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), createCampaign);
router.put("/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), updateCampaign);
router.delete("/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), deleteCampaign);

module.exports = router;

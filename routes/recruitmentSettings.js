const express = require("express");
const router = express.Router();
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const {
  getRecruitmentSettings,
  createSectionItem,
  updateSectionItem,
  deleteSectionItem,
  updateOtherSettings,
} = require("../controllers/recruitmentSettingsController");

router.get("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), getRecruitmentSettings);
router.put("/other/settings", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), updateOtherSettings);
router.post("/:section", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), createSectionItem);
router.put("/:section/:itemId", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), updateSectionItem);
router.delete("/:section/:itemId", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), deleteSectionItem);

module.exports = router;

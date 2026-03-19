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

router.get("/", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), getRecruitmentSettings);
router.put("/other/settings", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), updateOtherSettings);
router.post("/:section", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), createSectionItem);
router.put("/:section/:itemId", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), updateSectionItem);
router.delete("/:section/:itemId", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), deleteSectionItem);

module.exports = router;

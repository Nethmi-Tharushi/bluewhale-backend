const express = require("express");
const router = express.Router();
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const {
  getFullReport,
  getDashboardSummary,
  getMigrationStatusSummary,
  getReportsOverview,
} = require("../controllers/reportController");

router.get("/summary", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), getDashboardSummary);
router.get("/migration-status", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), getMigrationStatusSummary);
router.get("/overview", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), getReportsOverview);
router.get("/full", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), getFullReport);

module.exports = router;

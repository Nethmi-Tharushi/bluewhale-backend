const express = require("express");
const router = express.Router();

const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const { getSalesCrmReports } = require("../controllers/salesCrmReportController");

router.get("/reports", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), getSalesCrmReports);

module.exports = router;

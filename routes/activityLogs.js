const express = require("express");
const router = express.Router();
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const { createActivityLog, getActivityLogs } = require("../controllers/activityLogController");

router.get("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), getActivityLogs);
router.post("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), createActivityLog);

module.exports = router;

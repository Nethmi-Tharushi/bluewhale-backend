const express = require("express");
const {
  getNotificationSettings,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationSettings,
} = require("../controllers/notificationController");
const { authorizeAdmin, protectAdmin } = require("../middlewares/AdminAuth");

const router = express.Router();

router.get("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), listNotifications);
router.get("/settings", protectAdmin, authorizeAdmin("MainAdmin"), getNotificationSettings);
router.put("/settings", protectAdmin, authorizeAdmin("MainAdmin"), updateNotificationSettings);
router.patch("/read-all", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), markAllNotificationsRead);
router.patch("/:id/read", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), markNotificationRead);

module.exports = router;

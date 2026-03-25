// server/routes/chat.js
const express = require("express");
const router = express.Router();

const {
  getAdminMessages,
  getUserMessages,
  getAssignedAdmin,
  getAdminsForUser,
  getUsersForAdmin,
  getInternalAdminsForAdmin,
  getInternalAdminMessages,
  sendMessageToAdmin,
  sendMessageToInternalAdmin,
  sendMessageToUser,
} = require("../controllers/chatController");

const { protect, protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");

// --- USER ROUTES ---
router.get("/me", protect, getAssignedAdmin);
router.get("/admins", protect, getAdminsForUser);
router.get("/messages/:adminId", protect, getUserMessages);
router.get("/user/messages/:adminId", protect, getUserMessages);
router.post("/user/messages/:adminId", protect, sendMessageToAdmin);
router.post("/me/messages/:adminId", protect, sendMessageToAdmin);
router.post("/messages/:adminId/send", protect, sendMessageToAdmin);
router.post("/messages", protect, sendMessageToAdmin);

// --- ADMIN ROUTES (OLD paths kept for compatibility) ---
router.get("/users", protectAdmin, authorizeAdmin(), getUsersForAdmin);
router.get("/messages/:userId", protectAdmin, authorizeAdmin(), getAdminMessages);
router.post("/messages/:userId", protectAdmin, authorizeAdmin(), sendMessageToUser);

// --- ADMIN ROUTES (NEW paths to match your frontend) ---
router.get("/admin/users", protectAdmin, authorizeAdmin(), getUsersForAdmin);
router.get("/admin/messages/:userId", protectAdmin, authorizeAdmin(), getAdminMessages);
router.post("/admin/messages/:userId", protectAdmin, authorizeAdmin(), sendMessageToUser);
router.get("/admin/internal/contacts", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), getInternalAdminsForAdmin);
router.get("/admin/internal/messages/:adminId", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), getInternalAdminMessages);
router.post("/admin/internal/messages/:adminId", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), sendMessageToInternalAdmin);

module.exports = router;

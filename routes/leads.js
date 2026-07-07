const express = require("express");
const router = express.Router();
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const {
  getLeadMeta,
  listLeads,
  getLeadById,
  createLead,
  assignLead,
  bulkAssignLeads,
  updateLead,
  updateLeadStatus,
  addLeadNote,
  listLeadReminders,
  createLeadReminder,
  deleteLeadReminder,
  deleteLead,
  createWalkInLead,
  getMyWalkInLeadSummary,
  listMyWalkInLeads,
  getMyWalkInLeadById,
  syncPortalUsersToLeads,
} = require("../controllers/leadController");

router.get("/meta", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), getLeadMeta);
router.get("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), listLeads);
router.get("/walk-ins/my-summary", protectAdmin, authorizeAdmin("Receptionist"), getMyWalkInLeadSummary);
router.get("/walk-ins/my-leads", protectAdmin, authorizeAdmin("Receptionist"), listMyWalkInLeads);
router.get("/walk-ins/my-leads/:id", protectAdmin, authorizeAdmin("Receptionist"), getMyWalkInLeadById);
router.post("/walk-ins", protectAdmin, authorizeAdmin("Receptionist"), createWalkInLead);
router.post("/sync-portal-users", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), syncPortalUsersToLeads);
router.post("/bulk-assign", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), bulkAssignLeads);
router.get("/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), getLeadById);
router.post("/:id/notes", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), addLeadNote);
router.get("/:id/reminders", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), listLeadReminders);
router.post("/:id/reminders", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), createLeadReminder);
router.delete("/:id/reminders/:reminderId", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), deleteLeadReminder);
router.post("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), createLead);
router.patch("/:id/assign", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), assignLead);
router.put("/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), updateLead);
router.patch("/:id/status", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), updateLeadStatus);
router.delete("/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), deleteLead);

module.exports = router;

const express = require("express");
const router = express.Router();
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const {
  getLeadMeta,
  listLeads,
  createLead,
  updateLead,
  updateLeadStatus,
  deleteLead,
} = require("../controllers/leadController");

router.get("/meta", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), getLeadMeta);
router.get("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), listLeads);
router.post("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), createLead);
router.put("/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), updateLead);
router.patch("/:id/status", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), updateLeadStatus);
router.delete("/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), deleteLead);

module.exports = router;

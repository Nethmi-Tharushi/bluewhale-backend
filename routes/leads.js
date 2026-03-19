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

router.get("/meta", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), getLeadMeta);
router.get("/", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), listLeads);
router.post("/", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), createLead);
router.put("/:id", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), updateLead);
router.patch("/:id/status", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), updateLeadStatus);
router.delete("/:id", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), deleteLead);

module.exports = router;

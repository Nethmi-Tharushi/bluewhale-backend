const express = require("express");
const router = express.Router();
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const {
  listInterviewSchedules,
  getInterviewScheduleMeta,
  createInterviewSchedule,
  evaluateInterviewScheduleCandidate,
  deleteInterviewSchedule,
} = require("../controllers/interviewScheduleController");

router.get("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), listInterviewSchedules);
router.get("/meta", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), getInterviewScheduleMeta);
router.post("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), createInterviewSchedule);
router.post("/:id/evaluate", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), evaluateInterviewScheduleCandidate);
router.delete("/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), deleteInterviewSchedule);

module.exports = router;

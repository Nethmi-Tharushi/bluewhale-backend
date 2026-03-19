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

router.get("/", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), listInterviewSchedules);
router.get("/meta", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), getInterviewScheduleMeta);
router.post("/", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), createInterviewSchedule);
router.post("/:id/evaluate", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), evaluateInterviewScheduleCandidate);
router.delete("/:id", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), deleteInterviewSchedule);

module.exports = router;

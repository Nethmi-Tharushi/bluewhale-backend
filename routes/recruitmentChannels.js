const express = require("express");
const router = express.Router();
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const {
  listRecruitmentChannels,
  getRecruitmentChannelMeta,
  createRecruitmentChannel,
  updateRecruitmentChannel,
  deleteRecruitmentChannel,
} = require("../controllers/recruitmentChannelController");

router.get("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), listRecruitmentChannels);
router.get("/meta", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), getRecruitmentChannelMeta);
router.post("/", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), createRecruitmentChannel);
router.put("/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), updateRecruitmentChannel);
router.delete("/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), deleteRecruitmentChannel);

module.exports = router;

const express = require('express');
const router = express.Router();
const { getCandidateMeetings, createAdminMeeting } = require('../controllers/meetingController');
const { protect, protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");

router.get('/', protect, getCandidateMeetings);
router.post('/', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin'), createAdminMeeting);

module.exports = router;

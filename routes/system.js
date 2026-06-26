const express = require("express");
const { getPublicSystemPreferences, updateSystemPreferences } = require("../controllers/systemPreferenceController");
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");

const router = express.Router();

router.get("/preferences", getPublicSystemPreferences);
router.put("/preferences", protectAdmin, authorizeAdmin("MainAdmin"), updateSystemPreferences);

module.exports = router;

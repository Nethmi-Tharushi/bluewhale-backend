const express = require("express");
const { globalSearch } = require("../controllers/globalSearchController");
const { authorizeAdmin, protectAdmin } = require("../middlewares/AdminAuth");

const router = express.Router();

router.get("/global", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), globalSearch);

module.exports = router;

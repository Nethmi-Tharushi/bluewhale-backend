const express = require("express");
const router = express.Router();
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const {
  listMediaRoots,
  browseMedia,
  getBackups,
  createBackup,
  removeBackup,
} = require("../controllers/utilitiesController");

router.get("/media/roots", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), listMediaRoots);
router.get("/media/browse", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), browseMedia);
router.get("/backups", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), getBackups);
router.post("/backups", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), createBackup);
router.delete("/backups/:fileName", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), removeBackup);

module.exports = router;

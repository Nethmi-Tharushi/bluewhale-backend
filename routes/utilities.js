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

router.get("/media/roots", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), listMediaRoots);
router.get("/media/browse", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), browseMedia);
router.get("/backups", protectAdmin, authorizeAdmin("SalesAdmin"), getBackups);
router.post("/backups", protectAdmin, authorizeAdmin("SalesAdmin"), createBackup);
router.delete("/backups/:fileName", protectAdmin, authorizeAdmin("SalesAdmin"), removeBackup);

module.exports = router;

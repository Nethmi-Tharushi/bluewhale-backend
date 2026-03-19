const express = require("express");
const router = express.Router();
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const { listProjects, createProject, updateProject, deleteProject } = require("../controllers/projectController");

router.get("/", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), listProjects);
router.post("/", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), createProject);
router.put("/:id", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), updateProject);
router.delete("/:id", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), deleteProject);

module.exports = router;

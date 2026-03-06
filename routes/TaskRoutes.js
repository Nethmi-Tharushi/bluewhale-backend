const express = require('express');
const router = express.Router();
const {
  getTasks,
  getRelevantTaskDocuments,
  createTask,
  updateTask,
  deleteTask,
  markTaskComplete,
  uploadTaskFiles,
  getAdminTasks
} = require('../controllers/taskController');
const { protectAdmin, protect, authorizeAdmin } = require("../middlewares/AdminAuth");
const { uploadTaskFilesMulter } = require('../middlewares/upload');


// GET /api/tasks - Get tasks for candidate (both B2C and B2B)
router.get('/', protect, getTasks);
router.get('/:id/relevant-documents', protect, getRelevantTaskDocuments);

// Admin routes
router.get('/admin', protectAdmin, authorizeAdmin('MainAdmin'), getAdminTasks);
router.post('/', protectAdmin, authorizeAdmin('MainAdmin'), createTask);
router.put('/:id', protectAdmin, authorizeAdmin('MainAdmin'), updateTask);
router.delete('/:id', protectAdmin, authorizeAdmin('MainAdmin'), deleteTask);

// Candidate/ agent can mark task complete
router.put('/:id/complete', protect, markTaskComplete);
router.post('/upload/task-files', protect, uploadTaskFilesMulter.fields([{ name: 'files', maxCount: 10 }]), uploadTaskFiles);

module.exports = router;

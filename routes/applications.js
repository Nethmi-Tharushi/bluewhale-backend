const express = require('express');
const router = express.Router();
const { protect, protectAdmin, authorizeAdmin } = require('../middlewares/AdminAuth');
const upload = require('../middlewares/upload');

const {
  applyForJob,
  getMyApplications,
  getAllApplications,
  updateApplicationStatus,
  withdrawApplication,
  submitAgentApplication,
  getApplicationStats
} = require('../controllers/applicationController');


// @desc    Submit application for managed candidate (Agent)
// @route   POST /api/applications/agent
// @access  Private/Agent
router.post('/agent/submit', protect, submitAgentApplication);

// @desc    Apply for a job (One-click application)
// @route   POST /api/applications/:jobId
// @access  Private (Candidates only)
router.post('/:jobId', protect, applyForJob);

// @desc    Get user's applications
// @route   GET /api/applications
// @access  Private
router.get('/', protect, getMyApplications);

// @desc    Get application statistics
// @route   GET /api/applications/stats
// @access  Private
router.get('/stats', protect, getApplicationStats);

// @desc    Withdraw/delete user's application
// @route   DELETE /api/applications/:applicationId
// @access  Private
router.delete('/:applicationId', protect, withdrawApplication);

// @desc    Get all applications (Admin)
// @route   GET /api/applications/all
// @access  Private/Admin
router.get('/all', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin'), getAllApplications);

// @desc    Update application status (Admin)
// @route   PUT /api/applications/:applicationId/status
// @access  Private/Admin
router.put('/:applicationId/status', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin'), updateApplicationStatus);

module.exports = router;
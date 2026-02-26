const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/AdminAuth');
const {
  getAgentDashboardAnalytics,
  getDetailedAnalytics,
  updateAnalytics,
  exportAnalytics,
} = require('../controllers/analyticsController');

// Middleware to ensure only agents can access analytics
const agentOnly = (req, res, next) => {
  if (req.user.userType !== 'agent') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only agents can access analytics.'
    });
  }
  next();
};

// @desc    Get agent dashboard analytics overview
// @route   GET /api/analytics/dashboard
// @access  Private (Agent only)
router.get('/dashboard', protect, agentOnly, getAgentDashboardAnalytics);

// @desc    Get detailed analytics for specific period
// @route   GET /api/analytics/detailed
// @access  Private (Agent only)
// @query   startDate, endDate, period (daily/weekly/monthly)
router.get('/detailed', protect, agentOnly, getDetailedAnalytics);

// @desc    Update/refresh analytics data
// @route   POST /api/analytics/update
// @access  Private (Agent only)
router.post('/update', protect, agentOnly, updateAnalytics);

// @desc    Export analytics data
// @route   GET /api/analytics/export
// @access  Private (Agent only)
// @query   startDate, endDate, format (json/csv)
router.get('/export', protect, agentOnly, exportAnalytics);

module.exports = router;
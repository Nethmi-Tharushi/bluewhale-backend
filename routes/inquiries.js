const express = require('express');
const router = express.Router();
const { protect, protectAdmin, authorizeAdmin } = require('../middlewares/AdminAuth');
const {
  createInquiry,
  getAllInquiries,
  getUserInquiries,
  respondToInquiry,
  deleteInquiry,
} = require('../controllers/inquiryController');

// Candidate routes
router.post('/:jobId', protect, createInquiry);
router.get('/my', protect, getUserInquiries);

// Admin routes
router.get('/', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin'), getAllInquiries);
router.put('/:id/respond', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin'), respondToInquiry);
router.delete('/:id', protectAdmin, authorizeAdmin('MainAdmin'), deleteInquiry);

module.exports = router;

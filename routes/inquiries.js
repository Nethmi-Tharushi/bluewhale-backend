const express = require('express');
const router = express.Router();
const { protect, protectAdmin, authorizeAdmin } = require('../middlewares/AdminAuth');
const upload = require('../middlewares/upload');
const {
  createInquiry,
  getAllInquiries,
  getUserInquiries,
  respondToInquiry,
  deleteInquiry,
} = require('../controllers/inquiryController');

const handleUploadError = (err, req, res, next) => {
  if (!err) return next();
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Attachment file is too large. Max size is 10MB.' });
    }
    return res.status(400).json({ message: err.message || 'Attachment upload error' });
  }
  if (err.message && err.message.toLowerCase().includes('invalid file type')) {
    return res.status(400).json({ message: 'Unsupported attachment file type.' });
  }
  return res.status(500).json({ message: 'Attachment upload failed' });
};

// Candidate routes
router.post('/:jobId', protect, (req, res, next) => {
  upload.single('attachment')(req, res, (err) => {
    if (err) return handleUploadError(err, req, res, next);
    return next();
  });
}, createInquiry);
router.get('/my', protect, getUserInquiries);

// Admin routes
router.get('/', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), getAllInquiries);
router.put('/:id/respond', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), respondToInquiry);
router.delete('/:id', protectAdmin, authorizeAdmin('MainAdmin'), deleteInquiry);

module.exports = router;

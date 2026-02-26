// routes/documents.js - COMPLETELY FIXED VERSION
const express = require('express');
const router = express.Router();

// Import middlewares
const { protect } = require('../middlewares/AdminAuth');
const upload = require('../middlewares/upload');

// Import controller functions
const {
  uploadUserDocuments,
  getUserDocuments,
  deleteDocument,
  getDocumentsByType
} = require('../controllers/documentController');

// Error handling middleware for multer
const handleMulterError = (error, req, res, next) => {
  if (error instanceof require('multer').MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 10MB'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum is 10 files per request'
      });
    }
  }
  
  if (error.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid file type. Only images, PDFs, and Word documents are allowed.'
    });
  }
  
  next(error);
};


// GET all user documents
router.get('/users/documents', protect, getUserDocuments);

// GET documents by type (photo, cv, passport, drivingLicense)
router.get('/type/:type', protect, getDocumentsByType);

// POST upload documents
router.post('/upload', 
  protect,
  upload.fields([
    { name: 'photo', maxCount: 2 },
    { name: 'passport', maxCount: 2 },
    { name: 'drivingLicense', maxCount: 2 },
    { name: 'cv', maxCount: 5 }
  ]),
  handleMulterError,
  uploadUserDocuments
);

// DELETE specific document
router.delete('/:id', protect, deleteDocument);

module.exports = router;
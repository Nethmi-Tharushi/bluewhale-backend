const express = require('express');
const router = express.Router();
const { protect, authorizeAdmin, protectAdmin } = require('../middlewares/AdminAuth');
const upload = require('../middlewares/upload');
const { getAllCandidates, getCandidateDetails, getApplications, updateApplicationStatus, createMeeting, getMeetings, updateMeeting, getReports, getReportStats, changePassword, getAssignedAgentById, getAssignedAgents, getSalesAdminTasks, createSalesAdminTask, updateSalesAdminTask, deleteSalesAdminTask } = require('../controllers/salesAdminController');
const {
  createInvoice,
  listInvoices,
  getInvoiceById,
  updateInvoice,
  updateInvoiceStatus,
  markInvoicePaid,
  downloadInvoicePdf,
  sendInvoiceByEmail,
} = require('../controllers/invoiceController');

const handleMulterError = (error, req, res, next) => {
  if (error instanceof require('multer').MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large. Maximum size is 10MB.' });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ success: false, message: `Unexpected upload field: ${error.field || 'file'}` });
    }
    return res.status(400).json({ success: false, message: error.message || 'Upload failed' });
  }
  if (String(error?.message || '').toLowerCase().includes('invalid file type')) {
    return res.status(400).json({ success: false, message: 'Invalid file type. Only images, PDFs, and Word docs are allowed.' });
  }
  return next(error);
};

router.get('/candidates', protectAdmin, authorizeAdmin('SalesAdmin'), getAllCandidates);
router.get('/candidates/:id', protectAdmin, authorizeAdmin('SalesAdmin'), getCandidateDetails);

//agents
router.get('/agents', protectAdmin, authorizeAdmin('SalesAdmin'), getAssignedAgents);
router.get('/agents/:id', protectAdmin, authorizeAdmin('SalesAdmin'), getAssignedAgentById);

//applications
router.get('/applications', protectAdmin, authorizeAdmin('SalesAdmin'), getApplications);
router.put('/applications/:candidateId/status', protectAdmin, authorizeAdmin('SalesAdmin'), updateApplicationStatus);

//meetings
router.post('/meetings', protectAdmin, authorizeAdmin('SalesAdmin'), createMeeting);
router.get('/meetings', protectAdmin, authorizeAdmin('SalesAdmin'), getMeetings);
router.put('/meetings/:id', protectAdmin, authorizeAdmin('SalesAdmin'), updateMeeting);

//reports
router.get('/reports', protectAdmin, authorizeAdmin('SalesAdmin'), getReports);
router.get('/reports/stats', protectAdmin, authorizeAdmin('SalesAdmin'), getReportStats);

//change password
router.put("/change-password", protectAdmin, authorizeAdmin("SalesAdmin"), changePassword);

//tasks
router.get('/tasks', protectAdmin, authorizeAdmin("SalesAdmin"), getSalesAdminTasks);
router.post('/tasks', protectAdmin, authorizeAdmin("SalesAdmin"), createSalesAdminTask);
router.put('/tasks/:id',protectAdmin, authorizeAdmin("SalesAdmin"), updateSalesAdminTask);
router.delete('/tasks/:id', protectAdmin, authorizeAdmin("SalesAdmin"), deleteSalesAdminTask);

// billing / invoices
router.post(
  '/invoices',
  protectAdmin,
  authorizeAdmin('SalesAdmin'),
  upload.fields([
    { name: 'attachment', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'document', maxCount: 1 },
    { name: 'invoiceFile', maxCount: 1 },
    { name: 'pdf', maxCount: 1 },
  ]),
  handleMulterError,
  createInvoice
);
router.get('/invoices', protectAdmin, authorizeAdmin('SalesAdmin'), listInvoices);
router.get('/invoices/:id', protectAdmin, authorizeAdmin('SalesAdmin'), getInvoiceById);
router.put(
  '/invoices/:id',
  protectAdmin,
  authorizeAdmin('SalesAdmin'),
  upload.fields([
    { name: 'attachment', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'document', maxCount: 1 },
    { name: 'invoiceFile', maxCount: 1 },
    { name: 'pdf', maxCount: 1 },
  ]),
  handleMulterError,
  updateInvoice
);
router.patch('/invoices/:id/status', protectAdmin, authorizeAdmin('SalesAdmin'), updateInvoiceStatus);
router.post('/invoices/:id/mark-paid', protectAdmin, authorizeAdmin('SalesAdmin'), markInvoicePaid);
router.get('/invoices/:id/pdf', protectAdmin, authorizeAdmin('SalesAdmin'), downloadInvoicePdf);
router.post('/invoices/:id/send-email', protectAdmin, authorizeAdmin('SalesAdmin'), sendInvoiceByEmail);


module.exports = router;

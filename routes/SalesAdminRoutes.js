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
  addInvoicePayment,
  downloadInvoicePdf,
  sendInvoiceByEmail,
} = require('../controllers/invoiceController');
const {
  getTeamStaff,
  getSalesOverview,
  listTargets,
  createTarget,
  deleteTarget,
  listProposals,
  createProposal,
  updateProposalStatus,
  convertProposalToEstimate,
  listEstimates,
  createEstimate,
  updateEstimateStatus,
  convertEstimateToInvoice,
  listPayments,
} = require("../controllers/salesOperationsController");

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

router.get('/candidates', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), getAllCandidates);
router.get('/candidates/:id', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), getCandidateDetails);

//agents
router.get('/agents', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), getAssignedAgents);
router.get('/agents/:id', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), getAssignedAgentById);

//applications
router.get('/applications', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), getApplications);
router.put('/applications/:candidateId/status', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), updateApplicationStatus);

//meetings
router.post('/meetings', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), createMeeting);
router.get('/meetings', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), getMeetings);
router.put('/meetings/:id', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), updateMeeting);

//reports
router.get('/reports', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), getReports);
router.get('/reports/stats', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), getReportStats);

//change password
router.put("/change-password", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), changePassword);

//tasks
router.get('/tasks', protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), getSalesAdminTasks);
router.post('/tasks', protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), createSalesAdminTask);
router.put('/tasks/:id',protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), updateSalesAdminTask);
router.delete('/tasks/:id', protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), deleteSalesAdminTask);

router.get("/team/staff", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), getTeamStaff);
router.get("/overview", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), getSalesOverview);
router.get("/targets", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), listTargets);
router.post("/targets", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), createTarget);
router.delete("/targets/:id", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), deleteTarget);
router.get("/proposals", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), listProposals);
router.post("/proposals", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), createProposal);
router.patch("/proposals/:id/status", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), updateProposalStatus);
router.post("/proposals/:id/convert-estimate", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), convertProposalToEstimate);
router.get("/estimates", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), listEstimates);
router.post("/estimates", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), createEstimate);
router.patch("/estimates/:id/status", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), updateEstimateStatus);
router.post("/estimates/:id/convert-invoice", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), convertEstimateToInvoice);
router.get("/payments", protectAdmin, authorizeAdmin("SalesAdmin", "SalesStaff"), listPayments);

// billing / invoices
router.post(
  '/invoices',
  protectAdmin,
  authorizeAdmin('SalesAdmin', 'SalesStaff'),
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
router.get('/invoices', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), listInvoices);
router.get('/invoices/:id', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), getInvoiceById);
router.put(
  '/invoices/:id',
  protectAdmin,
  authorizeAdmin('SalesAdmin', 'SalesStaff'),
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
router.patch('/invoices/:id/status', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), updateInvoiceStatus);
router.post('/invoices/:id/mark-paid', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), markInvoicePaid);
router.post('/invoices/:id/payments', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), addInvoicePayment);
router.get('/invoices/:id/pdf', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), downloadInvoicePdf);
router.post('/invoices/:id/send-email', protectAdmin, authorizeAdmin('SalesAdmin', 'SalesStaff'), sendInvoiceByEmail);


module.exports = router;

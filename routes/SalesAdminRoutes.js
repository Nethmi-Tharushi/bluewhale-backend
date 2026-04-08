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
  getTeams,
  saveTeam,
  deleteTeam,
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

router.get('/candidates', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), getAllCandidates);
router.get('/candidates/:id', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), getCandidateDetails);

//agents
router.get('/agents', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), getAssignedAgents);
router.get('/agents/:id', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), getAssignedAgentById);

//applications
router.get('/applications', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), getApplications);
router.put('/applications/:candidateId/status', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), updateApplicationStatus);

//meetings
router.post('/meetings', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), createMeeting);
router.get('/meetings', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), getMeetings);
router.put('/meetings/:id', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), updateMeeting);

//reports
router.get('/reports', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), getReports);
router.get('/reports/stats', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), getReportStats);

//change password
router.put("/change-password", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), changePassword);

//tasks
router.get('/tasks', protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), getSalesAdminTasks);
router.post('/tasks', protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), createSalesAdminTask);
router.put('/tasks/:id',protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), updateSalesAdminTask);
router.delete('/tasks/:id', protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), deleteSalesAdminTask);

router.get("/teams", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), getTeams);
router.post("/teams", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), saveTeam);
router.put("/teams/:ownerId", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), saveTeam);
router.delete("/teams/:ownerId", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), deleteTeam);
router.get("/team/staff", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), getTeamStaff);
router.get("/overview", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), getSalesOverview);
router.get("/targets", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), listTargets);
router.post("/targets", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), createTarget);
router.delete("/targets/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), deleteTarget);
router.get("/proposals", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), listProposals);
router.post("/proposals", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), createProposal);
router.patch("/proposals/:id/status", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), updateProposalStatus);
router.post("/proposals/:id/convert-estimate", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), convertProposalToEstimate);
router.get("/estimates", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), listEstimates);
router.post("/estimates", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), createEstimate);
router.patch("/estimates/:id/status", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), updateEstimateStatus);
router.post("/estimates/:id/convert-invoice", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), convertEstimateToInvoice);
router.get("/payments", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff"), listPayments);

// billing / invoices
router.post(
  '/invoices',
  protectAdmin,
  authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'),
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
router.get('/invoices', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), listInvoices);
router.get('/invoices/:id', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), getInvoiceById);
router.put(
  '/invoices/:id',
  protectAdmin,
  authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'),
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
router.patch('/invoices/:id/status', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), updateInvoiceStatus);
router.post('/invoices/:id/mark-paid', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), markInvoicePaid);
router.post('/invoices/:id/payments', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), addInvoicePayment);
router.get('/invoices/:id/pdf', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), downloadInvoicePdf);
router.post('/invoices/:id/send-email', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), sendInvoiceByEmail);


module.exports = router;


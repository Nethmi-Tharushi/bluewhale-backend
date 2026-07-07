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
  getProposalById,
  createProposal,
  updateProposal,
  updateProposalStatus,
  convertProposalToEstimate,
  listEstimates,
  getEstimateById,
  createEstimate,
  updateEstimate,
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

router.get('/candidates', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), getAllCandidates);
router.get('/candidates/:id', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), getCandidateDetails);

//agents
router.get('/agents', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), getAssignedAgents);
router.get('/agents/:id', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), getAssignedAgentById);

//applications
router.get('/applications', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), getApplications);
router.put('/applications/:candidateId/status', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), updateApplicationStatus);

//meetings
router.post('/meetings', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), createMeeting);
router.get('/meetings', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), getMeetings);
router.put('/meetings/:id', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), updateMeeting);

//reports
router.get('/reports', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), getReports);
router.get('/reports/stats', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), getReportStats);

//change password
router.put("/change-password", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), changePassword);

//tasks
router.get('/tasks', protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), getSalesAdminTasks);
router.post('/tasks', protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), createSalesAdminTask);
router.put('/tasks/:id',protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), updateSalesAdminTask);
router.delete('/tasks/:id', protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), deleteSalesAdminTask);

router.get("/teams", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), getTeams);
router.post("/teams", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), saveTeam);
router.put("/teams/:ownerId", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), saveTeam);
router.delete("/teams/:ownerId", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin"), deleteTeam);
router.get("/team/staff", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), getTeamStaff);
router.get("/overview", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), getSalesOverview);
router.get("/targets", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), listTargets);
router.post("/targets", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), createTarget);
router.delete("/targets/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), deleteTarget);
router.get("/proposals", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), listProposals);
router.get("/proposals/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), getProposalById);
router.post("/proposals", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), createProposal);
router.put("/proposals/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), updateProposal);
router.patch("/proposals/:id/status", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), updateProposalStatus);
router.post("/proposals/:id/convert-estimate", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), convertProposalToEstimate);
router.get("/estimates", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), listEstimates);
router.get("/estimates/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), getEstimateById);
router.post("/estimates", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), createEstimate);
router.put("/estimates/:id", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), updateEstimate);
router.patch("/estimates/:id/status", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), updateEstimateStatus);
router.post("/estimates/:id/convert-invoice", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), convertEstimateToInvoice);
router.get("/payments", protectAdmin, authorizeAdmin("MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"), listPayments);

// billing / invoices
router.post(
  '/invoices',
  protectAdmin,
  authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'),
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
router.get('/invoices', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), listInvoices);
router.get('/invoices/:id', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), getInvoiceById);
router.put(
  '/invoices/:id',
  protectAdmin,
  authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'),
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
router.patch('/invoices/:id/status', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), updateInvoiceStatus);
router.post('/invoices/:id/mark-paid', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), markInvoicePaid);
router.post('/invoices/:id/payments', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), addInvoicePayment);
router.get('/invoices/:id/pdf', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), downloadInvoicePdf);
router.post('/invoices/:id/send-email', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff', 'Accountant'), sendInvoiceByEmail);


module.exports = router;


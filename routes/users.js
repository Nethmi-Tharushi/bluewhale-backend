const express = require('express');
const router = express.Router();
const { protect, protectAdmin, authorizeAdmin } = require('../middlewares/AdminAuth');
const upload = require('../middlewares/upload');

const {
  getUsers,
  createCandidateByAdmin,
  getUserById,
  updateUser,
  deleteUser,
  getManagedCandidates,
  addManagedCandidate,
  updateManagedCandidate,
  deleteManagedCandidate,
  createInquiry,
  getInquiries,
  getAgentApplications,
  getUserProfile,
  updateUserProfile,
  loginUser,
  signupUser,
  getUserApplications,
  changePassword,
  deleteAccount,
  getB2CCandidates,  // Add this import
  getSingleB2CCandidate,  // Add this new import
  getAllCandidates,
  getCandidateDetails,
  getSalesAdmins,
  updateVisaStatus,
  getAgents,
  getAgentById,
  assignB2CToSalesAdmin,
  assignAgentToSalesAdmin,
  updateVerificationStatus
} = require('../controllers/usersController');

const {
  uploadUserDocuments,
  getUserDocuments,
  deleteDocument,
  getDocumentsByType,
} = require('../controllers/documentController');
const { listUserInvoices, downloadUserInvoicePdf, submitUserPaymentProof } = require('../controllers/invoiceController');

// --------------------
// Auth & Profile Routes
// --------------------
router.post('/login', loginUser);

router.post(
  '/signup',
  upload.fields([
    { name: 'picture', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
    { name: 'CV', maxCount: 1 },
    { name: 'cv', maxCount: 1 },
    { name: 'companyLogo', maxCount: 1 },
  ]),
  signupUser
);

router.get('/profile', protect, getUserProfile);

router.put(
  '/profile',
  protect,
  upload.fields([
    { name: 'picture', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
    { name: 'CV', maxCount: 5 },
    { name: 'cv', maxCount: 5 },
  ]),
  updateUserProfile
);

// --------------------
// Password & Account Routes
// --------------------
router.post('/change-password', protect, changePassword);
router.delete('/delete-account', protect, deleteAccount);

// --------------------
// Document Routes
// --------------------
router.get('/documents', protect, getUserDocuments);
router.get('/documents/:type', protect, getDocumentsByType);
router.post(
  '/documents',
  protect,
  upload.fields([
    { name: 'photo', maxCount: 2 },
    { name: 'picture', maxCount: 2 },
    { name: 'cv', maxCount: 5 },
    { name: 'CV', maxCount: 5 },
    { name: 'passport', maxCount: 2 },
    { name: 'drivingLicense', maxCount: 2 },
    { name: 'file', maxCount: 5 },
    { name: 'document', maxCount: 5 },
  ]),
  uploadUserDocuments
);
router.delete('/documents/:id', protect, deleteDocument);

// --------------------
// B2C Candidates Routes (NEW)
// --------------------
router.get('/candidates/b2c', protectAdmin, authorizeAdmin("MainAdmin"), getB2CCandidates);
router.get('/candidates/b2c/:id', protectAdmin, authorizeAdmin("MainAdmin"), getSingleB2CCandidate);  // NEW ROUTE

// Get candidates for admin dashboard
router.get('/candidates', protectAdmin, authorizeAdmin('SalesAdmin','MainAdmin'), getAllCandidates);
router.post('/candidates', protectAdmin, authorizeAdmin('SalesAdmin', 'MainAdmin'), createCandidateByAdmin);
router.get('/candidates/:id', protectAdmin, authorizeAdmin('SalesAdmin','MainAdmin'), getCandidateDetails);

// --------------------
// Agent Routes
// --------------------
router.get('/agent/candidates', protect, getManagedCandidates);
router.post('/agent/candidates', protect, upload.fields([
  { name: 'cv', maxCount: 5 },
  { name: 'CV', maxCount: 5 },
  { name: 'passport', maxCount: 2 },
  { name: 'drivingLicense', maxCount: 2 },
  { name: 'photo', maxCount: 2 },
  { name: 'picture', maxCount: 2 },
  { name: 'file', maxCount: 5 },
  { name: 'document', maxCount: 5 },
]), addManagedCandidate);
router.put('/agent/candidates/:id', protect, upload.fields([
  { name: 'cv', maxCount: 5 },
  { name: 'CV', maxCount: 5 },
  { name: 'passport', maxCount: 2 },
  { name: 'drivingLicense', maxCount: 2 },
  { name: 'photo', maxCount: 2 },
  { name: 'picture', maxCount: 2 },
  { name: 'file', maxCount: 5 },
  { name: 'document', maxCount: 5 },
]), updateManagedCandidate);
router.delete('/agent/candidates/:id', protect, deleteManagedCandidate);

router.post('/agent/inquiries', protect, createInquiry);
router.get('/agent/inquiries', protect, getInquiries);

router.get('/agent/applications', protect, getAgentApplications);

// Optional legacy document routes for agents
router.post('/agent/documents', protect, upload.fields([
  { name: 'photo', maxCount: 2 },
  { name: 'picture', maxCount: 2 },
  { name: 'cv', maxCount: 5 },
  { name: 'CV', maxCount: 5 },
  { name: 'passport', maxCount: 2 },
  { name: 'drivingLicense', maxCount: 2 },
  { name: 'file', maxCount: 5 },
  { name: 'document', maxCount: 5 },
]), uploadUserDocuments);
router.get('/agent/documents', protect, getUserDocuments);
router.delete('/agent/documents/:id', protect, deleteDocument);

// --------------------
// User Management (Admin Only)
// --------------------
router.get("/", protectAdmin, authorizeAdmin("MainAdmin","SalesAdmin","AgentAdmin"), getUsers);
router.post("/assign-to-sales", protectAdmin, authorizeAdmin("MainAdmin"), assignB2CToSalesAdmin);
router.get('/sales-admins', protectAdmin, authorizeAdmin("MainAdmin"), getSalesAdmins);


router.get('/agents', protectAdmin, authorizeAdmin("MainAdmin"), getAgents);
router.get('/agents/:id', protectAdmin, authorizeAdmin("MainAdmin"), getAgentById);
router.post('/assign-agent-to-sales', protectAdmin, authorizeAdmin("MainAdmin"), assignAgentToSalesAdmin);

//update visastatus
router.post('/update-visa-status', protectAdmin, authorizeAdmin("MainAdmin","SalesAdmin"), updateVisaStatus);

//update agent verification
router.post('/update-verification',  protectAdmin, authorizeAdmin("MainAdmin","SalesAdmin"), updateVerificationStatus);

// Specific routes should come before parameterized ones
router.get('/applications', protect, getUserApplications);
router.get('/invoices', protect, listUserInvoices);
router.get('/invoices/:id/pdf', protect, downloadUserInvoicePdf);
router.post('/invoices/:id/payment-proof', protect, upload.fields([
  { name: 'paymentSlip', maxCount: 1 },
  { name: 'slip', maxCount: 1 },
  { name: 'proof', maxCount: 1 },
  { name: 'file', maxCount: 1 },
  { name: 'document', maxCount: 1 },
  { name: 'image', maxCount: 1 },
]), submitUserPaymentProof);
router.post('/me/invoices/:id/payment-proof', protect, upload.fields([
  { name: 'paymentSlip', maxCount: 1 },
  { name: 'slip', maxCount: 1 },
  { name: 'proof', maxCount: 1 },
  { name: 'file', maxCount: 1 },
  { name: 'document', maxCount: 1 },
  { name: 'image', maxCount: 1 },
]), submitUserPaymentProof);

router.get('/:id', protect, getUserById);
router.put('/:id', protect, updateUser);
router.delete('/:id', protect, deleteUser);

module.exports = router;

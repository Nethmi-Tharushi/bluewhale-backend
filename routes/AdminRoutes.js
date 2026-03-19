const express = require('express');
const router = express.Router();
const {
  registerAdmin,
  loginAdmin,
  getAllAdmins,
  updateAdmin,
  deleteAdmin,
  getMyAdminProfile,
  updateMyAdminProfile,
  changeMyAdminPassword,
  regenerateMyApiKey,
  getMyAuditLogs,
} = require('../controllers/AdminAuthController');
const { protectAdmin, authorizeAdmin } = require('../middlewares/AdminAuth');

// LOGIN (public)
router.post('/login', loginAdmin);

// REGISTER
router.post('/register', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin'), registerAdmin);

// Settings Hub "me" APIs
router.get('/me', protectAdmin, getMyAdminProfile);
router.put('/me', protectAdmin, updateMyAdminProfile);
router.put('/me/password', protectAdmin, changeMyAdminPassword);
router.post('/me/api-key', protectAdmin, regenerateMyApiKey);
router.get('/me/audit-logs', protectAdmin, getMyAuditLogs);

// PROTECTED ROUTES
router.get('/admin-dashboard', protectAdmin, authorizeAdmin('MainAdmin'), (req, res) => {
  res.json({ message: 'Admin Dashboard' });
});

router.get('/sales-dashboard', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), (req, res) => {
  res.json({ message: 'Sales Dashboard' });
});

router.get('/agent-dashboard', protectAdmin, authorizeAdmin('MainAdmin', 'AgentAdmin'), (req, res) => {
  res.json({ message: 'Agent Dashboard' });
});

// Get all admins
router.get('/', protectAdmin, authorizeAdmin('MainAdmin'), getAllAdmins);

// Update admin
router.put('/:id', protectAdmin, authorizeAdmin('MainAdmin'), updateAdmin);

// Delete admin
router.delete('/:id', protectAdmin, authorizeAdmin('MainAdmin'), deleteAdmin);

module.exports = router;

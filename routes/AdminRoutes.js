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
  getMyWallet,
  topUpMyWallet,
  getMyWalletTransactions,
  updateMyWallet,
  getRolePermissions,
  uploadMyWhatsAppProfileLogo,
} = require('../controllers/AdminAuthController');
const {
  getAgentSettings,
  getAgentSettingsMetadata,
} = require("../controllers/adminManagementController");
const {
  listRolePermissions,
  getRolePermission,
  updateRolePermission,
  resetRolePermissions,
} = require("../controllers/rolePermissionProfileController");
const {
  createAdminMeeting,
  getAdminMeetings,
  getAdminMeetingById,
  updateAdminMeeting,
} = require('../controllers/meetingController');
const { protectAdmin, authorizeAdmin } = require('../middlewares/AdminAuth');
const upload = require('../middlewares/upload');
const {
  validateAgentSettingsQuery,
  validateAdminIdParam,
  validateCreateAdminBody,
  validateUpdateAdminBody,
} = require("../middlewares/adminManagementValidation");
const {
  validateRolePermissionProfileKey,
  validateRolePermissionUpdateBody,
  validateRolePermissionResetBody,
} = require("../middlewares/rolePermissionProfileValidation");

// LOGIN (public)
router.post('/login', loginAdmin);

// REGISTER
router.post(
  '/register',
  protectAdmin,
  authorizeAdmin('MainAdmin', 'SalesAdmin'),
  validateCreateAdminBody,
  registerAdmin
);

// Settings Hub "me" APIs
router.get('/me', protectAdmin, getMyAdminProfile);
router.get('/me/role-permissions', protectAdmin, getRolePermissions);
router.put('/me', protectAdmin, updateMyAdminProfile);
router.post('/me/whatsapp-profile/logo', protectAdmin, upload.single("photo"), uploadMyWhatsAppProfileLogo);
router.put('/me/password', protectAdmin, changeMyAdminPassword);
router.post('/me/api-key', protectAdmin, regenerateMyApiKey);
router.get('/me/audit-logs', protectAdmin, getMyAuditLogs);
router.get('/me/wallet', protectAdmin, getMyWallet);
router.get('/me/wallet/transactions', protectAdmin, getMyWalletTransactions);
router.put('/me/wallet', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin'), updateMyWallet);
router.post('/me/wallet/top-up', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin'), topUpMyWallet);

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

router.get('/meetings', protectAdmin, authorizeAdmin('MainAdmin'), getAdminMeetings);
router.get('/meetings/:id', protectAdmin, authorizeAdmin('MainAdmin'), getAdminMeetingById);
router.post('/meetings', protectAdmin, authorizeAdmin('MainAdmin'), createAdminMeeting);
router.put('/meetings/:id', protectAdmin, authorizeAdmin('MainAdmin'), updateAdminMeeting);

// Get all admins
router.get(
  '/agent-settings/meta',
  protectAdmin,
  authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'),
  getAgentSettingsMetadata
);
router.get(
  '/agent-settings',
  protectAdmin,
  authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'),
  validateAgentSettingsQuery,
  getAgentSettings
);
router.get(
  '/role-permissions',
  protectAdmin,
  authorizeAdmin('MainAdmin', 'SalesAdmin'),
  listRolePermissions
);
router.post(
  '/role-permissions/reset',
  protectAdmin,
  authorizeAdmin('MainAdmin'),
  validateRolePermissionResetBody,
  resetRolePermissions
);
router.get(
  '/role-permissions/:profileKey',
  protectAdmin,
  authorizeAdmin('MainAdmin', 'SalesAdmin'),
  validateRolePermissionProfileKey,
  getRolePermission
);
router.put(
  '/role-permissions/:profileKey',
  protectAdmin,
  authorizeAdmin('MainAdmin'),
  validateRolePermissionProfileKey,
  validateRolePermissionUpdateBody,
  updateRolePermission
);
router.get('/', protectAdmin, authorizeAdmin('MainAdmin', 'SalesAdmin', 'SalesStaff'), getAllAdmins);

// Update admin
router.put(
  '/:id',
  protectAdmin,
  authorizeAdmin('MainAdmin', 'SalesAdmin'),
  validateAdminIdParam,
  validateUpdateAdminBody,
  updateAdmin
);

// Delete admin
router.delete(
  '/:id',
  protectAdmin,
  authorizeAdmin('MainAdmin', 'SalesAdmin'),
  validateAdminIdParam,
  deleteAdmin
);

module.exports = router;

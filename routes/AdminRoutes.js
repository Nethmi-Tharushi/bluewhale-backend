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
  exchangeEmbeddedSignupCode,
  disconnectMetaConnection,
  getMetaConnectionHealth,
} = require('../controllers/AdminAuthController');
const {
  autoPauseMyWorkSession,
  endMyWorkSession,
  getHrWorkSessionHistory,
  getHrWorkSessionSummary,
  getMyCurrentWorkSession,
  postMyWorkSessionHeartbeat,
  toggleMyWorkSessionBreak,
} = require("../controllers/adminWorkSessionController");
const {
  cancelMyLeaveRequest,
  createMyLeaveRequest,
  getHrAttendanceSummary,
  getHrLeaveRequests,
  getHrLeaveSettings,
  getMyLeaveRequests,
  reviewHrLeaveRequest,
  updateHrLeaveSettings,
} = require("../controllers/adminAttendanceLeaveController");
const {
  createHrRecruitmentCampaign,
  createHrRecruitmentCandidate,
  createHrRecruitmentRole,
  deleteHrRecruitmentCampaign,
  deleteHrRecruitmentCandidate,
  deleteHrRecruitmentInterview,
  getHrRecruitmentDashboard,
  getHrStaffDirectory,
  scheduleHrRecruitmentInterview,
  updateHrRecruitmentCampaign,
  updateHrRecruitmentCandidate,
  updateHrRecruitmentInterview,
} = require("../controllers/hrRecruitmentController");
const {
  getMetaLeadAdsStatusHandler,
  exchangeMetaLeadAdsCodeHandler,
  syncMetaLeadAdsHandler,
  syncMetaLeadAdsLeadsHandler,
  getMetaLeadAdsCampaignsHandler,
  getMetaLeadAdsLogsHandler,
  syncMetaLeadAdsCampaignsHandler,
  retryFailedMetaLeadAdsSyncsHandler,
  disconnectMetaLeadAdsHandler,
} = require("../controllers/metaLeadAdsController");
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
const {
  validateMetaLeadAdsDisconnectBody,
  validateMetaLeadAdsExchangeBody,
  validateMetaLeadAdsRetryBody,
  validateMetaLeadAdsSyncBody,
} = require("../middlewares/metaLeadAdsValidation");

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
router.get("/me/work-session", protectAdmin, getMyCurrentWorkSession);
router.post("/me/work-session/heartbeat", protectAdmin, postMyWorkSessionHeartbeat);
router.post("/me/work-session/toggle-break", protectAdmin, toggleMyWorkSessionBreak);
router.post("/me/work-session/auto-pause", protectAdmin, autoPauseMyWorkSession);
router.post("/me/work-session/logout", protectAdmin, endMyWorkSession);
router.get("/me/leave-requests", protectAdmin, getMyLeaveRequests);
router.post("/me/leave-requests", protectAdmin, upload.single("document"), createMyLeaveRequest);
router.patch("/me/leave-requests/:id/cancel", protectAdmin, cancelMyLeaveRequest);
router.get('/me/role-permissions', protectAdmin, getRolePermissions);
router.put('/me', protectAdmin, updateMyAdminProfile);
router.post('/me/whatsapp-profile/logo', protectAdmin, upload.single("photo"), uploadMyWhatsAppProfileLogo);
router.post('/me/whatsapp-meta/embedded-signup/exchange', protectAdmin, authorizeAdmin('MainAdmin'), exchangeEmbeddedSignupCode);
router.post('/me/whatsapp-meta/disconnect', protectAdmin, authorizeAdmin('MainAdmin'), disconnectMetaConnection);
router.get('/me/whatsapp-meta/health', protectAdmin, authorizeAdmin('MainAdmin'), getMetaConnectionHealth);
router.get("/me/meta-lead-ads/status", protectAdmin, authorizeAdmin("MainAdmin"), getMetaLeadAdsStatusHandler);
router.post("/me/meta-lead-ads/exchange", protectAdmin, authorizeAdmin("MainAdmin"), validateMetaLeadAdsExchangeBody, exchangeMetaLeadAdsCodeHandler);
router.post("/me/meta-lead-ads/sync", protectAdmin, authorizeAdmin("MainAdmin"), validateMetaLeadAdsSyncBody, syncMetaLeadAdsHandler);
router.post("/me/meta-lead-ads/leads/sync", protectAdmin, authorizeAdmin("MainAdmin"), validateMetaLeadAdsSyncBody, syncMetaLeadAdsLeadsHandler);
router.get("/me/meta-lead-ads/campaigns", protectAdmin, authorizeAdmin("MainAdmin"), getMetaLeadAdsCampaignsHandler);
router.get("/me/meta-lead-ads/logs", protectAdmin, authorizeAdmin("MainAdmin"), getMetaLeadAdsLogsHandler);
router.post("/me/meta-lead-ads/campaigns/sync", protectAdmin, authorizeAdmin("MainAdmin"), validateMetaLeadAdsSyncBody, syncMetaLeadAdsCampaignsHandler);
router.post("/me/meta-lead-ads/retry-failed-syncs", protectAdmin, authorizeAdmin("MainAdmin"), validateMetaLeadAdsRetryBody, retryFailedMetaLeadAdsSyncsHandler);
router.post("/me/meta-lead-ads/disconnect", protectAdmin, authorizeAdmin("MainAdmin"), validateMetaLeadAdsDisconnectBody, disconnectMetaLeadAdsHandler);
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
  "/hr/work-sessions",
  protectAdmin,
  authorizeAdmin("HRManager"),
  getHrWorkSessionSummary
);
router.get(
  "/hr/work-sessions/history",
  protectAdmin,
  authorizeAdmin("HRManager"),
  getHrWorkSessionHistory
);
router.get(
  "/hr/attendance",
  protectAdmin,
  authorizeAdmin("HRManager"),
  getHrAttendanceSummary
);
router.get(
  "/hr/leave-requests",
  protectAdmin,
  authorizeAdmin("HRManager"),
  getHrLeaveRequests
);
router.get(
  "/hr/leave-settings",
  protectAdmin,
  authorizeAdmin("HRManager"),
  getHrLeaveSettings
);
router.put(
  "/hr/leave-settings",
  protectAdmin,
  authorizeAdmin("HRManager"),
  updateHrLeaveSettings
);
router.patch(
  "/hr/leave-requests/:id/status",
  protectAdmin,
  authorizeAdmin("HRManager"),
  reviewHrLeaveRequest
);
router.get(
  "/hr/recruitment/dashboard",
  protectAdmin,
  authorizeAdmin("HRManager"),
  getHrRecruitmentDashboard
);
router.post(
  "/hr/recruitment/roles",
  protectAdmin,
  authorizeAdmin("HRManager"),
  createHrRecruitmentRole
);
router.post(
  "/hr/recruitment/campaigns",
  protectAdmin,
  authorizeAdmin("HRManager"),
  createHrRecruitmentCampaign
);
router.patch(
  "/hr/recruitment/campaigns/:id",
  protectAdmin,
  authorizeAdmin("HRManager"),
  updateHrRecruitmentCampaign
);
router.delete(
  "/hr/recruitment/campaigns/:id",
  protectAdmin,
  authorizeAdmin("HRManager"),
  deleteHrRecruitmentCampaign
);
router.post(
  "/hr/recruitment/candidates",
  protectAdmin,
  authorizeAdmin("HRManager"),
  upload.single("cv"),
  createHrRecruitmentCandidate
);
router.patch(
  "/hr/recruitment/candidates/:id",
  protectAdmin,
  authorizeAdmin("HRManager"),
  upload.single("cv"),
  updateHrRecruitmentCandidate
);
router.delete(
  "/hr/recruitment/candidates/:id",
  protectAdmin,
  authorizeAdmin("HRManager"),
  deleteHrRecruitmentCandidate
);
router.post(
  "/hr/recruitment/candidates/:id/interviews",
  protectAdmin,
  authorizeAdmin("HRManager"),
  scheduleHrRecruitmentInterview
);
router.patch(
  "/hr/recruitment/candidates/:id/interviews/:interviewId",
  protectAdmin,
  authorizeAdmin("HRManager"),
  updateHrRecruitmentInterview
);
router.delete(
  "/hr/recruitment/candidates/:id/interviews/:interviewId",
  protectAdmin,
  authorizeAdmin("HRManager"),
  deleteHrRecruitmentInterview
);
router.get(
  "/hr/staff-directory",
  protectAdmin,
  authorizeAdmin("HRManager"),
  getHrStaffDirectory
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

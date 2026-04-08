const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cloudinary = require("../config/cloudinary");
const AdminUser = require('../models/AdminUser');
const {
  getWalletSummary,
  listWalletTransactions,
  topUpWallet,
  updateWalletConfig,
} = require("../services/whatsappWalletService");

function getClientIp(req) {
  const xfwd = req.headers['x-forwarded-for'];
  if (typeof xfwd === 'string' && xfwd.length) return xfwd.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || '';
}

function pushAudit(admin, { what, ip, who = 'You' }) {
  try {
    admin.auditLogs = admin.auditLogs || [];
    admin.auditLogs.unshift({ when: new Date(), what, who, ip });
    if (admin.auditLogs.length > 50) admin.auditLogs = admin.auditLogs.slice(0, 50);
  } catch (_) {}
}

function generateApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const canManageWallet = (admin) => ["MainAdmin", "SalesAdmin"].includes(String(admin?.role || ""));
const buildDefaultRolePermissions = () => ({
  MainAdmin: {
    fullAccess: true,
  },
  SalesAdmin: {
    contactHub: true,
    inbox: true,
    whatsappProfile: true,
    whatsappTemplates: true,
    whatsappAutomations: true,
    whatsappAssignment: true,
    whatsappCampaigns: true,
    quickReplies: true,
    basicAutomations: true,
    forms: true,
    teamManagement: true,
    internalChat: true,
    invoices: true,
    targets: true,
    leads: true,
    projects: true,
    reports: true,
    settings: true,
    wallet: true,
    userManagement: true,
    rolePermissions: false,
  },
  SalesStaff: {
    contactHub: false,
    inbox: true,
    whatsappProfile: false,
    whatsappTemplates: false,
    whatsappAutomations: false,
    whatsappAssignment: false,
    whatsappCampaigns: false,
    quickReplies: true,
    basicAutomations: false,
    forms: false,
    teamManagement: false,
    internalChat: true,
    invoices: false,
    targets: true,
    leads: false,
    projects: false,
    reports: false,
    settings: false,
    wallet: false,
    userManagement: false,
    rolePermissions: false,
  },
});

const getGlobalRolePermissions = async () => {
  const mainAdmin = await AdminUser.findOne({ role: "MainAdmin" }).select("settings.rolePermissions");
  return {
    rolePermissions: (mainAdmin?.settings?.rolePermissions && typeof mainAdmin.settings.rolePermissions === "object")
      ? mainAdmin.settings.rolePermissions
      : buildDefaultRolePermissions(),
  };
};

// REGISTER ADMIN USER
exports.registerAdmin = async (req, res) => {
  const { name, email, password, role, phone, reportsTo } = req.body;

  try {
    if (req.admin?.role === "SalesAdmin" && role !== "SalesStaff") {
      return res.status(403).json({ message: "SalesAdmin can only create SalesStaff users" });
    }

    const existing = await AdminUser.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const payload = {
      name,
      email,
      phone: phone || "",
      password: hashedPassword,
      role,
    };

    if (role === "SalesStaff") {
      payload.reportsTo = req.admin?.role === "SalesAdmin" ? req.admin._id : reportsTo || null;
    }

    const admin = new AdminUser(payload);
    await admin.save();

    res.status(201).json({ message: 'Admin registered successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// LOGIN ADMIN USER
exports.loginAdmin = async (req, res) => {
  const { email, password, role } = req.body;
  console.log("Login request body:", req.body);

  if (!email || !password || !role) {
    return res.status(400).json({ message: 'Email, password, and role are required' });
  }

  try {
    const admin = await AdminUser.findOne({ email, role });
    if (!admin) return res.status(400).json({ message: 'User not found with this email and role' });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      { id: admin._id, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    pushAudit(admin, { what: 'Signed in', ip: getClientIp(req) });
    await admin.save();

    res.json({
      token,
      user: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET ALL ADMINS
exports.getAllAdmins = async (req, res) => {
  try {
    const admins = await AdminUser.find().select("-password");
    res.json(admins);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// UPDATE ADMIN (MainAdmin only existing)
exports.updateAdmin = async (req, res) => {
  try {
    const { name, email, role, phone, reportsTo } = req.body;
    const admin = await AdminUser.findByIdAndUpdate(
      req.params.id,
      {
        name,
        email,
        role,
        phone,
        reportsTo: role === "SalesStaff" ? reportsTo || null : null,
      },
      { new: true }
    ).select("-password");
    if (!admin) return res.status(404).json({ message: "Admin not found" });
    res.json({ message: "Admin updated successfully", admin });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE ADMIN
exports.deleteAdmin = async (req, res) => {
  try {
    const admin = await AdminUser.findByIdAndDelete(req.params.id);
    if (!admin) return res.status(404).json({ message: "Admin not found" });
    res.json({ message: "Admin deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// -----------------------------
// Settings Hub (Admin "Me") APIs
// -----------------------------

// GET /api/admins/me
exports.getMyAdminProfile = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    const admin = await AdminUser.findById(adminId);
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    // Backfill defaults for older admin records
    let touched = false;
    if (!admin.settings) { admin.settings = undefined; touched = true; }
    if (!admin.settings?.rolePermissions) {
      admin.settings = admin.settings || {};
      admin.settings.rolePermissions = buildDefaultRolePermissions();
      touched = true;
    }
    if (!admin.settings?.whatsappProfile) {
      admin.settings = admin.settings || {};
      admin.settings.whatsappProfile = {
        logoUrl: "",
        logoCloudinaryId: "",
        displayName: "",
        description: "",
        businessType: "",
        contactPhone: "",
        contactEmail: "",
        website: "",
        address: "",
        verificationNote: "",
      };
      touched = true;
    }
    if (!admin.apiKey) { admin.apiKey = generateApiKey(); touched = true; }
    if (!admin.billing) { admin.billing = undefined; touched = true; }
    if (!admin.auditLogs) { admin.auditLogs = []; touched = true; }
    if (touched) await admin.save();

    const sanitized = await AdminUser.findById(adminId).select('-password');
    const wallet = await getWalletSummary();
    res.json({ success: true, admin: sanitized, wallet });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/admins/role-permissions
exports.getRolePermissions = async (_req, res) => {
  try {
    const payload = await getGlobalRolePermissions();
    res.json({ success: true, ...payload });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/admins/me
exports.updateMyAdminProfile = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    const { name, email, settings, billing } = req.body;

    const admin = await AdminUser.findById(adminId);
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    if (typeof name === 'string') admin.name = name;
    if (typeof email === 'string') admin.email = email;

    if (settings && typeof settings === 'object') {
      admin.settings = admin.settings || {};
      if (settings.notifications && typeof settings.notifications === 'object') {
        admin.settings.notifications = {
          ...(admin.settings.notifications || {}),
          ...settings.notifications,
        };
      }
      if (typeof settings.theme === 'string') admin.settings.theme = settings.theme;
      if (settings.prefs && typeof settings.prefs === 'object') {
        admin.settings.prefs = {
          ...(admin.settings.prefs || {}),
          ...settings.prefs,
        };
      }
      if (settings.rolePermissions && typeof settings.rolePermissions === 'object') {
        admin.settings.rolePermissions = {
          ...(admin.settings.rolePermissions || buildDefaultRolePermissions()),
          ...settings.rolePermissions,
        };
      }
      if (settings.whatsappProfile && typeof settings.whatsappProfile === "object") {
        admin.settings.whatsappProfile = {
          ...(admin.settings.whatsappProfile || {}),
          ...settings.whatsappProfile,
        };
      }
    }

    if (billing && typeof billing === 'object') {
      admin.billing = { ...(admin.billing || {}), ...billing };
    }

    pushAudit(admin, { what: 'Updated settings', ip: getClientIp(req) });
    await admin.save();

    const sanitized = await AdminUser.findById(adminId).select('-password');
    res.json({ success: true, admin: sanitized });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/admins/me/password
exports.changeMyAdminPassword = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'currentPassword and newPassword are required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const admin = await AdminUser.findById(adminId);
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    const isMatch = await bcrypt.compare(currentPassword, admin.password);
    if (!isMatch) return res.status(400).json({ message: 'Current password is incorrect' });

    admin.password = await bcrypt.hash(newPassword, 10);
    pushAudit(admin, { what: 'Changed password', ip: getClientIp(req) });
    await admin.save();

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/admins/me/api-key
exports.regenerateMyApiKey = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    const admin = await AdminUser.findById(adminId);
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    admin.apiKey = generateApiKey();
    pushAudit(admin, { what: 'API key regenerated', ip: getClientIp(req) });
    await admin.save();

    res.json({ success: true, apiKey: admin.apiKey });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/admins/me/audit-logs
exports.getMyAuditLogs = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    const limit = Math.min(parseInt(req.query.limit || '25', 10) || 25, 100);

    const admin = await AdminUser.findById(adminId).select('auditLogs');
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    const logs = (admin.auditLogs || []).slice(0, limit);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/admins/me/whatsapp-profile/logo
exports.uploadMyWhatsAppProfileLogo = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    const admin = await AdminUser.findById(adminId);
    if (!admin) return res.status(404).json({ message: 'Admin not found' });
    if (!req.file) return res.status(400).json({ message: "No logo uploaded" });

    admin.settings = admin.settings || {};
    admin.settings.whatsappProfile = admin.settings.whatsappProfile || {};

    const previousPublicId = String(admin.settings.whatsappProfile.logoCloudinaryId || "").trim();
    if (previousPublicId && previousPublicId !== req.file.filename) {
      try {
        await cloudinary.uploader.destroy(previousPublicId);
      } catch (_) {}
    }

    admin.settings.whatsappProfile.logoUrl = req.file.path || req.file.secure_url || "";
    admin.settings.whatsappProfile.logoCloudinaryId = req.file.filename || req.file.public_id || "";
    pushAudit(admin, { what: "Updated WhatsApp profile logo", ip: getClientIp(req) });
    await admin.save();

    const sanitized = await AdminUser.findById(adminId).select('-password');
    res.json({ success: true, admin: sanitized, logoUrl: admin.settings.whatsappProfile.logoUrl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/admins/me/wallet
exports.getMyWallet = async (req, res) => {
  try {
    const wallet = await getWalletSummary();
    const limit = Math.min(parseInt(req.query.limit || "20", 10) || 20, 100);
    const transactions = await listWalletTransactions({ limit });
    res.json({ success: true, wallet, transactions });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// POST /api/admins/me/wallet/top-up
exports.topUpMyWallet = async (req, res) => {
  try {
    if (!canManageWallet(req.admin)) {
      return res.status(403).json({ message: "Access denied: only MainAdmin or SalesAdmin can top up the wallet" });
    }

    const amount = req.body?.amount;
    const note = String(req.body?.note || "").trim();
    const wallet = await topUpWallet({
      amount,
      actorId: req.admin?._id || null,
      note,
      reference: "Manual CRM top up",
      metadata: {
        source: "crm_wallet_top_up",
      },
    });

    res.json({ success: true, wallet });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// GET /api/admins/me/wallet/transactions
exports.getMyWalletTransactions = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "20", 10) || 20, 100);
    const transactions = await listWalletTransactions({ limit });
    res.json({ success: true, transactions });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// PUT /api/admins/me/wallet
exports.updateMyWallet = async (req, res) => {
  try {
    if (!canManageWallet(req.admin)) {
      return res.status(403).json({ message: "Access denied: only MainAdmin or SalesAdmin can manage wallet pricing" });
    }

    const wallet = await updateWalletConfig({
      templateChargeMinor: req.body?.templateChargeMinor,
      templateChargeByCategory: req.body?.templateChargeByCategory,
      lowBalanceThresholdMinor: req.body?.lowBalanceThresholdMinor,
      currency: req.body?.currency,
      active: req.body?.active,
      actorId: req.admin?._id || null,
    });

    res.json({ success: true, wallet });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

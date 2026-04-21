const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require("crypto");
const cloudinary = require("../config/cloudinary");
const AdminUser = require('../models/AdminUser');
const { loadWhatsAppMetaConnection, syncWhatsAppMetaConnectionCache } = require("../services/whatsappMetaConnectionService");
const { sendAdminLoginOtpEmail } = require("../services/emailService");
const { sendMessage: sendWhatsAppMessage } = require("../services/whatsappService");
const {
  listAdminsForLegacyEndpoint,
  createAdminRecord,
  updateAdminRecord,
  deleteAdminRecord,
} = require("../services/adminManagementService");
const {
  getWalletSummary,
  listWalletTransactions,
  topUpWallet,
  updateWalletConfig,
} = require("../services/whatsappWalletService");
const { syncWhatsAppAiIntentSettingsCache } = require("../services/whatsappAiIntentService");

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
const trimString = (value) => String(value || "").trim();
const getEmbeddedSignupConfigId = () =>
  trimString(
    process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ||
      process.env.META_EMBEDDED_SIGNUP_CONFIG_ID ||
      process.env.WHATSAPP_EMBEDDED_CONFIG_ID ||
      process.env.EMBEDDED_SIGNUP_CONFIG_ID ||
      ""
  );

const encodeQuery = (params = {}) =>
  Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");

const buildGraphUrl = (version = "v21.0", path = "", params = {}) => {
  const normalizedVersion = trimString(version || "v21.0") || "v21.0";
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const query = encodeQuery(params);
  return `https://graph.facebook.com/${normalizedVersion}/${normalizedPath}${query ? `?${query}` : ""}`;
};

const graphJsonRequest = async (url) => {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const message = data?.error?.message || `Meta Graph request failed (${response.status})`;
    const err = new Error(message);
    err.status = 400;
    err.code = "META_GRAPH_REQUEST_FAILED";
    err.details = data?.error || data;
    throw err;
  }
  return data;
};

const resolveWhatsAppAssetsFromToken = async ({ accessToken, graphApiVersion = "v21.0" }) => {
  const resolved = {
    businessAccountId: "",
    phoneNumberId: "",
  };

  if (!accessToken) return resolved;

  // First try direct WABA list.
  try {
    const directData = await graphJsonRequest(
      buildGraphUrl(graphApiVersion, "me/whatsapp_business_accounts", {
        access_token: accessToken,
        fields: "id,name,phone_numbers{id,display_phone_number,verified_name}",
        limit: 10,
      })
    );
    const firstWaba = Array.isArray(directData?.data) ? directData.data[0] : null;
    const firstPhone = Array.isArray(firstWaba?.phone_numbers) ? firstWaba.phone_numbers[0] : null;
    if (firstWaba?.id) {
      resolved.businessAccountId = trimString(firstWaba.id);
      resolved.phoneNumberId = trimString(firstPhone?.id);
      return resolved;
    }
  } catch (_) {
    // fallback below
  }

  // Fallback through business accounts.
  try {
    const businesses = await graphJsonRequest(
      buildGraphUrl(graphApiVersion, "me/businesses", {
        access_token: accessToken,
        fields: "id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}",
        limit: 10,
      })
    );

    const businessList = Array.isArray(businesses?.data) ? businesses.data : [];
    for (const business of businessList) {
      const wabas = Array.isArray(business?.owned_whatsapp_business_accounts)
        ? business.owned_whatsapp_business_accounts
        : [];
      const firstWaba = wabas[0];
      if (!firstWaba?.id) continue;
      const firstPhone = Array.isArray(firstWaba.phone_numbers) ? firstWaba.phone_numbers[0] : null;
      resolved.businessAccountId = trimString(firstWaba.id);
      resolved.phoneNumberId = trimString(firstPhone?.id);
      break;
    }
  } catch (_) {
    // leave resolved empty
  }

  return resolved;
};

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const TRUSTED_DEVICE_LIMIT = 10;

const hashOtpCode = (adminId, otpCode) =>
  crypto
    .createHash("sha256")
    .update(`${String(adminId)}:${String(otpCode || "")}`)
    .digest("hex");

const createOtpCode = () => String(Math.floor(100000 + Math.random() * 900000));
const createChallengeId = () => crypto.randomBytes(16).toString("hex");

const maskEmailAddress = (email = "") => {
  const value = trimString(email).toLowerCase();
  const parts = value.split("@");
  if (parts.length !== 2) return "";
  const [user, domain] = parts;
  if (!user || !domain) return "";
  if (user.length <= 2) return `${user[0] || "*"}*@${domain}`;
  return `${user[0]}${"*".repeat(Math.max(user.length - 2, 1))}${user[user.length - 1]}@${domain}`;
};

const maskPhoneNumber = (phone = "") => {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.length <= 4) return `${"*".repeat(Math.max(digits.length - 1, 0))}${digits.slice(-1)}`;
  return `${digits.slice(0, 2)}${"*".repeat(Math.max(digits.length - 4, 1))}${digits.slice(-2)}`;
};

const normalizeDeviceFingerprint = (value = "", req = null) => {
  const candidate = trimString(value);
  if (candidate) return candidate.slice(0, 191);
  const userAgent = trimString(req?.headers?.["user-agent"] || "unknown-device");
  return crypto.createHash("sha1").update(userAgent).digest("hex").slice(0, 40);
};

const getDeviceLabel = (req = null) => {
  const userAgent = trimString(req?.headers?.["user-agent"] || "");
  return userAgent ? userAgent.slice(0, 120) : "Unknown device";
};

const getTwoFactorState = (admin) => {
  admin.security = admin.security || {};
  admin.security.twoFactor = admin.security.twoFactor || {};
  const twoFactor = admin.security.twoFactor;

  if (typeof twoFactor.enabled !== "boolean") twoFactor.enabled = true;
  if (!trimString(twoFactor.deliveryPreference)) twoFactor.deliveryPreference = "email";
  if (typeof twoFactor.requireOnFirstLogin !== "boolean") twoFactor.requireOnFirstLogin = true;
  if (typeof twoFactor.requireOnNewDevice !== "boolean") twoFactor.requireOnNewDevice = true;
  if (typeof twoFactor.requireOnIpChange !== "boolean") twoFactor.requireOnIpChange = true;
  if (!Array.isArray(twoFactor.trustedDevices)) twoFactor.trustedDevices = [];
  twoFactor.pendingChallenge = twoFactor.pendingChallenge || {};

  return twoFactor;
};

const upsertTrustedDevice = ({ twoFactor, fingerprint, ip, label }) => {
  if (!twoFactor || !fingerprint) return;
  const now = new Date();
  const trustedDevices = Array.isArray(twoFactor.trustedDevices) ? twoFactor.trustedDevices : [];
  const existing = trustedDevices.find((item) => trimString(item?.fingerprint) === fingerprint);
  if (existing) {
    existing.lastIp = ip || existing.lastIp || "";
    existing.lastUsedAt = now;
    if (label) existing.label = label;
    twoFactor.trustedDevices = trustedDevices;
    return;
  }

  trustedDevices.unshift({
    fingerprint,
    label: label || "Trusted device",
    lastIp: ip || "",
    createdAt: now,
    lastUsedAt: now,
  });
  twoFactor.trustedDevices = trustedDevices.slice(0, TRUSTED_DEVICE_LIMIT);
};

const clearPendingChallenge = (twoFactor) => {
  if (!twoFactor) return;
  twoFactor.pendingChallenge = {
    challengeId: "",
    codeHash: "",
    expiresAt: null,
    attempts: 0,
    maxAttempts: OTP_MAX_ATTEMPTS,
    deliveryChannel: "email",
    destinationHint: "",
    lastSentAt: null,
    requestIp: "",
    deviceFingerprint: "",
  };
};

const sendLoginOtp = async ({ admin, otpCode, channel, ip, deviceLabel }) => {
  const preferredChannel = channel === "whatsapp" ? "whatsapp" : "email";
  const destination = {
    channel: "email",
    hint: maskEmailAddress(admin.email),
  };

  if (preferredChannel === "whatsapp") {
    const to = trimString(admin.phone || admin.settings?.whatsappProfile?.contactPhone);
    if (to) {
      try {
        await sendWhatsAppMessage({
          to,
          type: "text",
          text: {
            body: `Your Blue Whale CRM verification code is ${otpCode}. It expires in 5 minutes.`,
          },
          context: {
            skipWallet: true,
            source: "admin_login_otp",
          },
        });
        destination.channel = "whatsapp";
        destination.hint = maskPhoneNumber(to);
        return destination;
      } catch (_) {
        // Fallback to email below.
      }
    }
  }

  await sendAdminLoginOtpEmail({
    to: admin.email,
    name: admin.name,
    otpCode,
    expiresInMinutes: 5,
    ip,
    device: deviceLabel,
  });
  return destination;
};

const shouldRequireTwoFactor = ({ admin, twoFactor, ip, fingerprint }) => {
  if (!twoFactor?.enabled) return false;
  const trustedDevices = Array.isArray(twoFactor.trustedDevices) ? twoFactor.trustedDevices : [];
  const deviceKnown = Boolean(fingerprint && trustedDevices.some((item) => trimString(item?.fingerprint) === fingerprint));
  const hasVerifiedLogin = Boolean(twoFactor.lastVerifiedAt);
  const lastIp = trimString(twoFactor.lastLoginIp);
  const currentIp = trimString(ip);

  if (twoFactor.requireOnFirstLogin && !hasVerifiedLogin) return true;
  if (twoFactor.requireOnNewDevice && !deviceKnown) return true;
  if (twoFactor.requireOnIpChange && hasVerifiedLogin && lastIp && currentIp && lastIp !== currentIp) return true;
  return false;
};

const buildAuthPayload = (admin, token) => ({
  token,
  user: {
    id: admin._id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
  },
});
const buildDefaultRolePermissions = () => ({
  MainAdmin: {
    fullAccess: true,
  },
  SalesAdmin: {
    contactHub: true,
    inbox: true,
    whatsappProfile: true,
    whatsappTemplates: true,
    whatsappCommerce: true,
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
    whatsappCommerce: false,
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
    leads: true,
    projects: false,
    reports: true,
    settings: false,
    wallet: false,
    userManagement: false,
    rolePermissions: false,
  },
});

const mergeRolePermissionDefaults = (existingPermissions = {}) => {
  const defaults = buildDefaultRolePermissions();
  const source = existingPermissions && typeof existingPermissions === "object" ? existingPermissions : {};
  const merged = { ...source };

  Object.entries(defaults).forEach(([roleKey, defaultPermissions]) => {
    const current = source[roleKey];
    merged[roleKey] = {
      ...defaultPermissions,
      ...(current && typeof current === "object" ? current : {}),
    };
  });

  return merged;
};

const mergeRolePermissionPatch = (existingPermissions = {}, patchPermissions = {}) => {
  const base = mergeRolePermissionDefaults(existingPermissions);
  const patch = patchPermissions && typeof patchPermissions === "object" ? patchPermissions : {};
  const merged = { ...base };

  Object.entries(patch).forEach(([roleKey, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[roleKey] = {
        ...(base[roleKey] && typeof base[roleKey] === "object" ? base[roleKey] : {}),
        ...value,
      };
      return;
    }

    merged[roleKey] = value;
  });

  return mergeRolePermissionDefaults(merged);
};

const getGlobalRolePermissions = async () => {
  const mainAdmin = await AdminUser.findOne({ role: "MainAdmin" }).select("settings.rolePermissions");
  return {
    rolePermissions: mergeRolePermissionDefaults(mainAdmin?.settings?.rolePermissions || {}),
  };
};

function handleAdminManagementError(res, err) {
  if (err?.status) {
    const payload = { message: err.message };
    if (err.code) payload.code = err.code;
    return res.status(err.status).json(payload);
  }

  if (err?.code === 11000) {
    return res.status(400).json({ message: "Email already exists" });
  }

  return res.status(500).json({ message: err.message });
}

// REGISTER ADMIN USER
exports.registerAdmin = async (req, res) => {
  try {
    const admin = await createAdminRecord(req.body || {}, req.admin);
    res.status(201).json({
      message: 'Admin registered successfully',
      admin,
    });
  } catch (err) {
    handleAdminManagementError(res, err);
  }
};

// LOGIN ADMIN USER
exports.loginAdmin = async (req, res) => {
  const { email, password, role } = req.body;

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

    admin.lastLogin = new Date();
    pushAudit(admin, { what: 'Signed in', ip: getClientIp(req) });
    await admin.save();

    res.json(buildAuthPayload(admin, token));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/admins/login/otp/resend
exports.resendAdminLoginOtp = async (req, res) => {
  try {
    const email = trimString(req.body?.email).toLowerCase();
    const role = trimString(req.body?.role);
    const challengeId = trimString(req.body?.challengeId);
    if (!email || !role || !challengeId) {
      return res.status(400).json({ message: "email, role, and challengeId are required" });
    }

    const admin = await AdminUser.findOne({ email, role });
    if (!admin) return res.status(404).json({ message: "User not found" });

    const twoFactor = getTwoFactorState(admin);
    if (!twoFactor?.enabled) {
      return res.status(400).json({ message: "Two-factor login is not enabled for this account" });
    }

    const pending = twoFactor.pendingChallenge || {};
    if (!pending?.challengeId || pending.challengeId !== challengeId) {
      return res.status(400).json({ message: "Login verification session not found. Start login again." });
    }

    const now = Date.now();
    const expiresAt = pending?.expiresAt ? new Date(pending.expiresAt).getTime() : 0;
    if (!expiresAt || expiresAt <= now) {
      clearPendingChallenge(twoFactor);
      await admin.save();
      return res.status(400).json({ message: "Verification session expired. Please sign in again." });
    }

    const lastSent = pending?.lastSentAt ? new Date(pending.lastSentAt).getTime() : 0;
    if (lastSent && now - lastSent < OTP_RESEND_COOLDOWN_MS) {
      return res.status(429).json({
        message: "Please wait before requesting another OTP.",
        retryAfterSeconds: Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - lastSent)) / 1000),
      });
    }

    const clientIp = getClientIp(req);
    const otpCode = createOtpCode();
    const destination = await sendLoginOtp({
      admin,
      otpCode,
      channel: pending.deliveryChannel || twoFactor.deliveryPreference || "email",
      ip: clientIp,
      deviceLabel: getDeviceLabel(req),
    });

    twoFactor.pendingChallenge = {
      ...pending,
      codeHash: hashOtpCode(admin._id, otpCode),
      deliveryChannel: destination.channel,
      destinationHint: destination.hint,
      lastSentAt: new Date(),
      requestIp: clientIp,
    };
    pushAudit(admin, { what: `Resent login OTP via ${destination.channel}`, ip: clientIp });
    await admin.save();

    return res.json({
      success: true,
      message: "Verification code resent",
      deliveryChannel: destination.channel,
      destinationHint: destination.hint,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to resend OTP" });
  }
};

// POST /api/admins/login/otp/verify
exports.verifyAdminLoginOtp = async (req, res) => {
  try {
    const email = trimString(req.body?.email).toLowerCase();
    const role = trimString(req.body?.role);
    const challengeId = trimString(req.body?.challengeId);
    const otpCode = trimString(req.body?.otp);
    const trustDevice = Boolean(req.body?.trustDevice ?? true);
    const deviceFingerprint = normalizeDeviceFingerprint(req.body?.deviceFingerprint, req);
    const deviceLabel = getDeviceLabel(req);

    if (!email || !role || !challengeId || !otpCode) {
      return res.status(400).json({ message: "email, role, challengeId, and otp are required" });
    }

    const admin = await AdminUser.findOne({ email, role });
    if (!admin) return res.status(404).json({ message: "User not found" });

    const twoFactor = getTwoFactorState(admin);
    const pending = twoFactor.pendingChallenge || {};
    if (!pending?.challengeId || pending.challengeId !== challengeId) {
      return res.status(400).json({ message: "Verification session not found. Please sign in again." });
    }

    const now = Date.now();
    const expiresAt = pending?.expiresAt ? new Date(pending.expiresAt).getTime() : 0;
    if (!expiresAt || expiresAt <= now) {
      clearPendingChallenge(twoFactor);
      await admin.save();
      return res.status(400).json({ message: "Verification code expired. Please sign in again." });
    }

    const maxAttempts = Number(pending?.maxAttempts || OTP_MAX_ATTEMPTS);
    const attempts = Number(pending?.attempts || 0);
    if (attempts >= maxAttempts) {
      clearPendingChallenge(twoFactor);
      await admin.save();
      return res.status(429).json({ message: "Maximum OTP attempts exceeded. Please sign in again." });
    }

    const expectedHash = trimString(pending?.codeHash);
    const actualHash = hashOtpCode(admin._id, otpCode);
    if (!expectedHash || expectedHash !== actualHash) {
      twoFactor.pendingChallenge = {
        ...pending,
        attempts: attempts + 1,
      };
      await admin.save();
      return res.status(400).json({
        message: "Invalid verification code",
        remainingAttempts: Math.max(maxAttempts - (attempts + 1), 0),
      });
    }

    const clientIp = getClientIp(req);
    if (trustDevice) {
      upsertTrustedDevice({
        twoFactor,
        fingerprint: deviceFingerprint,
        ip: clientIp,
        label: deviceLabel,
      });
    }

    twoFactor.lastLoginIp = clientIp;
    twoFactor.lastLoginAt = new Date();
    twoFactor.lastVerifiedAt = new Date();
    clearPendingChallenge(twoFactor);
    admin.lastLogin = new Date();
    pushAudit(admin, { what: "Signed in with 2FA verification", ip: clientIp });
    await admin.save();

    const token = jwt.sign(
      { id: admin._id, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.json({
      ...buildAuthPayload(admin, token),
      twoFactorVerified: true,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to verify OTP" });
  }
};

// GET ALL ADMINS
exports.getAllAdmins = async (req, res) => {
  try {
    const admins = await listAdminsForLegacyEndpoint(req.admin);
    res.json(admins);
  } catch (err) {
    handleAdminManagementError(res, err);
  }
};

// UPDATE ADMIN (MainAdmin only existing)
exports.updateAdmin = async (req, res) => {
  try {
    const admin = await updateAdminRecord(req.params.id, req.body || {}, req.admin);
    res.json({ message: "Admin updated successfully", admin });
  } catch (err) {
    handleAdminManagementError(res, err);
  }
};

// DELETE ADMIN
exports.deleteAdmin = async (req, res) => {
  try {
    await deleteAdminRecord(req.params.id, req.admin);
    res.json({ message: "Admin deleted successfully" });
  } catch (err) {
    handleAdminManagementError(res, err);
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
    const normalizedRolePermissions = mergeRolePermissionDefaults(admin.settings?.rolePermissions || {});
    if (JSON.stringify(normalizedRolePermissions) !== JSON.stringify(admin.settings?.rolePermissions || {})) {
      admin.settings = admin.settings || {};
      admin.settings.rolePermissions = normalizedRolePermissions;
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
    if (!admin.settings?.whatsappMetaConnection) {
      admin.settings = admin.settings || {};
      admin.settings.whatsappMetaConnection = {
        accessToken: "",
        phoneNumberId: "",
        businessAccountId: "",
        appSecret: process.env.WHATSAPP_APP_SECRET || "",
        webhookVerifyToken: "",
        graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0",
        appId: process.env.WHATSAPP_APP_ID || process.env.META_APP_ID || "",
        catalogId: "",
        embeddedSignupConfigId: getEmbeddedSignupConfigId(),
        connectionMethod: "manual",
        lastEmbeddedSignupAt: null,
      };
      touched = true;
    }
    const envAppId = process.env.WHATSAPP_APP_ID || process.env.META_APP_ID || "";
    const envAppSecret = process.env.WHATSAPP_APP_SECRET || "";
    const envEmbeddedConfigId = getEmbeddedSignupConfigId();
    if (envAppId && admin.settings.whatsappMetaConnection.appId !== envAppId) {
      admin.settings.whatsappMetaConnection.appId = envAppId;
      touched = true;
    }
    if (envAppSecret && admin.settings.whatsappMetaConnection.appSecret !== envAppSecret) {
      admin.settings.whatsappMetaConnection.appSecret = envAppSecret;
      touched = true;
    }
    if (envEmbeddedConfigId && admin.settings.whatsappMetaConnection.embeddedSignupConfigId !== envEmbeddedConfigId) {
      admin.settings.whatsappMetaConnection.embeddedSignupConfigId = envEmbeddedConfigId;
      touched = true;
    }
    if (!admin.settings?.whatsappAiIntentAutomation) {
      admin.settings = admin.settings || {};
      admin.settings.whatsappAiIntentAutomation = {
        enabled: false,
        chargeMinor: 1,
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
        admin.settings.rolePermissions = mergeRolePermissionPatch(admin.settings.rolePermissions || {}, settings.rolePermissions);
      }
      if (settings.whatsappProfile && typeof settings.whatsappProfile === "object") {
        admin.settings.whatsappProfile = {
          ...(admin.settings.whatsappProfile || {}),
          ...settings.whatsappProfile,
        };
      }
      if (settings.whatsappMetaConnection && typeof settings.whatsappMetaConnection === "object") {
        admin.settings.whatsappMetaConnection = {
          ...(admin.settings.whatsappMetaConnection || {}),
          ...settings.whatsappMetaConnection,
        };
      }
      if (settings.whatsappAiIntentAutomation && typeof settings.whatsappAiIntentAutomation === "object") {
        admin.settings.whatsappAiIntentAutomation = {
          ...(admin.settings.whatsappAiIntentAutomation || {}),
          ...settings.whatsappAiIntentAutomation,
        };
      }
    }

    if (billing && typeof billing === 'object') {
      admin.billing = { ...(admin.billing || {}), ...billing };
    }

    pushAudit(admin, { what: 'Updated settings', ip: getClientIp(req) });
    await admin.save();
    if (admin?.settings?.whatsappMetaConnection) {
      syncWhatsAppMetaConnectionCache(admin.settings.whatsappMetaConnection);
    }
    if (admin?.settings?.whatsappAiIntentAutomation) {
      syncWhatsAppAiIntentSettingsCache(admin.settings.whatsappAiIntentAutomation);
    }

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

// POST /api/admins/me/whatsapp-meta/embedded-signup/exchange
exports.exchangeEmbeddedSignupCode = async (req, res) => {
  try {
    if (String(req.admin?.role || "") !== "MainAdmin") {
      return res.status(403).json({ message: "Only MainAdmin can complete Meta embedded signup" });
    }

    const adminId = req.admin?._id;
    const code = trimString(req.body?.code);
    const redirectUri = trimString(req.body?.redirectUri);
    const state = trimString(req.body?.state);
    const phoneNumberIdHint = trimString(req.body?.phoneNumberId);
    const businessAccountIdHint = trimString(req.body?.businessAccountId);

    if (!code) {
      return res.status(400).json({ message: "Missing authorization code from Meta signup callback" });
    }

    const admin = await AdminUser.findById(adminId);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const connection = admin.settings?.whatsappMetaConnection || {};
    const graphApiVersion = trimString(connection.graphApiVersion || process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0") || "v21.0";
    const appId = trimString(connection.appId || process.env.WHATSAPP_APP_ID || process.env.META_APP_ID);
    const appSecret = trimString(connection.appSecret || process.env.WHATSAPP_APP_SECRET);

    if (!appId || !appSecret) {
      return res.status(400).json({
        message: "App ID and App Secret are required before using Meta embedded signup",
        code: "META_EMBEDDED_SIGNUP_MISSING_APP_CREDENTIALS",
      });
    }

    const shortTokenResponse = await graphJsonRequest(
      buildGraphUrl(graphApiVersion, "oauth/access_token", {
        client_id: appId,
        client_secret: appSecret,
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        code,
      })
    );

    let accessToken = trimString(shortTokenResponse?.access_token);
    if (!accessToken) {
      return res.status(400).json({ message: "Meta code exchange did not return access token" });
    }

    // Exchange for long-lived token where possible.
    try {
      const longTokenResponse = await graphJsonRequest(
        buildGraphUrl(graphApiVersion, "oauth/access_token", {
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: accessToken,
        })
      );
      const longToken = trimString(longTokenResponse?.access_token);
      if (longToken) accessToken = longToken;
    } catch (_) {
      // Keep short-lived token if long-lived exchange fails.
    }

    const resolvedAssets = await resolveWhatsAppAssetsFromToken({
      accessToken,
      graphApiVersion,
    });

    admin.settings = admin.settings || {};
    admin.settings.whatsappMetaConnection = {
      ...(admin.settings.whatsappMetaConnection || {}),
      accessToken,
      appId,
      appSecret,
      graphApiVersion,
      phoneNumberId: phoneNumberIdHint || resolvedAssets.phoneNumberId || trimString(admin.settings?.whatsappMetaConnection?.phoneNumberId),
      businessAccountId:
        businessAccountIdHint ||
        resolvedAssets.businessAccountId ||
        trimString(admin.settings?.whatsappMetaConnection?.businessAccountId),
      connectionMethod: "embedded_signup",
      lastEmbeddedSignupAt: new Date(),
    };

    pushAudit(admin, {
      what: `Connected Meta WhatsApp via embedded signup${state ? ` (state: ${state})` : ""}`,
      ip: getClientIp(req),
    });
    await admin.save();
    syncWhatsAppMetaConnectionCache(admin.settings.whatsappMetaConnection);

    return res.json({
      success: true,
      message: "Meta embedded signup connected successfully",
      connection: admin.settings.whatsappMetaConnection,
    });
  } catch (err) {
    console.error("Failed to exchange Meta embedded signup code:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to complete Meta embedded signup",
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  }
};

const isMetaTokenExpiredError = (error = {}) => {
  const message = trimString(error?.message).toLowerCase();
  return (
    Number(error?.code || 0) === 190 ||
    message.includes("access token") ||
    message.includes("session has expired")
  );
};

// POST /api/admins/me/whatsapp-meta/disconnect
exports.disconnectMetaConnection = async (req, res) => {
  try {
    if (String(req.admin?.role || "") !== "MainAdmin") {
      return res.status(403).json({ message: "Only MainAdmin can disconnect Meta connection" });
    }

    const adminId = req.admin?._id;
    const mode = trimString(req.body?.mode || "session_only").toLowerCase();
    const admin = await AdminUser.findById(adminId);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    admin.settings = admin.settings || {};
    const currentConnection = admin.settings.whatsappMetaConnection || {};
    const nextConnection = {
      ...currentConnection,
      accessToken: "",
      connectionMethod: "manual",
      lastEmbeddedSignupAt: null,
    };

    if (mode === "reset_account") {
      nextConnection.phoneNumberId = "";
      nextConnection.businessAccountId = "";
      nextConnection.catalogId = "";
    } else if (mode !== "session_only") {
      return res.status(400).json({
        message: "Unsupported disconnect mode. Use session_only or reset_account",
      });
    }

    admin.settings.whatsappMetaConnection = nextConnection;
    pushAudit(admin, {
      what: mode === "reset_account" ? "Disconnected Meta account and reset WhatsApp IDs" : "Disconnected Meta session token",
      ip: getClientIp(req),
    });
    await admin.save();
    syncWhatsAppMetaConnectionCache(nextConnection);

    return res.json({
      success: true,
      message:
        mode === "reset_account"
          ? "Meta connection reset completed"
          : "Meta session disconnected successfully",
      connection: nextConnection,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to disconnect Meta connection" });
  }
};

// GET /api/admins/me/whatsapp-meta/health
exports.getMetaConnectionHealth = async (req, res) => {
  try {
    if (String(req.admin?.role || "") !== "MainAdmin") {
      return res.status(403).json({ message: "Only MainAdmin can view Meta connection health" });
    }

    const connection = await loadWhatsAppMetaConnection({ refresh: true });
    const graphApiVersion = trimString(connection?.graphApiVersion || "v21.0") || "v21.0";
    const hasAccessToken = Boolean(trimString(connection?.accessToken));
    const hasPhoneNumberId = Boolean(trimString(connection?.phoneNumberId));
    const hasBusinessAccountId = Boolean(trimString(connection?.businessAccountId));
    const hasAppId = Boolean(trimString(connection?.appId));
    const hasAppSecret = Boolean(trimString(connection?.appSecret));
    const hasWebhookVerifyToken = Boolean(trimString(connection?.webhookVerifyToken));

    const checks = {
      config: {
        status: hasAccessToken && hasPhoneNumberId ? "ok" : "warning",
        message: hasAccessToken && hasPhoneNumberId
          ? "Access token and phone number ID are present."
          : "Missing required fields. Access token and phone number ID are required.",
      },
      token: {
        status: hasAccessToken ? "unknown" : "warning",
        message: hasAccessToken ? "Token check pending." : "Access token is not configured.",
      },
      phoneNumber: {
        status: hasPhoneNumberId ? "unknown" : "warning",
        message: hasPhoneNumberId ? "Phone profile check pending." : "Phone number ID is not configured.",
      },
      webhook: {
        status: hasWebhookVerifyToken ? "ok" : "warning",
        message: hasWebhookVerifyToken ? "Webhook verify token is configured." : "Webhook verify token is not configured.",
      },
    };

    const diagnostics = [];

    if (hasAccessToken) {
      try {
        const tokenResult = await graphJsonRequest(
          buildGraphUrl(graphApiVersion, "me", {
            access_token: connection.accessToken,
            fields: "id,name",
          })
        );
        checks.token = {
          status: "ok",
          message: `Token is valid for ${trimString(tokenResult?.name || "Meta account")}.`,
        };
      } catch (error) {
        const metaError = error?.details || {};
        const tokenExpired = isMetaTokenExpiredError(metaError);
        checks.token = {
          status: tokenExpired ? "failed" : "warning",
          message: tokenExpired
            ? "WhatsApp access token is invalid or expired. Reconnect Meta account."
            : trimString(error?.message || "Token check failed"),
        };
        diagnostics.push({
          check: "token",
          code: trimString(metaError?.code),
          subcode: trimString(metaError?.error_subcode),
          type: trimString(metaError?.type),
        });
      }
    }

    if (hasAccessToken && hasPhoneNumberId) {
      try {
        const phoneResult = await graphJsonRequest(
          buildGraphUrl(graphApiVersion, connection.phoneNumberId, {
            access_token: connection.accessToken,
            fields: "id,display_phone_number,verified_name,quality_rating",
          })
        );
        checks.phoneNumber = {
          status: "ok",
          message: `Phone ${trimString(phoneResult?.display_phone_number || phoneResult?.verified_name || connection.phoneNumberId)} is reachable.`,
        };
      } catch (error) {
        const metaError = error?.details || {};
        checks.phoneNumber = {
          status: isMetaTokenExpiredError(metaError) ? "failed" : "warning",
          message: trimString(error?.message || "Phone number check failed"),
        };
        diagnostics.push({
          check: "phoneNumber",
          code: trimString(metaError?.code),
          subcode: trimString(metaError?.error_subcode),
          type: trimString(metaError?.type),
        });
      }
    }

    const statusOrder = { failed: 3, warning: 2, unknown: 1, ok: 0 };
    const overallStatus = Object.values(checks).reduce((current, check) =>
      statusOrder[check.status] > statusOrder[current] ? check.status : current, "ok");

    const data = {
      status: overallStatus,
      checkedAt: new Date().toISOString(),
      connection: {
        source: connection?.source || "unknown",
        connectionMethod: connection?.connectionMethod || "manual",
        graphApiVersion,
        lastEmbeddedSignupAt: connection?.lastEmbeddedSignupAt || null,
      },
      checks,
      flags: {
        hasAccessToken,
        hasPhoneNumberId,
        hasBusinessAccountId,
        hasAppId,
        hasAppSecret,
        hasWebhookVerifyToken,
      },
      diagnostics,
    };

    return res.json({
      success: true,
      health: data,
      message:
        overallStatus === "ok"
          ? "Meta connection is healthy"
          : overallStatus === "failed"
            ? "Meta connection has critical issues"
            : "Meta connection has warnings",
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      message: err.message || "Failed to check Meta connection health",
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  }
};

// GET /api/admins/me/wallet
exports.getMyWallet = async (req, res) => {
  try {
    const wallet = await getWalletSummary();
    const limit = Math.min(parseInt(req.query.limit || "20", 10) || 20, 100);
    const transactions = await listWalletTransactions({ limit });
    res.json({
      success: true,
      wallet,
      transactions,
      data: {
        wallet,
        transactions,
      },
    });
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

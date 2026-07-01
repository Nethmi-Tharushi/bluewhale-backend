const asyncHandler = require("express-async-handler");
const AdminUser = require("../models/AdminUser");
const AdminWorkSession = require("../models/AdminWorkSession");
const {
  autoPauseTrackedWorkSession,
  ensureOpenTrackedWorkSession,
  endTrackedWorkSession,
  getActiveDurationSeconds,
  getBreakDurationSeconds,
  isSessionOnline,
  isTrackedAdmin,
  resumeAutoPausedTrackedWorkSession,
  serializeWorkSession,
  touchOrResumeTrackedWorkSession,
  toggleTrackedWorkBreak,
} = require("../services/adminWorkSessionService");

const TRACKING_ROLES = ["SalesAdmin", "SalesStaff"];

const parseDateInput = (value, fallback) => {
  if (!value) return fallback;
  const normalized = String(value).trim();
  const dateOnlyMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const getRangeBounds = (query = {}) => {
  const now = new Date();
  const fallbackStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fallbackEnd = new Date(fallbackStart);
  fallbackEnd.setDate(fallbackEnd.getDate() + 1);

  const start = parseDateInput(query.start || query.date, fallbackStart);
  const end = parseDateInput(query.end, fallbackEnd);

  if (end <= start) {
    const correctedEnd = new Date(start);
    correctedEnd.setDate(correctedEnd.getDate() + 1);
    return { start, end: correctedEnd };
  }

  return { start, end };
};

const requireTrackedAdmin = (req, res) => {
  if (isTrackedAdmin(req.admin)) return true;
  res.status(403).json({ message: "Work session tracking is only available for SalesAdmin and SalesStaff accounts" });
  return false;
};

exports.getMyCurrentWorkSession = asyncHandler(async (req, res) => {
  if (!requireTrackedAdmin(req, res)) return;
  const session = await ensureOpenTrackedWorkSession(req.admin, req);
  await resumeAutoPausedTrackedWorkSession(session, { now: new Date() });
  return res.json({ success: true, data: serializeWorkSession(session, new Date()) });
});

exports.postMyWorkSessionHeartbeat = asyncHandler(async (req, res) => {
  if (!requireTrackedAdmin(req, res)) return;
  const session = await touchOrResumeTrackedWorkSession(req.admin, req);
  return res.json({ success: true, data: serializeWorkSession(session, new Date()) });
});

exports.toggleMyWorkSessionBreak = asyncHandler(async (req, res) => {
  if (!requireTrackedAdmin(req, res)) return;
  const session = await toggleTrackedWorkBreak(req.admin, req);
  return res.json({ success: true, data: serializeWorkSession(session, new Date()) });
});

exports.endMyWorkSession = asyncHandler(async (req, res) => {
  if (!requireTrackedAdmin(req, res)) return;
  const session = await endTrackedWorkSession(req.admin, { reason: "logout" });
  return res.json({ success: true, data: serializeWorkSession(session, new Date()) });
});

exports.autoPauseMyWorkSession = asyncHandler(async (req, res) => {
  if (!requireTrackedAdmin(req, res)) return;
  const session = await autoPauseTrackedWorkSession(req.admin, req, { now: new Date() });
  return res.json({ success: true, data: serializeWorkSession(session, new Date()) });
});

exports.getHrWorkSessionSummary = asyncHandler(async (req, res) => {
  const { start, end } = getRangeBounds(req.query || {});
  const now = new Date();

  const admins = await AdminUser.find({
    role: { $in: TRACKING_ROLES },
  })
    .select("_id name email role reportsTo lastLogin")
    .populate("reportsTo", "_id name email role")
    .sort({ role: 1, name: 1 })
    .lean();

  const adminIds = admins.map((admin) => admin._id);
  const [recentSessions, rangeSessions, openSessions] = await Promise.all([
    AdminWorkSession.find({ adminId: { $in: adminIds } })
      .sort({ loginAt: -1 })
      .lean(),
    AdminWorkSession.find({
      adminId: { $in: adminIds },
      loginAt: { $gte: start, $lt: end },
    })
      .sort({ loginAt: -1 })
      .lean(),
    AdminWorkSession.find({
      adminId: { $in: adminIds },
      endedAt: null,
    }).lean(),
  ]);

  const latestSessionMap = new Map();
  recentSessions.forEach((session) => {
    const key = String(session.adminId || "");
    if (!latestSessionMap.has(key)) latestSessionMap.set(key, session);
  });

  const openSessionMap = new Map();
  openSessions.forEach((session) => {
    openSessionMap.set(String(session.adminId || ""), session);
  });

  const sessionsByAdmin = new Map();
  rangeSessions.forEach((session) => {
    const key = String(session.adminId || "");
    if (!sessionsByAdmin.has(key)) sessionsByAdmin.set(key, []);
    sessionsByAdmin.get(key).push(session);
  });

  const rows = admins.map((admin) => {
    const key = String(admin._id || "");
    const currentSession = openSessionMap.get(key) || null;
    const latestSession = latestSessionMap.get(key) || null;
    const periodSessions = sessionsByAdmin.get(key) || [];
    const todayActiveSeconds = periodSessions.reduce(
      (sum, session) => sum + getActiveDurationSeconds(session, now),
      0
    );
    const todayBreakSeconds = periodSessions.reduce(
      (sum, session) => sum + getBreakDurationSeconds(session, now),
      0
    );
    const serializedCurrent = serializeWorkSession(currentSession, now);
    const serializedLatest = serializeWorkSession(latestSession, now);

    return {
      _id: admin._id,
      name: admin.name || "",
      email: admin.email || "",
      role: admin.role || "",
      reportsTo: admin.reportsTo
        ? {
            _id: admin.reportsTo._id,
            name: admin.reportsTo.name || "",
            email: admin.reportsTo.email || "",
            role: admin.reportsTo.role || "",
          }
        : null,
      status:
        currentSession && isSessionOnline(currentSession, now)
          ? currentSession.currentState === "on_break"
            ? "on_break"
            : "online"
          : "offline",
      lastLoginAt: latestSession?.loginAt || admin.lastLogin || null,
      lastActivityAt:
        currentSession?.lastSeenAt ||
        latestSession?.lastSeenAt ||
        latestSession?.endedAt ||
        admin.lastLogin ||
        null,
      currentSession: serializedCurrent,
      latestSession: serializedLatest,
      metrics: {
        rangeSessionCount: periodSessions.length,
        rangeActiveDurationSeconds: todayActiveSeconds,
        rangeBreakDurationSeconds: todayBreakSeconds,
      },
    };
  });

  const summary = {
    totalTrackedUsers: rows.length,
    onlineCount: rows.filter((row) => row.status === "online").length,
    onBreakCount: rows.filter((row) => row.status === "on_break").length,
    awayCount: 0,
    offlineCount: rows.filter((row) => row.status === "offline").length,
  };

  return res.json({
    success: true,
    data: {
      summary,
      range: {
        start,
        end,
      },
      rows,
    },
  });
});

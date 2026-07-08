const AdminWorkSession = require("../models/AdminWorkSession");

const TRACKED_ROLES = new Set(["SalesAdmin", "SalesStaff", "Receptionist", "Accountant"]);
const ONLINE_WINDOW_MS = 90 * 1000;

const emitWorkSessionUpdate = (session, eventType = "updated") => {
  try {
    const io = global.__crm_io;
    if (!io || !session) return;
    const payload = {
      eventType,
      adminId: String(session.adminId || ""),
      teamAdminId: String(session.teamAdminId || ""),
      role: session.role || "",
      currentState: session.currentState || "",
      loginAt: session.loginAt || null,
      lastSeenAt: session.lastSeenAt || null,
      endedAt: session.endedAt || null,
    };
    io.to("role:MainAdmin").emit("crm:work-session.updated", payload);
    io.to("role:HRManager").emit("crm:work-session.updated", payload);
  } catch (error) {
    console.error("Failed to emit work-session socket event:", error);
  }
};

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const isTrackedRole = (role = "") => TRACKED_ROLES.has(String(role || ""));

const isTrackedAdmin = (admin) => isTrackedRole(admin?.role);

const getTrackingManagerId = (admin) => {
  if (!admin) return null;
  if (String(admin.role || "") === "SalesStaff") {
    return admin.reportsTo || null;
  }
  return admin._id || null;
};

const getClientIp = (req) => {
  const xfwd = req?.headers?.["x-forwarded-for"];
  if (typeof xfwd === "string" && xfwd.length) return xfwd.split(",")[0].trim();
  return req?.ip || req?.connection?.remoteAddress || "";
};

const getUserAgent = (req) => String(req?.headers?.["user-agent"] || "").slice(0, 500);

const toDate = (value, fallback = new Date()) => {
  const date = value instanceof Date ? value : new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const diffSeconds = (start, end) => {
  const startTime = toDate(start).getTime();
  const endTime = toDate(end).getTime();
  return Math.max(0, Math.floor((endTime - startTime) / 1000));
};

const getBreakDurationSeconds = (session, referenceTime = new Date()) => {
  const entries = Array.isArray(session?.breakEntries) ? session.breakEntries : [];
  const completedSeconds = entries.reduce((total, entry) => {
    if (!entry?.startedAt) return total;
    const entryEnd = entry.endedAt || entry.startedAt;
    const storedDuration = Number(entry.durationSeconds || 0);
    return total + Math.max(storedDuration, diffSeconds(entry.startedAt, entryEnd));
  }, 0);

  if (session?.currentState === "on_break" && session?.currentBreakStartedAt && !session?.endedAt) {
    return completedSeconds + diffSeconds(session.currentBreakStartedAt, referenceTime);
  }

  return completedSeconds;
};

const getActiveDurationSeconds = (session, referenceTime = new Date()) => {
  if (!session?.loginAt) return 0;
  const endPoint = session?.endedAt || referenceTime;
  const totalElapsedSeconds = diffSeconds(session.loginAt, endPoint);
  return Math.max(0, totalElapsedSeconds - getBreakDurationSeconds(session, referenceTime));
};

const isSessionOnline = (session, referenceTime = new Date()) => {
  if (!session || session.endedAt) return false;
  const lastSeenAt = session.lastSeenAt || session.loginAt;
  return toDate(referenceTime).getTime() - toDate(lastSeenAt).getTime() <= ONLINE_WINDOW_MS;
};

const serializeWorkSession = (session, referenceTime = new Date()) => {
  if (!session) return null;

  const breakDurationSeconds = getBreakDurationSeconds(session, referenceTime);
  const activeDurationSeconds = getActiveDurationSeconds(session, referenceTime);
  const totalElapsedSeconds = Math.max(0, diffSeconds(session.loginAt, session.endedAt || referenceTime));
  const isOnline = isSessionOnline(session, referenceTime);

  return {
    _id: session._id,
    adminId: session.adminId,
    teamAdminId: session.teamAdminId,
    role: session.role,
    loginAt: session.loginAt,
    lastSeenAt: session.lastSeenAt,
    endedAt: session.endedAt,
    endReason: session.endReason || "",
    currentState: session.currentState,
    currentBreakStartedAt: session.currentBreakStartedAt,
    currentBreakSource: session.currentBreakSource || "",
    isOnline,
    breakEntries: (session.breakEntries || []).map((entry) => ({
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      durationSeconds: Math.max(Number(entry.durationSeconds || 0), diffSeconds(entry.startedAt, entry.endedAt || entry.startedAt)),
      source: entry.source || "manual",
    })),
    metrics: {
      totalElapsedSeconds,
      activeDurationSeconds,
      breakDurationSeconds,
    },
  };
};

const closeOpenBreakIfNeeded = (session, now = new Date()) => {
  if (session.currentState !== "on_break" || !session.currentBreakStartedAt) return;

  session.breakEntries = Array.isArray(session.breakEntries) ? session.breakEntries : [];
  session.breakEntries.push({
    startedAt: session.currentBreakStartedAt,
    endedAt: now,
    durationSeconds: diffSeconds(session.currentBreakStartedAt, now),
    source: session.currentBreakSource || "manual",
  });
  session.currentBreakStartedAt = null;
  session.currentBreakSource = null;
};

const closeSession = async (session, { now = new Date(), reason = "logout" } = {}) => {
  if (!session || session.endedAt) return session;

  closeOpenBreakIfNeeded(session, now);
  session.lastSeenAt = now;
  session.endedAt = now;
  session.endReason = reason;
  session.currentState = "ended";
  session.activeSecondsSnapshot = getActiveDurationSeconds(session, now);
  session.breakSecondsSnapshot = getBreakDurationSeconds(session, now);
  await session.save();
  emitWorkSessionUpdate(session, "ended");
  return session;
};

const closeAnyExistingOpenSessions = async (adminId, { reason = "relogin", now = new Date() } = {}) => {
  const openSessions = await AdminWorkSession.find({
    adminId,
    endedAt: null,
  }).sort({ loginAt: -1 });

  for (const session of openSessions) {
    await closeSession(session, { now, reason });
  }
};

const startTrackedWorkSession = async (admin, req, { now = new Date() } = {}) => {
  if (!isTrackedAdmin(admin)) return null;

  await closeAnyExistingOpenSessions(admin._id, { reason: "relogin", now });

  const session = await AdminWorkSession.create({
    adminId: admin._id,
    teamAdminId: getTrackingManagerId(admin),
    role: admin.role,
    loginAt: now,
    lastSeenAt: now,
    currentState: "working",
    breakEntries: [],
    loginIp: getClientIp(req),
    userAgent: getUserAgent(req),
  });

  emitWorkSessionUpdate(session, "started");

  return session;
};

const findOpenSessionForAdmin = (adminId) =>
  AdminWorkSession.findOne({
    adminId,
    endedAt: null,
  }).sort({ loginAt: -1 });

const ensureOpenTrackedWorkSession = async (admin, req, { now = new Date() } = {}) => {
  if (!isTrackedAdmin(admin)) return null;

  const existing = await findOpenSessionForAdmin(admin._id);
  if (existing) return existing;

  return startTrackedWorkSession(admin, req, { now });
};

const touchTrackedWorkSession = async (admin, req, { now = new Date() } = {}) => {
  const session = await ensureOpenTrackedWorkSession(admin, req, { now });
  if (!session) return null;

  session.lastSeenAt = now;
  if (session.currentState === "ended") {
    session.currentState = "working";
    session.endedAt = null;
    session.endReason = null;
  }
  await session.save();
  return session;
};

const resumeAutoPausedTrackedWorkSession = async (session, { now = new Date() } = {}) => {
  if (!session) return null;
  if (session.currentState !== "on_break" || session.currentBreakSource !== "window_close") {
    return session;
  }

  closeOpenBreakIfNeeded(session, now);
  session.currentState = "working";
  session.lastSeenAt = now;
  await session.save();
  emitWorkSessionUpdate(session, "resumed");
  return session;
};

const touchOrResumeTrackedWorkSession = async (admin, req, { now = new Date() } = {}) => {
  const session = await ensureOpenTrackedWorkSession(admin, req, { now });
  if (!session) return null;

  session.lastSeenAt = now;
  await resumeAutoPausedTrackedWorkSession(session, { now });

  if (session.currentState === "ended") {
    session.currentState = "working";
    session.endedAt = null;
    session.endReason = null;
  }
  await session.save();
  return session;
};

const toggleTrackedWorkBreak = async (admin, req, { now = new Date() } = {}) => {
  const session = await ensureOpenTrackedWorkSession(admin, req, { now });
  if (!session) return null;

  session.lastSeenAt = now;

  if (session.currentState === "on_break") {
    closeOpenBreakIfNeeded(session, now);
    session.currentState = "working";
  } else {
    session.currentState = "on_break";
    session.currentBreakStartedAt = now;
    session.currentBreakSource = "manual";
  }

  await session.save();
  emitWorkSessionUpdate(session, session.currentState === "on_break" ? "break_started" : "break_ended");
  return session;
};

const autoPauseTrackedWorkSession = async (admin, req, { now = new Date() } = {}) => {
  const session = await ensureOpenTrackedWorkSession(admin, req, { now });
  if (!session) return null;

  session.lastSeenAt = now;

  if (session.currentState === "working") {
    session.currentState = "on_break";
    session.currentBreakStartedAt = now;
    session.currentBreakSource = "window_close";
  }

  await session.save();
  emitWorkSessionUpdate(session, "auto_paused");
  return session;
};

const endTrackedWorkSession = async (admin, { now = new Date(), reason = "logout" } = {}) => {
  if (!isTrackedAdmin(admin)) return null;
  const session = await findOpenSessionForAdmin(admin._id);
  if (!session) return null;
  return closeSession(session, { now, reason });
};

module.exports = {
  autoPauseTrackedWorkSession,
  ONLINE_WINDOW_MS,
  closeAnyExistingOpenSessions,
  endTrackedWorkSession,
  ensureOpenTrackedWorkSession,
  findOpenSessionForAdmin,
  getActiveDurationSeconds,
  getBreakDurationSeconds,
  getTrackingManagerId,
  isSessionOnline,
  isTrackedAdmin,
  isTrackedRole,
  resumeAutoPausedTrackedWorkSession,
  serializeWorkSession,
  startTrackedWorkSession,
  touchOrResumeTrackedWorkSession,
  touchTrackedWorkSession,
  toggleTrackedWorkBreak,
};

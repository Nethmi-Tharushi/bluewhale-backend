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

const diffSeconds = (start, end) => {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
};

const getOverlapSeconds = (startA, endA, startB, endB) => {
  const from = Math.max(new Date(startA).getTime(), new Date(startB).getTime());
  const to = Math.min(new Date(endA).getTime(), new Date(endB).getTime());
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return 0;
  return Math.max(0, Math.floor((to - from) / 1000));
};

const getSessionRangeMetrics = (session, { start, end, referenceTime = new Date() }) => {
  const sessionStart = session?.loginAt ? new Date(session.loginAt) : null;
  const sessionEnd = session?.endedAt ? new Date(session.endedAt) : new Date(referenceTime);
  if (!sessionStart || Number.isNaN(sessionStart.getTime()) || Number.isNaN(sessionEnd.getTime())) {
    return {
      overlapSeconds: 0,
      activeSeconds: 0,
      breakSeconds: 0,
      overlapStart: null,
      overlapEnd: null,
    };
  }

  const overlapSeconds = getOverlapSeconds(sessionStart, sessionEnd, start, end);
  if (!overlapSeconds) {
    return {
      overlapSeconds: 0,
      activeSeconds: 0,
      breakSeconds: 0,
      overlapStart: null,
      overlapEnd: null,
    };
  }

  const overlapStart = new Date(Math.max(sessionStart.getTime(), start.getTime()));
  const overlapEnd = new Date(Math.min(sessionEnd.getTime(), end.getTime()));

  let breakSeconds = 0;
  const breakEntries = Array.isArray(session?.breakEntries) ? session.breakEntries : [];
  breakEntries.forEach((entry) => {
    if (!entry?.startedAt) return;
    const entryStart = new Date(entry.startedAt);
    const entryEnd = new Date(entry.endedAt || entry.startedAt);
    breakSeconds += getOverlapSeconds(entryStart, entryEnd, start, end);
  });

  if (session?.currentState === "on_break" && session?.currentBreakStartedAt && !session?.endedAt) {
    breakSeconds += getOverlapSeconds(session.currentBreakStartedAt, referenceTime, start, end);
  }

  breakSeconds = Math.min(breakSeconds, overlapSeconds);

  return {
    overlapSeconds,
    activeSeconds: Math.max(0, overlapSeconds - breakSeconds),
    breakSeconds,
    overlapStart,
    overlapEnd,
  };
};

const normalizeTrackingRoleFilter = (value = "") => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "all") return "";
  return TRACKING_ROLES.includes(normalized) ? normalized : "";
};

const normalizeIdList = (value) => {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return raw.map((item) => String(item || "").trim()).filter(Boolean);
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

exports.getHrWorkSessionHistory = asyncHandler(async (req, res) => {
  const { start, end } = getRangeBounds(req.query || {});
  const now = new Date();
  const roleFilter = normalizeTrackingRoleFilter(req.query?.role);
  const memberIds = normalizeIdList(req.query?.memberIds);

  const adminQuery = {
    role: roleFilter ? roleFilter : { $in: TRACKING_ROLES },
  };

  if (memberIds.length) {
    adminQuery._id = { $in: memberIds };
  }

  const admins = await AdminUser.find(adminQuery)
    .select("_id name email role reportsTo lastLogin")
    .populate("reportsTo", "_id name email role")
    .sort({ role: 1, name: 1 })
    .lean();

  const adminIds = admins.map((admin) => admin._id);

  const sessions = adminIds.length
    ? await AdminWorkSession.find({
        adminId: { $in: adminIds },
        loginAt: { $lt: end },
        $or: [{ endedAt: null }, { endedAt: { $gte: start } }],
      })
        .sort({ loginAt: -1 })
        .lean()
    : [];

  const sessionsByAdmin = new Map();
  sessions.forEach((session) => {
    const key = String(session.adminId || "");
    if (!sessionsByAdmin.has(key)) sessionsByAdmin.set(key, []);
    sessionsByAdmin.get(key).push(session);
  });

  const rows = admins.map((admin) => {
    const key = String(admin._id || "");
    const memberSessions = sessionsByAdmin.get(key) || [];

    let totalLoggedSeconds = 0;
    let totalActiveSeconds = 0;
    let totalBreakSeconds = 0;
    let firstLoginAt = null;
    let lastLogoutAt = null;
    let lastSeenAt = null;

    const sessionDetails = memberSessions.map((session) => {
      const rangeMetrics = getSessionRangeMetrics(session, { start, end, referenceTime: now });
      totalLoggedSeconds += rangeMetrics.overlapSeconds;
      totalActiveSeconds += rangeMetrics.activeSeconds;
      totalBreakSeconds += rangeMetrics.breakSeconds;

      if (!firstLoginAt || new Date(session.loginAt).getTime() < new Date(firstLoginAt).getTime()) {
        firstLoginAt = session.loginAt;
      }

      const sessionLastSeen = session.endedAt || session.lastSeenAt || session.loginAt || null;
      if (sessionLastSeen && (!lastSeenAt || new Date(sessionLastSeen).getTime() > new Date(lastSeenAt).getTime())) {
        lastSeenAt = sessionLastSeen;
      }

      if (session.endedAt && (!lastLogoutAt || new Date(session.endedAt).getTime() > new Date(lastLogoutAt).getTime())) {
        lastLogoutAt = session.endedAt;
      }

      return {
        _id: session._id,
        loginAt: session.loginAt,
        endedAt: session.endedAt || null,
        currentState: session.currentState || "ended",
        currentBreakSource: session.currentBreakSource || "",
        endReason: session.endReason || "",
        overlapStart: rangeMetrics.overlapStart,
        overlapEnd: rangeMetrics.overlapEnd,
        metrics: {
          loggedSeconds: rangeMetrics.overlapSeconds,
          activeSeconds: rangeMetrics.activeSeconds,
          breakSeconds: rangeMetrics.breakSeconds,
        },
      };
    });

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
      firstLoginAt,
      lastLogoutAt,
      lastSeenAt: lastSeenAt || admin.lastLogin || null,
      sessionDetails,
      metrics: {
        sessionCount: sessionDetails.length,
        totalLoggedSeconds,
        totalActiveSeconds,
        totalBreakSeconds,
        utilizationPercent: totalLoggedSeconds ? Math.round((totalActiveSeconds / totalLoggedSeconds) * 100) : 0,
      },
    };
  });

  const summary = rows.reduce(
    (acc, row) => {
      acc.totalMembers += 1;
      acc.totalSessions += Number(row.metrics?.sessionCount || 0);
      acc.totalLoggedSeconds += Number(row.metrics?.totalLoggedSeconds || 0);
      acc.totalActiveSeconds += Number(row.metrics?.totalActiveSeconds || 0);
      acc.totalBreakSeconds += Number(row.metrics?.totalBreakSeconds || 0);
      return acc;
    },
    {
      totalMembers: 0,
      totalSessions: 0,
      totalLoggedSeconds: 0,
      totalActiveSeconds: 0,
      totalBreakSeconds: 0,
    }
  );

  const members = admins.map((admin) => ({
    _id: admin._id,
    name: admin.name || "",
    email: admin.email || "",
    role: admin.role || "",
    reportsTo: admin.reportsTo
      ? {
          _id: admin.reportsTo._id,
          name: admin.reportsTo.name || "",
        }
      : null,
  }));

  return res.json({
    success: true,
    data: {
      summary: {
        ...summary,
        utilizationPercent: summary.totalLoggedSeconds
          ? Math.round((summary.totalActiveSeconds / summary.totalLoggedSeconds) * 100)
          : 0,
      },
      range: {
        start,
        end,
      },
      filters: {
        role: roleFilter || "all",
        memberIds,
      },
      members,
      rows,
    },
  });
});

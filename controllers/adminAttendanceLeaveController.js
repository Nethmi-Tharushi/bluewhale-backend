const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const AdminUser = require("../models/AdminUser");
const AdminWorkSession = require("../models/AdminWorkSession");
const AdminLeaveRequest = require("../models/AdminLeaveRequest");
const {
  buildLeaveBalanceForAdmin,
  buildLeaveBalanceMapForAdmins,
  ensureLeavePolicySettings,
  getLeaveTypeBalanceEntry,
  normalizeLeaveTypeKey,
  serializeLeavePolicy,
  updateLeavePolicySettings,
} = require("../services/adminLeavePolicyService");

const TRACKING_ROLES = ["SalesAdmin", "SalesStaff", "Receptionist", "Accountant"];
const REVIEWABLE_STATUSES = new Set(["approved", "rejected"]);

const emitHrLeaveUpdate = (eventType, request) => {
  try {
    const io = global.__crm_io;
    if (!io || !request) return;
    const payload = {
      eventType,
      leaveRequestId: String(request._id || ""),
      adminId: String(request.adminId?._id || request.adminId || ""),
      role: request.role || "",
      status: request.status || "",
      startDate: request.startDate || null,
      endDate: request.endDate || null,
      reviewedAt: request.reviewedAt || null,
      updatedAt: new Date().toISOString(),
    };
    io.to("role:HRManager").emit("crm:hr-leave.updated", payload);
    io.to("role:MainAdmin").emit("crm:hr-leave.updated", payload);
  } catch (error) {
    console.error("Failed to emit HR leave socket event:", error);
  }
};

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

const getRangeBounds = (query = {}, defaultDays = 1) => {
  const now = new Date();
  const fallbackStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fallbackEnd = new Date(fallbackStart);
  fallbackEnd.setDate(fallbackEnd.getDate() + Math.max(1, Number(defaultDays) || 1));

  const start = parseDateInput(query.start || query.date, fallbackStart);
  const end = parseDateInput(query.end, fallbackEnd);

  if (end <= start) {
    const correctedEnd = new Date(start);
    correctedEnd.setDate(correctedEnd.getDate() + 1);
    return { start, end: correctedEnd };
  }

  return { start, end };
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

const normalizeDateOnly = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const startOfDay = (value) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const addDays = (value, days) => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

const enumerateRangeDays = (start, end) => {
  const days = [];
  const cursor = startOfDay(start);
  while (cursor < end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
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
    breakSeconds += getOverlapSeconds(entry.startedAt, entry.endedAt || entry.startedAt, start, end);
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

const serializeLeaveRequest = (request) => {
  if (!request) return null;
  return {
    _id: request._id,
    leaveType: request.leaveType || "annual",
    startDate: request.startDate || null,
    endDate: request.endDate || null,
    reason: request.reason || "",
    attachmentUrl: request.attachmentUrl || "",
    attachmentFileName: request.attachmentFileName || "",
    attachmentCloudinaryId: request.attachmentCloudinaryId || "",
    attachmentMimeType: request.attachmentMimeType || "",
    status: request.status || "pending",
    reviewNotes: request.reviewNotes || "",
    cancellationReason: request.cancellationReason || "",
    totalDays: Number(request.totalDays || 0),
    createdAt: request.createdAt || null,
    updatedAt: request.updatedAt || null,
    reviewedAt: request.reviewedAt || null,
    role: request.role || "",
    admin: request.adminId && typeof request.adminId === "object"
      ? {
          _id: request.adminId._id,
          name: request.adminId.name || "",
          email: request.adminId.email || "",
          role: request.adminId.role || "",
          reportsTo: request.adminId.reportsTo && typeof request.adminId.reportsTo === "object"
            ? {
                _id: request.adminId.reportsTo._id,
                name: request.adminId.reportsTo.name || "",
                email: request.adminId.reportsTo.email || "",
              }
            : null,
        }
      : null,
    reviewedBy: request.reviewedBy && typeof request.reviewedBy === "object"
      ? {
          _id: request.reviewedBy._id,
          name: request.reviewedBy.name || "",
          email: request.reviewedBy.email || "",
          role: request.reviewedBy.role || "",
        }
      : null,
  };
};

const getLeaveTotalDays = (startDate, endDate) => {
  const start = startOfDay(startDate);
  const end = startOfDay(endDate);
  const diffMs = end.getTime() - start.getTime();
  return Math.max(1, Math.floor(diffMs / 86400000) + 1);
};

const getCalendarYear = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().getFullYear();
  return date.getFullYear();
};

const serializeBalanceContext = (balances = [], leaveType = "", requestedDays = 0, year = new Date().getFullYear()) => {
  const current = getLeaveTypeBalanceEntry(balances, leaveType);
  return {
    year,
    entries: balances,
    current: current
      ? {
          ...current,
          requestedDays: Number(requestedDays || 0),
          remainingAfterApproval: current.unlimited ? null : Math.max(0, Number(current.remainingDays || 0) - Number(requestedDays || 0)),
        }
      : null,
  };
};

const ensureTrackedAdmin = (req, res) => {
  if (TRACKING_ROLES.includes(String(req.admin?.role || ""))) return true;
  res.status(403).json({ message: "Leave requests are available only for SalesAdmin, SalesStaff, Receptionist, and Accountant accounts" });
  return false;
};

exports.createMyLeaveRequest = asyncHandler(async (req, res) => {
  if (!ensureTrackedAdmin(req, res)) return;

  const leaveType = normalizeLeaveTypeKey(req.body?.leaveType);
  const startDate = parseDateInput(req.body?.startDate, null);
  const endDate = parseDateInput(req.body?.endDate, null);
  const reason = String(req.body?.reason || "").trim();
  const uploadedFile = req.file || null;

  if (!leaveType) return res.status(400).json({ message: "Leave type is required" });
  if (!startDate || Number.isNaN(startDate.getTime()) || !endDate || Number.isNaN(endDate.getTime())) {
    return res.status(400).json({ message: "Valid startDate and endDate are required" });
  }

  const normalizedStart = startOfDay(startDate);
  const normalizedEnd = startOfDay(endDate);
  if (normalizedEnd < normalizedStart) {
    return res.status(400).json({ message: "endDate cannot be earlier than startDate" });
  }
  if (getCalendarYear(normalizedStart) !== getCalendarYear(normalizedEnd)) {
    return res.status(400).json({ message: "Leave request must stay within a single calendar year" });
  }

  const overlap = await AdminLeaveRequest.findOne({
    adminId: req.admin._id,
    status: { $in: ["pending", "approved"] },
    startDate: { $lte: normalizedEnd },
    endDate: { $gte: normalizedStart },
  }).lean();

  if (overlap) {
    return res.status(409).json({ message: "An overlapping pending or approved leave request already exists" });
  }

  const totalDays = getLeaveTotalDays(normalizedStart, normalizedEnd);
  const leavePolicySettings = await ensureLeavePolicySettings();
  const leavePolicy = serializeLeavePolicy(leavePolicySettings);
  const { balances } = await buildLeaveBalanceForAdmin({
    adminId: req.admin._id,
    role: req.admin.role,
    year: getCalendarYear(normalizedStart),
    settings: leavePolicySettings,
    statuses: ["approved", "pending"],
  });
  const balanceEntry = getLeaveTypeBalanceEntry(balances, leaveType);
  if (!balanceEntry || !balanceEntry.active) {
    return res.status(400).json({ message: "This leave type is not available for your role" });
  }
  if (!balanceEntry.unlimited && Number(balanceEntry.remainingAfterPendingDays || 0) < totalDays) {
    return res.status(409).json({
      message: `Only ${Number(balanceEntry.remainingAfterPendingDays || 0)} day(s) remain for ${balanceEntry.label}`,
      data: {
        leavePolicy,
        balance: serializeBalanceContext(balances, leaveType, totalDays, getCalendarYear(normalizedStart)),
      },
    });
  }

  const request = await AdminLeaveRequest.create({
    adminId: req.admin._id,
    role: req.admin.role,
    teamAdminId: req.admin.reportsTo || null,
    leaveType,
    startDate: normalizedStart,
    endDate: normalizedEnd,
    reason,
    attachmentUrl: uploadedFile?.path || uploadedFile?.secure_url || "",
    attachmentFileName: uploadedFile?.originalname || "",
    attachmentCloudinaryId: uploadedFile?.filename || uploadedFile?.public_id || "",
    attachmentMimeType: uploadedFile?.mimetype || "",
    totalDays,
  });

  emitHrLeaveUpdate("created", request);
  return res.status(201).json({
    success: true,
    data: {
      ...serializeLeaveRequest(request.toObject()),
      balance: serializeBalanceContext(balances, leaveType, totalDays, getCalendarYear(normalizedStart)),
    },
  });
});

exports.getMyLeaveRequests = asyncHandler(async (req, res) => {
  if (!ensureTrackedAdmin(req, res)) return;
  const statusFilter = String(req.query?.status || "all").trim();
  const balanceYear = Number(req.query?.year) || new Date().getFullYear();
  const query = { adminId: req.admin._id };
  if (statusFilter && statusFilter !== "all") {
    query.status = statusFilter;
  }

  const requests = await AdminLeaveRequest.find(query)
    .sort({ startDate: -1, createdAt: -1 })
    .populate("reviewedBy", "_id name email role")
    .lean();

  const summary = requests.reduce(
    (acc, item) => {
      acc.total += 1;
      acc[item.status] = Number(acc[item.status] || 0) + 1;
      return acc;
    },
    { total: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0 }
  );
  const leavePolicySettings = await ensureLeavePolicySettings();
  const leavePolicy = serializeLeavePolicy(leavePolicySettings);
  const { balances } = await buildLeaveBalanceForAdmin({
    adminId: req.admin._id,
    role: req.admin.role,
    year: balanceYear,
    settings: leavePolicySettings,
    statuses: ["approved", "pending"],
  });

  return res.json({
    success: true,
    data: {
      summary,
      leavePolicy,
      leaveBalance: {
        year: balanceYear,
        entries: balances,
      },
      rows: requests.map((item) => serializeLeaveRequest(item)),
    },
  });
});

exports.cancelMyLeaveRequest = asyncHandler(async (req, res) => {
  if (!ensureTrackedAdmin(req, res)) return;

  const leaveRequest = await AdminLeaveRequest.findOne({
    _id: req.params.id,
    adminId: req.admin._id,
  });

  if (!leaveRequest) {
    return res.status(404).json({ message: "Leave request not found" });
  }
  if (leaveRequest.status !== "pending") {
    return res.status(400).json({ message: "Only pending leave requests can be cancelled" });
  }

  leaveRequest.status = "cancelled";
  leaveRequest.cancellationReason = String(req.body?.cancellationReason || "").trim();
  leaveRequest.reviewNotes = "";
  leaveRequest.reviewedAt = null;
  leaveRequest.reviewedBy = null;
  await leaveRequest.save();

  emitHrLeaveUpdate("cancelled", leaveRequest);
  return res.json({ success: true, data: serializeLeaveRequest(leaveRequest.toObject()) });
});

exports.getHrLeaveRequests = asyncHandler(async (req, res) => {
  const hasDateFilter = Boolean(String(req.query?.start || req.query?.date || "").trim() || String(req.query?.end || "").trim());
  const { start, end } = hasDateFilter ? getRangeBounds(req.query || {}, 30) : { start: null, end: null };
  const roleFilter = normalizeTrackingRoleFilter(req.query?.role);
  const memberIds = normalizeIdList(req.query?.memberIds);
  const statusFilter = String(req.query?.status || "all").trim();
  const search = String(req.query?.search || "").trim();

  const query = hasDateFilter
    ? {
        $or: [
          {
            startDate: { $lt: end },
            endDate: { $gte: start },
          },
          {
            createdAt: { $gte: start, $lt: end },
          },
          {
            status: "pending",
          },
        ],
      }
    : {};

  if (roleFilter) query.role = roleFilter;
  if (memberIds.length) {
    query.adminId = { $in: memberIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) };
  }
  if (statusFilter && statusFilter !== "all") {
    query.status = statusFilter;
  }

  const requests = await AdminLeaveRequest.find(query)
    .sort({ createdAt: -1 })
    .populate("adminId", "_id name email role reportsTo")
    .populate({
      path: "adminId",
      populate: { path: "reportsTo", select: "_id name email role" },
    })
    .populate("reviewedBy", "_id name email role")
    .lean();

  const filteredRequests = search
    ? requests.filter((item) => {
        const haystack = [
          item.adminId?.name,
          item.adminId?.email,
          item.role,
          item.leaveType,
          item.reason,
          item.adminId?.reportsTo?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(search.toLowerCase());
      })
    : requests;

  const members = await AdminUser.find({
    role: roleFilter ? roleFilter : { $in: TRACKING_ROLES },
  })
    .select("_id name email role reportsTo")
    .populate("reportsTo", "_id name email role")
    .sort({ role: 1, name: 1 })
    .lean();

  const summary = filteredRequests.reduce(
    (acc, item) => {
      acc.total += 1;
      acc.totalDays += Number(item.totalDays || 0);
      acc[item.status] = Number(acc[item.status] || 0) + 1;
      return acc;
    },
    { total: 0, totalDays: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0 }
  );

  const leavePolicySettings = await ensureLeavePolicySettings();
  const leavePolicy = serializeLeavePolicy(leavePolicySettings);
  const requestYears = [...new Set(filteredRequests.map((item) => getCalendarYear(item.startDate)))];
  const balanceMapByAdminYear = new Map();

  for (const year of requestYears) {
    const { balanceMap } = await buildLeaveBalanceMapForAdmins({
      admins: members.map((member) => ({ _id: member._id, role: member.role || "" })),
      year,
      settings: leavePolicySettings,
      statuses: ["approved", "pending"],
    });
    balanceMap.forEach((balances, adminId) => {
      balanceMapByAdminYear.set(`${adminId}:${year}`, balances);
    });
  }

  return res.json({
    success: true,
    data: {
      summary,
      leavePolicy,
      range: { start, end },
      filters: {
        role: roleFilter || "all",
        status: statusFilter || "all",
        memberIds,
        search,
      },
      members: members.map((member) => ({
        _id: member._id,
        name: member.name || "",
        email: member.email || "",
        role: member.role || "",
        reportsTo: member.reportsTo
          ? {
              _id: member.reportsTo._id,
              name: member.reportsTo.name || "",
              email: member.reportsTo.email || "",
            }
          : null,
      })),
      rows: filteredRequests.map((item) => {
        const serialized = serializeLeaveRequest(item);
        const year = getCalendarYear(item.startDate);
        const balances = balanceMapByAdminYear.get(`${String(item.adminId?._id || item.adminId || "")}:${year}`) || [];
        return {
          ...serialized,
          balance: serializeBalanceContext(balances, item.leaveType, item.totalDays, year),
        };
      }),
    },
  });
});

exports.reviewHrLeaveRequest = asyncHandler(async (req, res) => {
  const nextStatus = String(req.body?.status || "").trim().toLowerCase();
  const reviewNotes = String(req.body?.reviewNotes || "").trim();

  if (!REVIEWABLE_STATUSES.has(nextStatus)) {
    return res.status(400).json({ message: "status must be approved or rejected" });
  }

  const leaveRequest = await AdminLeaveRequest.findById(req.params.id);
  if (!leaveRequest) {
    return res.status(404).json({ message: "Leave request not found" });
  }
  if (leaveRequest.status !== "pending") {
    return res.status(400).json({ message: "Only pending leave requests can be approved or rejected" });
  }
  if (leaveRequest.status === "cancelled") {
    return res.status(400).json({ message: "Cancelled leave requests cannot be reviewed" });
  }

  if (nextStatus === "approved") {
    const leavePolicySettings = await ensureLeavePolicySettings();
    const { balances } = await buildLeaveBalanceForAdmin({
      adminId: leaveRequest.adminId,
      role: leaveRequest.role,
      year: getCalendarYear(leaveRequest.startDate),
      settings: leavePolicySettings,
      excludeRequestId: leaveRequest._id,
      statuses: ["approved"],
    });
    const balanceEntry = getLeaveTypeBalanceEntry(balances, leaveRequest.leaveType);
    if (!balanceEntry || !balanceEntry.active) {
      return res.status(400).json({ message: "This leave type is no longer available for the requester's role" });
    }
    if (!balanceEntry.unlimited && Number(balanceEntry.remainingDays || 0) < Number(leaveRequest.totalDays || 0)) {
      return res.status(409).json({
        message: `Only ${Number(balanceEntry.remainingDays || 0)} day(s) remain for ${balanceEntry.label}`,
        data: {
          balance: serializeBalanceContext(balances, leaveRequest.leaveType, leaveRequest.totalDays, getCalendarYear(leaveRequest.startDate)),
        },
      });
    }
  }

  leaveRequest.status = nextStatus;
  leaveRequest.reviewNotes = reviewNotes;
  leaveRequest.reviewedAt = new Date();
  leaveRequest.reviewedBy = req.admin._id;
  await leaveRequest.save();

  const populated = await AdminLeaveRequest.findById(leaveRequest._id)
    .populate("adminId", "_id name email role reportsTo")
    .populate({
      path: "adminId",
      populate: { path: "reportsTo", select: "_id name email role" },
    })
    .populate("reviewedBy", "_id name email role")
    .lean();

  emitHrLeaveUpdate("reviewed", populated);
  return res.json({
    success: true,
    data: {
      ...serializeLeaveRequest(populated),
    },
  });
});

exports.getHrLeaveSettings = asyncHandler(async (req, res) => {
  const settings = await ensureLeavePolicySettings();
  return res.json({
    success: true,
    data: serializeLeavePolicy(settings),
  });
});

exports.updateHrLeaveSettings = asyncHandler(async (req, res) => {
  const settings = await updateLeavePolicySettings(req.body || {}, req.admin?._id || null);
  return res.json({
    success: true,
    data: serializeLeavePolicy(settings),
  });
});

exports.getHrAttendanceSummary = asyncHandler(async (req, res) => {
  const { start, end } = getRangeBounds(req.query || {}, 7);
  const now = new Date();
  const roleFilter = normalizeTrackingRoleFilter(req.query?.role);
  const memberIds = normalizeIdList(req.query?.memberIds);
  const statusFilter = String(req.query?.status || "all").trim().toLowerCase();

  const adminQuery = {
    role: roleFilter ? roleFilter : { $in: TRACKING_ROLES },
  };

  if (memberIds.length) {
    adminQuery._id = { $in: memberIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) };
  }

  const admins = await AdminUser.find(adminQuery)
    .select("_id name email role reportsTo lastLogin")
    .populate("reportsTo", "_id name email role")
    .sort({ role: 1, name: 1 })
    .lean();

  const adminIds = admins.map((admin) => admin._id);
  const [sessions, leaveRequests] = adminIds.length
    ? await Promise.all([
        AdminWorkSession.find({
          adminId: { $in: adminIds },
          loginAt: { $lt: end },
          $or: [{ endedAt: null }, { endedAt: { $gte: start } }],
        })
          .sort({ loginAt: -1 })
          .lean(),
        AdminLeaveRequest.find({
          adminId: { $in: adminIds },
          status: "approved",
          startDate: { $lt: end },
          endDate: { $gte: start },
        })
          .sort({ startDate: -1 })
          .lean(),
      ])
    : [[], []];

  const sessionsByAdmin = new Map();
  sessions.forEach((session) => {
    const key = String(session.adminId || "");
    if (!sessionsByAdmin.has(key)) sessionsByAdmin.set(key, []);
    sessionsByAdmin.get(key).push(session);
  });

  const leaveByAdmin = new Map();
  leaveRequests.forEach((item) => {
    const key = String(item.adminId || "");
    if (!leaveByAdmin.has(key)) leaveByAdmin.set(key, []);
    leaveByAdmin.get(key).push(item);
  });

  const rangeDays = enumerateRangeDays(start, end);
  const rows = admins.map((admin) => {
    const key = String(admin._id || "");
    const memberSessions = sessionsByAdmin.get(key) || [];
    const memberLeaves = leaveByAdmin.get(key) || [];

    let totalLoggedSeconds = 0;
    let totalActiveSeconds = 0;
    let totalBreakSeconds = 0;
    let presentDays = 0;
    let leaveDays = 0;
    let absentDays = 0;
    let partialLeaveDays = 0;
    let firstLoginAt = null;
    let lastLogoutAt = null;
    let lastSeenAt = null;

    const dailyRecords = rangeDays.map((dayStart) => {
      const dayEnd = addDays(dayStart, 1);
      const dayKey = normalizeDateOnly(dayStart);
      const daySessions = memberSessions.filter((session) => {
        const loginAt = new Date(session.loginAt);
        const endedAt = session.endedAt ? new Date(session.endedAt) : now;
        return loginAt < dayEnd && endedAt >= dayStart;
      });
      const dayLeave = memberLeaves.find((item) => item.startDate < dayEnd && addDays(item.endDate, 1) > dayStart) || null;

      let dayLoggedSeconds = 0;
      let dayActiveSeconds = 0;
      let dayBreakSeconds = 0;
      let dayFirstLoginAt = null;
      let dayLastLogoutAt = null;
      let dayLastSeenAt = null;

      daySessions.forEach((session) => {
        const metrics = getSessionRangeMetrics(session, { start: dayStart, end: dayEnd, referenceTime: now });
        dayLoggedSeconds += metrics.overlapSeconds;
        dayActiveSeconds += metrics.activeSeconds;
        dayBreakSeconds += metrics.breakSeconds;

        if (metrics.overlapSeconds > 0) {
          if (!dayFirstLoginAt || new Date(session.loginAt).getTime() < new Date(dayFirstLoginAt).getTime()) {
            dayFirstLoginAt = session.loginAt;
          }
          const candidateLastSeen = session.endedAt || session.lastSeenAt || session.loginAt;
          if (candidateLastSeen && (!dayLastSeenAt || new Date(candidateLastSeen).getTime() > new Date(dayLastSeenAt).getTime())) {
            dayLastSeenAt = candidateLastSeen;
          }
          if (session.endedAt && (!dayLastLogoutAt || new Date(session.endedAt).getTime() > new Date(dayLastLogoutAt).getTime())) {
            dayLastLogoutAt = session.endedAt;
          }
        }
      });

      totalLoggedSeconds += dayLoggedSeconds;
      totalActiveSeconds += dayActiveSeconds;
      totalBreakSeconds += dayBreakSeconds;

      if (dayFirstLoginAt && (!firstLoginAt || new Date(dayFirstLoginAt).getTime() < new Date(firstLoginAt).getTime())) {
        firstLoginAt = dayFirstLoginAt;
      }
      if (dayLastLogoutAt && (!lastLogoutAt || new Date(dayLastLogoutAt).getTime() > new Date(lastLogoutAt).getTime())) {
        lastLogoutAt = dayLastLogoutAt;
      }
      if (dayLastSeenAt && (!lastSeenAt || new Date(dayLastSeenAt).getTime() > new Date(lastSeenAt).getTime())) {
        lastSeenAt = dayLastSeenAt;
      }

      let status = "absent";
      if (dayLeave && dayLoggedSeconds > 0) {
        status = "partial_leave";
        partialLeaveDays += 1;
      } else if (dayLeave) {
        status = "on_leave";
        leaveDays += 1;
      } else if (dayLoggedSeconds > 0) {
        status = "present";
        presentDays += 1;
      } else {
        absentDays += 1;
      }

      return {
        date: dayKey,
        status,
        leaveType: dayLeave?.leaveType || "",
        leaveRequestId: dayLeave?._id || null,
        loggedSeconds: dayLoggedSeconds,
        activeSeconds: dayActiveSeconds,
        breakSeconds: dayBreakSeconds,
        firstLoginAt: dayFirstLoginAt,
        lastLogoutAt: dayLastLogoutAt,
        lastSeenAt: dayLastSeenAt,
      };
    });

    const latestStatus = dailyRecords[dailyRecords.length - 1]?.status || "absent";

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
      latestStatus,
      metrics: {
        presentDays,
        leaveDays,
        absentDays,
        partialLeaveDays,
        totalLoggedSeconds,
        totalActiveSeconds,
        totalBreakSeconds,
        utilizationPercent: totalLoggedSeconds ? Math.round((totalActiveSeconds / totalLoggedSeconds) * 100) : 0,
      },
      dailyRecords,
    };
  });

  const filteredRows = statusFilter && statusFilter !== "all"
    ? rows.filter((row) => {
        if (statusFilter === "present") return Number(row.metrics.presentDays || 0) > 0;
        if (statusFilter === "on_leave") return Number(row.metrics.leaveDays || 0) > 0 || Number(row.metrics.partialLeaveDays || 0) > 0;
        if (statusFilter === "absent") return Number(row.metrics.absentDays || 0) > 0;
        return true;
      })
    : rows;

  const summary = filteredRows.reduce(
    (acc, row) => {
      acc.totalMembers += 1;
      acc.presentDays += Number(row.metrics.presentDays || 0);
      acc.leaveDays += Number(row.metrics.leaveDays || 0);
      acc.absentDays += Number(row.metrics.absentDays || 0);
      acc.partialLeaveDays += Number(row.metrics.partialLeaveDays || 0);
      acc.totalLoggedSeconds += Number(row.metrics.totalLoggedSeconds || 0);
      acc.totalActiveSeconds += Number(row.metrics.totalActiveSeconds || 0);
      acc.totalBreakSeconds += Number(row.metrics.totalBreakSeconds || 0);
      return acc;
    },
    {
      totalMembers: 0,
      presentDays: 0,
      leaveDays: 0,
      absentDays: 0,
      partialLeaveDays: 0,
      totalLoggedSeconds: 0,
      totalActiveSeconds: 0,
      totalBreakSeconds: 0,
    }
  );

  return res.json({
    success: true,
    data: {
      summary: {
        ...summary,
        utilizationPercent: summary.totalLoggedSeconds
          ? Math.round((summary.totalActiveSeconds / summary.totalLoggedSeconds) * 100)
          : 0,
      },
      range: { start, end },
      filters: {
        role: roleFilter || "all",
        status: statusFilter || "all",
        memberIds,
      },
      members: admins.map((admin) => ({
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
      })),
      rows: filteredRows,
    },
  });
});

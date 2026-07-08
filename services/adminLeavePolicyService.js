const mongoose = require("mongoose");
const AdminLeavePolicySettings = require("../models/AdminLeavePolicySettings");
const AdminLeaveRequest = require("../models/AdminLeaveRequest");

const TRACKED_ROLES = ["SalesAdmin", "SalesStaff", "Receptionist", "Accountant"];

const createTrackedRoleAllowances = (days, options = {}) =>
  TRACKED_ROLES.reduce((acc, role) => {
    acc[role] = {
      enabled: true,
      days,
      unlimited: Boolean(options.unlimited),
    };
    return acc;
  }, {});

const createDisabledTrackedRoleAllowances = () =>
  TRACKED_ROLES.reduce((acc, role) => {
    acc[role] = { enabled: false, days: 0, unlimited: false };
    return acc;
  }, {});

const normalizeTrackedRoleAllowances = (allowances = {}, fallback = {}) =>
  TRACKED_ROLES.reduce((acc, role) => {
    acc[role] = normalizeAllowance(allowances?.[role], fallback?.[role]);
    return acc;
  }, {});

const DEFAULT_LEAVE_TYPE_SETTINGS = [
  {
    key: "annual",
    label: "Annual leave",
    description: "Planned personal leave deducted from the yearly allocation.",
    active: true,
    sortOrder: 10,
    allowances: createTrackedRoleAllowances(14),
  },
  {
    key: "sick",
    label: "Sick leave",
    description: "Health-related leave tracked against the yearly allowance.",
    active: true,
    sortOrder: 20,
    allowances: createTrackedRoleAllowances(7),
  },
  {
    key: "casual",
    label: "Casual leave",
    description: "Short personal leave for urgent or day-to-day needs.",
    active: true,
    sortOrder: 30,
    allowances: createTrackedRoleAllowances(7),
  },
  {
    key: "unpaid",
    label: "Unpaid leave",
    description: "Leave that does not consume paid allowance.",
    active: true,
    sortOrder: 40,
    allowances: createTrackedRoleAllowances(0, { unlimited: true }),
  },
  {
    key: "other",
    label: "Other leave",
    description: "Custom leave category for approved exceptions.",
    active: true,
    sortOrder: 50,
    allowances: createTrackedRoleAllowances(2),
  },
];

const normalizeLeaveTypeKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);

const toTitleCase = (value = "") =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());

const normalizeDays = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Number(fallback) || 0);
  return Math.max(0, Math.round(numeric * 100) / 100);
};

const normalizeAllowance = (value = {}, fallback = {}) => ({
  enabled: Boolean(value.enabled ?? fallback.enabled ?? true),
  days: normalizeDays(value.days, fallback.days),
  unlimited: Boolean(value.unlimited ?? fallback.unlimited),
});

const buildDefaultLeaveTypes = () =>
  DEFAULT_LEAVE_TYPE_SETTINGS.map((item) => ({
    key: item.key,
    label: item.label,
    description: item.description,
    active: Boolean(item.active),
    sortOrder: Number(item.sortOrder || 0),
    allowances: normalizeTrackedRoleAllowances(item.allowances, item.allowances),
  }));

const sortLeaveTypes = (items = []) =>
  [...items].sort((left, right) => {
    const orderDiff = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    if (orderDiff !== 0) return orderDiff;
    return String(left.label || left.key || "").localeCompare(String(right.label || right.key || ""));
  });

const normalizePolicyDocument = (document = {}, options = {}) => {
  const { includeDefaults = false } = options;
  const existingItems = Array.isArray(document.leaveTypes) ? document.leaveTypes : [];
  const existingMap = new Map(
    existingItems
      .map((item) => {
        const key = normalizeLeaveTypeKey(item?.key);
        return key ? [key, item] : null;
      })
      .filter(Boolean)
  );
  const defaults = includeDefaults ? buildDefaultLeaveTypes() : [];
  const merged = [];
  const usedKeys = new Set();

  defaults.forEach((defaultItem) => {
    const existing = existingMap.get(defaultItem.key) || {};
    usedKeys.add(defaultItem.key);
    merged.push({
      key: defaultItem.key,
      label: String(existing.label || defaultItem.label).trim() || defaultItem.label,
      description: String(existing.description || defaultItem.description).trim(),
      active: Boolean(existing.active ?? defaultItem.active),
      sortOrder: Number(existing.sortOrder ?? defaultItem.sortOrder) || defaultItem.sortOrder,
      allowances: normalizeTrackedRoleAllowances(existing.allowances, defaultItem.allowances),
    });
  });

  existingItems.forEach((rawItem, index) => {
    const key = normalizeLeaveTypeKey(rawItem?.key);
    if (!key || usedKeys.has(key)) return;
    const fallback = createDisabledTrackedRoleAllowances();
    usedKeys.add(key);
    merged.push({
      key,
      label: String(rawItem?.label || toTitleCase(key) || "Leave category").trim() || toTitleCase(key),
      description: String(rawItem?.description || "").trim(),
      active: Boolean(rawItem?.active ?? true),
      sortOrder: Number(rawItem?.sortOrder ?? (defaults.length + index + 1) * 10) || (defaults.length + index + 1) * 10,
      allowances: normalizeTrackedRoleAllowances(rawItem?.allowances, fallback),
    });
  });

  return sortLeaveTypes(merged);
};

const ensureLeavePolicySettings = async () => {
  let settings = await AdminLeavePolicySettings.findOne({ scopeKey: "default" });
  if (!settings) {
    settings = await AdminLeavePolicySettings.create({
      scopeKey: "default",
      leaveTypes: buildDefaultLeaveTypes(),
    });
    return settings;
  }

  const normalized = normalizePolicyDocument(settings.toObject ? settings.toObject() : settings, {
    includeDefaults: !Array.isArray(settings.leaveTypes) || !settings.leaveTypes.length,
  });
  const current = JSON.stringify(sortLeaveTypes(settings.leaveTypes || []));
  const next = JSON.stringify(normalized);
  if (current !== next) {
    settings.leaveTypes = normalized;
    await settings.save();
  }
  return settings;
};

const serializeLeavePolicy = (settings) => {
  const normalized = normalizePolicyDocument(settings?.toObject ? settings.toObject() : settings || {});
  return {
    updatedAt: settings?.updatedAt || null,
    leaveTypes: normalized.map((item) => ({
      key: item.key,
      label: item.label,
      description: item.description,
      active: Boolean(item.active),
      sortOrder: Number(item.sortOrder || 0),
      allowances: normalizeTrackedRoleAllowances(item.allowances),
    })),
  };
};

const updateLeavePolicySettings = async (payload = {}, actorId = null) => {
  const settings = await ensureLeavePolicySettings();
  const incoming = Array.isArray(payload.leaveTypes) ? payload.leaveTypes : [];

  const nextLeaveTypes = incoming
    .map((rawItem, index) => {
      const key = normalizeLeaveTypeKey(rawItem?.key || rawItem?.label);
      if (!key) return null;
      const fallback = {
        label: toTitleCase(key),
        description: "",
        active: true,
        sortOrder: (index + 1) * 10,
        allowances: createDisabledTrackedRoleAllowances(),
      };
      return {
        key,
        label: String(rawItem?.label || fallback.label).trim() || fallback.label,
        description: String(rawItem?.description || fallback.description).trim(),
        active: Boolean(rawItem?.active ?? fallback.active),
        sortOrder: Number(rawItem?.sortOrder ?? fallback.sortOrder ?? (index + 1) * 10) || fallback.sortOrder,
        allowances: normalizeTrackedRoleAllowances(rawItem?.allowances, fallback.allowances),
      };
    })
    .filter(Boolean);

  settings.leaveTypes = normalizePolicyDocument({
    leaveTypes: nextLeaveTypes,
  });
  settings.updatedBy = actorId && mongoose.Types.ObjectId.isValid(actorId) ? actorId : settings.updatedBy || null;
  await settings.save();
  return settings;
};

const getYearBounds = (year = new Date().getFullYear()) => {
  const normalizedYear = Number(year) || new Date().getFullYear();
  const start = new Date(normalizedYear, 0, 1);
  const end = new Date(normalizedYear + 1, 0, 1);
  return { year: normalizedYear, start, end };
};

const buildLeaveBalanceEntries = ({ role, leavePolicy, requests = [] }) => {
  const policy = leavePolicy?.leaveTypes || [];
  return policy.map((type) => {
    const allowance = normalizeAllowance(type.allowances?.[role] || {});
    const typeRequests = requests.filter((item) => String(item.leaveType || "") === type.key);
    const approvedDays = typeRequests
      .filter((item) => item.status === "approved")
      .reduce((sum, item) => sum + Number(item.totalDays || 0), 0);
    const pendingDays = typeRequests
      .filter((item) => item.status === "pending")
      .reduce((sum, item) => sum + Number(item.totalDays || 0), 0);
    const totalDays = allowance.unlimited ? null : normalizeDays(allowance.days, 0);
    const remainingDays = allowance.unlimited ? null : Math.max(0, totalDays - approvedDays);
    const remainingAfterPendingDays = allowance.unlimited ? null : Math.max(0, totalDays - approvedDays - pendingDays);

    return {
      key: type.key,
      label: type.label,
      description: type.description,
      active: Boolean(type.active) && Boolean(allowance.enabled),
      roleEnabled: Boolean(allowance.enabled),
      unlimited: allowance.unlimited,
      totalDays,
      approvedDays,
      pendingDays,
      remainingDays,
      remainingAfterPendingDays,
      isExhausted: allowance.unlimited ? false : remainingDays <= 0,
      canRequest: Boolean(type.active) && (allowance.unlimited || remainingAfterPendingDays > 0),
    };
  });
};

const queryLeaveRequestsForAdmins = async ({ adminIds = [], year, excludeRequestId = null, statuses = ["approved", "pending"] }) => {
  const validAdminIds = adminIds.filter((item) => mongoose.Types.ObjectId.isValid(String(item || "")));
  if (!validAdminIds.length) return [];
  const { start, end } = getYearBounds(year);
  const query = {
    adminId: { $in: validAdminIds },
    status: { $in: statuses },
    startDate: { $gte: start, $lt: end },
  };
  if (excludeRequestId && mongoose.Types.ObjectId.isValid(String(excludeRequestId))) {
    query._id = { $ne: excludeRequestId };
  }
  return AdminLeaveRequest.find(query).select("adminId leaveType totalDays status startDate endDate").lean();
};

const buildLeaveBalanceMapForAdmins = async ({ admins = [], year, settings = null, requests = null, excludeRequestId = null, statuses = ["approved", "pending"] }) => {
  const leavePolicySettings = settings || await ensureLeavePolicySettings();
  const leavePolicy = serializeLeavePolicy(leavePolicySettings);
  const adminList = Array.isArray(admins) ? admins : [];
  const adminIds = adminList.map((item) => item?._id || item?.adminId || item).filter(Boolean);
  const sourceRequests = requests || await queryLeaveRequestsForAdmins({ adminIds, year, excludeRequestId, statuses });

  const requestMap = new Map();
  sourceRequests.forEach((item) => {
    const key = String(item.adminId || "");
    if (!requestMap.has(key)) requestMap.set(key, []);
    requestMap.get(key).push(item);
  });

  const balanceMap = new Map();
  adminList.forEach((admin) => {
    const adminId = String(admin?._id || admin?.adminId || "");
    const role = String(admin?.role || "");
    balanceMap.set(
      adminId,
      buildLeaveBalanceEntries({
        role,
        leavePolicy,
        requests: requestMap.get(adminId) || [],
      })
    );
  });

  return {
    leavePolicy,
    balanceMap,
  };
};

const buildLeaveBalanceForAdmin = async ({ adminId, role, year, settings = null, excludeRequestId = null, statuses = ["approved", "pending"] }) => {
  const { leavePolicy, balanceMap } = await buildLeaveBalanceMapForAdmins({
    admins: [{ _id: adminId, role }],
    year,
    settings,
    excludeRequestId,
    statuses,
  });
  return {
    leavePolicy,
    balances: balanceMap.get(String(adminId || "")) || [],
  };
};

const getLeaveTypeBalanceEntry = (balances = [], leaveType = "") =>
  (Array.isArray(balances) ? balances : []).find((item) => item.key === leaveType) || null;

module.exports = {
  DEFAULT_LEAVE_TYPE_SETTINGS,
  TRACKED_ROLES,
  buildDefaultLeaveTypes,
  buildLeaveBalanceEntries,
  buildLeaveBalanceForAdmin,
  buildLeaveBalanceMapForAdmins,
  ensureLeavePolicySettings,
  getLeaveTypeBalanceEntry,
  getYearBounds,
  normalizeLeaveTypeKey,
  normalizePolicyDocument,
  queryLeaveRequestsForAdmins,
  serializeLeavePolicy,
  toTitleCase,
  updateLeavePolicySettings,
};

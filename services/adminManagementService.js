const bcrypt = require("bcryptjs");
const { Types } = require("mongoose");
const AdminUser = require("../models/AdminUser");
const SalesTeam = require("../models/SalesTeam");

const ADMIN_ROLE_OPTIONS = ["MainAdmin", "SalesAdmin", "SalesStaff", "AgentAdmin"];
const ADMIN_ROLE_LABELS = Object.freeze({
  MainAdmin: "Super Admin",
  SalesAdmin: "Sales Admin",
  SalesStaff: "Sales Agent",
  AgentAdmin: "Agent",
});
const AGENT_SETTINGS_TABS = new Set(["all", "sales"]);

const trimString = (value) => String(value || "").trim();
const toObject = (value) => {
  if (!value) return {};
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};
const toIsoStringOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const createHttpError = (message, status = 400, extras = {}) => {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extras);
  return error;
};
const isValidObjectId = (value) => Types.ObjectId.isValid(String(value || ""));
const isSalesCrmSeat = (role) => ["SalesAdmin", "SalesStaff"].includes(trimString(role));
const getRoleLabel = (role) => ADMIN_ROLE_LABELS[trimString(role)] || trimString(role) || "Agent";

const normalizeBooleanLike = (value) => {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return Boolean(value);
  const normalized = trimString(value).toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return null;
};

const normalizeEmail = (value, { required = false } = {}) => {
  const normalized = trimString(value).toLowerCase();
  if (!normalized) {
    if (required) {
      throw createHttpError("email is required");
    }
    return "";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw createHttpError("email must be a valid email address");
  }

  return normalized;
};

const normalizeRole = (value, { required = true } = {}) => {
  const normalized = trimString(value);
  if (!normalized) {
    if (required) {
      throw createHttpError("role is required");
    }
    return "";
  }

  if (!ADMIN_ROLE_OPTIONS.includes(normalized)) {
    throw createHttpError(`role must be one of: ${ADMIN_ROLE_OPTIONS.join(", ")}`);
  }

  return normalized;
};

const normalizePassword = async (value, { required = false } = {}) => {
  const normalized = trimString(value);
  if (!normalized) {
    if (required) {
      throw createHttpError("password is required");
    }
    return null;
  }

  if (normalized.length < 6) {
    throw createHttpError("Password must be at least 6 characters long");
  }

  return bcrypt.hash(normalized, 10);
};

const normalizePagination = (value, fallback, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, Math.floor(parsed));
};

const getAccessibleAdminFilter = (actor, { includeManagerForSalesStaff = true } = {}) => {
  const actorId = actor?._id;
  const actorRole = trimString(actor?.role);

  if (!actorId || !actorRole) {
    throw createHttpError("Not authorized", 401);
  }

  if (actorRole === "MainAdmin") {
    return {};
  }

  if (actorRole === "SalesAdmin") {
    return {
      $or: [
        { _id: actorId },
        { role: "SalesStaff", reportsTo: actorId },
      ],
    };
  }

  if (actorRole === "SalesStaff") {
    if (includeManagerForSalesStaff && actor.reportsTo && isValidObjectId(actor.reportsTo)) {
      return {
        $or: [
          { _id: actorId },
          { _id: actor.reportsTo },
        ],
      };
    }

    return { _id: actorId };
  }

  throw createHttpError("Access denied", 403);
};

const getManageableAdminFilter = (actor) => {
  const actorId = actor?._id;
  const actorRole = trimString(actor?.role);

  if (!actorId || !actorRole) {
    throw createHttpError("Not authorized", 401);
  }

  if (actorRole === "MainAdmin") {
    return {};
  }

  if (actorRole === "SalesAdmin") {
    return {
      role: "SalesStaff",
      reportsTo: actorId,
    };
  }

  throw createHttpError("Access denied", 403);
};

const getAccessibleTeamFilter = (actor) => {
  const actorRole = trimString(actor?.role);
  const actorId = actor?._id;

  if (actorRole === "MainAdmin") return {};
  if (actorRole === "SalesAdmin") return { ownerAdmin: actorId };
  if (actorRole === "SalesStaff") {
    const managerId = actor?.reportsTo;
    return {
      $or: [
        { members: actorId },
        ...(managerId ? [{ ownerAdmin: managerId }] : []),
      ],
    };
  }

  throw createHttpError("Access denied", 403);
};

const mapTeamDocument = (team) => {
  const plain = toObject(team);
  return {
    id: trimString(plain._id || plain.id),
    name: trimString(plain.name),
    ownerAdminId: trimString(plain.ownerAdmin?._id || plain.ownerAdmin),
    members: Array.isArray(plain.members)
      ? plain.members.map((member) => ({
          id: trimString(member?._id || member),
          name: trimString(member?.name),
          email: trimString(member?.email),
          role: trimString(member?.role),
        }))
      : [],
  };
};

const buildTeamMaps = (teams = []) => {
  const ownerMap = new Map();
  const memberMap = new Map();

  teams.map(mapTeamDocument).forEach((team) => {
    if (team.ownerAdminId) {
      ownerMap.set(team.ownerAdminId, team);
    }

    team.members.forEach((member) => {
      if (member.id) {
        memberMap.set(member.id, team);
      }
    });
  });

  return { ownerMap, memberMap };
};

const buildAgentSettingsRow = (admin, teamMaps) => {
  const plain = toObject(admin);
  const adminId = trimString(plain._id || plain.id);
  const ownedTeam = teamMaps.ownerMap.get(adminId);
  const memberTeam = teamMaps.memberMap.get(adminId);
  const team = ownedTeam || memberTeam || null;
  const createdBy = plain.createdBy && typeof plain.createdBy === "object" ? plain.createdBy : null;

  return {
    id: adminId,
    name: trimString(plain.name),
    email: trimString(plain.email),
    phone: trimString(plain.phone),
    role: trimString(plain.role),
    roleLabel: getRoleLabel(plain.role),
    createdBy: createdBy ? trimString(createdBy.name || createdBy.email) || null : null,
    createdById: createdBy ? trimString(createdBy._id || createdBy.id) || null : null,
    teamName: team ? trimString(team.name) : "",
    teamId: team ? team.id : null,
    teamMemberCount: team ? Number(team.members.length || 0) : 0,
    lastLogin: toIsoStringOrNull(plain.lastLogin),
    createdAt: toIsoStringOrNull(plain.createdAt),
    isSalesCrmSeat: isSalesCrmSeat(plain.role),
  };
};

const applyAgentSettingsFilters = (items = [], query = {}) => {
  const search = trimString(query.search).toLowerCase();
  const tab = trimString(query.tab || "all").toLowerCase() || "all";
  const role = trimString(query.role);

  if (!AGENT_SETTINGS_TABS.has(tab)) {
    throw createHttpError("tab must be all or sales");
  }

  if (role) {
    normalizeRole(role);
  }

  return items.filter((item) => {
    if (tab === "sales" && !isSalesCrmSeat(item.role)) return false;
    if (role && item.role !== role) return false;
    if (!search) return true;

    return [
      item.name,
      item.email,
      item.phone,
      item.role,
      item.roleLabel,
      item.teamName,
    ].some((value) => trimString(value).toLowerCase().includes(search));
  });
};

const buildAgentSettingsSummary = (items = [], teams = []) => ({
  totalAgents: items.length,
  salesCrmAgents: items.filter((item) => item.isSalesCrmSeat).length,
  superAdmins: items.filter((item) => item.role === "MainAdmin").length,
  totalTeams: [...new Set(
    (Array.isArray(teams) ? teams : [])
      .map((team) => trimString(team._id || team.id))
      .filter(Boolean)
  )].length,
});

const fetchAccessibleAdmins = async (actor, { includeManagerForSalesStaff = true, populateCreatedBy = false } = {}) => {
  let query = AdminUser.find(getAccessibleAdminFilter(actor, { includeManagerForSalesStaff }))
    .select("_id name email phone role reportsTo createdBy lastLogin createdAt")
    .sort({ createdAt: -1, _id: -1 });

  if (populateCreatedBy) {
    query = query.populate("createdBy", "_id name email role");
  }

  return query.lean();
};

const fetchAccessibleTeams = async (actor) =>
  SalesTeam.find(getAccessibleTeamFilter(actor))
    .populate("ownerAdmin", "_id name email role")
    .populate("members", "_id name email role")
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

const listAgentSettings = async (query = {}, actor) => {
  const page = normalizePagination(query.page, 1, 1000);
  const limit = normalizePagination(query.limit, 20, 100);
  const [admins, teams] = await Promise.all([
    fetchAccessibleAdmins(actor, { includeManagerForSalesStaff: true, populateCreatedBy: true }),
    fetchAccessibleTeams(actor),
  ]);

  const teamMaps = buildTeamMaps(teams);
  const allItems = admins.map((admin) => buildAgentSettingsRow(admin, teamMaps));
  const summary = buildAgentSettingsSummary(allItems, teams);
  const filteredItems = applyAgentSettingsFilters(allItems, query);
  const total = filteredItems.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const startIndex = (page - 1) * limit;

  return {
    items: filteredItems.slice(startIndex, startIndex + limit),
    summary,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
};

const getAgentSettingsMeta = async () => ({
  roles: ADMIN_ROLE_OPTIONS.map((role) => ({
    value: role,
    label: getRoleLabel(role),
  })),
});

const listAdminsForLegacyEndpoint = async (actor) => fetchAccessibleAdmins(actor, {
  includeManagerForSalesStaff: true,
  populateCreatedBy: false,
});

const findAdminByEmail = async (email, excludeId = null) => {
  const query = { email };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  return AdminUser.findOne(query).select("_id");
};

const resolveSalesStaffManagerId = async ({ actor, role, reportsTo, currentReportsTo = null }) => {
  if (role !== "SalesStaff") {
    return null;
  }

  if (trimString(actor?.role) === "SalesAdmin") {
    return actor._id;
  }

  const managerId = reportsTo || currentReportsTo;
  if (!isValidObjectId(managerId)) {
    throw createHttpError("SalesStaff requires a valid reportsTo SalesAdmin");
  }

  const manager = await AdminUser.findOne({ _id: managerId, role: "SalesAdmin" }).select("_id");
  if (!manager) {
    throw createHttpError("reportsTo must reference an existing SalesAdmin");
  }

  return manager._id;
};

const normalizeCreatePayload = async (payload = {}, actor) => {
  const name = trimString(payload.name);
  const email = normalizeEmail(payload.email, { required: true });
  const role = normalizeRole(payload.role);

  if (!name) {
    throw createHttpError("name is required");
  }

  if (trimString(actor?.role) === "SalesAdmin" && role !== "SalesStaff") {
    throw createHttpError("SalesAdmin can only create SalesStaff users", 403);
  }

  const existing = await findAdminByEmail(email);
  if (existing) {
    throw createHttpError("Email already exists");
  }

  const password = await normalizePassword(payload.password, { required: true });
  const reportsTo = await resolveSalesStaffManagerId({
    actor,
    role,
    reportsTo: payload.reportsTo,
  });

  return {
    name,
    email,
    phone: trimString(payload.phone),
    password,
    role,
    reportsTo,
    createdBy: actor?._id || null,
  };
};

const createAdminRecord = async (payload = {}, actor) => {
  const normalized = await normalizeCreatePayload(payload, actor);
  const admin = await AdminUser.create(normalized);
  return AdminUser.findById(admin._id)
    .select("_id name email phone role reportsTo createdBy lastLogin createdAt")
    .lean();
};

const getManageableAdminOrThrow = async (id, actor) => {
  if (!isValidObjectId(id)) {
    throw createHttpError("Invalid admin id");
  }

  const admin = await AdminUser.findOne({
    _id: id,
    ...getManageableAdminFilter(actor),
  });

  if (!admin) {
    throw createHttpError("Admin not found", 404);
  }

  return admin;
};

const ensureLastMainAdminIsProtected = async ({ currentRole, nextRole, deleting = false }) => {
  if (currentRole !== "MainAdmin") {
    return;
  }

  if (!deleting && nextRole === "MainAdmin") {
    return;
  }

  const mainAdminCount = await AdminUser.countDocuments({ role: "MainAdmin" });
  if (mainAdminCount <= 1) {
    throw createHttpError("Cannot remove the last remaining MainAdmin", 400, {
      code: "LAST_MAIN_ADMIN_PROTECTED",
    });
  }
};

const updateAdminRecord = async (id, payload = {}, actor) => {
  const admin = await getManageableAdminOrThrow(id, actor);
  const current = toObject(admin);
  const actorId = trimString(actor?._id);
  const nextRole = payload.role !== undefined ? normalizeRole(payload.role) : trimString(current.role);

  if (trimString(actor?.role) === "SalesAdmin" && nextRole !== "SalesStaff") {
    throw createHttpError("SalesAdmin can only manage SalesStaff users", 403);
  }

  if (trimString(current._id) === actorId && nextRole !== "MainAdmin" && trimString(current.role) === "MainAdmin") {
    throw createHttpError("You cannot demote the currently authenticated MainAdmin", 400);
  }

  await ensureLastMainAdminIsProtected({
    currentRole: trimString(current.role),
    nextRole,
    deleting: false,
  });

  if (payload.email !== undefined) {
    const email = normalizeEmail(payload.email, { required: true });
    const existing = await findAdminByEmail(email, current._id);
    if (existing) {
      throw createHttpError("Email already exists");
    }
    admin.email = email;
  }

  if (payload.name !== undefined) {
    const name = trimString(payload.name);
    if (!name) {
      throw createHttpError("name is required");
    }
    admin.name = name;
  }

  if (payload.phone !== undefined) {
    admin.phone = trimString(payload.phone);
  }

  if (payload.role !== undefined) {
    admin.role = nextRole;
  }

  if (payload.password !== undefined) {
    admin.password = await normalizePassword(payload.password, { required: true });
  }

  admin.reportsTo = await resolveSalesStaffManagerId({
    actor,
    role: nextRole,
    reportsTo: payload.reportsTo,
    currentReportsTo: current.reportsTo,
  });

  await admin.save();

  return AdminUser.findById(admin._id)
    .select("_id name email phone role reportsTo createdBy lastLogin createdAt")
    .lean();
};

const deleteAdminRecord = async (id, actor) => {
  const actorId = trimString(actor?._id);

  if (!isValidObjectId(id)) {
    throw createHttpError("Invalid admin id");
  }

  if (trimString(id) === actorId) {
    throw createHttpError("You cannot delete the account you are currently using", 400, {
      code: "SELF_DELETE_BLOCKED",
    });
  }

  const admin = await getManageableAdminOrThrow(id, actor);

  await ensureLastMainAdminIsProtected({
    currentRole: trimString(admin.role),
    deleting: true,
  });

  await AdminUser.deleteOne({ _id: admin._id });
  return {
    success: true,
    id: trimString(admin._id),
  };
};

module.exports = {
  ADMIN_ROLE_OPTIONS,
  ADMIN_ROLE_LABELS,
  isSalesCrmSeat,
  getRoleLabel,
  listAgentSettings,
  getAgentSettingsMeta,
  listAdminsForLegacyEndpoint,
  createAdminRecord,
  updateAdminRecord,
  deleteAdminRecord,
  __private: {
    getAccessibleAdminFilter,
    getManageableAdminFilter,
    getAccessibleTeamFilter,
    applyAgentSettingsFilters,
    buildAgentSettingsSummary,
    buildAgentSettingsRow,
  },
};

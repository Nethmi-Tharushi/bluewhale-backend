const AdminUser = require("../models/AdminUser");
const User = require("../models/User");

const trimString = (value) => String(value || "").trim();
const normalizeEmail = (value) => trimString(value).toLowerCase();

const DEFAULT_PORTAL_PASSWORD = "11112222";
const generateTempPassword = () => DEFAULT_PORTAL_PASSWORD;
const MANAGED_CANDIDATE_B2B_TAG = "B2B";

const getNextRoundRobinSalesStaff = async () => {
  const staff = await AdminUser.findOne({
    role: "SalesStaff",
    "whatsappInbox.allowAutoAssignment": { $ne: false },
  }).sort({
    "whatsappInbox.lastAssignedAt": 1,
    createdAt: 1,
    _id: 1,
  });

  if (!staff) return null;

  staff.whatsappInbox = staff.whatsappInbox || {};
  staff.whatsappInbox.lastAssignedAt = new Date();
  await staff.save();
  return staff;
};

const resolveAssignedSalesStaff = async ({
  actor = null,
  preferredAssigneeId = "",
} = {}) => {
  const actorRole = trimString(actor?.role);

  if (actorRole === "SalesStaff") {
    return actor;
  }

  const preferredId = trimString(preferredAssigneeId);
  if (preferredId && ["MainAdmin", "SalesAdmin"].includes(actorRole)) {
    const preferred = await AdminUser.findOne({
      _id: preferredId,
      role: "SalesStaff",
    }).select("_id name email role reportsTo");
    if (preferred) {
      return preferred;
    }
  }

  return getNextRoundRobinSalesStaff();
};

const buildLeadOwnership = ({ actor = null, assignedStaff = null } = {}) => {
  const actorRole = trimString(actor?.role);
  const assignedId = assignedStaff?._id || null;
  const assignedManagerId = assignedStaff?.reportsTo || assignedStaff?._id || null;

  if (actorRole === "SalesStaff") {
    return {
      teamAdmin: actor?.reportsTo || actor?._id || assignedManagerId,
      ownerAdmin: actor?._id || assignedId,
      assignedTo: actor?._id || assignedId,
      assignedBy: actor?._id || null,
    };
  }

  if (["MainAdmin", "SalesAdmin"].includes(actorRole)) {
    return {
      teamAdmin: actorRole === "SalesAdmin" ? actor?._id || assignedManagerId : assignedManagerId || actor?._id || null,
      ownerAdmin: actor?._id || assignedManagerId || assignedId,
      assignedTo: assignedId,
      assignedBy: actor?._id || null,
    };
  }

  return {
    teamAdmin: assignedManagerId,
    ownerAdmin: assignedManagerId || assignedId,
    assignedTo: assignedId,
    assignedBy: assignedId,
  };
};

const ensurePortalUserForLead = async ({
  leadInput = {},
  assignedStaff = null,
  existingUser = null,
} = {}) => {
  const shouldCreatePortalAccount = leadInput?.createPortalAccount !== false;
  const email = normalizeEmail(leadInput?.email);
  const portalAccountType = trimString(leadInput?.portalAccountType || "candidate").toLowerCase();

  if (!shouldCreatePortalAccount || !email || !["candidate", "agent"].includes(portalAccountType)) {
    return { user: existingUser || null, created: false, password: "" };
  }

  if (existingUser) {
    if (assignedStaff?._id && String(existingUser.assignedTo || "") !== String(assignedStaff._id)) {
      existingUser.assignedTo = assignedStaff._id;
      await existingUser.save();
    }
    return { user: existingUser, created: false, password: "" };
  }

  const resolvedPassword = trimString(leadInput?.password) || generateTempPassword();
  const commonPayload = {
    email,
    password: resolvedPassword,
    userType: portalAccountType,
    phone: trimString(leadInput?.phone),
    assignedTo: assignedStaff?._id || null,
  };

  if (portalAccountType === "agent") {
    const user = await User.create({
      ...commonPayload,
      name: trimString(leadInput?.contactPerson || leadInput?.name) || trimString(leadInput?.company) || "Agent Contact",
      companyName: trimString(leadInput?.company) || trimString(leadInput?.name) || "Agent Company",
      companyAddress: trimString(leadInput?.address || leadInput?.companyAddress),
      contactPerson: trimString(leadInput?.contactPerson || leadInput?.name) || "Agent Contact",
    });
    return { user, created: true, password: resolvedPassword };
  }

  const user = await User.create({
    ...commonPayload,
    name: trimString(leadInput?.name) || email,
    address: trimString(leadInput?.address),
    country: trimString(leadInput?.country),
    location: trimString(leadInput?.city || leadInput?.state || leadInput?.country),
    profession: trimString(leadInput?.profession),
    jobInterest: trimString(leadInput?.description),
  });
  return { user, created: true, password: resolvedPassword };
};

const syncLeadLinkedUserAssignment = async (lead) => {
  if (!lead?.linkedUser) return null;

  const user = await User.findById(lead.linkedUser);
  if (!user) return null;

  user.assignedTo = lead.assignedTo || null;
  await user.save();
  return user;
};

const buildManagedCandidateIntegrationKey = (agentId, managedCandidateId) => {
  const normalizedAgentId = trimString(agentId);
  const normalizedCandidateId = trimString(managedCandidateId);
  if (!normalizedAgentId || !normalizedCandidateId) return "";
  return `managed_candidate:${normalizedAgentId}:${normalizedCandidateId}`;
};

const resolveDefaultLeadOwner = async (assignedStaff = null) => {
  const fallbackOwner =
    assignedStaff ||
    (await AdminUser.findOne({ role: { $in: ["SalesAdmin", "MainAdmin"] } })
      .sort({ role: 1, createdAt: 1, _id: 1 })
      .select("_id role reportsTo"));

  const ownership = buildLeadOwnership({
    actor: null,
    assignedStaff,
  });

  return {
    assignedStaff,
    ownership,
    teamAdminId: ownership.teamAdmin || fallbackOwner?._id || null,
    ownerAdminId: ownership.ownerAdmin || fallbackOwner?._id || null,
  };
};

const resolveManagedCandidateAssignedStaff = async ({
  agent = null,
  managedCandidate = null,
} = {}) => {
  const preferredAssignedId = trimString(
    managedCandidate?.assignedTo?._id ||
      managedCandidate?.assignedTo ||
      agent?.assignedTo?._id ||
      agent?.assignedTo
  );

  if (preferredAssignedId) {
    const assignedStaff = await AdminUser.findOne({
      _id: preferredAssignedId,
      role: "SalesStaff",
    }).select("_id name email role reportsTo");
    if (assignedStaff) {
      return assignedStaff;
    }
  }

  return resolveAssignedSalesStaff();
};

module.exports = {
  resolveAssignedSalesStaff,
  buildLeadOwnership,
  ensurePortalUserForLead,
  syncLeadLinkedUserAssignment,
  normalizeEmail,
  DEFAULT_PORTAL_PASSWORD,
  MANAGED_CANDIDATE_B2B_TAG,
  buildManagedCandidateIntegrationKey,
  resolveDefaultLeadOwner,
  resolveManagedCandidateAssignedStaff,
};

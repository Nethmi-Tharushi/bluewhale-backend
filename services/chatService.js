const mongoose = require("mongoose");

const Message = require("../models/Message");
const AdminUser = require("../models/AdminUser");
const Lead = require("../models/Lead");
const User = require("../models/User");
const { buildManagedCandidateIntegrationKey } = require("./leadAccountService");

const CHAT_BRAND_NAME = "Blue Whale Migration";

const normalizeObjectId = (value) => {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  if (typeof value === "object" && value.id) return String(value.id);
  return String(value);
};

const toObjectIdOrNull = (value) => {
  const normalized = String(value || "").trim();
  return mongoose.Types.ObjectId.isValid(normalized) ? normalized : null;
};

const getManagedCandidateDisplayName = (candidate = {}) => {
  const fullName = [candidate.firstname, candidate.lastname].filter(Boolean).join(" ").trim();
  return String(candidate.name || fullName || candidate.email || "Managed Candidate").trim();
};

const buildParticipantUserLabel = (user = {}) => {
  if (String(user.userType || "").toLowerCase() === "agent") {
    return String(user.companyName || user.name || user.email || "B2B Agent").trim();
  }
  return String(user.name || user.email || "Customer").trim();
};

const getPortalThreadRoleLabel = ({ user, managedCandidate }) => {
  if (managedCandidate?._id) return "B2B Candidate";
  return String(user?.userType || "").toLowerCase() === "agent" ? "B2B Agent" : "B2C Candidate";
};

const buildPortalThreadKey = (userId, managedCandidateId = "") =>
  `${normalizeObjectId(userId)}:${normalizeObjectId(managedCandidateId)}`;

const getManagedCandidateMatch = (managedCandidateId = "") => {
  const normalized = toObjectIdOrNull(managedCandidateId);
  if (normalized) return { managedCandidateId: normalized };
  return { managedCandidateId: null };
};

const resolveSalesAdminForStaff = async (admin) => {
  const reportsToId = normalizeObjectId(admin?.reportsTo);
  if (!reportsToId) return null;
  return AdminUser.findById(reportsToId).select("_id name email role companyName reportsTo").lean();
};

const resolvePortalLeadAssignedAdmin = async (userId) => {
  const normalizedUserId = normalizeObjectId(userId);
  if (!normalizedUserId) return null;

  const lead = await Lead.findOne({
    $or: [
      { linkedUser: normalizedUserId },
      { integrationKey: `portal_user:${normalizedUserId}` },
    ],
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .populate("assignedTo", "_id name email role companyName reportsTo")
    .lean();

  return lead?.assignedTo || null;
};

const resolveManagedCandidateLeadAssignedAdmin = async (userId, managedCandidateId) => {
  const normalizedUserId = normalizeObjectId(userId);
  const normalizedManagedCandidateId = normalizeObjectId(managedCandidateId);
  if (!normalizedUserId || !normalizedManagedCandidateId) return null;

  const integrationKey = buildManagedCandidateIntegrationKey(normalizedUserId, normalizedManagedCandidateId);
  const lead = await Lead.findOne({
    $or: [
      integrationKey ? { integrationKey } : null,
      {
        "sourceMetadata.agentId": normalizedUserId,
        "sourceMetadata.managedCandidateId": normalizedManagedCandidateId,
      },
    ].filter(Boolean),
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .populate("assignedTo", "_id name email role companyName reportsTo")
    .lean();

  return lead?.assignedTo || null;
};

const resolvePrimaryAdminAndSupervisor = async (portalUser, managedCandidate) => {
  const leadAssignedAdmin = managedCandidate?._id
    ? await resolveManagedCandidateLeadAssignedAdmin(portalUser?._id, managedCandidate?._id)
    : await resolvePortalLeadAssignedAdmin(portalUser?._id);
  const primaryAdmin = leadAssignedAdmin || managedCandidate?.assignedTo || portalUser?.assignedTo || null;
  if (!primaryAdmin) {
    return {
      primaryAdmin: null,
      supervisingAdmin: null,
      adminIds: [],
    };
  }

  const primaryAdminId = normalizeObjectId(primaryAdmin?._id || primaryAdmin);
  let primaryAdminRecord = primaryAdmin;

  if (
    (
      !String(primaryAdmin?.role || "").trim() ||
      (String(primaryAdmin?.role || "") === "SalesStaff" && !normalizeObjectId(primaryAdmin?.reportsTo))
    ) &&
    primaryAdminId
  ) {
    primaryAdminRecord = await AdminUser.findById(primaryAdminId)
      .select("_id name email role companyName reportsTo")
      .lean();
  }

  let supervisingAdmin = null;
  if (String(primaryAdminRecord?.role || "") === "SalesStaff") {
    supervisingAdmin = await resolveSalesAdminForStaff(primaryAdminRecord);
  }

  const adminIds = [primaryAdminRecord, supervisingAdmin]
    .map((admin) => normalizeObjectId(admin?._id || admin))
    .filter(Boolean);

  return {
    primaryAdmin: primaryAdminRecord,
    supervisingAdmin,
    adminIds: [...new Set(adminIds)],
  };
};

const resolvePortalThreadScopeByUserId = async (userId, managedCandidateId = "") => {
  const normalizedUserId = toObjectIdOrNull(userId);
  if (!normalizedUserId) return null;

  const portalUser = await User.findById(normalizedUserId)
    .select(
      "name email userType companyName contactPerson assignedTo managedCandidates._id managedCandidates.name managedCandidates.firstname managedCandidates.lastname managedCandidates.email managedCandidates.assignedTo"
    )
    .populate("assignedTo", "_id name email role companyName reportsTo")
    .populate("managedCandidates.assignedTo", "_id name email role companyName reportsTo")
    .lean();

  if (!portalUser) return null;

  const normalizedManagedCandidateId = toObjectIdOrNull(managedCandidateId);
  const managedCandidate = normalizedManagedCandidateId
    ? Array.isArray(portalUser.managedCandidates)
      ? portalUser.managedCandidates.find(
          (candidate) => normalizeObjectId(candidate?._id) === normalizedManagedCandidateId
        ) || null
      : null
    : null;

  if (normalizedManagedCandidateId && !managedCandidate) {
    return null;
  }

  const {
    primaryAdmin,
    supervisingAdmin,
    adminIds,
  } = await resolvePrimaryAdminAndSupervisor(portalUser, managedCandidate);

  if (!primaryAdmin) {
    return {
      user: portalUser,
      managedCandidate,
      primaryAdmin: null,
      supervisingAdmin: null,
      adminIds: [],
      contactLabel: managedCandidate ? getManagedCandidateDisplayName(managedCandidate) : buildParticipantUserLabel(portalUser),
      roleLabel: getPortalThreadRoleLabel({ user: portalUser, managedCandidate }),
    };
  }

  return {
    user: portalUser,
    managedCandidate,
    primaryAdmin,
    supervisingAdmin,
    adminIds: [...new Set(adminIds)],
    contactLabel: managedCandidate ? getManagedCandidateDisplayName(managedCandidate) : buildParticipantUserLabel(portalUser),
    roleLabel: getPortalThreadRoleLabel({ user: portalUser, managedCandidate }),
  };
};

const canAdminAccessPortalThread = async (admin, userId, managedCandidateId = "") => {
  const scope = await resolvePortalThreadScopeByUserId(userId, managedCandidateId);
  if (!scope) return { allowed: false, reason: "Chat thread not found" };

  const adminId = normalizeObjectId(admin?._id);
  if (!adminId || !scope.adminIds.includes(adminId)) {
    return { allowed: false, reason: "Unauthorized to access this chat", scope };
  }

  return { allowed: true, scope };
};

const buildPortalThreadMessageQuery = ({ userId, adminIds = [], managedCandidateId = "" }) => ({
  ...getManagedCandidateMatch(managedCandidateId),
  $or: [
    {
      senderId: userId,
      senderType: "user",
      recipientType: "admin",
      recipientId: { $in: adminIds },
    },
    {
      recipientId: userId,
      recipientType: "user",
      senderType: "admin",
      senderId: { $in: adminIds },
    },
  ],
});

const fetchPortalThreadMessages = async ({ userId, adminIds = [], managedCandidateId = "" }) => {
  if (!userId || !adminIds.length) return [];
  return Message.find(buildPortalThreadMessageQuery({ userId, adminIds, managedCandidateId })).sort({ createdAt: 1 });
};

const getVisiblePortalUsersForAdmin = async (admin) => {
  const role = String(admin?.role || "");
  if (!admin?._id || role === "MainAdmin") return [];

  let assignedIds = [];
  if (role === "SalesStaff") {
    assignedIds = [normalizeObjectId(admin._id)];
  } else if (role === "SalesAdmin") {
    const staff = await AdminUser.find({ role: "SalesStaff", reportsTo: admin._id })
      .select("_id")
      .lean();
    assignedIds = [normalizeObjectId(admin._id), ...staff.map((entry) => normalizeObjectId(entry._id))];
  } else {
    assignedIds = [normalizeObjectId(admin._id)];
  }

  assignedIds = [...new Set(assignedIds.filter(Boolean))];
  if (!assignedIds.length) return [];

  const assignedLeadRows = await Lead.find({
    assignedTo: { $in: assignedIds },
  })
    .select("assignedTo linkedUser sourceMetadata")
    .lean();

  const linkedLeadAssignedMap = new Map();
  const managedCandidateLeadAssignedMap = new Map();

  assignedLeadRows.forEach((lead) => {
    const assignedToId = normalizeObjectId(lead?.assignedTo);
    const linkedUserId = normalizeObjectId(lead?.linkedUser);
    if (linkedUserId) {
      linkedLeadAssignedMap.set(linkedUserId, assignedToId);
    }

    const agentId = normalizeObjectId(lead?.sourceMetadata?.agentId);
    const managedCandidateId = normalizeObjectId(lead?.sourceMetadata?.managedCandidateId);
    if (agentId && managedCandidateId) {
      managedCandidateLeadAssignedMap.set(`${agentId}:${managedCandidateId}`, assignedToId);
    }
  });

  const users = await User.find({ assignedTo: { $in: assignedIds } })
    .select(
      "_id name email userType companyName contactPerson assignedTo createdAt managedCandidates._id managedCandidates.name managedCandidates.firstname managedCandidates.lastname managedCandidates.email managedCandidates.assignedTo"
    )
    .sort({ createdAt: -1 })
    .lean();
  const additionalUsers = await User.find({
    $or: [
      { _id: { $in: [...linkedLeadAssignedMap.keys()] } },
      { "managedCandidates.assignedTo": { $in: assignedIds } },
      {
        _id: {
          $in: [...managedCandidateLeadAssignedMap.keys()]
            .map((key) => key.split(":")[0])
            .filter(Boolean),
        },
      },
    ],
  })
    .select(
      "_id name email userType companyName contactPerson assignedTo createdAt managedCandidates._id managedCandidates.name managedCandidates.firstname managedCandidates.lastname managedCandidates.email managedCandidates.assignedTo"
    )
    .sort({ createdAt: -1 })
    .lean();

  const userMap = new Map();
  [...users, ...additionalUsers].forEach((user) => {
    userMap.set(normalizeObjectId(user?._id), user);
  });
  const scopedUsers = [...userMap.values()];

  const threadMessages = await Message.find({
    senderType: { $in: ["user", "admin"] },
    recipientType: { $in: ["user", "admin"] },
    $or: [
      {
        senderType: "user",
        recipientType: "admin",
        recipientId: { $in: assignedIds },
      },
      {
        senderType: "admin",
        recipientType: "user",
        senderId: { $in: assignedIds },
      },
    ],
  })
    .select("senderId recipientId senderType recipientType content createdAt managedCandidateId")
    .sort({ createdAt: -1 })
    .lean();

  const lastMessageByThread = new Map();
  threadMessages.forEach((message) => {
    const userId =
      message.senderType === "user" ? normalizeObjectId(message.senderId) : normalizeObjectId(message.recipientId);
    const key = buildPortalThreadKey(userId, message.managedCandidateId);
    if (!lastMessageByThread.has(key)) {
      lastMessageByThread.set(key, message);
    }
  });

  const contacts = [];

  scopedUsers.forEach((user) => {
    const baseKey = buildPortalThreadKey(user._id);
    const baseLastMessage = lastMessageByThread.get(baseKey);
    const baseAssignedAdminId =
      linkedLeadAssignedMap.get(normalizeObjectId(user._id)) || normalizeObjectId(user.assignedTo);

    if (assignedIds.includes(baseAssignedAdminId)) {
      contacts.push({
        _id: user._id,
        kind: "user",
        managedCandidateId: "",
        name: buildParticipantUserLabel(user),
        email: user.email || "",
        role: String(user.userType || "").toLowerCase() === "agent" ? "B2B Agent" : "B2C Candidate",
        lastMessageAt: baseLastMessage?.createdAt || null,
        lastMessage: String(baseLastMessage?.content || "").trim(),
        hasConversation: Boolean(baseLastMessage),
        assignedAdminId: baseAssignedAdminId,
        portalThreadName: CHAT_BRAND_NAME,
        portalUserType: user.userType || "",
      });
    }

    (Array.isArray(user.managedCandidates) ? user.managedCandidates : []).forEach((candidate) => {
      const managedCandidateLeadKey = `${normalizeObjectId(user._id)}:${normalizeObjectId(candidate?._id)}`;
      const candidateAssignedAdminId =
        managedCandidateLeadAssignedMap.get(managedCandidateLeadKey) ||
        normalizeObjectId(candidate?.assignedTo || user.assignedTo);
      if (!assignedIds.includes(candidateAssignedAdminId)) {
        return;
      }
      const threadKey = buildPortalThreadKey(user._id, candidate?._id);
      const candidateLastMessage = lastMessageByThread.get(threadKey);
      contacts.push({
        _id: user._id,
        kind: "user",
        managedCandidateId: normalizeObjectId(candidate?._id),
        parentUserId: normalizeObjectId(user._id),
        name: getManagedCandidateDisplayName(candidate),
        email: candidate?.email || user.email || "",
        role: "B2B Candidate",
        lastMessageAt: candidateLastMessage?.createdAt || null,
        lastMessage: String(candidateLastMessage?.content || "").trim(),
        hasConversation: Boolean(candidateLastMessage),
        assignedAdminId: candidateAssignedAdminId,
        portalThreadName: CHAT_BRAND_NAME,
        portalUserType: user.userType || "",
      });
    });
  });

  return contacts.sort((a, b) => {
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
};

const createUserToAdminMessage = async ({ userId, managedCandidateId = "", content }) => {
  const scope = await resolvePortalThreadScopeByUserId(userId, managedCandidateId);
  if (!scope?.primaryAdmin?._id) {
    throw new Error("No sales staff assigned to this chat");
  }

  const senderUser = await User.findById(userId).select("name companyName userType email");
  if (!senderUser) {
    throw new Error("User not found");
  }

  const senderName = scope.managedCandidate
    ? getManagedCandidateDisplayName(scope.managedCandidate)
    : buildParticipantUserLabel(senderUser);

  const newMessage = await Message.create({
    content,
    senderId: userId,
    senderType: "user",
    senderName,
    senderModel: "User",
    senderRole: scope.roleLabel,
    recipientId: scope.primaryAdmin._id,
    recipientType: "admin",
    recipientName: scope.primaryAdmin.name || CHAT_BRAND_NAME,
    recipientModel: "AdminUser",
    recipientRole: scope.primaryAdmin.role || "SalesStaff",
    managedCandidateId: toObjectIdOrNull(managedCandidateId),
  });

  return {
    message: newMessage,
    scope,
    rooms: [...new Set([normalizeObjectId(userId), ...scope.adminIds])],
  };
};

const createAdminToUserMessage = async ({ admin, userId, managedCandidateId = "", content }) => {
  const access = await canAdminAccessPortalThread(admin, userId, managedCandidateId);
  if (!access.allowed) {
    throw new Error(access.reason || "Unauthorized to access this chat");
  }

  const { scope } = access;
  const recipientName = scope.managedCandidate
    ? getManagedCandidateDisplayName(scope.managedCandidate)
    : buildParticipantUserLabel(scope.user);

  const newMessage = await Message.create({
    content,
    senderId: admin._id,
    senderType: "admin",
    senderName: admin.name || CHAT_BRAND_NAME,
    senderModel: "AdminUser",
    senderRole: admin.role || "Admin",
    recipientId: scope.user._id,
    recipientType: "user",
    recipientName,
    recipientModel: "User",
    recipientRole: scope.roleLabel,
    managedCandidateId: toObjectIdOrNull(managedCandidateId),
  });

  return {
    message: newMessage,
    scope,
    rooms: [...new Set([normalizeObjectId(scope.user._id), ...scope.adminIds])],
  };
};

module.exports = {
  CHAT_BRAND_NAME,
  normalizeObjectId,
  toObjectIdOrNull,
  buildPortalThreadKey,
  resolvePortalThreadScopeByUserId,
  canAdminAccessPortalThread,
  fetchPortalThreadMessages,
  getVisiblePortalUsersForAdmin,
  createUserToAdminMessage,
  createAdminToUserMessage,
};

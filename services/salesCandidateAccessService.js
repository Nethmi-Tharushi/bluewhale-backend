const mongoose = require("mongoose");
const Application = require("../models/Application");
const User = require("../models/User");

const FULL_ACCESS_ROLES = ["MainAdmin", "SalesAdmin"];

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const hasFullSalesCandidateAccess = (admin) => FULL_ACCESS_ROLES.includes(admin?.role);

const getVisibleSalesAssigneeIds = (admin) => {
  if (!admin || hasFullSalesCandidateAccess(admin)) return [];

  return [...new Set([admin._id, admin.reportsTo].filter(Boolean).map((id) => String(id)))];
};

const normalizeAssignedTo = (assignedTo) => {
  const assignedId = toIdString(assignedTo?._id || assignedTo);
  if (!assignedId) return null;

  return {
    _id: assignedId,
    name: String(assignedTo?.name || "").trim(),
  };
};

const isVisibleAssignee = (assignedTo, visibleAssigneeIds) => {
  if (!visibleAssigneeIds.length) return true;
  const assignedId = toIdString(assignedTo?._id || assignedTo);
  return assignedId ? visibleAssigneeIds.includes(assignedId) : false;
};

const resolveManagedCandidate = (agent, managedCandidateId) => {
  const normalizedId = String(managedCandidateId || "");
  return (agent?.managedCandidates || []).find((candidate) => String(candidate?._id) === normalizedId) || null;
};

const resolveEffectiveAssignedTo = (candidateAssignedTo, fallbackAssignedTo = null) => (
  candidateAssignedTo || fallbackAssignedTo || null
);

const buildCandidateAccessError = ({
  message,
  statusCode = 403,
  candidateId = "",
  candidateType = "",
  userId = "",
  assignedTo = null,
  agentId = "",
}) => ({
  success: false,
  statusCode,
  message,
  details: {
    candidateId: String(candidateId || ""),
    candidateType: String(candidateType || ""),
    userId: String(userId || ""),
    assignedTo: assignedTo ? normalizeAssignedTo(assignedTo) : null,
    agentId: agentId ? String(agentId) : "",
  },
});

const getLatestApplicationStatusMap = async (candidateIds) => {
  if (!candidateIds.length) return new Map();

  const objectIds = candidateIds
    .map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null))
    .filter(Boolean);

  if (!objectIds.length) return new Map();

  const rows = await Application.aggregate([
    {
      $match: {
        user: { $in: objectIds },
      },
    },
    {
      $sort: {
        appliedAt: -1,
        createdAt: -1,
      },
    },
    {
      $group: {
        _id: "$user",
        status: { $first: "$status" },
      },
    },
  ]);

  return new Map(rows.map((row) => [String(row._id), row.status]));
};

const listAccessibleSalesCandidates = async (admin) => {
  const fullAccess = hasFullSalesCandidateAccess(admin);
  const visibleAssigneeIds = getVisibleSalesAssigneeIds(admin);

  const [b2cUsers, agents] = await Promise.all([
    User.find(
      fullAccess
        ? { userType: "candidate" }
        : { userType: "candidate", assignedTo: { $in: visibleAssigneeIds } }
    )
      .select("name email phone location profession visaStatus jobInterest createdAt assignedTo")
      .populate("assignedTo", "name email role")
      .lean(),
    User.find(
      fullAccess
        ? { userType: "agent" }
        : {
            userType: "agent",
            $or: [
              { assignedTo: { $in: visibleAssigneeIds } },
              { "managedCandidates.assignedTo": { $in: visibleAssigneeIds } },
            ],
          }
    )
      .select("name companyName assignedTo managedCandidates")
      .populate("assignedTo", "name email role")
      .populate("managedCandidates.assignedTo", "name email role")
      .lean(),
  ]);

  const latestStatusByCandidateId = await getLatestApplicationStatusMap(
    b2cUsers.map((user) => String(user._id))
  );

  const unifiedCandidates = b2cUsers.map((user) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    location: user.location,
    profession: user.profession,
    status: latestStatusByCandidateId.get(String(user._id)) || "Not Applied",
    visaStatus: user.visaStatus,
    type: "B2C",
    agent: null,
    jobInterest: user.jobInterest || "",
    assignedTo: normalizeAssignedTo(user.assignedTo),
    createdAt: user.createdAt,
  }));

  agents.forEach((agent) => {
    (agent.managedCandidates || []).forEach((managedCandidate) => {
      const effectiveAssignedTo = resolveEffectiveAssignedTo(managedCandidate.assignedTo, agent.assignedTo);
      if (!fullAccess && !isVisibleAssignee(effectiveAssignedTo, visibleAssigneeIds)) {
        return;
      }

      unifiedCandidates.push({
        _id: managedCandidate._id,
        name: managedCandidate.name,
        email: managedCandidate.email,
        phone: managedCandidate.phone,
        location: managedCandidate.location,
        profession: managedCandidate.profession,
        status: managedCandidate.status,
        visaStatus: managedCandidate.visaStatus,
        type: "B2B",
        agent: {
          id: agent._id,
          name: agent.name,
          companyName: agent.companyName,
        },
        jobInterest: managedCandidate.jobInterest || "",
        assignedTo: normalizeAssignedTo(effectiveAssignedTo),
        createdAt: managedCandidate.addedAt,
      });
    });
  });

  unifiedCandidates.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return unifiedCandidates;
};

const resolveAccessibleSalesCandidate = async ({
  admin,
  candidateType,
  candidateId,
  managedCandidateId,
  agentId,
}) => {
  const requestedType = String(candidateType || "").trim().toUpperCase();
  const normalizedCandidateId = String(candidateId || "");
  const normalizedManagedCandidateId = String(managedCandidateId || normalizedCandidateId);
  const normalizedAgentId = String(agentId || "");
  const fullAccess = hasFullSalesCandidateAccess(admin);
  const visibleAssigneeIds = getVisibleSalesAssigneeIds(admin);
  const baseDetails = {
    candidateId: normalizedManagedCandidateId || normalizedCandidateId,
    candidateType: requestedType,
    userId: toIdString(admin?._id),
    agentId: normalizedAgentId,
  };

  if (!["B2C", "B2B"].includes(requestedType)) {
    return buildCandidateAccessError({
      message: "Invalid candidateType. Expected B2C or B2B",
      statusCode: 400,
      ...baseDetails,
    });
  }

  if (requestedType === "B2C") {
    if (!mongoose.Types.ObjectId.isValid(normalizedCandidateId)) {
      return buildCandidateAccessError({
        message: "Valid candidateId is required for B2C task creation",
        statusCode: 400,
        ...baseDetails,
      });
    }

    const candidate = await User.findOne({
      _id: normalizedCandidateId,
      userType: "candidate",
    })
      .select("name email phone assignedTo")
      .populate("assignedTo", "name email role");

    if (!candidate) {
      return buildCandidateAccessError({
        message: "Candidate not found",
        statusCode: 404,
        ...baseDetails,
      });
    }

    const effectiveAssignedTo = resolveEffectiveAssignedTo(candidate.assignedTo);
    if (!fullAccess && !isVisibleAssignee(effectiveAssignedTo, visibleAssigneeIds)) {
      return buildCandidateAccessError({
        message: "Candidate not accessible to this sales user",
        statusCode: 403,
        assignedTo: effectiveAssignedTo,
        ...baseDetails,
      });
    }

    return {
      success: true,
      candidateType: "B2C",
      candidate,
      candidateId: String(candidate._id),
      assignedTo: normalizeAssignedTo(effectiveAssignedTo),
    };
  }

  if (!mongoose.Types.ObjectId.isValid(normalizedManagedCandidateId)) {
    return buildCandidateAccessError({
      message: "Valid managedCandidateId is required for B2B task creation",
      statusCode: 400,
      ...baseDetails,
    });
  }

  let agent = null;
  if (normalizedAgentId) {
    if (!mongoose.Types.ObjectId.isValid(normalizedAgentId)) {
      return buildCandidateAccessError({
        message: "Valid agentId is required for B2B task creation",
        statusCode: 400,
        ...baseDetails,
      });
    }

    agent = await User.findOne({
      _id: normalizedAgentId,
      userType: "agent",
      "managedCandidates._id": normalizedManagedCandidateId,
    })
      .select("name companyName assignedTo managedCandidates")
      .populate("assignedTo", "name email role")
      .populate("managedCandidates.assignedTo", "name email role");

    if (!agent) {
      const candidateExistsUnderAnotherAgent = await User.exists({
        userType: "agent",
        "managedCandidates._id": normalizedManagedCandidateId,
      });

      return buildCandidateAccessError({
        message: candidateExistsUnderAnotherAgent
          ? "Candidate payload does not match the owning agent"
          : "Managed candidate not found",
        statusCode: candidateExistsUnderAnotherAgent ? 400 : 404,
        ...baseDetails,
      });
    }
  } else {
    agent = await User.findOne({
      userType: "agent",
      "managedCandidates._id": normalizedManagedCandidateId,
    })
      .select("name companyName assignedTo managedCandidates")
      .populate("assignedTo", "name email role")
      .populate("managedCandidates.assignedTo", "name email role");
  }

  if (!agent) {
    return buildCandidateAccessError({
      message: "Managed candidate not found",
      statusCode: 404,
      ...baseDetails,
    });
  }

  const managedCandidate = resolveManagedCandidate(agent, normalizedManagedCandidateId);
  if (!managedCandidate) {
    return buildCandidateAccessError({
      message: "Managed candidate not found",
      statusCode: 404,
      ...baseDetails,
    });
  }

  const effectiveAssignedTo = resolveEffectiveAssignedTo(managedCandidate.assignedTo, agent.assignedTo);
  if (!fullAccess && !isVisibleAssignee(effectiveAssignedTo, visibleAssigneeIds)) {
    return buildCandidateAccessError({
      message: "Candidate not accessible to this sales user",
      statusCode: 403,
      assignedTo: effectiveAssignedTo,
      ...baseDetails,
    });
  }

  return {
    success: true,
    candidateType: "B2B",
    agent,
    agentId: String(agent._id),
    managedCandidate,
    managedCandidateId: String(managedCandidate._id),
    assignedTo: normalizeAssignedTo(effectiveAssignedTo),
  };
};

module.exports = {
  hasFullSalesCandidateAccess,
  getVisibleSalesAssigneeIds,
  listAccessibleSalesCandidates,
  resolveAccessibleSalesCandidate,
  buildCandidateAccessError,
};

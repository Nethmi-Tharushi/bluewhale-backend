const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const AdminUser = require("../models/AdminUser");
const AdminWorkSession = require("../models/AdminWorkSession");
const AdminLeaveRequest = require("../models/AdminLeaveRequest");
const HrRecruitmentCampaign = require("../models/HrRecruitmentCampaign");
const HrRecruitmentCandidate = require("../models/HrRecruitmentCandidate");
const HrRecruitmentRole = require("../models/HrRecruitmentRole");
const {
  buildLeaveBalanceMapForAdmins,
  ensureLeavePolicySettings,
} = require("../services/adminLeavePolicyService");

const TRACKED_ROLES = ["SalesAdmin", "SalesStaff"];
const INTERVIEWER_ROLES = ["MainAdmin", "HRManager", "SalesAdmin"];
const CAMPAIGN_STATUS_OPTIONS = ["draft", "open", "on_hold", "closed", "filled"];
const CANDIDATE_STATUS_OPTIONS = ["active", "hired", "rejected", "withdrawn"];
const INTERVIEW_STATUS_OPTIONS = ["scheduled", "completed", "cancelled", "no_show"];
const LOCATION_TYPE_OPTIONS = ["Zoom", "Google Meet", "Microsoft Teams", "Phone", "Physical"];
const DEFAULT_PIPELINE_STAGES = ["Applied", "CV Review", "First Interview", "Second Interview", "Offered", "Hired"];
const DEFAULT_STAFF_LOOKBACK_DAYS = 30;
const DEFAULT_JOB_ROLES = [
  { name: "Sales Admin", description: "Internal sales admin role" },
  { name: "Sales Staff", description: "Internal sales staff role" },
];

const emitHrRecruitmentUpdate = (eventType, payload = {}) => {
  try {
    const io = global.__crm_io;
    if (!io) return;
    const message = {
      eventType,
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    io.to("role:HRManager").emit("crm:hr-recruitment.updated", message);
    io.to("role:MainAdmin").emit("crm:hr-recruitment.updated", message);
  } catch (error) {
    console.error("Failed to emit HR recruitment socket event:", error);
  }
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

const getOverlapSeconds = (startA, endA, startB, endB) => {
  const from = Math.max(new Date(startA).getTime(), new Date(startB).getTime());
  const to = Math.min(new Date(endA).getTime(), new Date(endB).getTime());
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return 0;
  return Math.max(0, Math.floor((to - from) / 1000));
};

const getSessionMetrics = (session, { start, end, referenceTime = new Date() }) => {
  const sessionStart = session?.loginAt ? new Date(session.loginAt) : null;
  const sessionEnd = session?.endedAt ? new Date(session.endedAt) : new Date(referenceTime);
  if (!sessionStart || Number.isNaN(sessionStart.getTime()) || Number.isNaN(sessionEnd.getTime())) {
    return { loggedSeconds: 0, activeSeconds: 0, breakSeconds: 0 };
  }

  const loggedSeconds = getOverlapSeconds(sessionStart, sessionEnd, start, end);
  if (!loggedSeconds) return { loggedSeconds: 0, activeSeconds: 0, breakSeconds: 0 };

  let breakSeconds = 0;
  for (const entry of Array.isArray(session?.breakEntries) ? session.breakEntries : []) {
    if (!entry?.startedAt) continue;
    breakSeconds += getOverlapSeconds(entry.startedAt, entry.endedAt || entry.startedAt, start, end);
  }

  if (session?.currentState === "on_break" && session?.currentBreakStartedAt && !session?.endedAt) {
    breakSeconds += getOverlapSeconds(session.currentBreakStartedAt, referenceTime, start, end);
  }

  breakSeconds = Math.min(breakSeconds, loggedSeconds);
  return {
    loggedSeconds,
    activeSeconds: Math.max(0, loggedSeconds - breakSeconds),
    breakSeconds,
  };
};

const roleLabel = (role = "") => {
  if (role === "SalesAdmin") return "Sales Admin";
  if (role === "SalesStaff") return "Sales Staff";
  if (role === "HRManager") return "HR Manager";
  if (role === "MainAdmin") return "Main Admin";
  return role || "-";
};

const normalizeString = (value = "") => String(value || "").trim();

const normalizeCampaignStatus = (value = "") => {
  const normalized = normalizeString(value);
  return CAMPAIGN_STATUS_OPTIONS.includes(normalized) ? normalized : "open";
};

const normalizeCandidateStatus = (value = "") => {
  const normalized = normalizeString(value);
  return CANDIDATE_STATUS_OPTIONS.includes(normalized) ? normalized : "active";
};

const normalizeInterviewStatus = (value = "") => {
  const normalized = normalizeString(value);
  return INTERVIEW_STATUS_OPTIONS.includes(normalized) ? normalized : "scheduled";
};

const normalizeLocationType = (value = "") => {
  const normalized = normalizeString(value);
  return LOCATION_TYPE_OPTIONS.includes(normalized) ? normalized : "Google Meet";
};

const parseStageList = (value) => {
  if (Array.isArray(value)) {
    const cleaned = value.map((item) => normalizeString(item)).filter(Boolean);
    return cleaned.length ? cleaned : DEFAULT_PIPELINE_STAGES;
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parseStageList(parsed);
    } catch {
      const split = value
        .split(",")
        .map((item) => normalizeString(item))
        .filter(Boolean);
      if (split.length) return split;
    }
  }

  return DEFAULT_PIPELINE_STAGES;
};

const ensureDefaultHrRecruitmentRoles = async (actorId = null) => {
  const existing = await HrRecruitmentRole.find({})
    .select("_id name description isActive")
    .sort({ name: 1 })
    .lean();

  if (existing.length) return existing;
  if (!actorId) return [];

  await HrRecruitmentRole.insertMany(
    DEFAULT_JOB_ROLES.map((role) => ({
      ...role,
      createdBy: actorId,
    }))
  );

  return HrRecruitmentRole.find({})
    .select("_id name description isActive")
    .sort({ name: 1 })
    .lean();
};

const getRoleOptions = async (actorId = null) => {
  const roles = await ensureDefaultHrRecruitmentRoles(actorId);
  return roles
    .filter((role) => role.isActive !== false)
    .map((role) => ({
      _id: role._id,
      value: role.name || "",
      label: role.name || "",
      description: role.description || "",
      isActive: role.isActive !== false,
    }));
};

const serializeCampaign = (campaign, candidates = []) => {
  const campaignId = String(campaign?._id || "");
  const relatedCandidates = candidates.filter((candidate) => String(candidate.campaignId?._id || candidate.campaignId || "") === campaignId);
  const upcomingInterviews = relatedCandidates.flatMap((candidate) =>
    (candidate.interviews || []).filter((interview) => interview.status === "scheduled")
  ).length;

  return {
    _id: campaign._id,
    title: campaign.title || "",
    positionRole: campaign.positionRole || "",
    positionRoleLabel: roleLabel(campaign.positionRole),
    branch: campaign.branch || "",
    locationLabel: campaign.locationLabel || "",
    workMode: campaign.workMode || "Onsite",
    openings: Number(campaign.openings || 0),
    status: campaign.status || "open",
    pipelineStages: Array.isArray(campaign.pipelineStages) && campaign.pipelineStages.length
      ? campaign.pipelineStages
      : DEFAULT_PIPELINE_STAGES,
    notes: campaign.notes || "",
    createdAt: campaign.createdAt || null,
    updatedAt: campaign.updatedAt || null,
    createdBy: campaign.createdBy && typeof campaign.createdBy === "object"
      ? {
          _id: campaign.createdBy._id,
          name: campaign.createdBy.name || "",
          email: campaign.createdBy.email || "",
          role: campaign.createdBy.role || "",
        }
      : null,
    metrics: {
      applicants: relatedCandidates.length,
      activeApplicants: relatedCandidates.filter((candidate) => candidate.candidateStatus === "active").length,
      hiredApplicants: relatedCandidates.filter((candidate) => candidate.candidateStatus === "hired").length,
      upcomingInterviews,
    },
  };
};

const getLatestInterviewForRound = (candidate, roundNumber) => {
  return [...(candidate?.interviews || [])]
    .filter((interview) => Number(interview.roundNumber) === Number(roundNumber))
    .sort((left, right) => new Date(right.scheduledAt || 0) - new Date(left.scheduledAt || 0))[0] || null;
};

const completeScheduledInterviewRound = (candidate, roundNumber) => {
  const targetInterview = [...(candidate?.interviews || [])]
    .filter((interview) => Number(interview.roundNumber) === Number(roundNumber))
    .sort((left, right) => new Date(right.scheduledAt || 0) - new Date(left.scheduledAt || 0))
    .find((interview) => interview.status === "scheduled");

  if (!targetInterview) {
    return false;
  }

  targetInterview.status = "completed";
  return true;
};

const serializeCandidate = (candidate) => {
  const firstInterview = getLatestInterviewForRound(candidate, 1);
  const secondInterview = getLatestInterviewForRound(candidate, 2);

  return {
    _id: candidate._id,
    campaignId: candidate.campaignId && typeof candidate.campaignId === "object"
      ? {
          _id: candidate.campaignId._id,
          title: candidate.campaignId.title || "",
          positionRole: candidate.campaignId.positionRole || "",
          positionRoleLabel: roleLabel(candidate.campaignId.positionRole),
          status: candidate.campaignId.status || "open",
          pipelineStages: candidate.campaignId.pipelineStages || DEFAULT_PIPELINE_STAGES,
        }
      : candidate.campaignId,
    fullName: candidate.fullName || "",
    email: candidate.email || "",
    phone: candidate.phone || "",
    currentLocation: candidate.currentLocation || "",
    source: candidate.source || "Manual",
    yearsOfExperience: Number(candidate.yearsOfExperience || 0),
    notes: candidate.notes || "",
    cv: {
      url: candidate.cvUrl || "",
      fileName: candidate.cvFileName || "",
      cloudinaryId: candidate.cvCloudinaryId || "",
      mimeType: candidate.cvMimeType || "",
    },
    pipelineStage: candidate.pipelineStage || "Applied",
    candidateStatus: candidate.candidateStatus || "active",
    firstInterviewStatus: firstInterview?.status || "not_scheduled",
    secondInterviewStatus: secondInterview?.status || "not_scheduled",
    linkedStaff: candidate.linkedStaffId && typeof candidate.linkedStaffId === "object"
      ? {
          _id: candidate.linkedStaffId._id,
          name: candidate.linkedStaffId.name || "",
          email: candidate.linkedStaffId.email || "",
          role: candidate.linkedStaffId.role || "",
        }
      : null,
    hiredAt: candidate.hiredAt || null,
    createdAt: candidate.createdAt || null,
    updatedAt: candidate.updatedAt || null,
    createdBy: candidate.createdBy && typeof candidate.createdBy === "object"
      ? {
          _id: candidate.createdBy._id,
          name: candidate.createdBy.name || "",
          email: candidate.createdBy.email || "",
          role: candidate.createdBy.role || "",
        }
      : null,
    interviews: (candidate.interviews || [])
      .map((interview) => ({
        _id: interview._id,
        roundNumber: Number(interview.roundNumber || 1),
        stageLabel: interview.stageLabel || "",
        status: interview.status || "scheduled",
        scheduledAt: interview.scheduledAt || null,
        interviewer: interview.interviewer && typeof interview.interviewer === "object"
          ? {
              _id: interview.interviewer._id,
              name: interview.interviewer.name || "",
              email: interview.interviewer.email || "",
              role: interview.interviewer.role || "",
            }
          : null,
        locationType: interview.locationType || "Google Meet",
        meetingLink: interview.meetingLink || "",
        location: interview.location || "",
        notes: interview.notes || "",
        feedback: interview.feedback || "",
        createdAt: interview.createdAt || null,
        updatedAt: interview.updatedAt || null,
      }))
      .sort((left, right) => new Date(left.scheduledAt || 0) - new Date(right.scheduledAt || 0)),
    stageHistory: (candidate.stageHistory || [])
      .map((entry) => ({
        stage: entry.stage || "",
        note: entry.note || "",
        changedAt: entry.changedAt || null,
        changedBy: entry.changedBy && typeof entry.changedBy === "object"
          ? {
              _id: entry.changedBy._id,
              name: entry.changedBy.name || "",
              email: entry.changedBy.email || "",
              role: entry.changedBy.role || "",
            }
          : null,
      }))
      .sort((left, right) => new Date(right.changedAt || 0) - new Date(left.changedAt || 0)),
  };
};

const buildStaffDirectory = async () => {
  const staff = await AdminUser.find({ role: { $in: TRACKED_ROLES } })
    .select("_id name email phone role reportsTo createdAt lastLogin settings")
    .populate("reportsTo", "_id name email role")
    .sort({ role: 1, name: 1 })
    .lean();

  const staffIds = staff.map((member) => member._id);
  const lookbackStart = addDays(startOfDay(new Date()), -(DEFAULT_STAFF_LOOKBACK_DAYS - 1));
  const balanceYear = new Date().getFullYear();
  const leavePolicySettings = await ensureLeavePolicySettings();
  const { balanceMap } = await buildLeaveBalanceMapForAdmins({
    admins: staff.map((member) => ({ _id: member._id, role: member.role || "" })),
    year: balanceYear,
    settings: leavePolicySettings,
    statuses: ["approved", "pending"],
  });

  const [sessions, leaves] = await Promise.all([
    AdminWorkSession.find({
      adminId: { $in: staffIds },
      loginAt: { $gte: lookbackStart },
    })
      .select("adminId loginAt lastSeenAt endedAt breakEntries currentState currentBreakStartedAt")
      .sort({ loginAt: -1 })
      .lean(),
    AdminLeaveRequest.find({
      adminId: { $in: staffIds },
    })
      .select("adminId status totalDays startDate endDate leaveType createdAt reviewedAt")
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const sessionMap = new Map();
  const latestSessionMap = new Map();
  for (const session of sessions) {
    const key = String(session.adminId);
    if (!sessionMap.has(key)) sessionMap.set(key, []);
    sessionMap.get(key).push(session);
    if (!latestSessionMap.has(key)) latestSessionMap.set(key, session);
  }

  const leaveMap = new Map();
  for (const leave of leaves) {
    const key = String(leave.adminId);
    if (!leaveMap.has(key)) leaveMap.set(key, []);
    leaveMap.get(key).push(leave);
  }

  return staff.map((member) => {
    const key = String(member._id);
    const memberSessions = sessionMap.get(key) || [];
    const memberLeaves = leaveMap.get(key) || [];
    const leaveBalances = balanceMap.get(key) || [];

    const metrics = memberSessions.reduce(
      (acc, session) => {
        const sessionMetrics = getSessionMetrics(session, {
          start: lookbackStart,
          end: new Date(),
        });
        acc.loggedSeconds += sessionMetrics.loggedSeconds;
        acc.activeSeconds += sessionMetrics.activeSeconds;
        acc.breakSeconds += sessionMetrics.breakSeconds;
        return acc;
      },
      { loggedSeconds: 0, activeSeconds: 0, breakSeconds: 0 }
    );

    const approvedLeaves = memberLeaves.filter((leave) => leave.status === "approved");
    const pendingLeaves = memberLeaves.filter((leave) => leave.status === "pending");
    const rejectedLeaves = memberLeaves.filter((leave) => leave.status === "rejected");

    const latestSession = latestSessionMap.get(key) || null;
    const lastActivityAt = latestSession?.lastSeenAt || latestSession?.endedAt || latestSession?.loginAt || member.lastLogin || null;

    return {
      _id: member._id,
      name: member.name || "",
      email: member.email || "",
      phone: member.phone || "",
      role: member.role || "",
      roleLabel: roleLabel(member.role),
      designation: roleLabel(member.role),
      branch: member?.settings?.prefs?.branch || "",
      reportsTo: member.reportsTo
        ? {
            _id: member.reportsTo._id,
            name: member.reportsTo.name || "",
            email: member.reportsTo.email || "",
            role: member.reportsTo.role || "",
          }
        : null,
      createdAt: member.createdAt || null,
      lastLogin: member.lastLogin || null,
      lastActivityAt,
      workSummary: {
        loggedSeconds: metrics.loggedSeconds,
        activeSeconds: metrics.activeSeconds,
        breakSeconds: metrics.breakSeconds,
      },
      leaveSummary: {
        approvedCount: approvedLeaves.length,
        approvedDays: approvedLeaves.reduce((sum, leave) => sum + Number(leave.totalDays || 0), 0),
        pendingCount: pendingLeaves.length,
        pendingDays: pendingLeaves.reduce((sum, leave) => sum + Number(leave.totalDays || 0), 0),
        rejectedCount: rejectedLeaves.length,
        balanceYear,
        balances: leaveBalances,
      },
      recentLeaves: memberLeaves.slice(0, 5).map((leave) => ({
        _id: leave._id,
        leaveType: leave.leaveType || "annual",
        status: leave.status || "pending",
        totalDays: Number(leave.totalDays || 0),
        startDate: leave.startDate || null,
        endDate: leave.endDate || null,
        createdAt: leave.createdAt || null,
        reviewedAt: leave.reviewedAt || null,
      })),
    };
  });
};

const getCampaignById = async (campaignId) => {
  if (!mongoose.Types.ObjectId.isValid(String(campaignId || ""))) return null;
  return HrRecruitmentCampaign.findById(campaignId);
};

exports.getHrRecruitmentDashboard = asyncHandler(async (req, res) => {
  const campaignFilterId = normalizeString(req.query?.campaignId);
  const [campaignsRaw, candidatesRaw, interviewers, staffDirectory, roleOptions] = await Promise.all([
    HrRecruitmentCampaign.find({})
      .populate("createdBy", "_id name email role")
      .sort({ createdAt: -1 })
      .lean(),
    HrRecruitmentCandidate.find(campaignFilterId && mongoose.Types.ObjectId.isValid(campaignFilterId) ? { campaignId: campaignFilterId } : {})
      .populate("campaignId", "_id title positionRole status pipelineStages")
      .populate("createdBy", "_id name email role")
      .populate("linkedStaffId", "_id name email role")
      .populate("interviews.interviewer", "_id name email role")
      .populate("stageHistory.changedBy", "_id name email role")
      .sort({ createdAt: -1 })
      .lean(),
    AdminUser.find({ role: { $in: INTERVIEWER_ROLES } })
      .select("_id name email role")
      .sort({ role: 1, name: 1 })
      .lean(),
    buildStaffDirectory(),
    getRoleOptions(req.admin?._id || null),
  ]);

  const campaigns = campaignsRaw.map((campaign) => serializeCampaign(campaign, candidatesRaw));
  const candidates = candidatesRaw.map(serializeCandidate);
  const activeCandidates = candidates.filter((candidate) => candidate.candidateStatus === "active");
  const upcomingInterviews = candidates.flatMap((candidate) =>
    (candidate.interviews || []).filter((interview) => interview.status === "scheduled")
  );

  return res.json({
    success: true,
    data: {
      summary: {
        campaigns: campaigns.length,
        openCampaigns: campaigns.filter((campaign) => campaign.status === "open").length,
        activeCandidates: activeCandidates.length,
        upcomingInterviews: upcomingInterviews.length,
        hiredCandidates: candidates.filter((candidate) => candidate.candidateStatus === "hired").length,
        staffMembers: staffDirectory.length,
      },
      campaigns,
      candidates,
      staffDirectory,
      meta: {
        roleOptions,
        campaignStatusOptions: CAMPAIGN_STATUS_OPTIONS.map((value) => ({
          value,
          label: value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
        })),
        candidateStatusOptions: CANDIDATE_STATUS_OPTIONS.map((value) => ({
          value,
          label: value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
        })),
        interviewStatusOptions: [
          { value: "scheduled", label: "Scheduled" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
          { value: "no_show", label: "No show" },
        ],
        locationTypeOptions: LOCATION_TYPE_OPTIONS,
        defaultPipelineStages: DEFAULT_PIPELINE_STAGES,
        interviewers: interviewers.map((member) => ({
          _id: member._id,
          name: member.name || "",
          email: member.email || "",
          role: member.role || "",
          roleLabel: roleLabel(member.role),
        })),
        linkableStaff: staffDirectory.map((member) => ({
          _id: member._id,
          name: member.name || "",
          email: member.email || "",
          role: member.role || "",
          roleLabel: member.roleLabel,
        })),
      },
    },
  });
});

exports.createHrRecruitmentRole = asyncHandler(async (req, res) => {
  const name = normalizeString(req.body?.name);
  const description = normalizeString(req.body?.description);

  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }

  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = await HrRecruitmentRole.findOne({
    name: { $regex: `^${escapedName}$`, $options: "i" },
  })
    .select("_id")
    .lean();

  if (existing) {
    return res.status(409).json({ message: "This job role already exists" });
  }

  const role = await HrRecruitmentRole.create({
    name,
    description,
    isActive: true,
    createdBy: req.admin._id,
  });

  emitHrRecruitmentUpdate("role_created", {
    roleId: String(role._id || ""),
    roleName: role.name || "",
  });

  return res.status(201).json({
    success: true,
    data: {
      _id: role._id,
      value: role.name || "",
      label: role.name || "",
      description: role.description || "",
      isActive: role.isActive !== false,
    },
  });
});

exports.createHrRecruitmentCampaign = asyncHandler(async (req, res) => {
  const title = normalizeString(req.body?.title);
  const positionRole = normalizeString(req.body?.positionRole);
  if (!title || !positionRole) {
    return res.status(400).json({ message: "title and positionRole are required" });
  }

  const roleOptions = await getRoleOptions(req.admin?._id || null);
  if (!roleOptions.some((role) => role.value === positionRole)) {
    return res.status(400).json({ message: "Selected job role is not available" });
  }

  const campaign = await HrRecruitmentCampaign.create({
    title,
    positionRole,
    branch: normalizeString(req.body?.branch),
    locationLabel: normalizeString(req.body?.locationLabel),
    workMode: ["Onsite", "Remote", "Hybrid"].includes(normalizeString(req.body?.workMode))
      ? normalizeString(req.body?.workMode)
      : "Onsite",
    openings: Math.max(1, Number(req.body?.openings || 1)),
    status: normalizeCampaignStatus(req.body?.status),
    pipelineStages: parseStageList(req.body?.pipelineStages),
    notes: normalizeString(req.body?.notes),
    createdBy: req.admin._id,
  });

  const populated = await HrRecruitmentCampaign.findById(campaign._id)
    .populate("createdBy", "_id name email role")
    .lean();

  emitHrRecruitmentUpdate("campaign_created", {
    campaignId: String(campaign._id || ""),
    positionRole,
  });
  return res.status(201).json({ success: true, data: serializeCampaign(populated, []) });
});

exports.updateHrRecruitmentCampaign = asyncHandler(async (req, res) => {
  const campaign = await getCampaignById(req.params.id);
  if (!campaign) {
    return res.status(404).json({ message: "Campaign not found" });
  }

  if (req.body?.title !== undefined) campaign.title = normalizeString(req.body.title) || campaign.title;
  if (req.body?.positionRole !== undefined) {
    const role = normalizeString(req.body.positionRole);
    if (!role) return res.status(400).json({ message: "Invalid positionRole" });
    const roleOptions = await getRoleOptions(req.admin?._id || null);
    if (!roleOptions.some((option) => option.value === role)) {
      return res.status(400).json({ message: "Selected job role is not available" });
    }
    campaign.positionRole = role;
  }
  if (req.body?.branch !== undefined) campaign.branch = normalizeString(req.body.branch);
  if (req.body?.locationLabel !== undefined) campaign.locationLabel = normalizeString(req.body.locationLabel);
  if (req.body?.workMode !== undefined) {
    const nextMode = normalizeString(req.body.workMode);
    if (!["Onsite", "Remote", "Hybrid"].includes(nextMode)) {
      return res.status(400).json({ message: "Invalid workMode" });
    }
    campaign.workMode = nextMode;
  }
  if (req.body?.openings !== undefined) campaign.openings = Math.max(1, Number(req.body.openings || 1));
  if (req.body?.status !== undefined) campaign.status = normalizeCampaignStatus(req.body.status);
  if (req.body?.pipelineStages !== undefined) campaign.pipelineStages = parseStageList(req.body.pipelineStages);
  if (req.body?.notes !== undefined) campaign.notes = normalizeString(req.body.notes);

  await campaign.save();
  const populated = await HrRecruitmentCampaign.findById(campaign._id)
    .populate("createdBy", "_id name email role")
    .lean();
  emitHrRecruitmentUpdate("campaign_updated", {
    campaignId: String(campaign._id || ""),
    positionRole: campaign.positionRole || "",
    status: campaign.status || "",
  });
  return res.json({ success: true, data: serializeCampaign(populated, []) });
});

exports.deleteHrRecruitmentCampaign = asyncHandler(async (req, res) => {
  const campaign = await getCampaignById(req.params.id);
  if (!campaign) {
    return res.status(404).json({ message: "Campaign not found" });
  }

  const campaignId = String(campaign._id || "");
  const campaignTitle = campaign.title || "";

  await HrRecruitmentCandidate.deleteMany({ campaignId: campaign._id });
  await HrRecruitmentCampaign.deleteOne({ _id: campaign._id });

  emitHrRecruitmentUpdate("campaign_deleted", {
    campaignId,
    campaignTitle,
  });

  return res.json({
    success: true,
    message: "Campaign deleted successfully",
    data: {
      _id: campaignId,
      title: campaignTitle,
    },
  });
});

exports.createHrRecruitmentCandidate = asyncHandler(async (req, res) => {
  const campaignId = normalizeString(req.body?.campaignId);
  const fullName = normalizeString(req.body?.fullName);
  if (!mongoose.Types.ObjectId.isValid(campaignId)) {
    return res.status(400).json({ message: "Valid campaignId is required" });
  }
  if (!fullName) {
    return res.status(400).json({ message: "fullName is required" });
  }

  const campaign = await HrRecruitmentCampaign.findById(campaignId).lean();
  if (!campaign) {
    return res.status(404).json({ message: "Campaign not found" });
  }

  const pipelineStage = normalizeString(req.body?.pipelineStage) || campaign.pipelineStages?.[0] || "Applied";
  const uploadedFile = req.file || null;

  const candidate = await HrRecruitmentCandidate.create({
    campaignId,
    fullName,
    email: normalizeString(req.body?.email).toLowerCase(),
    phone: normalizeString(req.body?.phone),
    currentLocation: normalizeString(req.body?.currentLocation),
    source: normalizeString(req.body?.source) || "Manual",
    yearsOfExperience: Math.max(0, Number(req.body?.yearsOfExperience || 0)),
    notes: normalizeString(req.body?.notes),
    cvUrl: uploadedFile?.path || uploadedFile?.secure_url || normalizeString(req.body?.cvUrl),
    cvFileName: uploadedFile?.originalname || normalizeString(req.body?.cvFileName),
    cvCloudinaryId: uploadedFile?.filename || uploadedFile?.public_id || "",
    cvMimeType: uploadedFile?.mimetype || "",
    pipelineStage,
    candidateStatus: normalizeCandidateStatus(req.body?.candidateStatus),
    linkedStaffId: mongoose.Types.ObjectId.isValid(String(req.body?.linkedStaffId || "")) ? req.body.linkedStaffId : null,
    hiredAt: normalizeCandidateStatus(req.body?.candidateStatus) === "hired" ? new Date() : null,
    createdBy: req.admin._id,
    stageHistory: [
      {
        stage: pipelineStage,
        note: "Candidate created",
        changedBy: req.admin._id,
        changedAt: new Date(),
      },
    ],
  });

  const populated = await HrRecruitmentCandidate.findById(candidate._id)
    .populate("campaignId", "_id title positionRole status pipelineStages")
    .populate("createdBy", "_id name email role")
    .populate("linkedStaffId", "_id name email role")
    .populate("interviews.interviewer", "_id name email role")
    .populate("stageHistory.changedBy", "_id name email role")
    .lean();

  emitHrRecruitmentUpdate("candidate_created", {
    campaignId,
    candidateId: String(candidate._id || ""),
    candidateStatus: candidate.candidateStatus || "",
    pipelineStage: candidate.pipelineStage || "",
  });
  return res.status(201).json({ success: true, data: serializeCandidate(populated) });
});

exports.updateHrRecruitmentCandidate = asyncHandler(async (req, res) => {
  const candidate = await HrRecruitmentCandidate.findById(req.params.id);
  if (!candidate) {
    return res.status(404).json({ message: "Candidate not found" });
  }

  const campaign = await HrRecruitmentCampaign.findById(candidate.campaignId).lean();
  const uploadedFile = req.file || null;
  const previousStage = candidate.pipelineStage || "Applied";

  if (req.body?.fullName !== undefined) candidate.fullName = normalizeString(req.body.fullName) || candidate.fullName;
  if (req.body?.email !== undefined) candidate.email = normalizeString(req.body.email).toLowerCase();
  if (req.body?.phone !== undefined) candidate.phone = normalizeString(req.body.phone);
  if (req.body?.currentLocation !== undefined) candidate.currentLocation = normalizeString(req.body.currentLocation);
  if (req.body?.source !== undefined) candidate.source = normalizeString(req.body.source) || "Manual";
  if (req.body?.yearsOfExperience !== undefined) candidate.yearsOfExperience = Math.max(0, Number(req.body.yearsOfExperience || 0));
  if (req.body?.notes !== undefined) candidate.notes = normalizeString(req.body.notes);
  if (req.body?.candidateStatus !== undefined) candidate.candidateStatus = normalizeCandidateStatus(req.body.candidateStatus);
  if (req.body?.linkedStaffId !== undefined) {
    candidate.linkedStaffId = mongoose.Types.ObjectId.isValid(String(req.body.linkedStaffId || ""))
      ? req.body.linkedStaffId
      : null;
  }
  if (req.body?.pipelineStage !== undefined) {
    const nextStage = normalizeString(req.body.pipelineStage);
    const allowedStages = Array.isArray(campaign?.pipelineStages) && campaign.pipelineStages.length
      ? campaign.pipelineStages
      : DEFAULT_PIPELINE_STAGES;
    if (!allowedStages.includes(nextStage)) {
      return res.status(400).json({ message: "Selected pipeline stage is not part of this campaign" });
    }
    candidate.pipelineStage = nextStage;
    if (nextStage !== previousStage) {
      candidate.stageHistory.push({
        stage: nextStage,
        note: normalizeString(req.body?.stageNote) || `Stage moved from ${previousStage} to ${nextStage}`,
        changedBy: req.admin._id,
        changedAt: new Date(),
      });
    }

    if (nextStage === "Offered") {
      const autoCompletedSecondInterview = completeScheduledInterviewRound(candidate, 2);
      if (autoCompletedSecondInterview) {
        candidate.stageHistory.push({
          stage: "Second Interview",
          note: "Second interview auto-completed when candidate moved to Offered",
          changedBy: req.admin._id,
          changedAt: new Date(),
        });
      }
    }
  }

  if (uploadedFile) {
    candidate.cvUrl = uploadedFile.path || uploadedFile.secure_url || "";
    candidate.cvFileName = uploadedFile.originalname || "";
    candidate.cvCloudinaryId = uploadedFile.filename || uploadedFile.public_id || "";
    candidate.cvMimeType = uploadedFile.mimetype || "";
  } else if (req.body?.cvUrl !== undefined) {
    candidate.cvUrl = normalizeString(req.body.cvUrl);
    if (req.body?.cvFileName !== undefined) candidate.cvFileName = normalizeString(req.body.cvFileName);
  }

  if (candidate.candidateStatus === "hired" && !candidate.hiredAt) {
    candidate.hiredAt = new Date();
  }
  if (candidate.candidateStatus !== "hired") {
    candidate.hiredAt = null;
  }

  await candidate.save();

  const populated = await HrRecruitmentCandidate.findById(candidate._id)
    .populate("campaignId", "_id title positionRole status pipelineStages")
    .populate("createdBy", "_id name email role")
    .populate("linkedStaffId", "_id name email role")
    .populate("interviews.interviewer", "_id name email role")
    .populate("stageHistory.changedBy", "_id name email role")
    .lean();

  emitHrRecruitmentUpdate("candidate_updated", {
    campaignId: String(candidate.campaignId || ""),
    candidateId: String(candidate._id || ""),
    candidateStatus: candidate.candidateStatus || "",
    pipelineStage: candidate.pipelineStage || "",
  });
  return res.json({ success: true, data: serializeCandidate(populated) });
});

exports.deleteHrRecruitmentCandidate = asyncHandler(async (req, res) => {
  const candidate = await HrRecruitmentCandidate.findById(req.params.id).lean();
  if (!candidate) {
    return res.status(404).json({ message: "Candidate not found" });
  }

  await HrRecruitmentCandidate.deleteOne({ _id: candidate._id });

  emitHrRecruitmentUpdate("candidate_deleted", {
    campaignId: String(candidate.campaignId || ""),
    candidateId: String(candidate._id || ""),
    fullName: candidate.fullName || "",
  });

  return res.json({
    success: true,
    message: "Candidate deleted successfully",
    data: {
      _id: String(candidate._id || ""),
      fullName: candidate.fullName || "",
    },
  });
});

exports.scheduleHrRecruitmentInterview = asyncHandler(async (req, res) => {
  const candidate = await HrRecruitmentCandidate.findById(req.params.id);
  if (!candidate) {
    return res.status(404).json({ message: "Candidate not found" });
  }

  const roundNumber = Number(req.body?.roundNumber || 1);
  if (![1, 2].includes(roundNumber)) {
    return res.status(400).json({ message: "roundNumber must be 1 or 2" });
  }

  const scheduledAt = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    return res.status(400).json({ message: "A valid scheduledAt date is required" });
  }

  const interviewerId = normalizeString(req.body?.interviewerId);
  let interviewer = null;
  if (interviewerId) {
    interviewer = await AdminUser.findOne({
      _id: interviewerId,
      role: { $in: INTERVIEWER_ROLES },
    }).select("_id");
    if (!interviewer) {
      return res.status(400).json({ message: "Invalid interviewer selected" });
    }
  }

  const interview = {
    roundNumber,
    stageLabel: normalizeString(req.body?.stageLabel) || (roundNumber === 1 ? "First Interview" : "Second Interview"),
    status: normalizeInterviewStatus(req.body?.status),
    scheduledAt,
    interviewer: interviewer?._id || null,
    locationType: normalizeLocationType(req.body?.locationType),
    meetingLink: normalizeString(req.body?.meetingLink),
    location: normalizeString(req.body?.location),
    notes: normalizeString(req.body?.notes),
    feedback: normalizeString(req.body?.feedback),
    createdBy: req.admin._id,
  };

  candidate.interviews.push(interview);

  if (roundNumber === 2) {
    const autoCompletedFirstInterview = completeScheduledInterviewRound(candidate, 1);
    if (autoCompletedFirstInterview) {
      candidate.stageHistory.push({
        stage: "First Interview",
        note: "First interview auto-completed when second interview was scheduled",
        changedBy: req.admin._id,
        changedAt: new Date(),
      });
    }
  }

  const stageLabel = roundNumber === 1 ? "First Interview" : "Second Interview";
  if ((candidate.pipelineStage || "") !== stageLabel) {
    candidate.pipelineStage = stageLabel;
    candidate.stageHistory.push({
      stage: stageLabel,
      note: `Interview round ${roundNumber} scheduled`,
      changedBy: req.admin._id,
      changedAt: new Date(),
    });
  }

  await candidate.save();

  const populated = await HrRecruitmentCandidate.findById(candidate._id)
    .populate("campaignId", "_id title positionRole status pipelineStages")
    .populate("createdBy", "_id name email role")
    .populate("linkedStaffId", "_id name email role")
    .populate("interviews.interviewer", "_id name email role")
    .populate("stageHistory.changedBy", "_id name email role")
    .lean();

  emitHrRecruitmentUpdate("interview_scheduled", {
    campaignId: String(candidate.campaignId || ""),
    candidateId: String(candidate._id || ""),
    roundNumber,
  });
  return res.status(201).json({ success: true, data: serializeCandidate(populated) });
});

exports.updateHrRecruitmentInterview = asyncHandler(async (req, res) => {
  const candidate = await HrRecruitmentCandidate.findById(req.params.id);
  if (!candidate) {
    return res.status(404).json({ message: "Candidate not found" });
  }

  const interview = candidate.interviews.id(req.params.interviewId);
  if (!interview) {
    return res.status(404).json({ message: "Interview not found" });
  }

  if (req.body?.status !== undefined) interview.status = normalizeInterviewStatus(req.body.status);
  if (req.body?.scheduledAt !== undefined) {
    const nextDate = new Date(req.body.scheduledAt);
    if (Number.isNaN(nextDate.getTime())) {
      return res.status(400).json({ message: "Invalid scheduledAt value" });
    }
    interview.scheduledAt = nextDate;
  }
  if (req.body?.locationType !== undefined) interview.locationType = normalizeLocationType(req.body.locationType);
  if (req.body?.meetingLink !== undefined) interview.meetingLink = normalizeString(req.body.meetingLink);
  if (req.body?.location !== undefined) interview.location = normalizeString(req.body.location);
  if (req.body?.notes !== undefined) interview.notes = normalizeString(req.body.notes);
  if (req.body?.feedback !== undefined) interview.feedback = normalizeString(req.body.feedback);
  if (req.body?.stageLabel !== undefined) interview.stageLabel = normalizeString(req.body.stageLabel);
  if (req.body?.interviewerId !== undefined) {
    const interviewerId = normalizeString(req.body.interviewerId);
    if (!interviewerId) {
      interview.interviewer = null;
    } else {
      const interviewer = await AdminUser.findOne({
        _id: interviewerId,
        role: { $in: INTERVIEWER_ROLES },
      }).select("_id");
      if (!interviewer) {
        return res.status(400).json({ message: "Invalid interviewer selected" });
      }
      interview.interviewer = interviewer._id;
    }
  }

  const roundStage = Number(interview.roundNumber) === 2 ? "Second Interview" : "First Interview";
  if (req.body?.status === "completed" && candidate.pipelineStage !== roundStage) {
    candidate.pipelineStage = roundStage;
    candidate.stageHistory.push({
      stage: roundStage,
      note: `${roundStage} completed`,
      changedBy: req.admin._id,
      changedAt: new Date(),
    });
  }

  await candidate.save();

  const populated = await HrRecruitmentCandidate.findById(candidate._id)
    .populate("campaignId", "_id title positionRole status pipelineStages")
    .populate("createdBy", "_id name email role")
    .populate("linkedStaffId", "_id name email role")
    .populate("interviews.interviewer", "_id name email role")
    .populate("stageHistory.changedBy", "_id name email role")
    .lean();

  emitHrRecruitmentUpdate("interview_updated", {
    campaignId: String(candidate.campaignId || ""),
    candidateId: String(candidate._id || ""),
    interviewId: String(interview._id || ""),
    status: interview.status || "",
  });
  return res.json({ success: true, data: serializeCandidate(populated) });
});

exports.deleteHrRecruitmentInterview = asyncHandler(async (req, res) => {
  const candidate = await HrRecruitmentCandidate.findById(req.params.id);
  if (!candidate) {
    return res.status(404).json({ message: "Candidate not found" });
  }

  const interview = candidate.interviews.id(req.params.interviewId);
  if (!interview) {
    return res.status(404).json({ message: "Interview not found" });
  }

  const interviewId = String(interview._id || "");
  const roundNumber = Number(interview.roundNumber || 1);
  interview.deleteOne();

  await candidate.save();

  const populated = await HrRecruitmentCandidate.findById(candidate._id)
    .populate("campaignId", "_id title positionRole status pipelineStages")
    .populate("createdBy", "_id name email role")
    .populate("linkedStaffId", "_id name email role")
    .populate("interviews.interviewer", "_id name email role")
    .populate("stageHistory.changedBy", "_id name email role")
    .lean();

  emitHrRecruitmentUpdate("interview_deleted", {
    campaignId: String(candidate.campaignId || ""),
    candidateId: String(candidate._id || ""),
    interviewId,
    roundNumber,
  });

  return res.json({
    success: true,
    message: "Interview deleted successfully",
    data: serializeCandidate(populated),
  });
});

exports.getHrStaffDirectory = asyncHandler(async (_req, res) => {
  const data = await buildStaffDirectory();
  return res.json({ success: true, data });
});

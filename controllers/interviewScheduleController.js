const asyncHandler = require("express-async-handler");
const AdminUser = require("../models/AdminUser");
const Campaign = require("../models/Campaign");
const InterviewSchedule = require("../models/InterviewSchedule");
const RecruitmentSettings = require("../models/RecruitmentSettings");
const User = require("../models/User");
const { buildOwnedFilter, getSalesScope } = require("../utils/salesScope");
const {
  getRecruitmentSettingsDoc,
  serializeEvaluationForm,
  calculateEvaluationSummary,
} = require("../services/recruitmentWorkflowService");

const buildAccessibleAdminIds = async (req) => {
  const scope = getSalesScope(req);

  if (scope.isSalesStaff) {
    return [String(scope.actorId)];
  }

  const salesStaff = await AdminUser.find({
    role: "SalesStaff",
    reportsTo: scope.managerId,
  }).select("_id");

  return [String(scope.actorId), ...salesStaff.map((staff) => String(staff._id))];
};

const getAccessibleCandidates = async (req) => {
  const accessibleAdminIds = await buildAccessibleAdminIds(req);

  const b2cCandidates = await User.find({
    userType: "candidate",
    assignedTo: { $in: accessibleAdminIds },
  })
    .select("name email phone")
    .sort({ createdAt: -1 })
    .lean();

  const agents = await User.find({
    userType: "agent",
    "managedCandidates.assignedTo": { $in: accessibleAdminIds },
  })
    .select("name managedCandidates")
    .lean();

  const unified = [
    ...b2cCandidates.map((candidate) => ({
      candidateId: String(candidate._id),
      candidateType: "B2C",
      name: candidate.name || "Candidate",
      email: candidate.email || "",
      phone: candidate.phone || "",
      agentId: "",
    })),
  ];

  agents.forEach((agent) => {
    (agent.managedCandidates || []).forEach((candidate) => {
      if (!candidate?.assignedTo || !accessibleAdminIds.includes(String(candidate.assignedTo))) return;
      unified.push({
        candidateId: String(candidate._id),
        candidateType: "B2B",
        name: candidate.name || "Managed Candidate",
        email: candidate.email || "",
        phone: candidate.phone || "",
        agentId: String(agent._id),
      });
    });
  });

  return unified;
};

const buildInterviewerFilter = (scope) => {
  if (scope.isSalesStaff) {
    return {
      $or: [
        { _id: scope.actorId },
        { _id: scope.managerId },
      ],
    };
  }

  return {
    $or: [
      { _id: scope.actorId },
      { role: "SalesStaff", reportsTo: scope.managerId },
    ],
  };
};

const listInterviewSchedules = asyncHandler(async (req, res) => {
  const schedules = await InterviewSchedule.find(buildOwnedFilter(req, "ownerAdmin", "teamAdmin"))
    .populate("campaign", "campaignName campaignCode")
    .populate("interviewer", "name email role")
    .populate("ownerAdmin", "name email role")
    .populate("evaluations.evaluatedBy", "name email role")
    .sort({ interviewDate: -1, createdAt: -1 })
    .lean();

  res.json({ success: true, data: schedules });
});

const getInterviewScheduleMeta = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);

  const [campaigns, interviewers, candidates] = await Promise.all([
    Campaign.find(buildOwnedFilter(req, "ownerAdmin", "teamAdmin"))
      .select("campaignName campaignCode status")
      .sort({ createdAt: -1 })
      .lean(),
    AdminUser.find(buildInterviewerFilter(scope))
      .select("name email role")
      .sort({ name: 1 })
      .lean(),
    getAccessibleCandidates(req),
  ]);

  const settings = await RecruitmentSettings.findOne({ teamAdmin: scope.managerId }).lean();
  const jobPositions = Array.isArray(settings?.jobPositions)
    ? settings.jobPositions.map((position) => ({
        _id: position._id,
        jobPosition: position.jobPosition,
      }))
    : [];
  const evaluationForms = Array.isArray(settings?.evaluationForms)
    ? settings.evaluationForms
        .map((form) => serializeEvaluationForm(settings, form._id))
        .filter(Boolean)
    : [];

  res.json({
    success: true,
    data: {
      campaigns,
      interviewers,
      candidates,
      jobPositions,
      evaluationForms,
    },
  });
});

const createInterviewSchedule = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const body = req.body || {};

  if (!body.scheduleName || !body.interviewDate || !body.fromHour || !body.toHour || !body.interviewer) {
    return res.status(400).json({ message: "Schedule name, date, time range, and interviewer are required" });
  }

  const selectedCandidates = Array.isArray(body.candidates) ? body.candidates : [];
  if (selectedCandidates.length === 0) {
    return res.status(400).json({ message: "At least one candidate is required" });
  }

  const accessibleCandidates = await getAccessibleCandidates(req);
  const candidateMap = new Map(accessibleCandidates.map((candidate) => [candidate.candidateId, candidate]));

  const normalizedCandidates = selectedCandidates.map((candidate) => {
    const existing = candidateMap.get(String(candidate.candidateId));
    if (!existing) return null;

    return {
      candidateId: existing.candidateId,
      candidateType: existing.candidateType,
      name: existing.name,
      email: existing.email,
      phone: existing.phone,
      agentId: existing.agentId,
    };
  }).filter(Boolean);

  if (normalizedCandidates.length === 0) {
    return res.status(400).json({ message: "Selected candidates are not available to this user" });
  }

  const interviewer = await AdminUser.findOne({
    _id: body.interviewer,
    ...buildInterviewerFilter(scope),
  }).select("_id");

  if (!interviewer) {
    return res.status(400).json({ message: "Invalid interviewer selected" });
  }

  let campaignId = null;
  if (body.campaign) {
    const campaign = await Campaign.findOne({
      _id: body.campaign,
      ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin"),
    }).select("_id");

    if (!campaign) {
      return res.status(400).json({ message: "Selected campaign is not available" });
    }

    campaignId = campaign._id;
  }

  let evaluationFormId = null;
  let evaluationFormName = "";
  let evaluationFormSnapshot = null;
  if (body.evaluationFormId) {
    const settings = await getRecruitmentSettingsDoc(req.admin);
    const formSnapshot = serializeEvaluationForm(settings, body.evaluationFormId);
    if (!formSnapshot) {
      return res.status(400).json({ message: "Selected evaluation form is not available" });
    }

    evaluationFormId = formSnapshot._id;
    evaluationFormName = formSnapshot.formName;
    evaluationFormSnapshot = formSnapshot;
  }

  const schedule = await InterviewSchedule.create({
    teamAdmin: scope.managerId,
    ownerAdmin: scope.actorId,
    campaign: campaignId,
    scheduleName: String(body.scheduleName).trim(),
    position: body.position || "None",
    interviewDate: new Date(body.interviewDate),
    fromHour: String(body.fromHour).trim(),
    toHour: String(body.toHour).trim(),
    interviewer: interviewer._id,
    evaluationFormId,
    evaluationFormName,
    evaluationFormSnapshot,
    candidates: normalizedCandidates,
    status: body.status || "Scheduled",
  });

  const populated = await InterviewSchedule.findById(schedule._id)
    .populate("campaign", "campaignName campaignCode")
    .populate("interviewer", "name email role")
    .populate("ownerAdmin", "name email role")
    .lean();

  res.status(201).json({ success: true, data: populated });
});

const evaluateInterviewScheduleCandidate = asyncHandler(async (req, res) => {
  const schedule = await InterviewSchedule.findOne({
    _id: req.params.id,
    ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin"),
  });

  if (!schedule) {
    return res.status(404).json({ message: "Interview schedule not found" });
  }

  if (!schedule.evaluationFormSnapshot?.criteriaItems?.length) {
    return res.status(400).json({ message: "No evaluation form is linked to this interview schedule" });
  }

  const candidateId = String(req.body?.candidateId || "");
  const candidate = (schedule.candidates || []).find((item) => item.candidateId === candidateId);
  if (!candidate) {
    return res.status(400).json({ message: "Selected candidate is not part of this interview schedule" });
  }

  const summary = calculateEvaluationSummary(
    schedule.evaluationFormSnapshot,
    Array.isArray(req.body?.scores) ? req.body.scores : []
  );

  const evaluationPayload = {
    candidateId,
    candidateName: candidate.name,
    recommendation: req.body?.recommendation || "Pending",
    notes: String(req.body?.notes || "").trim(),
    percentage: summary.percentage,
    totalScore: summary.totalScore,
    maxScore: summary.maxScore,
    totalWeight: summary.totalWeight,
    criteriaScores: summary.criteriaScores,
    evaluatedBy: req.admin._id,
    evaluatedAt: new Date(),
  };

  const existingIndex = (schedule.evaluations || []).findIndex((item) => item.candidateId === candidateId);
  if (existingIndex >= 0) {
    schedule.evaluations.splice(existingIndex, 1, evaluationPayload);
  } else {
    schedule.evaluations.push(evaluationPayload);
  }

  if (
    schedule.status === "Scheduled" &&
    schedule.evaluations.length >= schedule.candidates.length &&
    schedule.candidates.length > 0
  ) {
    schedule.status = "Completed";
  }

  await schedule.save();

  const populated = await InterviewSchedule.findById(schedule._id)
    .populate("campaign", "campaignName campaignCode")
    .populate("interviewer", "name email role")
    .populate("ownerAdmin", "name email role")
    .populate("evaluations.evaluatedBy", "name email role")
    .lean();

  res.json({ success: true, data: populated });
});

const deleteInterviewSchedule = asyncHandler(async (req, res) => {
  const schedule = await InterviewSchedule.findOneAndDelete({
    _id: req.params.id,
    ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin"),
  });

  if (!schedule) {
    return res.status(404).json({ message: "Interview schedule not found" });
  }

  res.json({ success: true, message: "Interview schedule deleted successfully" });
});

module.exports = {
  listInterviewSchedules,
  getInterviewScheduleMeta,
  createInterviewSchedule,
  evaluateInterviewScheduleCandidate,
  deleteInterviewSchedule,
};

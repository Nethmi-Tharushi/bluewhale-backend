require("dotenv").config();
const mongoose = require("mongoose");

const AdminUser = require("../models/AdminUser");
const Campaign = require("../models/Campaign");
const InterviewSchedule = require("../models/InterviewSchedule");
const RecruitmentSettings = require("../models/RecruitmentSettings");
const User = require("../models/User");
const { serializeEvaluationForm } = require("../services/recruitmentWorkflowService");

const trimString = (value) => String(value || "").trim();

const parseArgs = (argv) => {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
};

const buildDefaultDate = () => {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
};

const buildScheduleName = () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `QA Interview Schedule ${stamp}`;
};

const getTeamAdminId = (admin) => {
  if (!admin) return null;
  if (admin.role === "SalesStaff" && admin.reportsTo) {
    return admin.reportsTo;
  }
  return admin._id;
};

const pickOwnerAdmin = async (adminEmail) => {
  const normalizedEmail = trimString(adminEmail).toLowerCase();
  if (normalizedEmail) {
    return AdminUser.findOne({ email: normalizedEmail });
  }

  const priorityRoles = ["SalesAdmin", "MainAdmin", "SalesStaff"];
  for (const role of priorityRoles) {
    const admin = await AdminUser.findOne({ role }).sort({ createdAt: 1 });
    if (admin) {
      return admin;
    }
  }

  return null;
};

const ensureCandidate = async (assignedAdminId) => {
  const existing = await User.findOne({
    userType: "candidate",
    assignedTo: assignedAdminId,
  }).sort({ createdAt: -1 });

  if (existing) {
    return {
      candidateId: String(existing._id),
      candidateType: "B2C",
      name: existing.name || "Candidate",
      email: existing.email || "",
      phone: existing.phone || "",
      agentId: "",
      created: false,
    };
  }

  const stamp = Date.now();
  const candidate = await User.create({
    name: `QA Candidate ${stamp}`,
    email: `qa-candidate-${stamp}@example.com`,
    password: "Pass123!",
    userType: "candidate",
    phone: "+94770000000",
    assignedTo: assignedAdminId,
  });

  return {
    candidateId: String(candidate._id),
    candidateType: "B2C",
    name: candidate.name,
    email: candidate.email || "",
    phone: candidate.phone || "",
    agentId: "",
    created: true,
  };
};

const pickCampaignId = async ({ useCampaign, teamAdminId, ownerAdminId }) => {
  if (!useCampaign) return null;

  const campaign = await Campaign.findOne({
    teamAdmin: teamAdminId,
    ownerAdmin: ownerAdminId,
  }).sort({ createdAt: -1 });

  return campaign ? campaign._id : null;
};

const pickEvaluationDetails = async ({ teamAdminId, preferredPosition }) => {
  const settings = await RecruitmentSettings.findOne({ teamAdmin: teamAdminId });
  if (!settings) {
    return {
      position: preferredPosition || "None",
      evaluationFormId: null,
      evaluationFormName: "",
      evaluationFormSnapshot: null,
    };
  }

  const positionRecord = preferredPosition
    ? (settings.jobPositions || []).find(
        (item) => trimString(item?.jobPosition).toLowerCase() === trimString(preferredPosition).toLowerCase()
      )
    : settings.jobPositions?.[0];

  const position = trimString(positionRecord?.jobPosition) || preferredPosition || "None";

  const evaluationForms = Array.isArray(settings.evaluationForms) ? settings.evaluationForms : [];
  const matchingForm = positionRecord
    ? evaluationForms.find((form) => String(form?.jobPositionId || "") === String(positionRecord._id))
    : evaluationForms[0];

  if (!matchingForm) {
    return {
      position,
      evaluationFormId: null,
      evaluationFormName: "",
      evaluationFormSnapshot: null,
    };
  }

  const snapshot = serializeEvaluationForm(settings, matchingForm._id);

  return {
    position,
    evaluationFormId: snapshot?._id || null,
    evaluationFormName: snapshot?.formName || "",
    evaluationFormSnapshot: snapshot || null,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error("MONGO_URI is not configured.");
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
  });

  const ownerAdmin = await pickOwnerAdmin(args.adminEmail);
  if (!ownerAdmin) {
    throw new Error("No admin user was found. Seed an admin account first.");
  }

  const teamAdminId = getTeamAdminId(ownerAdmin);
  const interviewer = ownerAdmin;
  const candidate = await ensureCandidate(ownerAdmin._id);
  const campaignId = await pickCampaignId({
    useCampaign: Boolean(args.useCampaign),
    teamAdminId,
    ownerAdminId: ownerAdmin._id,
  });
  const evaluationDetails = await pickEvaluationDetails({
    teamAdminId,
    preferredPosition: args.position,
  });

  const schedule = await InterviewSchedule.create({
    teamAdmin: teamAdminId,
    ownerAdmin: ownerAdmin._id,
    campaign: campaignId,
    scheduleName: trimString(args.name) || buildScheduleName(),
    position: evaluationDetails.position,
    interviewDate: new Date(args.date || buildDefaultDate()),
    fromHour: trimString(args.from) || "10:00",
    toHour: trimString(args.to) || "11:00",
    interviewer: interviewer._id,
    evaluationFormId: evaluationDetails.evaluationFormId,
    evaluationFormName: evaluationDetails.evaluationFormName,
    evaluationFormSnapshot: evaluationDetails.evaluationFormSnapshot,
    candidates: [
      {
        candidateId: candidate.candidateId,
        candidateType: candidate.candidateType,
        name: candidate.name,
        email: candidate.email,
        phone: candidate.phone,
        agentId: candidate.agentId,
      },
    ],
    status: "Scheduled",
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        scheduleId: String(schedule._id),
        scheduleName: schedule.scheduleName,
        ownerAdmin: {
          id: String(ownerAdmin._id),
          email: ownerAdmin.email,
          role: ownerAdmin.role,
        },
        interviewer: {
          id: String(interviewer._id),
          email: interviewer.email,
        },
        candidate: {
          id: candidate.candidateId,
          name: candidate.name,
          created: candidate.created,
        },
        campaignLinked: Boolean(campaignId),
        evaluationFormLinked: Boolean(evaluationDetails.evaluationFormId),
        interviewDate: schedule.interviewDate,
        fromHour: schedule.fromHour,
        toHour: schedule.toHour,
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error("Failed to seed interview schedule:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

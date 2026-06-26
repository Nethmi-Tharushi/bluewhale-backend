const AdminUser = require("../models/AdminUser");
const Meeting = require("../models/Meeting");
const User = require("../models/User");
const { buildUtcDateFromZonedDateTime, getSystemPreferencePayload } = require("./systemPreferenceService");

const getMainAdminId = async () => {
  const mainAdmin = await AdminUser.findOne({ role: "MainAdmin" }).select("_id");
  if (!mainAdmin) {
    throw new Error("Main Admin not found");
  }
  return mainAdmin._id;
};

const combineMeetingDateTime = async (meetingDate, meetingTime) => {
  if (!meetingDate || !meetingTime) {
    return null;
  }

  const { timezone } = await getSystemPreferencePayload();
  return buildUtcDateFromZonedDateTime({
    date: meetingDate,
    time: meetingTime,
    timeZone: timezone,
  });
};

const resolveTaskMeetingCandidate = async ({ candidateType, candidate, managedCandidateId, agent }) => {
  if (candidateType === "B2C") {
    const candidateUser = await User.findById(candidate).select("_id userType name assignedTo");
    if (!candidateUser || candidateUser.userType !== "candidate") {
      throw new Error("Candidate not found");
    }

    return {
      meetingCandidateId: candidateUser._id,
      candidateType: "B2C",
      managedCandidateId: null,
      resolvedSalesAdminId: candidateUser.assignedTo || null,
    };
  }

  const agentQuery = agent
    ? { _id: agent, userType: "agent", "managedCandidates._id": managedCandidateId }
    : { userType: "agent", "managedCandidates._id": managedCandidateId };

  const agentUser = await User.findOne(agentQuery).select("_id managedCandidates");
  if (!agentUser) {
    throw new Error("Managed candidate not found");
  }

  const managedCandidate = agentUser.managedCandidates.id(managedCandidateId);
  if (!managedCandidate) {
    throw new Error("Managed candidate not found");
  }

  return {
    meetingCandidateId: managedCandidate._id,
    candidateType: "B2B",
    managedCandidateId: managedCandidate._id,
    resolvedSalesAdminId: managedCandidate.assignedTo || null,
  };
};

const createMeetingForTask = async ({
  admin,
  title,
  candidateType,
  candidate,
  managedCandidateId,
  agent,
  meetingDate,
  meetingTime,
  locationType,
  link,
  location,
  notes,
}) => {
  const combinedDate = await combineMeetingDateTime(meetingDate, meetingTime);
  if (!combinedDate) {
    throw new Error("Valid meeting date and time are required");
  }

  const candidateContext = await resolveTaskMeetingCandidate({
    candidateType,
    candidate,
    managedCandidateId,
    agent,
  });

  let salesAdminId = null;
  let mainAdminId = null;

  if (admin.role === "MainAdmin") {
    mainAdminId = admin._id;
    salesAdminId = candidateContext.resolvedSalesAdminId || admin._id;
  } else if (admin.role === "SalesAdmin" || admin.role === "SalesStaff") {
    salesAdminId = admin._id;
    mainAdminId = await getMainAdminId();
  } else {
    throw new Error("Invalid admin role for meeting task");
  }

  const meeting = await Meeting.create({
    candidate: candidateContext.meetingCandidateId,
    salesAdmin: salesAdminId,
    mainAdmin: mainAdminId,
    title,
    date: combinedDate,
    locationType,
    link: link || "",
    location: location || "",
    notes: notes || "",
    candidateType: candidateContext.candidateType,
    managedCandidateId:
      candidateContext.candidateType === "B2B"
        ? String(candidateContext.managedCandidateId)
        : undefined,
  });

  return meeting;
};

const updateMeetingForTask = async ({
  meetingId,
  title,
  notes,
  status,
  meetingDate,
  meetingTime,
  locationType,
  link,
  location,
}) => {
  const meeting = await Meeting.findById(meetingId);
  if (!meeting) {
    throw new Error("Linked meeting not found");
  }

  const existingDate = new Date(meeting.date);
  const nextDate = meetingDate || existingDate.toISOString().split("T")[0];
  const nextTime =
    meetingTime ||
    `${String(existingDate.getHours()).padStart(2, "0")}:${String(existingDate.getMinutes()).padStart(2, "0")}`;

  const combinedDate = await combineMeetingDateTime(nextDate, nextTime);
  if (!combinedDate) {
    throw new Error("Valid meeting date and time are required");
  }

  meeting.title = title;
  meeting.notes = notes || "";
  meeting.date = combinedDate;

  if (status && ["Scheduled", "Completed", "Canceled"].includes(status)) {
    meeting.status = status;
  }

  if (locationType) {
    meeting.locationType = locationType;
  }

  if (typeof link === "string") {
    meeting.link = link;
  }

  if (typeof location === "string") {
    meeting.location = location;
  }

  await meeting.save();
  return meeting;
};

module.exports = {
  createMeetingForTask,
  updateMeetingForTask,
};


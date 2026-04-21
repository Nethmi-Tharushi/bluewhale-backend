const User = require("../models/User");

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDateParts(dateValue) {
  if (!dateValue) {
    return { scheduledAt: null, date: null, time: null };
  }

  const dateObj = new Date(dateValue);
  if (Number.isNaN(dateObj.getTime())) {
    return { scheduledAt: null, date: null, time: null };
  }

  const hours = dateObj.getHours();
  const minutes = pad(dateObj.getMinutes());
  const displayHour = hours % 12 || 12;
  const meridiem = hours >= 12 ? "PM" : "AM";

  return {
    scheduledAt: dateObj.toISOString(),
    date: `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`,
    time: `${pad(displayHour)}:${minutes} ${meridiem}`,
  };
}

function normalizeCandidate(candidate, fallbackName) {
  if (!candidate && !fallbackName) {
    return null;
  }

  return {
    _id: candidate?._id || null,
    name: candidate?.name || fallbackName || "Candidate",
    email: candidate?.email || null,
    phone: candidate?.phone || null,
    userType: candidate?.userType || null,
  };
}

async function resolveManagedCandidate(managedCandidateId) {
  if (!managedCandidateId) {
    return null;
  }

  const agent = await User.findOne({
    userType: "agent",
    "managedCandidates._id": managedCandidateId,
  }).select("name email managedCandidates");

  if (!agent) {
    return null;
  }

  const managedCandidate = agent.managedCandidates.id(managedCandidateId);
  if (!managedCandidate) {
    return null;
  }

  return {
    agent,
    candidate: {
      _id: managedCandidate._id,
      name: managedCandidate.name,
      email: managedCandidate.email,
      phone: managedCandidate.phone,
      userType: "managedCandidate",
    },
  };
}

async function resolveMeetingCandidate(meeting, options = {}) {
  if (options.managedCandidateData) {
    return {
      candidate: normalizeCandidate(options.managedCandidateData),
      agent: null,
    };
  }

  const candidateRef = meeting?.candidate;
  const populatedCandidate =
    candidateRef && typeof candidateRef === "object" && candidateRef.name
      ? candidateRef
      : null;

  if (meeting?.candidateType === "B2B" || meeting?.managedCandidateId) {
    const managedCandidateId = meeting.managedCandidateId || candidateRef?._id || candidateRef;

    if (meeting.managedCandidateId && candidateRef && typeof candidateRef !== "string" && candidateRef._id) {
      const agent = await User.findOne({
        _id: candidateRef._id,
        userType: "agent",
        "managedCandidates._id": meeting.managedCandidateId,
      }).select("name email managedCandidates");

      if (agent) {
        const managedCandidate = agent.managedCandidates.id(meeting.managedCandidateId);
        if (managedCandidate) {
          return {
            agent,
            candidate: {
              _id: managedCandidate._id,
              name: managedCandidate.name,
              email: managedCandidate.email,
              phone: managedCandidate.phone,
              userType: "managedCandidate",
            },
          };
        }
      }
    }

    const managedCandidate = await resolveManagedCandidate(managedCandidateId);
    if (managedCandidate) {
      return managedCandidate;
    }
  }

  if (populatedCandidate) {
    return { candidate: normalizeCandidate(populatedCandidate), agent: null };
  }

  if (candidateRef) {
    const candidateId = candidateRef._id || candidateRef;
    const candidate = await User.findById(candidateId).select("name email phone userType");
    if (candidate) {
      return { candidate: normalizeCandidate(candidate), agent: null };
    }
  }

  return { candidate: null, agent: null };
}

function buildParticipants({ candidate, salesAdmin, mainAdmin, clientName }) {
  const participants = [candidate?.name || clientName || "Candidate"];

  if (salesAdmin?.name) {
    participants.push(`${salesAdmin.name} (Sales Admin)`);
  }

  if (mainAdmin?.name) {
    participants.push(`${mainAdmin.name} (Main Admin)`);
  }

  return participants;
}

async function formatMeetingResponse(meeting, options = {}) {
  const rawMeeting = meeting?.toObject ? meeting.toObject() : meeting;
  const { candidate, agent } = await resolveMeetingCandidate(rawMeeting, options);
  const normalizedCandidate = normalizeCandidate(candidate, rawMeeting?.clientName);
  const dateParts = formatDateParts(rawMeeting?.date);

  // Build CRM context
  const crmContext = {};
  if (rawMeeting?.linkedLeadId || rawMeeting?.conversationId) {
    if (rawMeeting.linkedLeadId) {
      crmContext.linkedLeadId = String(rawMeeting.linkedLeadId._id || rawMeeting.linkedLeadId);
    }
    if (rawMeeting.conversationId) {
      crmContext.conversationId = String(rawMeeting.conversationId._id || rawMeeting.conversationId);
    }
  }

  return {
    _id: rawMeeting._id,
    title: rawMeeting.title,
    status: rawMeeting.status,
    locationType: rawMeeting.locationType || null,
    link: rawMeeting.link || null,
    location: rawMeeting.location || null,
    date: dateParts.date,
    time: dateParts.time,
    scheduledAt: dateParts.scheduledAt,
    // Alternative date/time fields for API compatibility
    dateTime: dateParts.scheduledAt,
    meetingDate: rawMeeting.meetingDate || rawMeeting.date,
    meetingTime: rawMeeting.meetingTime || dateParts.time,
    notes: rawMeeting.notes || "",
    clientName: rawMeeting.clientName || normalizedCandidate?.name || null,
    customerName: rawMeeting.customerName || rawMeeting.clientName || normalizedCandidate?.name || null,
    candidateType: rawMeeting.candidateType || "B2C",
    managedCandidateId: rawMeeting.managedCandidateId || null,
    candidate: normalizedCandidate,
    // Contact information
    email: rawMeeting.email || normalizedCandidate?.email || "",
    phone: rawMeeting.phone || normalizedCandidate?.phone || "",
    customerEmail: rawMeeting.customerEmail || rawMeeting.email || normalizedCandidate?.email || "",
    customerPhone: rawMeeting.customerPhone || rawMeeting.phone || normalizedCandidate?.phone || "",
    // Assignment information
    assignee: rawMeeting.assignee || rawMeeting.assignedPerson || "",
    assignedPerson: rawMeeting.assignedPerson || rawMeeting.assignee || "",
    assignedTo: rawMeeting.salesAdmin
      ? {
          _id: rawMeeting.salesAdmin._id,
          name: rawMeeting.salesAdmin.name,
          email: rawMeeting.salesAdmin.email || null,
        }
      : null,
    participants: buildParticipants({
      candidate: normalizedCandidate,
      salesAdmin: rawMeeting.salesAdmin,
      mainAdmin: rawMeeting.mainAdmin,
      clientName: rawMeeting.clientName,
    }),
    salesAdmin: rawMeeting.salesAdmin
      ? {
          _id: rawMeeting.salesAdmin._id,
          name: rawMeeting.salesAdmin.name,
          email: rawMeeting.salesAdmin.email || null,
        }
      : null,
    mainAdmin: rawMeeting.mainAdmin
      ? {
          _id: rawMeeting.mainAdmin._id,
          name: rawMeeting.mainAdmin.name,
          email: rawMeeting.mainAdmin.email || null,
        }
      : null,
    agent: agent
      ? {
          _id: agent._id,
          name: agent.name,
          email: agent.email || null,
        }
      : null,
    // CRM linking fields
    linkedLeadId: rawMeeting.linkedLeadId ? String(rawMeeting.linkedLeadId._id || rawMeeting.linkedLeadId) : null,
    conversationId: rawMeeting.conversationId ? String(rawMeeting.conversationId._id || rawMeeting.conversationId) : null,
    crmContext: Object.keys(crmContext).length > 0 ? crmContext : null,
    createdAt: rawMeeting.createdAt || null,
    updatedAt: rawMeeting.updatedAt || null,
  };
}

async function formatMeetingsResponse(meetings, options = {}) {
  return Promise.all(meetings.map((meeting) => formatMeetingResponse(meeting, options)));
}

module.exports = {
  formatMeetingResponse,
  formatMeetingsResponse,
};

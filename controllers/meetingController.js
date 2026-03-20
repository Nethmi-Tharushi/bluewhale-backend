const Meeting = require('../models/Meeting');
const User = require('../models/User');
const AdminUser = require('../models/AdminUser');
const mongoose = require('mongoose');
const { formatMeetingResponse, formatMeetingsResponse } = require('../services/meetingFormatter');

const populateMeetingAdmins = (query) =>
  query
    .populate('salesAdmin', 'name email')
    .populate('mainAdmin', 'name email');

const buildManagedCandidateMeetingFilter = (candidateId) => ({
  $or: [{ candidate: candidateId }, { managedCandidateId: candidateId }]
});

const resolveAdminIds = async (admin, requestedSalesAdminId = null) => {
  let mainAdminId = null;
  let salesAdminId = null;

  if (admin?.role === "MainAdmin") {
    mainAdminId = admin._id;
    salesAdminId = requestedSalesAdminId || admin._id;
  } else if (admin?.role === "SalesAdmin" || admin?.role === "SalesStaff") {
    salesAdminId = admin._id;
    const mainAdmin = await AdminUser.findOne({ role: "MainAdmin" }).select("_id");
    if (!mainAdmin) {
      throw new Error("Main admin not found");
    }
    mainAdminId = mainAdmin._id;
  } else {
    throw new Error("Access denied");
  }

  return { mainAdminId, salesAdminId };
};

const resolveMeetingCreatePayload = async (body, admin) => {
  const {
    candidateId,
    dateTime,
    scheduledAt,
    date,
    title,
    clientName,
    notes,
    link,
    location,
    locationType,
    salesAdminId: requestedSalesAdminId,
    status,
  } = body;

  const meetingTitle = String(title || "").trim();
  const rawDate = dateTime || scheduledAt || date;

  if (!meetingTitle || !rawDate) {
    return { error: { code: 400, message: "title and dateTime are required" } };
  }

  const parsedDate = new Date(rawDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return { error: { code: 400, message: "Invalid dateTime value" } };
  }

  let adminIds;
  try {
    adminIds = await resolveAdminIds(admin, requestedSalesAdminId);
  } catch (error) {
    return { error: { code: error.message === "Main admin not found" ? 500 : 403, message: error.message } };
  }

  let resolvedCandidateId = null;
  let resolvedManagedCandidateId = null;
  let candidateType = "B2C";
  let resolvedClientName = String(clientName || "").trim() || null;

  if (candidateId) {
    const directCandidate = await User.findById(candidateId).select("_id name userType");
    if (directCandidate && directCandidate.userType === "candidate") {
      resolvedCandidateId = directCandidate._id;
      resolvedClientName = resolvedClientName || directCandidate.name;
    } else {
      const agentWithCandidate = await User.findOne({
        userType: "agent",
        "managedCandidates._id": candidateId,
      }).select("managedCandidates");

      if (agentWithCandidate) {
        const managedCandidate = agentWithCandidate.managedCandidates.id(candidateId);
        candidateType = "B2B";
        resolvedCandidateId = managedCandidate._id;
        resolvedManagedCandidateId = managedCandidate._id.toString();
        resolvedClientName = resolvedClientName || managedCandidate.name || null;
      } else {
        return { error: { code: 404, message: "Candidate not found" } };
      }
    }
  } else if (resolvedClientName) {
    const escaped = resolvedClientName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matchedCandidate = await User.findOne({
      $or: [
        { email: resolvedClientName.toLowerCase() },
        { name: { $regex: escaped, $options: "i" } },
      ],
    }).select("_id name");

    if (matchedCandidate) {
      resolvedCandidateId = matchedCandidate._id;
      resolvedClientName = matchedCandidate.name || resolvedClientName;
    } else {
      resolvedCandidateId = new mongoose.Types.ObjectId();
    }
  } else {
    resolvedCandidateId = new mongoose.Types.ObjectId();
  }

  return {
    meetingData: {
      candidate: resolvedCandidateId,
      salesAdmin: adminIds.salesAdminId,
      mainAdmin: adminIds.mainAdminId,
      title: meetingTitle,
      date: parsedDate,
      locationType: locationType || "Phone",
      link: link || "",
      location: location || "",
      notes: notes || "",
      clientName: resolvedClientName || undefined,
      candidateType,
      managedCandidateId: resolvedManagedCandidateId,
      status,
    },
  };
};

const getCandidateMeetings = async (req, res) => {
  try {
    let candidateId = req.user._id;
    let managedCandidateData = null;
    
    // If managedCandidateId is provided, use that instead of logged-in user
    if (req.query.managedCandidateId) {
      // Verify the agent owns this managed candidate
      const agent = await User.findById(req.user._id);
      
      // Find the managed candidate in the agent's managedCandidates array
      managedCandidateData = agent.managedCandidates.find(
        candidate => candidate._id.toString() === req.query.managedCandidateId
      );
      
      if (!managedCandidateData) {
        return res.status(404).json({ message: "Managed candidate not found" });
      }
      
      // Use managed candidate's ID for meeting lookup
      candidateId = req.query.managedCandidateId;
    }

    const filter = managedCandidateData
      ? buildManagedCandidateMeetingFilter(candidateId)
      : { candidate: candidateId };

    const meetings = await populateMeetingAdmins(
      Meeting.find(filter).populate('candidate', 'name email phone userType')
    )
      .sort({ createdAt: -1 })
      .lean();

    const formattedMeetings = await formatMeetingsResponse(meetings, {
      managedCandidateData,
    });

    res.json({ meetings: formattedMeetings });
  } catch (err) {
    console.error("Error in getCandidateMeetings:", err);
    res.status(500).json({ message: err.message });
  }
};

const getCandidateMeetingById = async (req, res) => {
  try {
    let filter = { _id: req.params.id, candidate: req.user._id };
    let managedCandidateData = null;

    if (req.query.managedCandidateId) {
      const agent = await User.findById(req.user._id).select('managedCandidates');
      managedCandidateData = agent?.managedCandidates?.id(req.query.managedCandidateId) || null;

      if (!managedCandidateData) {
        return res.status(404).json({ message: "Managed candidate not found" });
      }

      filter = {
        _id: req.params.id,
        ...buildManagedCandidateMeetingFilter(req.query.managedCandidateId),
      };
    }

    const meeting = await populateMeetingAdmins(
      Meeting.findOne(filter).populate('candidate', 'name email phone userType')
    ).lean();

    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found" });
    }

    const formattedMeeting = await formatMeetingResponse(meeting, {
      managedCandidateData,
    });

    res.json({ meeting: formattedMeeting });
  } catch (err) {
    console.error("Error in getCandidateMeetingById:", err);
    res.status(500).json({ message: err.message });
  }
};

const createAdminMeeting = async (req, res) => {
  try {
    const result = await resolveMeetingCreatePayload(req.body, req.admin);
    if (result.error) {
      return res.status(result.error.code).json({ message: result.error.message });
    }

    const meeting = await Meeting.create(result.meetingData);
    const populatedMeeting = await populateMeetingAdmins(
      Meeting.findById(meeting._id).populate('candidate', 'name email phone userType')
    );
    const formattedMeeting = await formatMeetingResponse(populatedMeeting);

    return res.status(201).json({
      message: "Meeting scheduled successfully",
      meeting: formattedMeeting,
    });
  } catch (err) {
    console.error("Error in createAdminMeeting:", err);
    return res.status(500).json({ message: err.message || "Failed to schedule meeting" });
  }
};

const getAdminMeetings = async (req, res) => {
  try {
    const filter = {};

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.candidateType) {
      filter.candidateType = req.query.candidateType;
    }

    if (req.query.salesAdminId) {
      filter.salesAdmin = req.query.salesAdminId;
    }

    if (req.query.managedCandidateId) {
      Object.assign(filter, buildManagedCandidateMeetingFilter(req.query.managedCandidateId));
    } else if (req.query.candidateId) {
      filter.candidate = req.query.candidateId;
    }

    const meetings = await populateMeetingAdmins(
      Meeting.find(filter).populate('candidate', 'name email phone userType')
    )
      .sort({ createdAt: -1 })
      .lean();

    const formattedMeetings = await formatMeetingsResponse(meetings);

    res.json({ meetings: formattedMeetings });
  } catch (err) {
    console.error("Error in getAdminMeetings:", err);
    res.status(500).json({ message: err.message });
  }
};

const getAdminMeetingById = async (req, res) => {
  try {
    const meeting = await populateMeetingAdmins(
      Meeting.findById(req.params.id).populate('candidate', 'name email phone userType')
    ).lean();

    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found" });
    }

    const formattedMeeting = await formatMeetingResponse(meeting);
    res.json({ meeting: formattedMeeting });
  } catch (err) {
    console.error("Error in getAdminMeetingById:", err);
    res.status(500).json({ message: err.message });
  }
};

const updateAdminMeeting = async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.candidate;
    delete updates.salesAdmin;
    delete updates.mainAdmin;
    delete updates.managedCandidateId;
    delete updates.candidateType;

    if (updates.dateTime || updates.scheduledAt) {
      updates.date = updates.dateTime || updates.scheduledAt;
    }

    if (updates.date) {
      const parsedDate = new Date(updates.date);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: "Invalid dateTime value" });
      }
      updates.date = parsedDate;
    }

    delete updates.dateTime;
    delete updates.scheduledAt;

    const meeting = await populateMeetingAdmins(
      Meeting.findByIdAndUpdate(req.params.id, updates, { new: true })
        .populate('candidate', 'name email phone userType')
    );

    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found" });
    }

    const formattedMeeting = await formatMeetingResponse(meeting);
    res.json({ meeting: formattedMeeting });
  } catch (err) {
    console.error("Error in updateAdminMeeting:", err);
    res.status(500).json({ message: err.message });
  }
};



module.exports = {
  getCandidateMeetings,
  getCandidateMeetingById,
  createAdminMeeting,
  getAdminMeetings,
  getAdminMeetingById,
  updateAdminMeeting,
};

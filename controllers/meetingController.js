const Meeting = require('../models/Meeting');
const User = require('../models/User');
const AdminUser = require('../models/AdminUser');
const mongoose = require('mongoose');

const getCandidateMeetings = async (req, res) => {
  try {
    let candidateId = req.user._id;
    let isManagedView = false;
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
      isManagedView = true;
    }

    let meetings = [];
    
    if (isManagedView) {
      // For B2B managed candidates, look up meetings by candidate ID
      meetings = await Meeting.find({ candidate: candidateId })
        .populate('salesAdmin', 'name email')
        .populate('mainAdmin', 'name email')
        .sort({ createdAt: -1 })
        .lean();
    } else {
      // For regular B2C candidates 
      meetings = await Meeting.find({ candidate: candidateId })
        .populate('candidate', 'name email phone')
        .sort({ createdAt: -1 })
        .lean();
    }

    const formattedMeetings = meetings.map(m => {
      const dateObj = new Date(m.date);
      
      let candidateName = 'Candidate';
      let candidateEmail = 'N/A';
      
      if (isManagedView) {
        candidateName = managedCandidateData.name;
        candidateEmail = managedCandidateData.email;
      } else if (m.candidate) {
        candidateName = m.candidate.name;
        candidateEmail = m.candidate.email;
      }

      // For managed view, include participant names
      let participants = [];
      if (isManagedView) {
        participants = [
          candidateName,
          m.salesAdmin ? `${m.salesAdmin.name} (Sales Admin)` : 'Sales Admin',
          m.mainAdmin ? `${m.mainAdmin.name} (Main Admin)` : 'Main Admin'
        ];
      } else {
        participants = [candidateName];
      }

      return {
        _id: m._id,
        title: m.title,
        status: m.status,
        locationType: m.locationType,
        link: m.link || null,
        location: m.location || null,
        date: dateObj.toLocaleDateString(),
        time: dateObj.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit"
        }),
        candidate: {
          name: candidateName,
          email: candidateEmail
        },
        ...(isManagedView && { participants })
      };
    });

    res.json({ meetings: formattedMeetings });
  } catch (err) {
    console.error("Error in getCandidateMeetings:", err);
    res.status(500).json({ message: err.message });
  }
};

const createAdminMeeting = async (req, res) => {
  try {
    const { title, dateTime, date, clientName, notes } = req.body;

    const meetingTitle = String(title || "").trim();
    const rawDate = dateTime || date;

    if (!meetingTitle || !rawDate) {
      return res.status(400).json({ message: "title and dateTime are required" });
    }

    const parsedDate = new Date(rawDate);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: "Invalid dateTime value" });
    }

    let mainAdminId = null;
    let salesAdminId = null;

    if (req.admin?.role === "MainAdmin") {
      mainAdminId = req.admin._id;
      salesAdminId = req.admin._id;
    } else if (req.admin?.role === "SalesAdmin") {
      salesAdminId = req.admin._id;
      const mainAdmin = await AdminUser.findOne({ role: "MainAdmin" }).select("_id");
      if (!mainAdmin) {
        return res.status(500).json({ message: "Main admin not found" });
      }
      mainAdminId = mainAdmin._id;
    } else {
      return res.status(403).json({ message: "Access denied" });
    }

    // Try to bind to a real candidate if clientName matches by email/name; otherwise keep ad-hoc meeting.
    let candidateId = null;
    const searchTerm = String(clientName || "").trim();
    if (searchTerm) {
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matchedCandidate = await User.findOne({
        $or: [{ email: searchTerm.toLowerCase() }, { name: { $regex: escaped, $options: "i" } }],
      }).select("_id");
      candidateId = matchedCandidate?._id || null;
    }

    const meeting = await Meeting.create({
      candidate: candidateId || new mongoose.Types.ObjectId(),
      salesAdmin: salesAdminId,
      mainAdmin: mainAdminId,
      title: meetingTitle,
      date: parsedDate,
      locationType: "Phone",
      notes: notes || "",
      clientName: searchTerm || undefined,
      candidateType: "B2C",
    });

    return res.status(201).json({
      message: "Meeting scheduled successfully",
      meeting,
    });
  } catch (err) {
    console.error("Error in createAdminMeeting:", err);
    return res.status(500).json({ message: err.message || "Failed to schedule meeting" });
  }
};



module.exports = { getCandidateMeetings, createAdminMeeting };

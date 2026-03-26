const asyncHandler = require("express-async-handler");
const User = require("../models/User");
const Application = require("../models/Application");
const Document = require("../models/Document");
const Job = require("../models/Job");
const Lead = require("../models/Lead");
const Meeting = require("../models/Meeting");
const AdminUser = require("../models/AdminUser");
const JobInquiry = require('../models/Inquiries');
const Task = require('../models/Task');
const WhatsAppConversation = require("../models/WhatsAppConversation");
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { generateOnboardingTasksForApplication } = require("../services/recruitmentWorkflowService");
const { createMeetingForTask, updateMeetingForTask } = require("../services/taskMeetingService");
const { formatMeetingResponse, formatMeetingsResponse } = require("../services/meetingFormatter");
const {
  listAccessibleSalesCandidates,
  resolveAccessibleSalesCandidate,
} = require("../services/salesCandidateAccessService");
const {
  buildAccessibleSalesTaskAccess,
} = require("../services/salesTaskAccessService");

const parseTaskCrmContext = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
};

const buildTaskCrmContext = (task) => {
  const base = task?.toObject ? task.toObject() : task;
  const conversationId = base?.conversationId ? String(base.conversationId._id || base.conversationId) : "";
  const linkedLeadId = base?.linkedLeadId ? String(base.linkedLeadId._id || base.linkedLeadId) : "";

  if (!conversationId && !linkedLeadId) {
    return null;
  }

  return {
    source: "whatsapp",
    conversationId: conversationId || null,
    linkedLeadId: linkedLeadId || null,
  };
};

const withTaskCrmContext = (task) => {
  const base = task?.toObject ? task.toObject() : task;
  const crmContext = buildTaskCrmContext(base);

  return {
    ...base,
    conversationId: crmContext?.conversationId || null,
    linkedLeadId: crmContext?.linkedLeadId || null,
    crmContext,
  };
};

const resolveTaskLinkingPayload = async (body = {}) => {
  const crmContext = parseTaskCrmContext(body.crmContext);
  const conversationId = String(body.conversationId || crmContext.conversationId || "").trim();
  const linkedLeadId = String(body.linkedLeadId || crmContext.linkedLeadId || "").trim();

  if (conversationId && !mongoose.Types.ObjectId.isValid(conversationId)) {
    return {
      error: {
        code: 400,
        message: "Invalid conversationId",
      },
    };
  }

  if (linkedLeadId && !mongoose.Types.ObjectId.isValid(linkedLeadId)) {
    return {
      error: {
        code: 400,
        message: "Invalid linkedLeadId",
      },
    };
  }

  if (conversationId) {
    const conversation = await WhatsAppConversation.findById(conversationId).select("_id");
    if (!conversation) {
      return {
        error: {
          code: 404,
          message: "WhatsApp conversation not found",
        },
      };
    }
  }

  if (linkedLeadId) {
    const lead = await Lead.findById(linkedLeadId).select("_id");
    if (!lead) {
      return {
        error: {
          code: 404,
          message: "Linked lead not found",
        },
      };
    }
  }

  return {
    conversationId: conversationId || null,
    linkedLeadId: linkedLeadId || null,
  };
};

const getAllCandidates = asyncHandler(async (req, res) => {
  try {
    const unifiedCandidates = await listAccessibleSalesCandidates(req.admin);

    res.status(200).json({
      success: true,
      count: unifiedCandidates.length,
      data: unifiedCandidates
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Error fetching candidates',
      error: error.message
    });
  }
});


const getCandidateDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    // b2c
    let candidate = await User.findById(id).lean();

    let agentInfo = null;
    let isB2B = false;
    let managedCandidate = null;


    if (!candidate) {
      const agent = await User.findOne({ "managedCandidates._id": id }).lean();
      if (agent) {
        isB2B = true;
        managedCandidate = agent.managedCandidates.find(c => c._id.toString() === id);
        candidate = managedCandidate;
        candidate.agent = {
          _id: agent._id,
          name: agent.name,
          email: agent.email,
          companyName: agent.companyName
        };
      }
    }

    // If still no candidate found
    if (!candidate) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }
    const documentsFromDb = await Document.find({ user: candidate._id }).sort({ uploadedAt: -1 });

    // Group by type
    const groupedDocuments = {
      CV: [],
      Passport: [],
      DrivingLicense: [],
      Picture: []
    };

    documentsFromDb.forEach(doc => {
      switch (doc.type) {
        case 'cv':
        case 'CV':
          groupedDocuments.CV.push({ fileName: doc.originalName, fileUrl: doc.url });
          break;
        case 'passport':
          groupedDocuments.Passport.push({ fileName: doc.originalName, fileUrl: doc.url });
          break;
        case 'drivingLicense':
          groupedDocuments.DrivingLicense.push({ fileName: doc.originalName, fileUrl: doc.url });
          break;
        case 'photo':
        case 'picture':
          groupedDocuments.Picture.push({ fileName: doc.originalName, fileUrl: doc.url });
          break;
      }
    });


    // Applications only exist for B2C candidates
    let applications = [];
    if (!isB2B) {
      applications = await Application.find({
        $or: [
          { user: id },
          { candidateId: id }
        ]
      }).populate('job', 'title location').sort({ createdAt: -1 }).lean();
    }

    // Documents
    let documents = { CV: [], Passport: [], DrivingLicense: [], Picture: [] };

    if (isB2B) {
      // Documents from managed candidate
      (candidate.documents || []).forEach(doc => {
        switch (doc.type) {
          case 'CV': case 'cv':
            documents.CV.push({ fileName: doc.fileName, fileUrl: doc.fileUrl });
            break;
          case 'Passport': case 'passport':
            documents.Passport.push({ fileName: doc.fileName, fileUrl: doc.fileUrl });
            break;
          case 'DrivingLicense': case 'drivingLicense':
            documents.DrivingLicense.push({ fileName: doc.fileName, fileUrl: doc.fileUrl });
            break;
          case 'Picture': case 'photo':
            documents.Picture.push({ fileName: doc.fileName, fileUrl: doc.fileUrl });
            break;
        }
      });
    } else {
      // Documents B2C user (Document collection)
      const documentsFromDb = await Document.find({ user: candidate._id }).sort({ uploadedAt: -1 });
      documentsFromDb.forEach(doc => {
        switch (doc.type) {
          case 'CV': case 'cv':
            documents.CV.push({ fileName: doc.originalName, fileUrl: doc.url });
            break;
          case 'Passport': case 'passport':
            documents.Passport.push({ fileName: doc.originalName, fileUrl: doc.url });
            break;
          case 'DrivingLicense': case 'drivingLicense':
            documents.DrivingLicense.push({ fileName: doc.originalName, fileUrl: doc.url });
            break;
          case 'Picture': case 'photo':
            documents.Picture.push({ fileName: doc.originalName, fileUrl: doc.url });
            break;
        }
      });
    }

    const response = {
      _id: candidate._id,
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
      location: candidate.location,
      profession: candidate.profession,
      status: candidate.status || 'Not specified',
      visaStatus: candidate.visaStatus || 'Not Started',
      type: isB2B ? 'B2B' : 'B2C',
      agent: candidate.agent,
      dob: candidate.dateOfBirth,
      gender: candidate.gender,
      ageRange: candidate.ageRange,
      qualification: candidate.qualification,
      experience: candidate.experience,
      jobInterest: candidate.jobInterest,
      categories: candidate.categories || [],
      languages: candidate.languages || [],
      aboutMe: candidate.aboutMe || '',
      socialNetworks: candidate.socialNetworks || { linkedin: "", github: "" },
      documents,
      applications
    };

    res.status(200).json({ success: true, data: response });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Error fetching candidate details', error: error.message });
  }
});

// get assigned agents
const getAssignedAgents = asyncHandler(async (req, res) => {
  try {
    const salesAdminId = req.admin._id;

    const agents = await User.find({
      userType: 'agent',
      ...(req.admin.role === 'MainAdmin' ? {} : { assignedTo: salesAdminId }),
    }).select('name email phone companyName location managedCandidates');

    const agentsWithCounts = agents.map(agent => ({
      _id: agent._id,
      name: agent.name,
      email: agent.email,
      phone: agent.phone,
      companyName: agent.companyName,
      location: agent.location,
      managedCandidatesCount: agent.managedCandidates?.length || 0,
    }));

    res.status(200).json({
      success: true,
      count: agentsWithCounts.length,
      data: agentsWithCounts,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Error fetching agents',
      error: error.message,
    });
  }
});

// get assigned agent by id
const getAssignedAgentById = asyncHandler(async (req, res) => {
  try {
    const salesAdminId = req.admin._id;
    const { id } = req.params; // agentId

    const agent = await User.findOne({
      _id: id,
      userType: 'agent',
      ...(req.admin.role === 'MainAdmin' ? {} : { assignedTo: salesAdminId }),
    }).select('name email phone companyName location managedCandidates');

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    res.status(200).json({
      success: true,
      data: agent,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Error fetching agent details',
      error: error.message,
    });
  }
});


//applications controller
const getApplications = async (req, res) => {
  try {
    const jobs = await Job.find({}).lean();

    const jobsWithCandidates = await Promise.all(
      jobs.map(async (job) => {
        const b2cCandidates = [];

        // Get B2C applications 
        const b2cApplications = await Application.find({
          job: job._id,
          user: { $exists: true } // Only B2C applications
        }).populate('user', 'name email phone location CV aboutMe').lean();

        for (const app of b2cApplications) {
          if (!app.user) continue;
          b2cCandidates.push({
            id: app.user._id,
            name: app.user.name,
            email: app.user.email,
            phone: app.user.phone,
            location: app.user.location || '',
            appliedDate: app.appliedAt?.toISOString().split('T')[0] || '',
            status: app.status || 'Pending',
            resume: app.user.CV ? 'Submitted' : 'Not Submitted',
            notes: app.user.aboutMe || '',
            type: 'B2C'
          });
        }

        // B2B candidates 
        const b2bCandidates = [];
        const agents = await User.find({ userType: 'agent' }).lean();

        for (const agent of agents) {
          if (!agent.managedCandidates?.length) continue;

          for (const mc of agent.managedCandidates) {
            if (!mc) continue;

            // Check if this managed candidate applied to this job
            const appliedToJob = mc.appliedJobs?.some(j => j.jobId.toString() === job._id.toString());
            if (!appliedToJob) continue;

            b2bCandidates.push({
              id: mc._id,
              name: mc.name,
              email: mc.email,
              phone: mc.phone,
              location: mc.location || 'Not provided',
              appliedDate: mc.appliedJobs.find(j => j.jobId.toString() === job._id.toString())?.appliedAt?.toISOString().split('T')[0] || '',
              status: mc.appliedJobs.find(j => j.jobId.toString() === job._id.toString())?.status || 'Pending',
              resume: mc.documents?.length ? 'Submitted' : 'Not Submitted',
              notes: mc.aboutMe || '',
              type: 'B2B',
            });
          }
        }

        return {
          id: job._id,
          title: job.title,
          company: job.company,
          location: job.location,
          type: job.type,
          postedDate: job.postedAt?.toISOString().split('T')[0] || '',
          status: job.expiringAt > new Date() ? 'Active' : 'Closed',
          applications: b2cCandidates.length + b2bCandidates.length,
          candidates: [...b2cCandidates, ...b2bCandidates],
        };
      })
    );

    res.status(200).json(jobsWithCandidates);
  } catch (error) {
    console.error('Error fetching job applications:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

const updateApplicationStatus = asyncHandler(async (req, res) => {
  const { candidateId } = req.params;
  const { jobId, status } = req.body;

  if (!status || !jobId) {
    return res.status(400).json({ success: false, message: 'Status and jobId are required' });
  }

  // Try updating B2C application
  const b2cApplication = await Application.findOne({ user: candidateId, job: jobId });

  if (b2cApplication) {
    b2cApplication.status = status;
    await b2cApplication.save();

    const b2cCandidate = await User.findById(candidateId);
    if (b2cCandidate) {
      const appliedJob = (b2cCandidate.appliedJobs || []).find(
        (item) => item.jobId && item.jobId.toString() === jobId.toString()
      );
      if (appliedJob) {
        appliedJob.status = status;
      }
      await b2cCandidate.save();
    }

    let generatedTasks = [];
    if (status === 'Accepted') {
      generatedTasks = await generateOnboardingTasksForApplication({
        admin: req.admin,
        candidateType: 'B2C',
        candidateId,
        jobId,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Application status updated',
      type: 'B2C',
      generatedOnboardingTasks: generatedTasks.length,
    });
  }

  // Update B2B managed candidate
  const agent = await User.findOne({ 'managedCandidates._id': candidateId });
  if (!agent) return res.status(404).json({ success: false, message: 'Candidate not found' });

  const managedCandidate = agent.managedCandidates.id(candidateId);

  // Update the Application document for B2B candidate
  const b2bApplication = await Application.findOne({
    candidateId: candidateId,
    job: jobId,
    agent: agent._id
  });

  if (b2bApplication) {
    b2bApplication.status = status;
    await b2bApplication.save();
  }

  //  update the managed candidate's appliedJobs array
  const appliedJob = managedCandidate.appliedJobs.find(j => j.jobId.toString() === jobId);
  if (appliedJob) {
    appliedJob.status = status;
  }

  await agent.save();

  let generatedTasks = [];
  if (status === 'Accepted') {
    generatedTasks = await generateOnboardingTasksForApplication({
      admin: req.admin,
      candidateType: 'B2B',
      candidateId,
      agentId: agent._id,
      jobId,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Application status updated',
    type: 'B2B',
    updatedIn: b2bApplication ? 'Application document & candidate record' : 'Candidate record only',
    generatedOnboardingTasks: generatedTasks.length,
  });
});


//meetings endpoints
const createMeeting = async (req, res) => {
  try {
    const { candidateId, date, title, locationType, link, location, notes } = req.body;
    const allowedLocationTypes = ['Zoom', 'Google Meet', 'Microsoft Teams', 'Phone', 'Physical'];

    if (!candidateId || !title || !date || !locationType) {
      return res.status(400).json({ message: 'Candidate, title, date, and location type are required' });
    }

    if (!allowedLocationTypes.includes(locationType)) {
      return res.status(400).json({ message: 'Invalid location type' });
    }

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'Invalid meeting date' });
    }

    let candidateType = 'B2C';
    let managedCandidateId = null;
    let resolvedSalesAdminId = null;
    let managedCandidate = null;

    // Check B2C candidate first
    let candidate = await User.findById(candidateId);

    // If not B2C candidate, check if it's a B2B managed candidate
    if (!candidate || candidate.userType !== 'candidate') {
      const agentWithCandidate = await User.findOne({
        userType: 'agent',
        'managedCandidates._id': candidateId
      }).select('_id managedCandidates');

      if (agentWithCandidate) {
        // This is a B2B managed candidate
        candidateType = 'B2B';
        managedCandidateId = candidateId;
        managedCandidate = agentWithCandidate.managedCandidates.id(candidateId);
        if (!managedCandidate) {
          return res.status(404).json({ message: 'Managed candidate not found' });
        }
        resolvedSalesAdminId = managedCandidate?.assignedTo || null;
      } else {
        return res.status(404).json({ message: 'Candidate not found' });
      }
    } else {
      resolvedSalesAdminId = candidate.assignedTo || null;
    }

    let salesAdminId = null;
    let mainAdminId = null;

    if (!req.admin) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (req.admin.role === 'SalesAdmin' || req.admin.role === 'SalesStaff') {
      salesAdminId = req.admin._id;

      const mainAdmin = await AdminUser.findOne({ role: 'MainAdmin' });
      if (!mainAdmin) return res.status(500).json({ message: 'Main Admin not found' });

      mainAdminId = mainAdmin._id;
    }

    if (req.admin.role === 'MainAdmin') {
      mainAdminId = req.admin._id;
      salesAdminId = resolvedSalesAdminId || req.admin._id;
    }

    const meetingData = {
      candidate: candidateId,
      salesAdmin: salesAdminId,
      mainAdmin: mainAdminId,
      title,
      date: parsedDate,
      locationType,
      link: link || '',
      location: location || '',
      notes: notes || '',
      candidateType,
    };

    // Add managedCandidateId for B2B meetings
    if (candidateType === 'B2B') {
      meetingData.managedCandidateId = managedCandidateId;
    }

    const meeting = await Meeting.create(meetingData);

    const populatedMeeting = await Meeting.findById(meeting._id)
      .populate('candidate', 'name email phone userType')
      .populate('salesAdmin', 'name email')
      .populate('mainAdmin', 'name email');

    const formattedMeeting = await formatMeetingResponse(populatedMeeting, {
      managedCandidateData:
        candidateType === 'B2B'
          ? {
              _id: managedCandidate._id,
              name: managedCandidate.name,
              email: managedCandidate.email,
              phone: managedCandidate.phone,
              userType: 'managedCandidate',
            }
          : null,
    });

    res.status(201).json(formattedMeeting);
  } catch (error) {
    console.error("Error creating meeting:", error);
    const status = error?.name === 'ValidationError' || error?.name === 'CastError' ? 400 : (error?.statusCode || 500);
    res.status(status).json({ message: error.message || 'Failed to create meeting' });
  }
};

// get meetings
const getMeetings = async (req, res) => {
  try {
    let filter = {};

    if (req.admin.role === 'SalesAdmin' || req.admin.role === 'SalesStaff') {
      filter.salesAdmin = req.admin._id;
    }

    const meetings = await Meeting.find(filter)
      .populate('candidate', 'name email phone userType')
      .populate('salesAdmin', 'name email')
      .populate('mainAdmin', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const formattedMeetings = await formatMeetingsResponse(meetings);

    res.json({ meetings: formattedMeetings });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// Update meeting
const updateMeeting = async (req, res) => {
  try {
    const { id } = req.params;
    const { candidate, salesAdmin, mainAdmin, ...updates } = req.body;

    if (updates.dateTime || updates.scheduledAt) {
      updates.date = updates.dateTime || updates.scheduledAt;
    }

    if (updates.date) {
      const parsedDate = new Date(updates.date);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: 'Invalid dateTime value' });
      }
      updates.date = parsedDate;
    }

    delete updates.dateTime;
    delete updates.scheduledAt;

    let meeting;

    // SalesAdmin
    if (req.admin.role === 'SalesAdmin' || req.admin.role === 'SalesStaff') {
      meeting = await Meeting.findOneAndUpdate(
        { _id: id, salesAdmin: req.admin._id },
        updates,
        { new: true }
      )
        .populate('candidate', 'name email phone userType')
        .populate('salesAdmin', 'name email')
        .populate('mainAdmin', 'name email');

      if (!meeting) {
        return res.status(404).json({ message: 'Meeting not found or not yours' });
      }
    } else {
      // MainAdmin 
      meeting = await Meeting.findByIdAndUpdate(id, updates, { new: true })
        .populate('candidate', 'name email phone userType')
        .populate('salesAdmin', 'name email')
        .populate('mainAdmin', 'name email');

      if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
    }

    const formattedMeeting = await formatMeetingResponse(meeting);

    res.json(formattedMeeting);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//reports page

const getReports = async (req, res) => {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  try {
    const { timeframe = 'monthly' } = req.query;
    const salesAdminId = req.admin._id; // Get current sales admin ID

    // Get assigned B2C candidate IDs
    const b2cCandidates = await User.find({
      userType: "candidate",
      assignedTo: salesAdminId
    }).select('_id');
    const b2cCandidateIds = b2cCandidates.map(c => c._id);

    // Get B2B managed candidates assigned to this sales admin
    const agentsWithManagedCandidates = await User.find({
      userType: "agent",
      'managedCandidates.assignedTo': salesAdminId
    }).select('_id managedCandidates');

    const managedCandidateIds = [];
    agentsWithManagedCandidates.forEach(agent => {
      agent.managedCandidates.forEach(mc => {
        if (mc.assignedTo && mc.assignedTo.toString() === salesAdminId.toString()) {
          managedCandidateIds.push(mc._id.toString());
        }
      });
    });

    // Applications Status Data 
    const statusAgg = await Application.aggregate([
      {
        $match: {
          $or: [
            // B2C applications
            { user: { $in: b2cCandidateIds } },
            // B2B applications: agent-submitted with candidateId
            {
              agent: { $exists: true, $ne: null },
              candidateId: { $in: managedCandidateIds }
            }
          ]
        }
      },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    const statusData = statusAgg.map(s => ({
      name: s._id,
      value: s.count
    }));

    // Visa Stage Data 
    const visaAgg = await User.aggregate([
      {
        $match: {
          userType: "candidate",
          _id: { $in: b2cCandidateIds }
        }
      },
      { $group: { _id: "$visaStatus", count: { $sum: 1 } } }
    ]);

    const b2bVisaAgg = await User.aggregate([
      {
        $match: {
          userType: "agent",
          'managedCandidates._id': { $in: managedCandidateIds.map(id => new mongoose.Types.ObjectId(id)) }
        }
      },
      { $unwind: "$managedCandidates" },
      { $match: { 'managedCandidates._id': { $in: managedCandidateIds.map(id => new mongoose.Types.ObjectId(id)) } } },
      { $group: { _id: "$managedCandidates.visaStatus", count: { $sum: 1 } } }
    ]);

    // B2C + B2B counts
    const visaStageMap = {};
    visaAgg.forEach(v => { visaStageMap[v._id] = v.count; });
    b2bVisaAgg.forEach(v => {
      visaStageMap[v._id] = (visaStageMap[v._id] || 0) + v.count;
    });

    const visaStageData = Object.entries(visaStageMap).map(([name, value]) => ({ name, value }));

    // Candidate Distribution (B2B vs B2C) 
    const b2cCount = b2cCandidateIds.length;
    const b2bCount = managedCandidateIds.length;
    const candidateDistributionData = [
      { name: "B2C", value: b2cCount },
      { name: "B2B", value: b2bCount }
    ];

    // Applications Trend 
    let trendGroupId;
    if (timeframe === "weekly") {
      trendGroupId = {
        year: { $year: "$appliedAt" },
        week: { $week: "$appliedAt" }
      };
    } else if (timeframe === "monthly") {
      trendGroupId = {
        year: { $year: "$appliedAt" },
        month: { $month: "$appliedAt" }
      };
    } else { // yearly
      trendGroupId = {
        year: { $year: "$appliedAt" }
      };
    }

    const trendAgg = await Application.aggregate([
      {
        $match: {
          appliedAt: { $exists: true },
          $or: [
            { user: { $in: b2cCandidateIds } },
            {
              agent: { $exists: true, $ne: null },
              candidateId: { $in: managedCandidateIds }
            }
          ]
        }
      },
      { $group: { _id: trendGroupId, count: { $sum: 1 } } },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.week": 1 } }
    ]);

    let total = 0;
    const applicationsTrendData = trendAgg.map(t => {
      total += t.count;

      let label;
      if (timeframe === "weekly") {
        label = `W${t._id.week} ${t._id.year}`;
      } else if (timeframe === "monthly") {
        label = `${monthNames[t._id.month - 1]} ${t._id.year}`;
      } else {
        label = t._id.year.toString();
      }

      return { label, applications: total };
    });

    // Processing Time Data 
    let processingGroupId;
    if (timeframe === "weekly") {
      processingGroupId = {
        year: { $year: "$appliedAt" },
        week: { $week: "$appliedAt" }
      };
    } else if (timeframe === "monthly") {
      processingGroupId = {
        year: { $year: "$appliedAt" },
        month: { $month: "$appliedAt" }
      };
    } else {
      processingGroupId = { year: { $year: "$appliedAt" } };
    }

    const processingAgg = await Application.aggregate([
      {
        $match: {
          appliedAt: { $exists: true },
          updatedAt: { $exists: true },
          $or: [
            { user: { $in: b2cCandidateIds } },
            {
              agent: { $exists: true, $ne: null },
              candidateId: { $in: managedCandidateIds }
            }
          ]
        }
      },
      {
        $project: {
          appliedAt: 1,
          updatedAt: 1,
          diffDays: {
            $divide: [
              { $subtract: ["$updatedAt", "$appliedAt"] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      },
      { $group: { _id: processingGroupId, avgDays: { $avg: "$diffDays" } } },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.week": 1 } }
    ]);

    const processingTimeData = processingAgg.map(p => {
      let label;
      if (timeframe === "weekly") {
        label = `W${p._id.week} ${p._id.year}`;
      } else if (timeframe === "monthly") {
        label = `${monthNames[p._id.month - 1]} ${p._id.year}`;
      } else {
        label = p._id.year.toString();
      }
      return { label, days: Math.round(p.avgDays) };
    });

    res.json({
      statusData,
      visaStageData,
      candidateDistributionData,
      processingTimeData,
      applicationsTrendData
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

const getReportStats = async (req, res) => {
  try {
    const salesAdminId = req.admin._id; // Get current sales admin ID

    // Get assigned B2C candidate IDs
    const b2cCandidates = await User.find({
      userType: "candidate",
      assignedTo: salesAdminId
    }).select('_id');
    const b2cCandidateIds = b2cCandidates.map(c => c._id);

    // Get B2B managed candidates assigned to this sales admin
    const agentsWithManagedCandidates = await User.find({
      userType: "agent",
      'managedCandidates.assignedTo': salesAdminId
    }).select('_id managedCandidates');

    const managedCandidateIds = [];
    agentsWithManagedCandidates.forEach(agent => {
      agent.managedCandidates.forEach(mc => {
        if (mc.assignedTo && mc.assignedTo.toString() === salesAdminId.toString()) {
          managedCandidateIds.push(mc._id.toString());
        }
      });
    });

    // Total candidates
    const totalB2C = b2cCandidateIds.length;
    const totalB2B = managedCandidateIds.length;
    const totalCandidates = totalB2C + totalB2B;

    // New applications this month 
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const newApplications = await Application.countDocuments({
      appliedAt: { $gte: startOfMonth },
      $or: [
        { user: { $in: b2cCandidateIds } },
        {
          agent: { $exists: true, $ne: null },
          candidateId: { $in: managedCandidateIds }
        }
      ]
    });

    // Active applications 
    const activeApplications = await Application.countDocuments({
      status: { $in: ["Pending", "In Review"] },
      $or: [
        { user: { $in: b2cCandidateIds } },
        {
          agent: { $exists: true, $ne: null },
          candidateId: { $in: managedCandidateIds }
        }
      ]
    });

    // Average processing time 
    const processingAgg = await Application.aggregate([
      {
        $match: {
          status: { $in: ["Accepted", "Rejected"] },
          $or: [
            { user: { $in: b2cCandidateIds } },
            {
              agent: { $exists: true, $ne: null },
              candidateId: { $in: managedCandidateIds }
            }
          ]
        }
      },
      {
        $project: {
          diffDays: {
            $divide: [
              { $subtract: ["$updatedAt", "$appliedAt"] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      },
      { $group: { _id: null, avgDays: { $avg: "$diffDays" } } }
    ]);

    const avgProcessingTime = Math.round(processingAgg[0]?.avgDays) || 0;

    res.json({
      totalCandidates,
      newApplications,
      activeApplications,
      avgProcessingTime
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//settings page change password
const changePassword = async (req, res) => {
  try {
    const adminId = req.admin.id;
    const { currentPassword, newPassword } = req.body;

    const admin = await AdminUser.findById(adminId);
    if (!admin) return res.status(404).json({ message: 'User not found' });

    const isMatch = await bcrypt.compare(currentPassword, admin.password);
    if (!isMatch) return res.status(400).json({ message: 'Current password is incorrect' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    admin.password = hashedPassword;
    await admin.save();

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

//tasks page
// Get tasks 
const getSalesAdminTasks = async (req, res) => {
  try {
    if (!['MainAdmin', 'SalesAdmin', 'SalesStaff'].includes(req.admin.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const salesAdminId = req.admin._id;
    const hasFullCandidateAccess = ['MainAdmin', 'SalesAdmin'].includes(req.admin.role);

    const managedCandidateMap = new Map();
    let b2cCandidateIds = [];
    let managedCandidateIds = [];
    let taskFilter;

    if (hasFullCandidateAccess) {
      const b2cCandidates = await User.find({ userType: 'candidate' }).select('_id name email');
      b2cCandidateIds = b2cCandidates.map((candidate) => candidate._id);

      const agentsWithManagedCandidates = await User.find({ userType: 'agent' }).select('_id managedCandidates');
      agentsWithManagedCandidates.forEach((agent) => {
        agent.managedCandidates.forEach((mc) => {
          managedCandidateIds.push(mc._id);
          managedCandidateMap.set(mc._id.toString(), {
            name: mc.name || 'Managed Candidate',
            email: mc.email,
            agentId: agent._id,
          });
        });
      });

      taskFilter = {
        $or: [
          { assignedBy: salesAdminId },
          { candidateType: 'B2C', candidate: { $in: b2cCandidateIds } },
          { candidateType: 'B2B', managedCandidateId: { $in: managedCandidateIds } },
        ],
      };
    } else {
      const salesTaskAccess = await buildAccessibleSalesTaskAccess(req.admin);
      const {
        accessibleCandidates,
        accessibleLeadIds,
        accessibleConversationIds,
      } = salesTaskAccess;

      accessibleCandidates.forEach((candidate) => {
        if (candidate.type === 'B2C') {
          b2cCandidateIds.push(candidate._id);
          return;
        }

        if (candidate.type === 'B2B') {
          managedCandidateIds.push(candidate._id);
          managedCandidateMap.set(String(candidate._id), {
            name: candidate.name || 'Managed Candidate',
            email: candidate.email || '',
            agentId: candidate.agent?.id || null,
          });
        }
      });

      taskFilter = salesTaskAccess.taskFilter;
    }

    const tasks = await Task.find(taskFilter)
      .populate('assignedBy', 'name email')
      .populate('relatedJob', 'title company')
      .populate('candidate', 'name email')
      .populate('agent', 'name email companyName')
      .populate('relatedMeeting')
      .sort({ createdAt: -1 })
      .lean();

    // 🔥 Add managed candidate name to B2B tasks
    const tasksWithCandidateNames = tasks.map(task => {
      if (task.candidateType === 'B2B' && task.managedCandidateId) {
        const mcData = managedCandidateMap.get(task.managedCandidateId.toString());
        if (mcData) {
          // Add candidateName for table display
          task.candidateName = mcData.name;
        }
      } else if (task.candidateType === 'B2C' && task.candidate) {
        // Add candidateName for B2C
        task.candidateName = task.candidate.name;
      }
      return withTaskCrmContext(task);
    });

    res.json({ tasks: tasksWithCandidateNames });
  } catch (err) {
    console.error("Error fetching sales admin tasks:", err);
    res.status(500).json({ message: err.message });
  }
};

// Create task 
const createSalesAdminTask = async (req, res) => {
  try {
    if (!['MainAdmin', 'SalesAdmin', 'SalesStaff'].includes(req.admin.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const salesAdminId = req.admin._id;
    const {
      title,
      description,
      type,
      priority,
      dueDate,
      candidateType,
      candidate,
      managedCandidateId,
      agent,
      requiredDocument,
      relatedJob,
      meetingDate,
      meetingTime,
      locationType,
      link,
      location,
      notes
    } = req.body;

    const resolvedCandidate = await resolveAccessibleSalesCandidate({
      admin: req.admin,
      candidateType,
      candidateId: candidate || req.body.candidateId,
      managedCandidateId: managedCandidateId || candidate || req.body.candidateId,
      agentId: agent || req.body.agentId,
    });

    const taskLinking = await resolveTaskLinkingPayload(req.body);

    if (!resolvedCandidate.success) {
      return res.status(resolvedCandidate.statusCode || 400).json({
        success: false,
        message: resolvedCandidate.message,
        details: resolvedCandidate.details || {
          candidateId: String(managedCandidateId || candidate || req.body.candidateId || ""),
          candidateType: String(candidateType || ""),
          userId: String(req.admin?._id || ""),
        },
      });
    }

    if (taskLinking.error) {
      return res.status(taskLinking.error.code).json({
        success: false,
        message: taskLinking.error.message,
      });
    }

    if (type === "Document Upload" && (!requiredDocument || !String(requiredDocument).trim())) {
      return res.status(400).json({ message: "Required document type is mandatory for document upload tasks" });
    }

    if (type === "Meeting") {
      if (!meetingDate || !meetingTime || !locationType) {
        return res.status(400).json({ message: "Meeting date, time, and location type are required for meeting tasks" });
      }
    }

    const taskData = {
      title,
      description: type === "Meeting" ? (notes || description || "") : description,
      type,
      priority: priority || 'Medium',
      dueDate: type === "Meeting" ? new Date(`${meetingDate}T${meetingTime}`) : dueDate,
      candidateType: resolvedCandidate.candidateType,
      assignedBy: salesAdminId
    };

    // Only add requiredDocument if it's provided and valid
    if (requiredDocument && requiredDocument.trim() !== '') {
      taskData.requiredDocument = requiredDocument;
    }

    // Only add relatedJob if it's provided and valid
    if (relatedJob && relatedJob.trim() !== '' && mongoose.Types.ObjectId.isValid(relatedJob)) {
      taskData.relatedJob = relatedJob;
    }

    if (taskLinking.conversationId) {
      taskData.conversationId = taskLinking.conversationId;
    }

    if (taskLinking.linkedLeadId) {
      taskData.linkedLeadId = taskLinking.linkedLeadId;
    }

    if (resolvedCandidate.candidateType === 'B2C') {
      taskData.candidate = resolvedCandidate.candidateId;
    } else if (resolvedCandidate.candidateType === 'B2B') {
      taskData.managedCandidateId = resolvedCandidate.managedCandidateId;
      taskData.agent = resolvedCandidate.agentId;
    }

    if (type === "Meeting") {
      const meeting = await createMeetingForTask({
        admin: req.admin,
        title,
        candidateType: resolvedCandidate.candidateType,
        candidate: resolvedCandidate.candidateType === 'B2C' ? resolvedCandidate.candidateId : undefined,
        managedCandidateId: resolvedCandidate.candidateType === 'B2B' ? resolvedCandidate.managedCandidateId : undefined,
        agent: resolvedCandidate.candidateType === 'B2B' ? resolvedCandidate.agentId : undefined,
        meetingDate,
        meetingTime,
        locationType,
        link,
        location,
        notes: notes || description || "",
      });

      taskData.relatedMeeting = meeting._id;
    }

    const task = await Task.create(taskData);

    const populatedTask = await Task.findById(task._id)
      .populate('assignedBy', 'name email')
      .populate('relatedJob', 'title company')
      .populate('candidate', 'name email')
      .populate('agent', 'name email companyName')
      .populate('relatedMeeting');

    res.status(201).json(withTaskCrmContext(populatedTask));
  } catch (err) {
    console.error("Error creating sales admin task:", err);
    res.status(500).json({ message: err.message });
  }
};

// Update task 
const updateSalesAdminTask = async (req, res) => {
  try {
    if (!['MainAdmin', 'SalesAdmin', 'SalesStaff'].includes(req.admin.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const hasFullCandidateAccess = ['MainAdmin', 'SalesAdmin'].includes(req.admin.role);
    const taskId = req.params.id;

    // Verify task belongs to sales admin's assigned candidates
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    let hasAccess = hasFullCandidateAccess;

    if (!hasAccess) {
      const salesTaskAccess = await buildAccessibleSalesTaskAccess(req.admin);
      hasAccess = !!(await Task.exists({
        _id: taskId,
        ...salesTaskAccess.taskFilter,
      }));
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied to this task" });
    }

    if (task.relatedMeeting && req.body.type && req.body.type !== 'Meeting') {
      return res.status(400).json({ message: "Meeting tasks cannot be changed to another task type" });
    }

    if (!task.relatedMeeting && req.body.type === 'Meeting') {
      return res.status(400).json({ message: "Convert existing tasks to meetings is not supported. Create a new meeting task instead." });
    }

    if (task.relatedMeeting) {
      await updateMeetingForTask({
        meetingId: task.relatedMeeting,
        title: req.body.title || task.title,
        notes: typeof req.body.notes === "string" ? req.body.notes : req.body.description,
        status: req.body.status === "Cancelled" ? "Canceled" : req.body.status,
        meetingDate: req.body.meetingDate,
        meetingTime: req.body.meetingTime,
        locationType: req.body.locationType,
        link: req.body.link,
        location: req.body.location,
      });

      if (req.body.meetingDate && req.body.meetingTime) {
        req.body.dueDate = new Date(`${req.body.meetingDate}T${req.body.meetingTime}`);
      }

      if (typeof req.body.notes === "string") {
        req.body.description = req.body.notes;
      }
    }

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      req.body,
      { new: true }
    )
      .populate('assignedBy', 'name email')
      .populate('relatedJob', 'title company')
      .populate('candidate', 'name email')
      .populate('agent', 'name email companyName')
      .populate('relatedMeeting');

    res.json(withTaskCrmContext(updatedTask));
  } catch (err) {
    console.error("Error updating sales admin task:", err);
    res.status(500).json({ message: err.message });
  }
};

// Delete task 
const deleteSalesAdminTask = async (req, res) => {
  try {
    if (!['MainAdmin', 'SalesAdmin', 'SalesStaff'].includes(req.admin.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const hasFullCandidateAccess = ['MainAdmin', 'SalesAdmin'].includes(req.admin.role);
    const taskId = req.params.id;

    // Verify task belongs to sales admin's assigned candidates
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    let hasAccess = hasFullCandidateAccess;

    if (!hasAccess) {
      const salesTaskAccess = await buildAccessibleSalesTaskAccess(req.admin);
      hasAccess = !!(await Task.exists({
        _id: taskId,
        ...salesTaskAccess.taskFilter,
      }));
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied to this task" });
    }

    await Task.findByIdAndDelete(taskId);
    res.json({ message: "Task deleted successfully" });
  } catch (err) {
    console.error("Error deleting sales admin task:", err);
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getAllCandidates,
  getCandidateDetails,
  getAssignedAgents,
  getAssignedAgentById,
  getApplications,
  updateApplicationStatus,
  createMeeting,
  getMeetings,
  updateMeeting,
  getReports,
  getReportStats,
  changePassword,
  getSalesAdminTasks,
  createSalesAdminTask,
  updateSalesAdminTask,
  deleteSalesAdminTask,
};





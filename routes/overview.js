const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/AdminAuth');
const Application = require('../models/Application');
const Job = require('../models/Job');
const User = require('../models/User');
const Message = require('../models/Message');

// @desc    Get candidate overview data
// @route   GET /api/overview/candidate
// @access  Private
const getCandidateOverview = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get user data with populated saved jobs and applied jobs
    const user = await User.findById(userId).populate('savedJobs.jobId appliedJobs.jobId');

    // Get applications data
    const applications = await Application.find({ user: userId })
      .populate('job', 'title company location type salary')
      .sort({ appliedAt: -1 });

    // Get recent messages/chats
    const recentMessages = await Message.find({
      $or: [
        { senderId: userId },
        { recipientId: userId }
      ]
    }).sort({ createdAt: -1 }).limit(5);

    // Calculate statistics
    const stats = {
      totalApplications: applications.length,
      pendingApplications: applications.filter(app => app.status === 'Pending').length,
      inReviewApplications: applications.filter(app => app.status === 'In Review').length,
      acceptedApplications: applications.filter(app => app.status === 'Accepted').length,
      rejectedApplications: applications.filter(app => app.status === 'Rejected').length,
      savedJobs: user.savedJobs.length,
      profileCompletion: calculateProfileCompletion(user),
      recentApplications: applications.slice(0, 5),
    };

    // Get all available jobs count
    const totalJobs = await Job.countDocuments({ expiringAt: { $gt: new Date() } });

    res.json({
      success: true,
      data: {
        user: {
          name: user.name,
          email: user.email,
          userType: user.userType,
          profilePicture: user.picture,
          visaStatus: user.visaStatus || 'Not Started'
        },
        stats,
        totalJobs,
        recentApplications: applications.slice(0, 5)
      }
    });

  } catch (error) {
    console.error('Candidate overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching candidate overview data',
      error: error.message
    });
  }
};

// Get managed candidate overview data (agent only)
const getManagedCandidateOverview = async (req, res) => {
  try {
    const { candidateId } = req.params;
    const agentId = req.user._id;

    // Verify agent
    if (req.user.userType !== 'agent') {
      return res.status(403).json({
        success: false,
        message: 'Only agents can view managed candidate data'
      });
    }

    // Find the agent and the managed candidate
    const agent = await User.findById(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    const managedCandidate = agent.managedCandidates.id(candidateId);
    if (!managedCandidate) {
      return res.status(404).json({
        success: false,
        message: 'Managed candidate not found'
      });
    }

    // Get applications for managed candidate
    const applications = await Application.find({
      agent: agentId,
      candidateId: candidateId
    })
      .populate('job', 'title company location type salary')
      .sort({ appliedAt: -1 });

    // Get saved jobs for managed candidate
    const savedJobsCount = managedCandidate.savedJobs?.length || 0;

    // Calculate profile completion
    const profileCompletion = calculateManagedCandidateProfileCompletion(managedCandidate);

    // Get all available jobs count
    const totalJobs = await Job.countDocuments({ expiringAt: { $gt: new Date() } });

    // Calculate statistics
    const stats = {
      totalApplications: applications.length,
      pendingApplications: applications.filter(app => app.status === 'Pending').length,
      inReviewApplications: applications.filter(app => app.status === 'In Review').length,
      acceptedApplications: applications.filter(app => app.status === 'Accepted').length,
      rejectedApplications: applications.filter(app => app.status === 'Rejected').length,
      savedJobs: savedJobsCount,
      profileCompletion: profileCompletion,
      recentApplications: applications.slice(0, 5)
    };

    res.json({
      success: true,
      data: {
        user: {
          _id: candidateId,
          name: managedCandidate.name || 'Managed Candidate',
          email: managedCandidate.email,
          userType: 'managed-candidate',
          profilePicture: managedCandidate.picture,
          visaStatus: managedCandidate.visaStatus || 'Not Started'
        },
        stats,
        totalJobs,
        recentApplications: applications.slice(0, 5),
        agentInfo: {
          name: agent.name,
          companyName: agent.companyName,
          email: agent.email
        }
      }
    });

  } catch (error) {
    console.error('Managed candidate overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching managed candidate overview data',
      error: error.message
    });
  }
};

// @desc    Get agent overview data
// @route   GET /api/overview/agent
// @access  Private
const getAgentOverview = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get agent data
    const agent = await User.findById(userId);

    // Get agent's applications (applications submitted by this agent)
    const agentApplications = await Application.find({ agent: userId })
      .populate('job', 'title company location type salary')
      .sort({ appliedAt: -1 });

    // Get recent messages
    const recentMessages = await Message.find({
      $or: [
        { senderId: userId },
        { recipientId: userId }
      ]
    }).sort({ createdAt: -1 }).limit(5);

    // Calculate managed candidates stats
    const managedCandidates = agent.managedCandidates || [];
    const candidateStats = {
      total: managedCandidates.length,
      pending: managedCandidates.filter(c => c.status === 'Pending').length,
      reviewed: managedCandidates.filter(c => c.status === 'Reviewed').length,
      approved: managedCandidates.filter(c => c.status === 'Approved').length,
      rejected: managedCandidates.filter(c => c.status === 'Rejected').length
    };

    // Calculate application stats
    const applicationStats = {
      total: agentApplications.length,
      pending: agentApplications.filter(app => app.status === 'Pending').length,
      inReview: agentApplications.filter(app => app.status === 'In Review').length,
      accepted: agentApplications.filter(app => app.status === 'Accepted').length,
      rejected: agentApplications.filter(app => app.status === 'Rejected').length
    };

    // Get total inquiries from managed candidates
    let totalInquiries = 0;
    let pendingInquiries = 0;

    managedCandidates.forEach(candidate => {
      if (candidate.inquiries) {
        totalInquiries += candidate.inquiries.length;
        pendingInquiries += candidate.inquiries.filter(inq => inq.status === 'Pending').length;
      }
    });

    // Calculate documents stats
    let totalDocuments = 0;
    let pendingDocuments = 0;

    managedCandidates.forEach(candidate => {
      if (candidate.documents) {
        totalDocuments += candidate.documents.length;
        pendingDocuments += candidate.documents.filter(doc => doc.status === 'Pending').length;
      }
    });

    // Profile completion for agent
    const profileCompletion = calculateAgentProfileCompletion(agent);

    // Get all available jobs count
    const totalJobs = await Job.countDocuments({ expiringAt: { $gt: new Date() } });

    //most recen candidates
    const recentCandidates = [...agent.managedCandidates]
      .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
      .slice(0, 5);


    res.json({
      success: true,
      data: {
        user: {
          name: agent.name,
          email: agent.email,
          userType: agent.userType,
          companyName: agent.companyName,
          companyLogo: agent.companyLogo,
          isVerified: agent.isVerified
        },
        candidateStats,
        applicationStats,
        inquiryStats: {
          total: totalInquiries,
          pending: pendingInquiries
        },
        documentStats: {
          total: totalDocuments,
          pending: pendingDocuments
        },
        profileCompletion,
        totalJobs,
        recentApplications: agentApplications.slice(0, 5),
        recentMessages: recentMessages.length,
        recentCandidates
      }
    });

  } catch (error) {
    console.error('Agent overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching agent overview data',
      error: error.message
    });
  }
};

// Helper function to calculate candidate profile completion
function calculateProfileCompletion(user) {
  let completedFields = 0;
  // const totalFields = 14; 
  const totalFields = 13;


  // Basic information (5 fields)
  if (user.name) completedFields++;
  if (user.email) completedFields++;
  if (user.phone) completedFields++;
  if (user.dateOfBirth) completedFields++;
  if (user.gender) completedFields++;

  // Professional information (6 fields)
  if (user.location) completedFields++;
  if (user.profession) completedFields++;
  if (user.qualification) completedFields++;
  if (user.experience) completedFields++;
  if (user.jobInterest) completedFields++;
  if (user.categories && user.categories.length > 0) completedFields++;

  // image (1 field)
  // if (user.picture) completedFields++;

  // Additional information (2 fields)
  if (user.aboutMe) completedFields++;
  if (user.socialNetworks && (user.socialNetworks.linkedin || user.socialNetworks.github)) completedFields++;

  return Math.round((completedFields / totalFields) * 100);
}

// Helper function to calculate agent profile completion
function calculateAgentProfileCompletion(agent) {
  let completedFields = 0;
  const totalFields = 8;

  if (agent.name) completedFields++;
  if (agent.email) completedFields++;
  if (agent.phone) completedFields++;
  if (agent.companyName) completedFields++;
  if (agent.companyAddress) completedFields++;
  if (agent.contactPerson) completedFields++;
  if (agent.companyLogo) completedFields++;
  if (agent.isVerified) completedFields++;

  return Math.round((completedFields / totalFields) * 100);
}

// Helper function for managed candidate profile completion
function calculateManagedCandidateProfileCompletion(candidate) {
  let completedFields = 0;
  // const totalFields = 14;
  const totalFields = 13;


  if (candidate.name) completedFields++;
  if (candidate.email) completedFields++;
  if (candidate.phone) completedFields++;
  if (candidate.dateOfBirth) completedFields++;
  if (candidate.gender) completedFields++;
  if (candidate.location) completedFields++;
  if (candidate.profession) completedFields++;
  if (candidate.qualification) completedFields++;
  if (candidate.experience) completedFields++;
  if (candidate.jobInterest) completedFields++;
  if (candidate.categories && candidate.categories.length > 0) completedFields++;
  // if (candidate.picture) completedFields++;
  if (candidate.aboutMe) completedFields++;
  if (candidate.socialNetworks && (candidate.socialNetworks.linkedin || candidate.socialNetworks.github)) completedFields++;

  return Math.round((completedFields / totalFields) * 100);
}

// Routes
router.get('/candidate', protect, getCandidateOverview);
router.get('/agent', protect, getAgentOverview);
router.get('/managed-candidate/:candidateId', protect, getManagedCandidateOverview);

module.exports = router;
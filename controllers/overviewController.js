const Job = require('../models/Job');
const Application = require('../models/Application');
const User = require('../models/User');
const Document = require('../models/Document');
const Message = require('../models/Message');

// @desc    Get Agent Overview Data
// @route   GET /api/overview/agent
// @access  Private/Agent
const getAgentOverview = async (req, res) => {
  try {
    const agentId = req.user.id;
    
    // Get total managed candidates
    const totalCandidates = await User.countDocuments({ 
      managedBy: agentId, 
      userType: 'candidate' 
    });

    // Get applications submitted by agent
    const totalApplications = await Application.countDocuments({ 
      submittedBy: agentId 
    });

    // Get applications by status
    const applicationsByStatus = await Application.aggregate([
      { $match: { submittedBy: agentId } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Get pending applications count
    const pendingApplications = await Application.countDocuments({ 
      submittedBy: agentId, 
      status: 'pending' 
    });

    // Get approved applications count
    const approvedApplications = await Application.countDocuments({ 
      submittedBy: agentId, 
      status: 'approved' 
    });

    // Get rejected applications count
    const rejectedApplications = await Application.countDocuments({ 
      submittedBy: agentId, 
      status: 'rejected' 
    });

    // Get recent applications (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentApplications = await Application.find({ 
      submittedBy: agentId,
    })
    .populate('job', 'title company')
    .populate('candidate', 'name email')
    .sort({ createdAt: -1 })
    .limit(5);

    // Get success rate (approved / total * 100)
    const successRate = totalApplications > 0 
      ? Math.round((approvedApplications / totalApplications) * 100) 
      : 0;

    // Get active candidates (candidates with recent activity)
    const activeCandidates = await User.countDocuments({
      managedBy: agentId,
      userType: 'candidate',
      lastLogin: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });

    // Get unread messages count
    const unreadMessages = await Message.countDocuments({
      $or: [{ to: agentId }, { from: agentId }],
      isRead: false,
      to: agentId
    });

    // Get monthly application trends (last 6 months)
    const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000);
    const monthlyTrends = await Application.aggregate([
      { 
        $match: { 
          submittedBy: agentId,
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json({
      success: true,
      data: {
        totalCandidates,
        totalApplications,
        pendingApplications,
        approvedApplications,
        rejectedApplications,
        activeCandidates,
        successRate,
        unreadMessages,
        applicationsByStatus,
        recentApplications,
        monthlyTrends
      }
    });

  } catch (error) {
    console.error('Error fetching agent overview:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

// @desc    Get Candidate Overview Data
// @route   GET /api/overview/candidate
// @access  Private/Candidate
const getCandidateOverview = async (req, res) => {
  try {
    const candidateId = req.user.id;
    
    // Get total applications
    const totalApplications = await Application.countDocuments({ 
      candidate: candidateId 
    });

    // Get applications by status
    const applicationsByStatus = await Application.aggregate([
      { $match: { candidate: candidateId } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Get pending applications count
    const pendingApplications = await Application.countDocuments({ 
      candidate: candidateId, 
      status: 'pending' 
    });

    // Get approved applications count
    const approvedApplications = await Application.countDocuments({ 
      candidate: candidateId, 
      status: 'approved' 
    });

    // Get rejected applications count
    const rejectedApplications = await Application.countDocuments({ 
      candidate: candidateId, 
      status: 'rejected' 
    });

    // Get recent applications (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentApplications = await Application.find({ 
      candidate: candidateId,
      createdAt: { $gte: sevenDaysAgo }
    })
    .populate('job', 'title company location salary')
    .sort({ createdAt: -1 })
    .limit(5);

    // Get saved jobs count
    const savedJobsCount = await User.findById(candidateId)
      .select('savedJobs')
      .then(user => user.savedJobs ? user.savedJobs.length : 0);

    // Get profile completion percentage
    const user = await User.findById(candidateId);
    let profileCompletion = 0;
    const requiredFields = ['name', 'email', 'phone', 'location', 'skills', 'experience'];
    const completedFields = requiredFields.filter(field => {
      if (field === 'skills') return user.skills && user.skills.length > 0;
      if (field === 'experience') return user.experience && user.experience.length > 0;
      return user[field] && user[field].toString().trim() !== '';
    });
    profileCompletion = Math.round((completedFields.length / requiredFields.length) * 100);

    // Get documents count
    const documentsCount = await Document.countDocuments({ 
      uploadedBy: candidateId 
    });

    // Get unread messages count
    const unreadMessages = await Message.countDocuments({
      to: candidateId,
      isRead: false
    });

    // Get response rate (applications with responses / total applications)
    const applicationsWithResponse = await Application.countDocuments({
      candidate: candidateId,
      status: { $in: ['approved', 'rejected'] }
    });
    const responseRate = totalApplications > 0 
      ? Math.round((applicationsWithResponse / totalApplications) * 100) 
      : 0;

    // Get monthly application trends (last 6 months)
    const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000);
    const monthlyTrends = await Application.aggregate([
      { 
        $match: { 
          candidate: candidateId,
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Get latest job recommendations (jobs matching user's skills)
    const jobRecommendations = await Job.find({
      $or: [
        { skills: { $in: user.skills || [] } },
        { location: user.location }
      ],
      status: 'active'
    })
    .select('title company location salary postedDate')
    .sort({ postedDate: -1 })
    .limit(5);

    res.json({
      success: true,
      data: {
        totalApplications,
        pendingApplications,
        approvedApplications,
        rejectedApplications,
        savedJobsCount,
        profileCompletion,
        documentsCount,
        unreadMessages,
        responseRate,
        applicationsByStatus,
        recentApplications,
        monthlyTrends,
        jobRecommendations
      }
    });

  } catch (error) {
    console.error('Error fetching candidate overview:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

module.exports = {
  getAgentOverview,
  getCandidateOverview
};
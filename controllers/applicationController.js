const asyncHandler = require('express-async-handler');
const Application = require('../models/Application');
const Job = require('../models/Job');
const User = require('../models/User');

const firstNonEmptyString = (...values) => {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
};

// @desc    Apply for a job (One-click application)
// @route   POST /api/applications/:jobId
// @access  Private
const applyForJob = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.jobId);
  if (!job) {
    res.status(404);
    throw new Error('Job not found');
  }

  // Check if user has already applied for this job
  const existingApplication = await Application.findOne({
    user: req.user._id,
    job: req.params.jobId
  });

  if (existingApplication) {
    res.status(400);
    throw new Error('You have already applied for this job');
  }

  const resolvedCoverLetter = firstNonEmptyString(req.body?.coverLetter, req.body?.note, req.body?.message);
  const cvFromBody = firstNonEmptyString(
    req.body?.cvUrl,
    req.body?.cv,
    req.body?.resumeUrl,
    req.body?.resume,
    req.body?.attachmentUrl,
    req.body?.fileUrl
  );
  const userDoc = await User.findById(req.user._id).select('CV');
  const resolvedCv = cvFromBody || firstNonEmptyString(req.user?.CV, userDoc?.CV) || null;

  // Create application using explicit payload CV first, then fallback to profile CV.
  const application = new Application({
    user: req.user._id,
    job: req.params.jobId,
    status: 'Pending',
    coverLetter: resolvedCoverLetter || '',
    cv: resolvedCv,
    appliedAt: new Date()
  });

  const createdApplication = await application.save();

  // Keep profile CV in sync when candidate applies with a new uploaded CV URL.
  if (cvFromBody && userDoc && !firstNonEmptyString(userDoc.CV)) {
    userDoc.CV = cvFromBody;
    await userDoc.save();
  }

  // Update user's appliedJobs array for quick access
  await User.findByIdAndUpdate(req.user._id, {
    $push: {
      appliedJobs: {
        jobId: req.params.jobId,
        status: 'Applied',
        appliedAt: new Date()
      }
    }
  });

  job.applicants.push({
    userId: req.user._id,
    status: 'Applied',
    appliedAt: new Date()
  });
  await job.save();

  // Populate job details for response
  const populatedApplication = await Application.findById(createdApplication._id)
    .populate('job', 'title company country location salary type requirements');

  res.status(201).json({
    success: true,
    message: 'Application submitted successfully',
    data: populatedApplication
  });
});

// @desc    Get user's applications (b2c and b2b)
// @route   GET /api/applications
// @access  Private
const getMyApplications = asyncHandler(async (req, res) => {
  let query = {};
  
  // If candidateId is provided (agent viewing managed candidate applications)
  if (req.query.candidateId && req.user.userType === 'agent') {
    query = { 
      candidateId: req.query.candidateId,
      agent: req.user._id 
    };
  } else {
    // B2C candidate viewing their own applications
    query = { user: req.user._id };
  }

  const applications = await Application.find(query)
    .populate('job', 'title company country location salary type requirements')
    .sort({ appliedAt: -1 });

  res.json(applications);
});

// @desc    Get all applications (for admin)
// @route   GET /api/applications/all
// @access  Private/Admin
const getAllApplications = async (req, res) => {
  try {
    const applications = await Application.find({})
      .populate('user', 'name email phoneNumber')
      .populate('job', 'title company country location salary type')
      .sort({ appliedAt: -1 });

    // Group by job for admin dashboard
    const groupedByJob = applications.reduce((acc, app) => {
      const jobId = app.job._id.toString();
      if (!acc[jobId]) {
        acc[jobId] = {
          job: app.job,
          applications: []
        };
      }
      acc[jobId].applications.push({
        _id: app._id,
        user: app.user,
        status: app.status,
        appliedAt: app.appliedAt,
        coverLetter: app.coverLetter,
        cv: app.cv
      });
      return acc;
    }, {});

    res.json(Object.values(groupedByJob));
  } catch (err) {
    console.error('Error fetching all applications:', err);
    res.status(500).json({ message: 'Server error while fetching applications' });
  }
};

// @desc    Update application status (for admin)
// @route   PUT /api/applications/:applicationId/status
// @access  Private/Admin
const updateApplicationStatus = async (req, res) => {
  const { applicationId } = req.params;
  const { status } = req.body;

  const validStatuses = ['Pending', 'In Review', 'Accepted', 'Rejected'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
    });
  }

  try {
    const application = await Application.findById(applicationId)
      .populate('job', 'title')
      .populate('user', 'name email');

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    // Update application status
    application.status = status;
    application.updatedAt = new Date();
    await application.save();

    // Update user's appliedJobs array to keep in sync
    const user = await User.findById(application.user._id);
    if (user) {
      const appliedJobIndex = user.appliedJobs.findIndex(
        job => job.jobId.toString() === application.job._id.toString()
      );

      if (appliedJobIndex !== -1) {
        user.appliedJobs[appliedJobIndex].status = status;
        await user.save();
      }
    }

    res.json({
      success: true,
      message: `Application status updated to ${status}`,
      data: application
    });
  } catch (err) {
    console.error('Error updating application status:', err);
    res.status(500).json({
      success: false,
      message: 'Server error while updating application status'
    });
  }
};

// @desc    Delete/withdraw application
// @route   DELETE /api/applications/:applicationId
// @access  Private
const withdrawApplication = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;

  const application = await Application.findOne({
    _id: applicationId,
    user: req.user._id // Ensure user can only withdraw their own applications
  });

  if (!application) {
    res.status(404);
    throw new Error('Application not found or unauthorized');
  }

  // Remove from Application collection
  await Application.findByIdAndDelete(applicationId);

  // Remove from user's appliedJobs array
  await User.findByIdAndUpdate(req.user._id, {
    $pull: { appliedJobs: { jobId: application.job } }
  });

  res.json({
    success: true,
    message: 'Application withdrawn successfully'
  });
});

// @desc    Submit application for a managed candidate (agent)
// @route   POST /api/applications/agent/submit
// @access  Private/Agent
const submitAgentApplication = asyncHandler(async (req, res) => {
  // Only agents can submit
  if (req.user.userType !== 'agent') {
    res.status(403);
    throw new Error('Only agents can submit applications for candidates');
  }

  const { jobId, candidateId } = req.body;

  // Find the job
  const job = await Job.findById(jobId);
  if (!job) {
    res.status(404);
    throw new Error('Job not found');
  }

  // Find the agent and the managed candidate
  const agent = await User.findById(req.user._id);
  const managedCandidate = agent.managedCandidates.id(candidateId);
  
  if (!managedCandidate) {
    res.status(404);
    throw new Error('Managed candidate not found');
  }

  // Check if this candidate has already applied for this job
  const existingApplication = await Application.findOne({
    job: jobId,
    candidateId: candidateId,
    agent: req.user._id
  });

  if (existingApplication) {
    res.status(400);
    throw new Error('Candidate has already been submitted for this job');
  }

  // Create new application
  const application = new Application({
    user: null,
    agent: req.user._id,
    candidateId: candidateId,
    job: jobId,
    status: 'Pending',
    cv: managedCandidate.CV || null,
    appliedAt: new Date()
  });

  const createdApplication = await application.save();

  // Update the managed candidate's appliedJobs array
  managedCandidate.appliedJobs.push({
    jobId: jobId,
    appliedAt: new Date(),
    status: 'Pending'
  });

  await agent.save();

  // Also update the job's applicants array
  job.applicants.push({
    userId: null, // Not a regular user
    candidateId: candidateId,
    status: 'Applied',
    appliedAt: new Date()
  });
  await job.save();

  res.status(201).json({
    success: true,
    message: 'Managed candidate application submitted successfully',
    data: createdApplication
  });
});


// @desc    Get applications statistics (for dashboard)
// @route   GET /api/applications/stats
// @access  Private
const getApplicationStats = asyncHandler(async (req, res) => {
  const applications = await Application.find({ user: req.user._id });

  const stats = {
    total: applications.length,
    pending: applications.filter(app => app.status === 'Pending').length,
    inReview: applications.filter(app => app.status === 'In Review').length,
    accepted: applications.filter(app => app.status === 'Accepted').length,
    rejected: applications.filter(app => app.status === 'Rejected').length
  };

  res.json({
    success: true,
    data: stats
  });
});

module.exports = {
  applyForJob,
  getMyApplications,
  getAllApplications,
  updateApplicationStatus,
  withdrawApplication,
  submitAgentApplication,
  getApplicationStats
};

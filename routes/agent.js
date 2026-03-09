const express = require('express');
const router = express.Router();
const { protect, authorizeAdmin, protectAdmin } = require('../middlewares/AdminAuth');
const upload = require('../middlewares/upload');
const User = require('../models/User');
const Job = require('../models/Job');
const { getAllManagedCandidates, updateCandidateStatus } = require('../controllers/usersController')

// Middleware to allow only agents
const agentOnly = (req, res, next) => {
  if (req.user.userType !== 'agent') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only agents can access this resource.'
    });
  }
  next();
};

// --------------------
// GET agent profile
// --------------------
router.get('/profile', protect, agentOnly, async (req, res) => {
  try {
    const agent = await User.findById(req.user._id).select('-password');
    res.json({ success: true, data: agent });
  } catch (error) {
    console.error('Get agent profile error:', error);
    res.status(500).json({ success: false, message: 'Error fetching agent profile' });
  }
});

// Update agent profile
router.put(
  "/update/:id",
  protect, // Make sure req.user is populated first
  upload.single("companyLogo"), // then handle file upload
  async (req, res) => {
    try {
      const { id } = req.params;

      const updateData = { ...req.body };

      // Map phoneNumber to phone
      if (updateData.phoneNumber) {
        updateData.phone = updateData.phoneNumber;
        delete updateData.phoneNumber;
      }

      // If companyLogo is uploaded, add its path to updateData
      if (req.file) {
        updateData.companyLogo = req.file.path;
      }

      const updatedAgent = await User.findByIdAndUpdate(id, updateData, {
        new: true,
      });

      if (!updatedAgent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      res.json({ success: true, data: updatedAgent });
    } catch (err) {
      console.error("Error updating agent profile:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// --------------------
// Add managed candidate
// --------------------
router.post(
  '/candidates',
  protect,
  agentOnly,
  upload.fields([
    { name: 'cv', maxCount: 1 },
    { name: 'passport', maxCount: 1 },
    { name: 'picture', maxCount: 1 },
    { name: 'drivingLicense', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        name, email, phone, firstname, lastname, dateOfBirth,
        address, country, location, profession, qualification,
        experience, jobInterest, aboutMe, visaStatus, gender,
        ageRange, linkedin, github, categories, skills
      } = req.body;

      // Check if candidate already exists with this email
      const agent = await User.findById(req.user._id);
      const existingCandidate = agent.managedCandidates.find(c => c.email === email);

      if (existingCandidate) {
        return res.status(400).json({
          success: false,
          message: 'Candidate with this email already exists in your managed list'
        });
      }

      // Prepare candidate data with all B2C fields
      const candidateData = {
        name,
        email,
        phone: phone || '',
        firstname: firstname || '',
        lastname: lastname || '',
        dateOfBirth: dateOfBirth || null,
        address: address || '',
        country: country || '',
        location: location || '',
        profession: profession || '',
        qualification: qualification || '',
        experience: experience || '',
        jobInterest: jobInterest || '',
        aboutMe: aboutMe || '',
        visaStatus: visaStatus || 'Not Started',
        picture: '',
        CV: '',
        passport: '',
        drivingLicense: '',
        // Handle array fields
        categories: categories ? (Array.isArray(categories) ? categories : categories.split(',').map(c => c.trim())) : [],
        skills: skills ? (Array.isArray(skills) ? skills : skills.split(',').map(s => s.trim())) : [],
        // Social networks
        socialNetworks: {
          linkedin: linkedin || '',
          github: github || ''
        },
        // Initialize arrays
        appliedJobs: [],
        savedJobs: [],
        inquiries: [],
        documents: [],
        status: "Pending",
        addedAt: new Date()
      };

      // Handle gender and age range
      if (gender) candidateData.gender = gender;
      if (ageRange) candidateData.ageRange = ageRange;

      // Handle file uploads
      if (req.files) {
        const fileMappings = {
          cv: 'CV',
          passport: 'Passport',
          picture: 'Picture',
          drivingLicense: 'DrivingLicense'
        };
        const rootDocFieldByUploadKey = {
          cv: 'CV',
          passport: 'passport',
          picture: 'picture',
          drivingLicense: 'drivingLicense'
        };

        Object.entries(req.files).forEach(([fieldName, files]) => {
          if (files && files[0]) {
            candidateData.documents.push({
              type: fileMappings[fieldName],
              fileName: files[0].originalname,
              fileUrl: files[0].path,
              uploadedAt: new Date()
            });
            const rootField = rootDocFieldByUploadKey[fieldName];
            if (rootField) {
              candidateData[rootField] = files[0].path;
            }
          }
        });
      }

      // Add candidate to agent's managed list
      if (agent.assignedTo) {
        candidateData.assignedTo = agent.assignedTo;
      }

      agent.managedCandidates.push(candidateData);
      agent.markModified("managedCandidates");
      await agent.save();

      res.status(201).json({
        success: true,
        message: 'Candidate added successfully',
        data: candidateData
      });

    } catch (error) {
      console.error('Add managed candidate error:', error);
      res.status(500).json({
        success: false,
        message: 'Error adding candidate',
        error: error.message
      });
    }
  }
);


// --------------------
// GET all managed candidates
// --------------------
router.get('/candidates', protect, agentOnly, async (req, res) => {
  try {
    const agent = await User.findById(req.user._id)
      .select('managedCandidates')
      .populate('managedCandidates.assignedTo', 'name email');
    
    // Format the response to include all B2C fields
    const candidates = agent.managedCandidates.map(candidate => ({
      _id: candidate._id,
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
      firstname: candidate.firstname,
      lastname: candidate.lastname,
      dateOfBirth: candidate.dateOfBirth,
      gender: candidate.gender,
      ageRange: candidate.ageRange,
      address: candidate.address,
      country: candidate.country,
      location: candidate.location,
      profession: candidate.profession,
      qualification: candidate.qualification,
      experience: candidate.experience,
      jobInterest: candidate.jobInterest,
      categories: candidate.categories,
      aboutMe: candidate.aboutMe,
      socialNetworks: candidate.socialNetworks,
      visaStatus: candidate.visaStatus,
      skills: candidate.skills,
      status: candidate.status,
      addedAt: candidate.addedAt,
      lastUpdated: candidate.lastUpdated,
      documents: candidate.documents,
      inquiries: candidate.inquiries,
      appliedJobs: candidate.appliedJobs,
      savedJobs: candidate.savedJobs,
      assignedTo: candidate.assignedTo
    }));

    res.json({ success: true, data: candidates });
  } catch (error) {
    console.error('Get managed candidates error:', error);
    res.status(500).json({ success: false, message: 'Error fetching managed candidates' });
  }
});

// --------------------
// UPDATE managed candidate
// --------------------
router.put(
  '/candidates/:candidateId',
  protect,
  agentOnly,
  upload.fields([
    { name: 'cv', maxCount: 5 },
    { name: 'passport', maxCount: 2 },
    { name: 'picture', maxCount: 2 },
    { name: 'drivingLicense', maxCount: 2 },
  ]),
  async (req, res) => {
    try {
      const { candidateId } = req.params;
      const updateData = { ...req.body };

      const agent = await User.findById(req.user._id);
      const candidate = agent.managedCandidates.id(candidateId);

      if (!candidate) {
        return res.status(404).json({
          success: false,
          message: 'Candidate not found'
        });
      }

      // Handle array fields
      const arrayFields = ['skills', 'categories'];
arrayFields.forEach(field => {
  if (updateData[field] !== undefined) {
    let parsed;

    try {
      // Try parsing JSON 
      parsed = JSON.parse(updateData[field]);
      if (Array.isArray(parsed)) {
        candidate[field] = parsed;
        return;
      }
    } catch (err) {
      // Not valid JSON — will handle below as comma-separated string
    }

    // Fallback: comma-separated string to array
    candidate[field] = Array.isArray(updateData[field])
      ? updateData[field]
      : updateData[field]
          .split(',')
          .map(item => item.trim())
          .filter(Boolean);
  }
});


      // Handle social networks
      if (updateData.linkedin || updateData.github) {
        candidate.socialNetworks = {
          linkedin: updateData.linkedin || candidate.socialNetworks?.linkedin || '',
          github: updateData.github || candidate.socialNetworks?.github || ''
        };
      }

      // Handle enum fields
      const validGenders = ["Male", "Female", "Other", "Prefer not to say"];
      if (updateData.gender && validGenders.includes(updateData.gender)) {
        candidate.gender = updateData.gender;
      }

      const validAgeRanges = ["18-24", "25-34", "35-44", "45-54", "55+"];
      if (updateData.ageRange && validAgeRanges.includes(updateData.ageRange)) {
        candidate.ageRange = updateData.ageRange;
      }

      const validVisaStatuses = ['Not Started', 'Processing', 'Approved', 'Rejected', 'Completed'];
      if (updateData.visaStatus && validVisaStatuses.includes(updateData.visaStatus)) {
        candidate.visaStatus = updateData.visaStatus;
      }

      // Update all other candidate fields
      const fieldsToUpdate = [
        'name', 'email', 'phone', 'firstname', 'lastname', 'dateOfBirth',
        'address', 'country', 'location', 'profession', 'qualification',
        'experience', 'jobInterest', 'aboutMe', 'status'
      ];

      fieldsToUpdate.forEach(field => {
        if (updateData[field] !== undefined && updateData[field] !== '') {
          candidate[field] = updateData[field];
        }
      });

      // Handle file uploads
      if (req.files) {
        const fileMappings = {
          cv: 'CV',
          passport: 'Passport',
          picture: 'Picture',
          drivingLicense: 'DrivingLicense'
        };
        const rootDocFieldByUploadKey = {
          cv: 'CV',
          passport: 'passport',
          picture: 'picture',
          drivingLicense: 'drivingLicense'
        };

        Object.entries(req.files).forEach(([fieldName, files]) => {
          if (files && files.length > 0) {
            files.forEach(file => {
              candidate.documents.push({
                type: fileMappings[fieldName],
                fileName: file.originalname,
                fileUrl: file.path,
                uploadedAt: new Date()
              });
            });
            const rootField = rootDocFieldByUploadKey[fieldName];
            if (rootField) {
              candidate[rootField] = files[0].path;
            }
          }
        });
      }

      // Update last updated timestamp
      candidate.lastUpdated = new Date();

      await agent.save();

      res.json({
        success: true,
        message: 'Candidate updated successfully',
        data: candidate
      });

    } catch (error) {
      console.error('Update managed candidate error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating candidate',
        error: error.message
      });
    }
  }
);

// --------------------
// DELETE managed candidate
// --------------------
router.delete('/candidates/:candidateId', protect, agentOnly, async (req, res) => {
  try {
    const { candidateId } = req.params;
    const agent = await User.findById(req.user._id);
    const candidateIndex = agent.managedCandidates.findIndex(c => c._id.toString() === candidateId);
    if (candidateIndex === -1) return res.status(404).json({ success: false, message: 'Candidate not found' });

    agent.managedCandidates.splice(candidateIndex, 1);
    await agent.save();
    res.json({ success: true, message: 'Candidate removed successfully' });
  } catch (error) {
    console.error('Delete managed candidate error:', error);
    res.status(500).json({ success: false, message: 'Error removing candidate' });
  }
});

// --------------------
// Apply for job on behalf of candidate
// --------------------
router.post('/candidates/:candidateId/apply/:jobId', protect, agentOnly, async (req, res) => {
  try {
    const { candidateId, jobId } = req.params;
    const { applicationNote } = req.body;

    const agent = await User.findById(req.user._id);
    const candidate = agent.managedCandidates.find(c => c._id.toString() === candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: 'Candidate not found' });

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const existingApplication = job.applicants.find(a => a.email === candidate.email);
    if (existingApplication) return res.status(400).json({ success: false, message: 'Candidate has already applied for this job' });

    const applicationData = {
      email: candidate.email,
      name: candidate.name,
      phone: candidate.phone,
      cv: candidate.cv,
      appliedBy: 'agent',
      agentId: req.user._id,
      agentCompany: agent.companyName,
      applicationNote,
      status: 'Applied',
      appliedAt: new Date()
    };

    job.applicants.push(applicationData);
    await job.save();

    res.json({
      success: true,
      message: 'Application submitted successfully',
      data: { jobTitle: job.title, candidateName: candidate.name, appliedAt: new Date() }
    });
  } catch (error) {
    console.error('Apply for job error:', error);
    res.status(500).json({ success: false, message: 'Error submitting application' });
  }
});

// --------------------
// GET applications for agent's managed candidates
// --------------------
router.get('/applications', protect, agentOnly, async (req, res) => {
  try {
    const agent = await User.findById(req.user._id);
    const managedEmails = agent.managedCandidates.map(c => c.email);

    const jobs = await Job.find({});
    const applications = [];

    jobs.forEach(job => {
      job.applicants.forEach(applicant => {
        if (managedEmails.includes(applicant.email)) {
          applications.push({
            _id: applicant._id,
            jobId: job._id,
            jobTitle: job.title,
            company: job.company,
            location: job.location,
            candidateName: applicant.name || applicant.email,
            candidateEmail: applicant.email,
            status: applicant.status,
            appliedAt: applicant.appliedAt,
            salary: job.salary,
            type: job.type
          });
        }
      });
    });

    applications.sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));
    res.json({ success: true, data: applications });
  } catch (error) {
    console.error('Get agent applications error:', error);
    res.status(500).json({ success: false, message: 'Error fetching applications' });
  }
});

// --------------------
// GET agent dashboard stats
// --------------------
router.get('/stats', protect, agentOnly, async (req, res) => {
  try {
    const agent = await User.findById(req.user._id);
    const managedEmails = agent.managedCandidates.map(c => c.email);

    const jobs = await Job.find({});
    let totalApplications = 0, pendingApplications = 0, approvedApplications = 0, rejectedApplications = 0;

    jobs.forEach(job => {
      job.applicants.forEach(applicant => {
        if (managedEmails.includes(applicant.email)) {
          totalApplications++;
          switch (applicant.status) {
            case 'Applied':
            case 'Under Review':
              pendingApplications++;
              break;
            case 'Approved':
            case 'Hired':
              approvedApplications++;
              break;
            case 'Rejected':
              rejectedApplications++;
              break;
          }
        }
      });
    });

    const stats = {
      totalCandidates: agent.managedCandidates.length,
      totalApplications,
      pendingApplications,
      approvedApplications,
      rejectedApplications,
      successRate: totalApplications > 0 ? Math.round((approvedApplications / totalApplications) * 100) : 0,
      thisMonthCandidates: agent.managedCandidates.filter(c => new Date(c.addedAt).getMonth() === new Date().getMonth()).length
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Get agent stats error:', error);
    res.status(500).json({ success: false, message: 'Error fetching agent statistics' });
  }
});

// Get all managed candidates from all agents
router.get("/candidate", protectAdmin, authorizeAdmin("MainAdmin", "AgentAdmin"), getAllManagedCandidates);

// Update candidate status (need agentId and candidateId)
router.put("/candidate/:agentId/:candidateId/status", protectAdmin, authorizeAdmin("MainAdmin", "AgentAdmin"), updateCandidateStatus);

// Change Password
router.put('/change-password', protect, agentOnly, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'All password fields are required'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirmation do not match'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Get user with password field
    const user = await User.findById(req.user._id).select('+password');

    // Check current password
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error changing password'
    });
  }
});

// DELETE agent acc
router.delete('/delete-account', protect, agentOnly, async (req, res) => {
  try {
    const { emailConfirmation } = req.body;

    // Validate email confirmation
    if (!emailConfirmation || emailConfirmation !== req.user.email) {
      return res.status(400).json({
        success: false,
        message: 'Email confirmation does not match'
      });
    }

    const agentId = req.user._id;

    // Remove agent
    await User.findByIdAndDelete(agentId);

    // Clean up assignedTo references in candidates
    await User.updateMany(
      { assignedTo: agentId },
      { $unset: { assignedTo: "" } }
    );

    res.json({
      success: true,
      message: 'Agent and related references removed successfully'
    });

  } catch (error) {
    console.error('Delete agent error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting agent'
    });
  }
});



module.exports = router;

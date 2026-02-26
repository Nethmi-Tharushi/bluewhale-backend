const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Job = require('../models/Job');
const Application = require('../models/Application');
const bcrypt = require('bcryptjs');
const cloudinary = require('../config/cloudinary');
const Document = require('../models/Document');
const Message = require('../models/Message');
const ChatAssignment = require('../models/ChatAssignment');
const ChatUser = require('../models/ChatUser');
const AdminUser = require("../models/AdminUser");

const normalizeUploadFieldName = (fieldname = "") => {
  const f = String(fieldname).trim();
  if (f === "CV" || f === "cv") return "cv";
  if (f === "picture" || f === "photo") return "photo";
  if (f === "file" || f === "document") return "cv";
  if (f === "passport" || f === "drivingLicense") return f;
  return f;
};

const flattenUploadedFiles = (req) => {
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === "object") {
    return Object.values(req.files).flat();
  }
  if (req.file) return [req.file];
  return [];
};


// Generate JWT Token with role
const generateToken = (id, role = 'user') => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d',
  });
};

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
const getUsers = asyncHandler(async (req, res) => {
  const users = await User.find({});
  res.json(users);
});

// @desc    Create candidate by admin (quick lead creation)
// @route   POST /api/users/candidates
// @access  Private/Admin
const createCandidateByAdmin = asyncHandler(async (req, res) => {
  const { name, email, phone, profession, location, qualification, experience, jobInterest } = req.body;

  if (!name || !email) {
    return res.status(400).json({ success: false, message: "Name and email are required" });
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(400).json({ success: false, message: "User with this email already exists" });
  }

  const tempPassword = `Lead@${Math.random().toString(36).slice(-8)}A1`;

  const candidate = await User.create({
    name,
    email,
    password: tempPassword,
    userType: "candidate",
    phone: phone || "",
    profession: profession || "",
    location: location || "",
    qualification: qualification || "",
    experience: experience || "",
    jobInterest: jobInterest || "",
  });

  const safeCandidate = await User.findById(candidate._id).select("-password");
  res.status(201).json({
    success: true,
    message: "Candidate created successfully",
    data: safeCandidate,
  });
});

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private/Admin
const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('-password');
  if (user) {
    res.json(user);
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private/Admin
const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (user) {
    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;
    if (req.body.password) {
      user.password = req.body.password;
    }
    const updatedUser = await user.save();
    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      isAdmin: updatedUser.isAdmin,
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (user) {
    await user.remove();
    res.json({ message: 'User removed' });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

// New: Get agent's managed candidates
// @route   GET /api/agent/candidates
// @access  Private/Agent
const getManagedCandidates = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.userType !== 'agent') {
    res.status(403);
    throw new Error('Access denied');
  }
  res.json({ success: true, data: user.managedCandidates });
});

// POST /api/agent/candidates
// Protected, Agent only
const addManagedCandidate = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.userType !== 'agent') {
    res.status(403);
    throw new Error('Access denied');
  }

  const { name, email, phone, skills, experience, address, qualifications } = req.body;

  const candidateData = {
    name,
    email,
    phone,
    skills: Array.isArray(skills) ? skills : skills?.split(',').map(s => s.trim()),
    experience,
    address,
    qualifications: Array.isArray(qualifications) ? qualifications : qualifications?.split(',').map(q => q.trim()),
    addedAt: new Date(),
    documents: [] // Initialize empty documents array
  };

  // Handle multiple uploaded files with types
  // req.files should be an array of files with 'fieldname' as type
  const uploadedFiles = flattenUploadedFiles(req);
  if (uploadedFiles.length > 0) {
    uploadedFiles.forEach(file => {
      candidateData.documents.push({
        type: normalizeUploadFieldName(file.fieldname), // e.g., 'cv', 'passport', 'photo', 'drivingLicense'
        fileName: file.originalname,
        fileUrl: file.path,
        status: 'Pending'
      });
    });
  }

  // Check for existing candidate by email
  const existingCandidate = user.managedCandidates.find(c => c.email === email);
  if (existingCandidate) {
    return res.status(400).json({ success: false, message: 'Candidate with this email already exists' });
  }

  user.managedCandidates.push(candidateData);
  await user.save();

  res.status(201).json({ success: true, message: 'Candidate added successfully', data: candidateData });
});


// PUT /api/agent/candidates/:candidateId
// Protected, Agent only
const updateManagedCandidate = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.userType !== 'agent') {
    res.status(403);
    throw new Error('Access denied');
  }

  const candidate = user.managedCandidates.id(req.params.candidateId);
  if (!candidate) {
    res.status(404);
    throw new Error('Candidate not found');
  }

  // Update basic info
  candidate.name = req.body.name || candidate.name;
  candidate.email = req.body.email || candidate.email;
  candidate.phone = req.body.phone || candidate.phone;
  candidate.skills = req.body.skills
    ? Array.isArray(req.body.skills)
      ? req.body.skills
      : req.body.skills.split(',').map(s => s.trim())
    : candidate.skills;
  candidate.experience = req.body.experience || candidate.experience;
  candidate.address = req.body.address || candidate.address;
  candidate.qualifications = req.body.qualifications
    ? Array.isArray(req.body.qualifications)
      ? req.body.qualifications
      : req.body.qualifications.split(',').map(q => q.trim())
    : candidate.qualifications;

  // Update / add documents
  const uploadedFiles = flattenUploadedFiles(req);
  if (uploadedFiles.length > 0) {
    uploadedFiles.forEach(file => {
      const normalizedType = normalizeUploadFieldName(file.fieldname);
      // Check if document of this type exists; if so, replace, else add
      const existingDoc = candidate.documents.find(doc => doc.type === normalizedType);
      if (existingDoc) {
        existingDoc.fileName = file.originalname;
        existingDoc.fileUrl = file.path;
        existingDoc.status = 'Pending';
        existingDoc.uploadedAt = new Date();
      } else {
        candidate.documents.push({
          type: normalizedType,
          fileName: file.originalname,
          fileUrl: file.path,
          status: 'Pending',
          uploadedAt: new Date()
        });
      }
    });
  }

  await user.save();

  res.json({ success: true, message: 'Candidate updated successfully', data: candidate });
});


// New: Delete managed candidate
// @route   DELETE /api/agent/candidates/:id
// @access  Private/Agent
const deleteManagedCandidate = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.userType !== 'agent') {
    res.status(403);
    throw new Error('Access denied');
  }

  // Find the managed candidate 
  const managedCandidate = user.managedCandidates.id(req.params.id);
  if (!managedCandidate) {
    res.status(404);
    throw new Error('Candidate not found');
  }

  // DELETE CANDIDATE'S DOCUMENTS FROM CLOUDINARY
  if (managedCandidate.documents && managedCandidate.documents.length > 0) {
    for (const doc of managedCandidate.documents) {
      if (doc.cloudinaryId) {
        try {
          await cloudinary.uploader.destroy(doc.cloudinaryId);
        } catch (err) {
          console.error('Cloudinary delete error:', err);
        }
      }
    }
  }

  //  DELETE CANDIDATE'S APPLICATIONS
  await Application.deleteMany({
    agent: req.user._id,
    candidateId: req.params.id
  });

  // DELETE CANDIDATE'S TASKS
  await Task.deleteMany({
    candidateType: 'B2B',
    managedCandidateId: req.params.id,
    agent: req.user._id
  });

  // Remove candidate from agent's array
  user.managedCandidates.id(req.params.id).remove();
  await user.save();

  res.json({ 
    success: true, 
    message: 'Candidate and all associated data deleted successfully' 
  });
});

// New: Create inquiry for candidate
// @route   POST /api/agent/inquiries
// @access  Private/Agent
const createInquiry = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.userType !== 'agent') {
    res.status(403);
    throw new Error('Access denied');
  }
  const inquiry = {
    content: req.body.content,
    status: 'Pending'
  };
  user.managedCandidates.id(req.body.candidateId).inquiries.push(inquiry);
  await user.save();
  res.json({ success: true, inquiry });
});

// New: Get agent's inquiries
// @route   GET /api/agent/inquiries
// @access  Private/Agent
const getInquiries = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.userType !== 'agent') {
    res.status(403);
    throw new Error('Access denied');
  }
  const inquiries = user.managedCandidates.flatMap(cand => cand.inquiries.map(inq => ({ ...inq.toObject(), candidateName: cand.name })));
  res.json({ success: true, data: inquiries });
});

// POST /api/agent/candidates/:candidateId/documents
// Protected, Agent only
const uploadDocument = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.userType !== 'agent') {
    res.status(403);
    throw new Error('Access denied');
  }

  const candidate = user.managedCandidates.id(req.params.candidateId);
  if (!candidate) {
    res.status(404);
    throw new Error('Candidate not found');
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const document = {
    type: req.file.fieldname, // 'cv', 'passport', 'picture', 'drivingLicense'
    fileName: req.file.originalname,
    fileUrl: req.file.path,
    status: 'Pending',
    uploadedAt: new Date()
  };

  candidate.documents.push(document);
  await user.save();

  res.status(201).json({ success: true, message: 'Document uploaded', document });
});


// New: Get agent's documents
// @route   GET /api/agent/documents
// @access  Private/Agent
const getDocuments = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.userType !== 'agent') {
    res.status(403);
    throw new Error('Access denied');
  }
  const documents = user.managedCandidates.flatMap(cand => cand.documents.map(doc => ({ ...doc.toObject(), candidateName: cand.name })));
  res.json({ success: true, data: documents });
});

// New: Delete document
// @route   DELETE /api/agent/documents/:id
// @access  Private/Agent
const deleteDocument = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.userType !== 'agent') {
    res.status(403);
    throw new Error('Access denied');
  }
  // Find and remove document across all candidates
  user.managedCandidates.forEach(cand => {
    cand.documents = cand.documents.filter(doc => doc._id.toString() !== req.params.id);
  });
  await user.save();
  res.json({ success: true, message: 'Document deleted' });
});

// New: Get agent's applications
// @route   GET /api/agent/applications
// @access  Private/Agent
const getAgentApplications = asyncHandler(async (req, res) => {
  const applications = await Application.find({ agent: req.user._id }).populate('job', 'title company');
  res.json({ success: true, data: applications });
});

// Get user profile
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (user) {
      res.json({
        // All existing fields PLUS new fields
        ...user.toObject(),
        // Ensure socialNetworks is always an object
        socialNetworks: user.socialNetworks || { linkedin: "", github: "" }
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Update user profile
const updateUserProfile = async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    // Update name instead of fullName
    user.name = req.body.name || user.name;

    if (req.body.password) {
      user.password = req.body.password;
    }

    user.phoneNumber = req.body.phoneNumber || user.phoneNumber;
    user.address = req.body.address || user.address;
    user.country = req.body.country || user.country;
    user.drivingLicense = req.body.drivingLicense || user.drivingLicense;
    user.passport = req.body.passport || user.passport;

    user.phone = req.body.phone || user.phone;
    user.dateOfBirth = req.body.dateOfBirth || user.dateOfBirth;
    user.gender = req.body.gender || user.gender;
    user.ageRange = req.body.ageRange || user.ageRange;
    user.location = req.body.location || user.location;
    user.profession = req.body.profession || user.profession;
    user.qualification = req.body.qualification || user.qualification;
    user.experience = req.body.experience || user.experience;
    user.jobInterest = req.body.jobInterest || user.jobInterest;
    user.aboutMe = req.body.aboutMe || user.aboutMe;

    // Handle categories array
    if (req.body.categories) {
      try {
        // Try to parse as JSON array
        user.categories = JSON.parse(req.body.categories);
      } catch (e) {
        // If parsing fails, treat as comma-separated string
        user.categories = req.body.categories.split(',')
          .map(cat => cat.trim())
          .filter(cat => cat);
      }
    } else {
      user.categories = [];
    }

    // Handle social networks 
    user.socialNetworks = {
      linkedin: req.body.linkedin || (user.socialNetworks?.linkedin || ""),
      github: req.body.github || (user.socialNetworks?.github || "")
    };

    const profilePicture = req.files?.picture?.[0] || req.files?.photo?.[0];
    const profileCv = req.files?.CV?.[0] || req.files?.cv?.[0];

    if (profilePicture) {
      user.picture = profilePicture.path;
    }
    if (profileCv) {
      user.CV = profileCv.path;
    }

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      picture: updatedUser.picture,
      CV: updatedUser.CV,
      phone: updatedUser.phone,
      dateOfBirth: updatedUser.dateOfBirth,
      gender: updatedUser.gender,
      ageRange: updatedUser.ageRange,
      location: updatedUser.location,
      profession: updatedUser.profession,
      qualification: updatedUser.qualification,
      experience: updatedUser.experience,
      jobInterest: updatedUser.jobInterest,
      categories: updatedUser.categories,
      aboutMe: updatedUser.aboutMe,
      socialNetworks: updatedUser.socialNetworks
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user (candidate or agent)
    const user = await User.findOne({ email });

    if (user && (await user.matchPassword(password))) {
      res.json({
        success: true,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          userType: user.userType,
          companyName: user.companyName,
          companyAddress: user.companyAddress,
          contactPerson: user.contactPerson,
          isVerified: user.isVerified,
        },
        token: generateToken(user._id, 'user'),
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// Combined Signup for Candidates and Agents
const signupUser = async (req, res) => {
  try {
    console.log('Signup request body:', req.body);
    console.log('Signup request files:', req.files);

    const {
      name,
      email,
      password,
      userType,
      // Candidate fields
      address,
      country,
      phoneNumber,
      // Agent fields
      companyName,
      companyAddress,
      contactPerson
    } = req.body;

    // Validate required fields
    if (!email || !password || !userType) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and user type are required'
      });
    }

    // Validate user type
    if (!['candidate', 'agent'].includes(userType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user type. Must be either candidate or agent'
      });
    }

    // Type-specific validation
    if (userType === 'candidate' && (!name)) {
      return res.status(400).json({
        success: false,
        message: 'Name, first name, and last name are required for candidates'
      });
    }

    if (userType === 'agent' && (!companyName || !companyAddress || !contactPerson)) {
      return res.status(400).json({
        success: false,
        message: 'Company name, address, and contact person are required for agents'
      });
    }

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Prepare user data
    const userData = {
      email,
      password,
      userType,
      phoneNumber,
    };

    // Add type-specific fields
    if (userType === 'candidate') {
      userData.name = name;
      userData.address = address;
      userData.country = country;
      userData.phone = phoneNumber;

      // Handle file uploads for candidates
      const signupPicture = req.files?.picture?.[0] || req.files?.photo?.[0];
      const signupCv = req.files?.CV?.[0] || req.files?.cv?.[0];

      if (signupPicture) {
        userData.picture = signupPicture.path;
      }
      if (signupCv) {
        userData.CV = signupCv.path;
      }
    } else if (userType === 'agent') {
      userData.name = contactPerson; // Use contact person as name for agents
      userData.companyName = companyName;
      userData.companyAddress = companyAddress;
      userData.contactPerson = contactPerson;

      // Handle company logo upload for agents
      if (req.files?.companyLogo) {
        userData.companyLogo = req.files.companyLogo[0].path;
      }
    }

    // Create new user
    const user = await User.create(userData);

    // Respond with created user info and token
    if (user) {
      const responseData = {
        success: true,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          userType: user.userType,
        },
        token: generateToken(user._id, 'user'),
      };

      // Add type-specific response data
      if (userType === 'candidate') {
        responseData.user.address = user.address;
        responseData.user.country = user.country;
        responseData.user.phone = user.phone;
        responseData.user.picture = user.picture;
        responseData.user.CV = user.CV;
      } else if (userType === 'agent') {
        responseData.user.companyName = user.companyName;
        responseData.user.companyAddress = user.companyAddress;
        responseData.user.contactPerson = user.contactPerson;
        responseData.user.phoneNumber = user.phoneNumber;
        responseData.user.companyLogo = user.companyLogo;
        responseData.user.isVerified = user.isVerified;
      }

      res.status(201).json(responseData);
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid user data'
      });
    }
  } catch (error) {
    console.error('Signup error:', error);

    // Handle mongoose validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: messages.join('. ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

const getUserApplications = async (req, res) => {
  try {
    // Use req.user._id, NOT a string
    const user = await User.findById(req.user._id)
      .populate('appliedJobs.jobId'); // populate the jobs

    if (!user) return res.status(404).json({ message: 'User not found' });

    const applications = user.appliedJobs.map((job) => ({
      id: job._id,
      status: job.status,
      appliedAt: job.appliedAt,
      job: job.jobId, // populated job info
    }));

    res.json(applications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Fetch all managed candidates for all agents (for admin)
const getAllManagedCandidates = async (req, res) => {
  try {
    const agents = await User.find({ userType: "agent" }).select("name companyName managedCandidates");

    const allCandidates = [];
    agents.forEach(agent => {
      agent.managedCandidates.forEach(candidate => {
        allCandidates.push({
          ...candidate.toObject(),
          agentName: agent.name,
          agentCompany: agent.companyName,
          agentId: agent._id.toString(),
        });
      });
    });

    res.json({ success: true, data: allCandidates });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching managed candidates", error: error.message });
  }
};

// Update candidate status
const updateCandidateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { agentId, candidateId } = req.params;

    const agent = await User.findById(agentId);
    if (!agent || agent.userType !== "agent") {
      return res.status(404).json({ message: "Agent not found" });
    }

    const candidate = agent.managedCandidates.id(candidateId);
    if (!candidate) return res.status(404).json({ message: "Candidate not found" });

    candidate.status = status;
    await agent.save();

    res.json({ success: true, message: "Status updated successfully", candidate });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating status", error: error.message });
  }
};

// Change password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Validate new password
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while changing password'
    });
  }
};

// Delete account
const deleteAccount = async (req, res) => {
  try {
    const { emailConfirmation } = req.body;
    const userId = req.user._id;

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Verify email confirmation
    if (emailConfirmation !== user.email) {
      return res.status(400).json({ success: false, message: 'Email confirmation does not match' });
    }

    // Delete user documents (Cloudinary + DB)
    const documents = await Document.find({ user: userId });
    for (const doc of documents) {
      if (doc.cloudinaryId) {
        try {
          await cloudinary.uploader.destroy(doc.cloudinaryId);
        } catch (err) {
          console.error('Cloudinary delete error:', err);
        }
      }
    }
    await Document.deleteMany({ user: userId });

    //  Delete messages
    await Message.deleteMany({
      $or: [
        { senderId: userId },
        { recipientId: userId }
      ]
    });

    //  Delete chat assignments
    await ChatAssignment.deleteMany({ userId });

    //  Delete chat presence/status
    await ChatUser.deleteMany({ userId });

    //  Delete user
    await User.findByIdAndDelete(userId);

    res.json({ success: true, message: 'Account deleted successfully' });

  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting account' });
  }
};

// B2C 
const getB2CCandidates = async (req, res) => {
  try {
    // Fetch all users with userType 'candidate' (B2C candidates)
    const candidates = await User.find({
      userType: 'candidate'
    })
      .select('-password') // Exclude password field
      .sort({ createdAt: -1 }) // Sort by newest first
      .lean(); // Convert to plain JavaScript objects for better performance

    // Get statistics
    const totalCandidates = candidates.length;
    const withProfession = candidates.filter(c => c.profession && c.profession.trim() !== '').length;
    const visaProcessing = candidates.filter(c => c.visaStatus === 'processing' || c.visaStatus === 'applied').length;
    const uniqueLocations = [...new Set(candidates.map(c => c.location).filter(l => l))].length;

    // Group by profession for filtering
    const professions = [...new Set(candidates.map(c => c.profession).filter(p => p))];

    res.status(200).json({
      success: true,
      data: {
        candidates,
        statistics: {
          total: totalCandidates,
          withProfession,
          visaProcessing,
          locations: uniqueLocations
        },
        professions
      },
      message: `Found ${totalCandidates} B2C candidates`
    });

  } catch (error) {
    console.error('Error fetching B2C candidates:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching B2C candidates',
      error: error.message
    });
  }
};

const getSingleB2CCandidate = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch single candidate with userType 'candidate' (B2C candidate)
    const candidate = await User.findOne({
      _id: id,
      userType: 'candidate'
    })
      .select('-password') // Exclude password field
      .populate('appliedJobs.jobId', 'title company location') // Populate job details if needed
      .lean(); // Convert to plain JavaScript object for better performance

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'B2C candidate not found'
      });
    }

    res.status(200).json({
      success: true,
      data: candidate,
      message: 'B2C candidate details retrieved successfully'
    });

  } catch (error) {
    console.error('Error fetching single B2C candidate:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching B2C candidate details',
      error: error.message
    });
  }
};

const getAllCandidates = asyncHandler(async (req, res) => {
  try {
    //  B2C candidates
    const b2cUsers = await User.find({ userType: 'candidate' })
      .select('name email phone location profession status visaStatus jobInterest createdAt')
      .populate('assignedTo', 'name');

    const unifiedCandidates = await Promise.all(
      b2cUsers.map(async user => {
        // latest application for this candidate
        const latestApplication = await Application.findOne({ user: user._id })
          .sort({ appliedAt: -1 })
          .select('status');

        return {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          location: user.location,
          profession: user.profession,
          status: latestApplication ? latestApplication.status : "Not Applied",
          visaStatus: user.visaStatus,
          type: 'B2C',
          agent: null,
          jobInterest: user.jobInterest || '',
          assignedTo: user.assignedTo || null,
          createdAt: user.createdAt
        };
      })
    );

    // B2B candidates from agents
    const agents = await User.find({ userType: 'agent' })
      .select('name companyName managedCandidates');

    for (const agent of agents) {
      for (const managedCandidate of agent.managedCandidates) {
        let assignedTo = null;

        if (managedCandidate.assignedTo) {
          assignedTo = await AdminUser.findById(managedCandidate.assignedTo)
            .select('name email');
        }

        unifiedCandidates.push({
          _id: managedCandidate._id,
          name: managedCandidate.name,
          email: managedCandidate.email,
          phone: managedCandidate.phone,
          location: managedCandidate.location,
          profession: managedCandidate.profession,
          status: managedCandidate.status,
          visaStatus: managedCandidate.visaStatus,
          type: 'B2B',
          assignedTo,
          agent: {
            id: agent._id,
            name: agent.name,
            companyName: agent.companyName
          },
          createdAt: managedCandidate.addedAt
        });
      }
    }

    unifiedCandidates.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

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

// assign to sales
const assignB2CToSalesAdmin = asyncHandler(async (req, res) => {
  const { candidateId, salesAdminId } = req.body;

  const salesAdmin = await AdminUser.findById(salesAdminId);
  if (!salesAdmin || salesAdmin.role !== 'SalesAdmin') {
    return res.status(400).json({ success: false, message: 'Invalid Sales Admin' });
  }

  // First check if this is a top-level B2C candidate
  let candidate = await User.findOne({ _id: candidateId, userType: 'candidate' });
  if (candidate) {
    candidate.assignedTo = salesAdmin._id;
    await candidate.save();
    return res.json({ success: true, message: 'B2C Candidate assigned', candidate });
  }

  // Check if this is a B2B candidate (inside an agent's managedCandidates)
  const agent = await User.findOne({ "managedCandidates._id": candidateId });
  if (agent) {
    return res.status(400).json({
      success: false,
      message: 'B2B candidates cannot be assigned individually. Assign their agent instead.'
    });
  }

  // Not found anywhere
  return res.status(404).json({ success: false, message: 'Candidate not found' });
});


//get all sales admins 
const getSalesAdmins = asyncHandler(async (req, res) => {
  const salesAdmins = await AdminUser.find({ role: 'SalesAdmin' }).select('name email');
  res.json({ success: true, data: salesAdmins });
});

// Update visa status for candidate 
const updateVisaStatus = asyncHandler(async (req, res) => {
  const { candidateId, visaStatus } = req.body;

  //  B2C candidate
  let candidate = await User.findById(candidateId);
  let isManaged = false;

  if (!candidate) {
    //  managed candidates
    const agent = await User.findOne({ "managedCandidates._id": candidateId });
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Candidate not found' });
    }

    isManaged = true;
    candidate = agent.managedCandidates.id(candidateId);
  }

  candidate.visaStatus = visaStatus;

  if (isManaged) {
    // Save the agent document containing the managed candidate
    await candidate.parent().save();
  } else {
    await candidate.save();
  }

  res.status(200).json({
    success: true,
    message: 'Visa status updated successfully',
    visaStatus: candidate.visaStatus
  });
});

//agents page get agents
const getAgents = asyncHandler(async (req, res) => {
  const agents = await User.find({ userType: 'agent' })
    .select('name email phone companyName companyAddress contactPerson isVerified assignedTo managedCandidates')
    .populate('assignedTo', 'name email')
    .sort({ createdAt: -1 });

  const agentsWithCounts = agents.map(agent => ({
    ...agent.toObject(),
    candidateCount: agent.managedCandidates.length,
    managedCandidates: undefined
  }));

  res.json({
    success: true,
    data: agentsWithCounts
  });
});

//get single agent
const getAgentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const agent = await User.findOne({ _id: id, userType: 'agent' })
    .select('name email phone companyName companyAddress contactPerson isVerified managedCandidates assignedTo')
    .populate('assignedTo', 'name email');

  if (!agent) {
    return res.status(404).json({ success: false, message: 'Agent not found' });
  }

  res.json({
    success: true,
    data: agent
  });
});

const assignAgentToSalesAdmin = asyncHandler(async (req, res) => {
  const { agentId, salesAdminId } = req.body;

  const salesAdmin = await AdminUser.findById(salesAdminId);
  if (!salesAdmin || salesAdmin.role !== 'SalesAdmin') {
    return res.status(400).json({ success: false, message: 'Invalid Sales Admin' });
  }

  // Find the agent
  const agent = await User.findOne({ _id: agentId, userType: 'agent' });
  if (!agent) {
    return res.status(404).json({ success: false, message: 'Agent not found' });
  }

  // Assign agent to sales admin
  agent.assignedTo = salesAdmin._id;

  // assignment to all managed candidates
  agent.managedCandidates.forEach(candidate => {
    candidate.assignedTo = salesAdmin._id;
  });

  agent.markModified('managedCandidates');
  await agent.save();

  res.json({
    success: true,
    message: 'Agent and all managed candidates assigned',
    agent,
  });
});

// update agent verification
const updateVerificationStatus = async (req, res) => {
  try {
    const { agentId, isVerified } = req.body;

    if (!agentId || typeof isVerified !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }

    await User.updateOne(
      { _id: agentId },
      { $set: { isVerified } }
    );

    return res.status(200).json({ success: true, message: 'Verification status updated' });
  } catch (error) {
    console.error('Error updating verification:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};


module.exports = {
  createCandidateByAdmin,
  getB2CCandidates,
  getSingleB2CCandidate,
  getCandidateDetails,
  getAllCandidates,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  getManagedCandidates, // New
  addManagedCandidate, // New
  updateManagedCandidate, // New
  deleteManagedCandidate, // New
  createInquiry, // New
  getInquiries, // New
  uploadDocument, // New
  getDocuments, // New
  deleteDocument, // New
  getAgentApplications, // New
  getUserProfile,
  updateUserProfile,
  loginUser,
  signupUser,
  getUserApplications,
  getAllManagedCandidates,
  updateCandidateStatus,
  changePassword,
  deleteAccount,
  assignB2CToSalesAdmin,
  getSalesAdmins,
  updateVisaStatus,
  getAgents,
  getAgentById,
  assignAgentToSalesAdmin,
  updateVerificationStatus
}; 

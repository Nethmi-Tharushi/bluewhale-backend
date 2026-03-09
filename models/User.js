const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // Common fields for all users
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  userType: {
    type: String,
    enum: ['candidate', 'agent'],
    default: 'candidate',
    required: true,
  },

  // Password Reset Fields
  resetPasswordToken: String,
  resetPasswordExpire: Date,

  // Candidate-specific fields
  firstname: {
    type: String,
  },
  lastname: {
    type: String,
  },
  picture: {
    type: String, // Profile picture path/URL
  },
  CV: {
    type: String, // CV file path/URL
  },
  drivingLicense: {
    type: String, // Driving license file path/URL
  },
  passport: {
    type: String, // Passport file path/URL
  },
  address: {
    type: String,
  },
  country: {
    type: String,
  },
  appliedJobs: [
    {
      jobId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
      },
      status: {
        type: String,
        default: 'Applied',
      },
      appliedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  savedJobs: [
    {
      jobId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
      },
      savedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],

  phone: String,
  dateOfBirth: Date,
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other', 'Prefer not to say']
  },
  ageRange: {
    type: String,
    enum: ['18-24', '25-34', '35-44', '45-54', '55+']
  },
  location: String,
  profession: String,
  qualification: String,
  experience: String,
  jobInterest: String,
  categories: [String],
  aboutMe: String,
  socialNetworks: {
    linkedin: String,
    github: String
  },
  // In your userSchema, add this with the other candidate fields
  visaStatus: {
    type: String,
    enum: ['Not Started', 'Processing', 'Approved', 'Rejected', 'Completed'],
    default: 'Not Started'
  },

  // Agent-specific fields
  companyName: {
    type: String,
    required: function () {
      return this.userType === 'agent';
    },
  },
  companyAddress: {
    type: String,
    required: function () {
      return this.userType === 'agent';
    },
  },
  contactPerson: {
    type: String,
    required: function () {
      return this.userType === 'agent';
    },
  },
  companyLogo: {
    type: String, // Company logo path/URL
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  managedCandidates: [
    {
      name: String,
      firstname: String,
      lastname: String,
      email: String,
      phone: String,
      address: String,
      country: String,
      dateOfBirth: Date,
      ageRange: {
        type: String,
        enum: ["18-24", "25-34", "35-44", "45-54", "55+"],
        default: undefined, 
        required: false
      },
      gender: {
        type: String,
        enum: ["Male", "Female", "Other", "Prefer not to say"],
        default: undefined,
        required: false
      },
      location: String,
      profession: String,
      qualification: String,
      qualifications: [String],
      skills: [String],
      experience: String,
      jobInterest: String,
      picture: String,
      CV: String,
      passport: String,
      drivingLicense: String,
      categories: [String],
      aboutMe: String,
      socialNetworks: {
        linkedin: String,
        github: String
      },
      visaStatus: {
        type: String,
        enum: ['Not Started', 'Processing', 'Approved', 'Rejected', 'Completed'],
        default: 'Not Started'
      },
      appliedJobs: [
        {
          jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
          appliedAt: { type: Date, default: Date.now },
          status: { type: String, enum: ["Pending", "In Review", "Accepted", "Rejected"], default: "Pending" }
        }
      ],
      savedJobs: [
      {
        jobId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Job',
        },
        savedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
      status: { type: String, enum: ["Pending", "Reviewed", "Approved", "Rejected"], default: "Pending" },
      addedAt: {
        type: Date,
        default: Date.now,
      },
      inquiries: [ // New: Inquiries per candidate
        {
          content: String,
          response: String,
          status: { type: String, default: 'Pending' },
          createdAt: { type: Date, default: Date.now }
        }
      ],
      assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AdminUser'
      },
      documents: [ // Documents per managed candidate
        {
          type: {
            type: String,
            enum: ['CV', 'Passport', 'Picture', 'DrivingLicense'],
            required: true,
          },
          fileName: { type: String, required: true },
          fileUrl: { type: String, required: true },
          status: { type: String, default: 'Pending' }, // optional: Approved / Rejected
          uploadedAt: { type: Date, default: Date.now }
        }
      ]
    },
  ],
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdminUser'
  }
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to check password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Method to add saved job (for candidates AND managed candidates)
userSchema.methods.saveJob = async function (jobId, managedCandidateId = null) {
  if (managedCandidateId) {
    // For managed candidate
    const managedCandidate = this.managedCandidates.id(managedCandidateId);
    if (!managedCandidate) {
      throw new Error('Managed candidate not found');
    }
    
    // Initialize savedJobs if it doesn't exist
    if (!managedCandidate.savedJobs) {
      managedCandidate.savedJobs = [];
    }
    
    const isAlreadySaved = managedCandidate.savedJobs.some(
      savedJob => savedJob.jobId.toString() === jobId.toString()
    );

    if (!isAlreadySaved) {
      managedCandidate.savedJobs.push({ jobId });
      await this.save();
    }
  } else {
    // For regular B2C candidate
    if (this.userType !== 'candidate') {
      throw new Error('Only candidates can save jobs');
    }

    const isAlreadySaved = this.savedJobs.some(
      savedJob => savedJob.jobId.toString() === jobId.toString()
    );

    if (!isAlreadySaved) {
      this.savedJobs.push({ jobId });
      await this.save();
    }
  }
  return this;
};

// Method to remove saved job (for candidates AND managed candidates)
userSchema.methods.unsaveJob = async function (jobId, managedCandidateId = null) {
  if (managedCandidateId) {
    // For managed candidate
    const managedCandidate = this.managedCandidates.id(managedCandidateId);
    if (!managedCandidate) {
      throw new Error('Managed candidate not found');
    }
    
    if (managedCandidate.savedJobs) {
      managedCandidate.savedJobs = managedCandidate.savedJobs.filter(
        savedJob => savedJob.jobId.toString() !== jobId.toString()
      );
      await this.save();
    }
  } else {
    // For regular B2C candidate
    if (this.userType !== 'candidate') {
      throw new Error('Only candidates can unsave jobs');
    }

    this.savedJobs = this.savedJobs.filter(
      savedJob => savedJob.jobId.toString() !== jobId.toString()
    );
    await this.save();
  }
  return this;
};

// Method to add managed candidate (for agents)
userSchema.methods.addManagedCandidate = async function (candidateData) {
  if (this.userType !== 'agent') {
    throw new Error('Only agents can manage candidates');
  }

  this.managedCandidates.push(candidateData);
  await this.save();
  return this;
};

// New: Method to update candidate status
userSchema.methods.updateCandidateStatus = async function (candidateId, newStatus) {
  if (this.userType !== 'agent') {
    throw new Error('Only agents can update statuses');
  }
  const candidate = this.managedCandidates.id(candidateId);
  if (candidate) {
    candidate.status = newStatus; // Assume adding status field if needed
    await this.save();
  }
  return this;
};

const User = mongoose.model('User', userSchema);

module.exports = User;

const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  company: {
    type: String,
    required: true,
  },
  location: {
    type: String,
    required: true,
  },
  country: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['Full-time', 'Part-time', 'Contract', 'Internship', 'Remote'],
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  benefits: [String],
  requirements: [String],
  skills: [String],
  salary: Number,

  // pricing
  pricing: {
    currency: {
      type: String,
      enum: ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'AED', 'INR'],
      default: 'USD'
    },
    candidatePrice: {
      type: Number,
      default: 0
    },
    agentPrice: {
      type: Number,
      default: 0
    }
  },

  postedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
  },

  ageLimit: {
    min: {
      type: Number,
      required: [true, 'Minimum age is required'],
      default: 18,
      min: [0, 'Minimum age must be a positive number'],
    },
    max: {
      type: Number,
      required: [true, 'Maximum age is required'],
      default: 60,
      max: [100, 'Maximum age must be less than or equal to 100'],
    }
  },

  applicants: [
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
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

  inquiries: [
    {
      email: {
        type: String,
        required: true,
      },
      heading: [String],
      subject: {
        type: String,
        required: true,
      },
      message: {
        type: String,
        required: true,
      },
      status: {
        type: String,
        default: 'Pending',
      },
      appliedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],

  postedAt: {
    type: Date,
    default: Date.now,
  },
  expiringAt: {
    type: Date,
    required: true,
  },
  tags: {
    type: [String],
    default: []
  },
});

module.exports = mongoose.model('Job', jobSchema);
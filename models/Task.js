const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  type: {
    type: String,
    enum: [
      'Document Upload',
      'Meeting',
      'Profile Update',
      'Form Fill',
      'Review',
      'Other'
    ],
    required: true
  },
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Completed', 'Cancelled'],
    default: 'Pending'
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium'
  },
  dueDate: {
    type: Date,
    required: true
  },
  candidateType: {
    type: String,
    enum: ['B2C', 'B2B'],
    required: true
  },
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  managedCandidateId: {
    type: mongoose.Schema.Types.ObjectId
  },
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdminUser',
    required: true
  },

  // extra task info
  requiredDocument: {
    type: String,
    enum: ['cv', 'passport', 'picture', 'drivingLicense'],
    required: false
  },
  completionNotes: String,
  completedAt: Date,
  completionFiles: [{
    fileName: String,
    fileUrl: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  relatedJob: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: false
  },

  relatedMeeting: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meeting'
  }

}, { timestamps: true });

module.exports = mongoose.model('Task', taskSchema);
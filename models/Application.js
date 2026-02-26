const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      return !this.agent; // user required only if agent is not submitting (if b2c)
    }
  },
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  status: {
    type: String,
    enum: ['Pending', 'In Review', 'Accepted', 'Rejected'],
    default: 'Pending'
  },
  coverLetter: {
    type: String
  },
  cv: {
    type: String
  },
  appliedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date
  },
  agent: { // New: For agent-submitted applications
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  candidateId: { // New: Link to managed candidate
    type: String
  }
}, { timestamps: true });

// New: Pre-save to update timestamp
applicationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Application = mongoose.model('Application', applicationSchema);

module.exports = Application;
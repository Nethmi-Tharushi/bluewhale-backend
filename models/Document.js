const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['photo', 'passport', 'drivingLicense', 'cv']
  },
  url: {
    type: String,
    required: true
  },
  originalName: { 
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  mimeType: { 
    type: String,
    required: true
  },
  cloudinaryId: {
    type: String,
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
    fromTask: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task'
  },
});

module.exports = mongoose.model('Document', documentSchema);
const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // B2C candidate or Agent (for B2B)
    required: true
  },
  salesAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdminUser',
    required: true
  },
  mainAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdminUser',
    required: true
  },
  title: { type: String, required: true },
  date: { type: Date, required: true },
  status: {
    type: String,
    enum: ['Scheduled', 'Completed', 'Canceled'],
    default: 'Scheduled'
  },
  locationType: {
    type: String,
    enum: ['Zoom', 'Google Meet', 'Microsoft Teams', 'Phone', 'Physical'],
    required: true
  },
  link: { type: String },
  location: { type: String },
  notes: { type: String },
  clientName: { type: String },
  reminderSent: { type: Boolean, default: false },
  
  candidateType: {
    type: String,
    enum: ['B2C', 'B2B'],
    default: 'B2C'
  },
  managedCandidateId: {
    type: String, // managed candidate ID
  },
  // CRM linking fields
  linkedLeadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    default: null,
    index: true,
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppConversation',
    default: null,
    index: true,
  },
  // Contact information fields (for matching and display)
  email: {
    type: String,
    default: '',
    trim: true,
    lowercase: true,
  },
  phone: {
    type: String,
    default: '',
    trim: true,
  },
  customerEmail: {
    type: String,
    default: '',
    trim: true,
    lowercase: true,
  },
  customerPhone: {
    type: String,
    default: '',
    trim: true,
  },
  customerName: {
    type: String,
    default: '',
    trim: true,
  },
  // Additional metadata
  assignee: {
    type: String,
    default: '',
    trim: true,
  },
  assignedPerson: {
    type: String,
    default: '',
    trim: true,
  },
  meetingDate: {
    type: Date,
    default: null,
  },
  scheduledAt: {
    type: Date,
    default: null,
  },
  meetingTime: {
    type: String,
    default: '',
    trim: true,
  },
  // CRM context wrapper
  crmContext: {
    linkedLeadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppConversation',
      default: null,
    },
  }
}, { timestamps: true });

module.exports = mongoose.model('Meeting', meetingSchema);

const mongoose = require('mongoose');

const jobInquirySchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    email: { type: String, required: true },
    category: { type: String, default: "General", trim: true },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    attachmentUrl: { type: String, default: "" },
    candidateType: {
      type: String,
      enum: ['B2C', 'B2B']
    },
    //For managed candidate inquiries
    managedCandidate: {
      candidateId: { type: String }, // managed candidate ID in agent's array
      agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } // Agent who made the inquiry
    },
    status: {
      type: String,
      enum: ['Pending', 'Responded'],
      default: 'Pending',
    },
    response: {
      message: { type: String },
      repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' },
      repliedAt: { type: Date },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('JobInquiry', jobInquirySchema);

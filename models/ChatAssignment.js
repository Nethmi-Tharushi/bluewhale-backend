const mongoose = require('mongoose');

const chatAssignmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', required: true },
  userRole: { type: String, enum: ['candidate', 'agent'], required: true },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  assignedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('ChatAssignment', chatAssignmentSchema);

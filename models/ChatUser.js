const mongoose = require('mongoose');

const chatUserSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  socketId: { type: String },
  role: { type: String, enum: ['user', 'admin'], required: true },
  isOnline: { type: Boolean, default: false },
  lastMessage: { type: String, default: '' },
  unreadCount: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('ChatUser', chatUserSchema);

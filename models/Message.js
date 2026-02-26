const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  content: { type: String, required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  senderType: { type: String, enum: ['user', 'admin'], required: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, required: true },
  recipientType: { type: String, enum: ['user', 'admin'], required: true },
  senderModel: { type: String, required: true },
  recipientModel: { type: String, required: true },
  senderName: { type: String, required: true },
  recipientName: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Message', messageSchema);

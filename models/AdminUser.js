// server/models/AdminUser.js
const mongoose = require('mongoose');

function generateApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const adminUserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ['MainAdmin', 'SalesAdmin', 'AgentAdmin'],
    required: true
  },

  // ✅ Settings Hub support (optional fields; safe defaults)
  settings: {
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: false },
    },
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system',
    },
    prefs: {
      language: { type: String, default: 'English' },
      timezone: { type: String, default: 'UTC+05:30' },
      currency: { type: String, default: 'USD' },
    },
  },

  // Single active API key (simple approach)
  apiKey: { type: String, default: generateApiKey },

  // Optional billing snapshot (placeholder - integrate Stripe later)
  billing: {
    plan: { type: String, default: 'Free' },
    nextBilling: { type: String, default: '' },
    cardLast4: { type: String, default: '' },
  },

  // Lightweight audit log (last N events)
  auditLogs: [
    {
      when: { type: Date, default: Date.now },
      what: { type: String, default: '' },
      who: { type: String, default: 'You' },
      ip: { type: String, default: '' },
    }
  ],
}, { timestamps: true });

module.exports = mongoose.model('AdminUser', adminUserSchema);

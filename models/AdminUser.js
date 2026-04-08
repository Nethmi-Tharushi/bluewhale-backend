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
  phone: { type: String, default: "" },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ['MainAdmin', 'SalesAdmin', 'SalesStaff', 'AgentAdmin'],
    required: true
  },
  reportsTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdminUser',
    default: null,
    index: true,
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
    rolePermissions: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    whatsappProfile: {
      logoUrl: { type: String, default: "" },
      logoCloudinaryId: { type: String, default: "" },
      displayName: { type: String, default: "" },
      description: { type: String, default: "" },
      businessType: { type: String, default: "" },
      contactPhone: { type: String, default: "" },
      contactEmail: { type: String, default: "" },
      website: { type: String, default: "" },
      address: { type: String, default: "" },
      verificationNote: { type: String, default: "" },
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

  whatsappInbox: {
    status: {
      type: String,
      enum: ['available', 'busy', 'offline'],
      default: 'available',
    },
    allowAutoAssignment: {
      type: Boolean,
      default: true,
    },
    lastAssignedAt: {
      type: Date,
      default: null,
    },
  },
}, { timestamps: true });

module.exports = mongoose.model('AdminUser', adminUserSchema);

const mongoose = require("mongoose");

const breakEntrySchema = new mongoose.Schema(
  {
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0, min: 0 },
    source: {
      type: String,
      enum: ["manual", "window_close"],
      default: "manual",
    },
  },
  { _id: false }
);

const adminWorkSessionSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    teamAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    role: {
      type: String,
      enum: ["MainAdmin", "SalesAdmin", "SalesStaff", "Receptionist", "AgentAdmin", "Accountant"],
      required: true,
      index: true,
    },
    loginAt: {
      type: Date,
      required: true,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: null,
      index: true,
    },
    currentState: {
      type: String,
      enum: ["working", "on_break", "ended"],
      default: "working",
      index: true,
    },
    currentBreakStartedAt: {
      type: Date,
      default: null,
    },
    currentBreakSource: {
      type: String,
      enum: ["manual", "window_close", null],
      default: null,
    },
    breakEntries: {
      type: [breakEntrySchema],
      default: [],
    },
    endedAt: {
      type: Date,
      default: null,
      index: true,
    },
    endReason: {
      type: String,
      enum: ["logout", "relogin", "forced", "expired", null],
      default: null,
    },
    activeSecondsSnapshot: {
      type: Number,
      default: 0,
      min: 0,
    },
    breakSecondsSnapshot: {
      type: Number,
      default: 0,
      min: 0,
    },
    loginIp: {
      type: String,
      default: "",
    },
    userAgent: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

adminWorkSessionSchema.index({ adminId: 1, endedAt: 1, loginAt: -1 });

module.exports = mongoose.model("AdminWorkSession", adminWorkSessionSchema);

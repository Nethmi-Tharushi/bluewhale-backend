const mongoose = require("mongoose");

const CONTACT_HUB_STATUS_OPTIONS = ["New Lead", "Qualified", "Follow-up", "Customer", "Inactive"];
const CONTACT_HUB_B2C_CONFIRMATION_OPTIONS = ["Confirmed", "Pending", "Requested", "Opted Out"];

const normalizePhoneValue = (value) => String(value || "").replace(/[^\d]/g, "");
const normalizeTags = (value) => {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const seen = new Set();
  const normalized = [];

  source.forEach((item) => {
    const tag = String(item || "").trim();
    if (!tag) return;

    const dedupeKey = tag.toLowerCase();
    if (seen.has(dedupeKey)) return;

    seen.add(dedupeKey);
    normalized.push(tag);
  });

  return normalized;
};

const whatsAppContactSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    normalizedPhone: {
      type: String,
      default: "",
      index: true,
      sparse: true,
    },
    name: {
      type: String,
      default: "",
      trim: true,
    },
    email: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: CONTACT_HUB_STATUS_OPTIONS,
      default: "New Lead",
      index: true,
    },
    accountOwner: {
      type: String,
      default: "",
      trim: true,
    },
    accountOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    waId: {
      type: String,
      default: "",
      index: true,
    },
    source: {
      type: String,
      default: "WhatsApp",
      trim: true,
      index: true,
    },
    b2cConfirmation: {
      type: String,
      enum: CONTACT_HUB_B2C_CONFIRMATION_OPTIONS,
      default: "Confirmed",
      index: true,
    },
    optedIn: {
      type: Boolean,
      default: true,
      index: true,
    },
    city: {
      type: String,
      default: "",
      trim: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    profile: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: null,
      index: true,
    },
    totalMessages: {
      type: Number,
      default: 0,
      min: 0,
    },
    externalContactId: {
      type: String,
      default: "",
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  { timestamps: true }
);

whatsAppContactSchema.pre("validate", function normalizeContactHubFields(next) {
  const normalizedPhone = normalizePhoneValue(this.phone || this.waId);
  if (normalizedPhone) {
    this.phone = normalizedPhone;
    this.normalizedPhone = normalizedPhone;
    if (!this.waId) {
      this.waId = normalizedPhone;
    }
  }

  this.tags = normalizeTags(this.tags);

  if (this.optedIn === false) {
    this.b2cConfirmation = "Opted Out";
  } else if (
    this.b2cConfirmation === "Opted Out"
    && this.isModified("optedIn")
    && this.optedIn === true
  ) {
    this.b2cConfirmation = "Confirmed";
  }

  next();
});

whatsAppContactSchema.index(
  { normalizedPhone: 1 },
  {
    unique: true,
    partialFilterExpression: {
      normalizedPhone: { $type: "string", $ne: "" },
    },
  }
);

whatsAppContactSchema.statics.CONTACT_HUB_STATUS_OPTIONS = CONTACT_HUB_STATUS_OPTIONS;
whatsAppContactSchema.statics.CONTACT_HUB_B2C_CONFIRMATION_OPTIONS = CONTACT_HUB_B2C_CONFIRMATION_OPTIONS;

module.exports = mongoose.model("WhatsAppContact", whatsAppContactSchema);

const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema(
  {
    teamAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    ownerAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    assignedAt: {
      type: Date,
      default: null,
      index: true,
    },
    leadNumber: {
      type: Number,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["Prospects", "Not Interested", "Follow-up Required", "Leads", "Paid Client", "Paid Clients", "Converted Leads"],
      default: "Leads",
      index: true,
    },
    source: {
      type: String,
      default: "Nothing selected",
      trim: true,
      index: true,
    },
    sourceDetails: {
      type: String,
      default: "",
      trim: true,
    },
    integrationKey: {
      type: String,
      default: "",
      trim: true,
      index: true,
      sparse: true,
      unique: true,
    },
    sourceMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    website: {
      type: String,
      default: "",
      trim: true,
    },
    address: {
      type: String,
      default: "",
      trim: true,
    },
    city: {
      type: String,
      default: "",
      trim: true,
    },
    state: {
      type: String,
      default: "",
      trim: true,
    },
    country: {
      type: String,
      default: "",
      trim: true,
    },
    zipCode: {
      type: String,
      default: "",
      trim: true,
    },
    leadValue: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: "AED",
      trim: true,
    },
    defaultLanguage: {
      type: String,
      default: "System Default",
      trim: true,
    },
    company: {
      type: String,
      default: "",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    assignmentHistory: {
      type: [
        {
          action: {
            type: String,
            enum: ["assigned", "reassigned", "unassigned"],
            default: "assigned",
          },
          assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
          },
          previousAssignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
          },
          assignedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
          },
          assignedAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      default: [],
    },
    lastContactAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

leadSchema.index({ teamAdmin: 1, ownerAdmin: 1, createdAt: -1 });
leadSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Lead", leadSchema);

const mongoose = require("mongoose");

const selectableOptionSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, default: "" },
    value: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const builderFieldSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["header", "paragraph", "text", "email", "phone", "number", "date", "textarea", "select", "file"],
      default: "text",
    },
    label: { type: String, trim: true, default: "" },
    fieldKey: { type: String, trim: true, default: "" },
    candidateField: { type: String, trim: true, default: "" },
    placeholder: { type: String, trim: true, default: "" },
    helperText: { type: String, trim: true, default: "" },
    content: { type: String, trim: true, default: "" },
    required: { type: Boolean, default: false },
    width: {
      type: String,
      enum: ["full", "half"],
      default: "full",
    },
    options: {
      type: [selectableOptionSchema],
      default: [],
    },
    acceptedFileTypes: {
      type: [String],
      default: [],
    },
    systemField: { type: Boolean, default: false },
  },
  { _id: false }
);

const notificationSchema = new mongoose.Schema(
  {
    notifyWhenNewCandidates: { type: Boolean, default: true },
    notifyMode: {
      type: String,
      enum: ["specific_staff_members", "staff_members_with_roles", "responsible_person"],
      default: "specific_staff_members",
    },
    specificStaffMembers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser",
      },
    ],
    staffRoles: {
      type: [String],
      default: [],
    },
    personInCharge: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  { _id: false }
);

const recruitmentChannelSchema = new mongoose.Schema(
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
    formName: { type: String, required: true, trim: true, index: true },
    formType: {
      type: String,
      enum: ["Candidate Profile", "Lead Capture", "General Recruitment"],
      default: "Candidate Profile",
    },
    status: {
      type: String,
      enum: ["Draft", "Active", "Inactive", "Archived"],
      default: "Draft",
      index: true,
    },
    language: { type: String, default: "English", trim: true },
    submitButtonText: { type: String, default: "Submit", trim: true },
    successMessage: { type: String, default: "Form submitted successfully", trim: true },
    responsiblePerson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
    notificationSettings: {
      type: notificationSchema,
      default: () => ({
        notifyWhenNewCandidates: true,
        notifyMode: "specific_staff_members",
        specificStaffMembers: [],
        staffRoles: [],
        personInCharge: null,
      }),
    },
    formSchema: {
      type: [builderFieldSchema],
      default: [],
    },
  },
  { timestamps: true }
);

recruitmentChannelSchema.index({ teamAdmin: 1, ownerAdmin: 1, createdAt: -1 });

module.exports = mongoose.model("RecruitmentChannel", recruitmentChannelSchema);

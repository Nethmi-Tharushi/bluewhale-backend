const mongoose = require("mongoose");

const projectPermissionSchema = new mongoose.Schema(
  {
    allowCustomerToViewTasks: { type: Boolean, default: true },
    allowCustomerToCreateTasks: { type: Boolean, default: true },
    allowCustomerToEditTasks: { type: Boolean, default: true },
    allowCustomerToCommentOnTasks: { type: Boolean, default: true },
    allowCustomerToViewTaskComments: { type: Boolean, default: true },
    allowCustomerToViewTaskAttachments: { type: Boolean, default: true },
    allowCustomerToViewTaskChecklistItems: { type: Boolean, default: true },
    allowCustomerToUploadAttachmentsOnTasks: { type: Boolean, default: true },
    allowCustomerToViewTaskTotalLoggedTime: { type: Boolean, default: true },
    allowCustomerToViewFinanceOverview: { type: Boolean, default: true },
    allowCustomerToUploadFiles: { type: Boolean, default: true },
    allowCustomerToOpenDiscussions: { type: Boolean, default: true },
    allowCustomerToViewMilestones: { type: Boolean, default: true },
    allowCustomerToViewGantt: { type: Boolean, default: true },
    allowCustomerToViewTimesheets: { type: Boolean, default: true },
    allowCustomerToViewActivityLog: { type: Boolean, default: true },
    allowCustomerToViewTeamMembers: { type: Boolean, default: true },
    hideProjectTasksOnMainTasksTable: { type: Boolean, default: false },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
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
    projectName: { type: String, required: true, trim: true },
    customer: {
      sourceId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      name: { type: String, required: true, trim: true },
      email: { type: String, default: "", trim: true, lowercase: true },
      phone: { type: String, default: "" },
      type: { type: String, enum: ["B2C", "B2B", "Other"], default: "Other" },
    },
    billingType: {
      type: String,
      enum: ["Fixed Rate", "Hourly Rate", "Project Hours"],
      default: "Fixed Rate",
    },
    status: {
      type: String,
      enum: ["Not Started", "In Progress", "On Hold", "Completed", "Cancelled"],
      default: "In Progress",
      index: true,
    },
    progressMode: {
      type: String,
      enum: ["tasks", "manual"],
      default: "manual",
    },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    totalRate: { type: Number, min: 0, default: 0 },
    estimatedHours: { type: Number, min: 0, default: 0 },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" }],
    startDate: { type: Date, required: true },
    deadline: { type: Date, default: null },
    tags: [{ type: String, trim: true }],
    description: { type: String, default: "" },
    sendCreatedEmail: { type: Boolean, default: false },
    settings: {
      sendContactsNotifications: {
        type: String,
        enum: [
          "enabled-contacts",
          "primary-contact-only",
          "assigned-team-only",
          "none",
        ],
        default: "enabled-contacts",
      },
      visibleTabs: {
        type: [
          {
            type: String,
            enum: [
              "Tasks",
              "Timesheets",
              "Milestones",
              "Files",
              "Discussions",
              "Gantt",
              "Tickets",
              "Contracts",
              "Invoices",
              "Payments",
            ],
          },
        ],
        default: ["Tasks", "Timesheets", "Milestones", "Files", "Discussions", "Gantt", "Tickets", "Contracts"],
      },
      permissions: {
        type: projectPermissionSchema,
        default: () => ({}),
      },
    },
  },
  { timestamps: true }
);

projectSchema.index({ teamAdmin: 1, ownerAdmin: 1, createdAt: -1 });

module.exports = mongoose.model("Project", projectSchema);

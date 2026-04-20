const mongoose = require("mongoose");

const salesTeamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: "",
    },
    ownerAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser",
        default: [],
      },
    ],
    settings: {
      inboxShowSameTeamMembersInAssigneeList: {
        type: Boolean,
        default: false,
      },
      contactsAllowTeamLeadAssignContactsToTeamMembers: {
        type: Boolean,
        default: true,
      },
      contactsAllowTeamLeadViewAssignedContacts: {
        type: Boolean,
        default: true,
      },
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

salesTeamSchema.index({ ownerAdmin: 1 }, { unique: true });

module.exports = mongoose.model("SalesTeam", salesTeamSchema);

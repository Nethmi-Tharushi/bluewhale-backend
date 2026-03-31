const mongoose = require("mongoose");

const whatsAppAssignmentStateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    lastAssignedAgentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
    selectionMode: {
      type: String,
      enum: ["all", "preferred"],
      default: "all",
    },
    preferredAgentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser",
      },
    ],
    autoAssignmentEnabled: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhatsAppAssignmentState", whatsAppAssignmentStateSchema);

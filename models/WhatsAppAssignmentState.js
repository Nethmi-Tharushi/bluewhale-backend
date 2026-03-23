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
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhatsAppAssignmentState", whatsAppAssignmentStateSchema);

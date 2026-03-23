const AdminUser = require("../models/AdminUser");
const WhatsAppAssignmentState = require("../models/WhatsAppAssignmentState");

const DEFAULT_AGENT_ROLES = ["MainAdmin", "SalesAdmin", "SalesStaff", "AgentAdmin"];

const getAvailableAgents = async () => {
  return AdminUser.find({
    role: { $in: DEFAULT_AGENT_ROLES },
    "whatsappInbox.allowAutoAssignment": true,
    "whatsappInbox.status": { $in: ["available", "busy"] },
  })
    .select("_id name email role whatsappInbox")
    .sort({ "whatsappInbox.lastAssignedAt": 1, createdAt: 1 })
    .lean();
};

const pickNextAgentRoundRobin = async () => {
  const agents = await getAvailableAgents();
  if (!agents.length) return null;

  const state = await WhatsAppAssignmentState.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default" } },
    { new: true, upsert: true }
  );

  let nextAgent = agents[0];
  if (state?.lastAssignedAgentId) {
    const lastIndex = agents.findIndex((agent) => String(agent._id) === String(state.lastAssignedAgentId));
    if (lastIndex >= 0) {
      nextAgent = agents[(lastIndex + 1) % agents.length];
    }
  }

  state.lastAssignedAgentId = nextAgent._id;
  await state.save();

  await AdminUser.findByIdAndUpdate(nextAgent._id, {
    $set: {
      "whatsappInbox.lastAssignedAt": new Date(),
    },
  });

  return nextAgent;
};

module.exports = {
  getAvailableAgents,
  pickNextAgentRoundRobin,
};

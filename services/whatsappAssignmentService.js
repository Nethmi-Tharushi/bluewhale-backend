const AdminUser = require("../models/AdminUser");
const WhatsAppAssignmentState = require("../models/WhatsAppAssignmentState");
const { Types } = require("mongoose");

const DEFAULT_AGENT_ROLES = ["SalesStaff"];
const DEFAULT_ASSIGNMENT_KEY = "default";

const ensureAssignmentState = async () =>
  WhatsAppAssignmentState.findOneAndUpdate(
    { key: DEFAULT_ASSIGNMENT_KEY },
    { $setOnInsert: { key: DEFAULT_ASSIGNMENT_KEY, selectionMode: "all", preferredAgentIds: [], autoAssignmentEnabled: true } },
    { new: true, upsert: true }
  );

const getAssignmentSettings = async () => {
  const state = await ensureAssignmentState();
  return {
    selectionMode: String(state?.selectionMode || "all") === "preferred" ? "preferred" : "all",
    preferredAgentIds: Array.isArray(state?.preferredAgentIds) ? state.preferredAgentIds.map((item) => String(item)) : [],
    lastAssignedAgentId: state?.lastAssignedAgentId ? String(state.lastAssignedAgentId) : "",
    autoAssignmentEnabled: state?.autoAssignmentEnabled !== false,
  };
};

const updateAssignmentSettings = async ({ selectionMode = "all", preferredAgentIds = [], autoAssignmentEnabled } = {}) => {
  const state = await ensureAssignmentState();
  state.selectionMode = String(selectionMode || "").trim().toLowerCase() === "preferred" ? "preferred" : "all";
  state.preferredAgentIds = Array.isArray(preferredAgentIds)
    ? preferredAgentIds
        .filter((value) => Types.ObjectId.isValid(String(value || "")))
        .map((value) => new Types.ObjectId(String(value)))
    : [];
  if (typeof autoAssignmentEnabled === "boolean") {
    state.autoAssignmentEnabled = autoAssignmentEnabled;
  }
  await state.save();
  return getAssignmentSettings();
};

const getAvailableAgents = async () => {
  const settings = await getAssignmentSettings();
  if (settings.autoAssignmentEnabled === false) return [];
  const agents = await AdminUser.find({
    role: { $in: DEFAULT_AGENT_ROLES },
    "whatsappInbox.allowAutoAssignment": true,
    "whatsappInbox.status": { $in: ["available", "busy"] },
  })
    .select("_id name email role whatsappInbox")
    .sort({ "whatsappInbox.lastAssignedAt": 1, createdAt: 1 })
    .lean();

  if (settings.selectionMode !== "preferred") return agents;

  const preferredIds = new Set(settings.preferredAgentIds.map((item) => String(item)));
  return agents.filter((agent) => preferredIds.has(String(agent._id)));
};

const pickNextAgentRoundRobin = async () => {
  const agents = await getAvailableAgents();
  if (!agents.length) return null;

  const state = await ensureAssignmentState();

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
  getAssignmentSettings,
  updateAssignmentSettings,
};

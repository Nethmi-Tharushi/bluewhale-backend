const User = require("../models/User");

const normalizeId = (value) => String(value || "").trim();
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const findByManagedCandidateId = async (candidateId) => {
  const id = normalizeId(candidateId);
  if (!id) return null;
  return User.findOne(
    { userType: "agent", "managedCandidates._id": id },
    { name: 1, email: 1, managedCandidates: { $elemMatch: { _id: id } } }
  ).lean();
};

const findByManagedCandidateEmail = async (candidateEmail) => {
  const email = normalizeEmail(candidateEmail);
  if (!email) return null;
  return User.findOne(
    { userType: "agent", "managedCandidates.email": email },
    { name: 1, email: 1, managedCandidates: { $elemMatch: { email } } }
  ).lean();
};

const resolveManagedCandidateNotificationTarget = async ({ candidateId, candidateEmail } = {}) => {
  let agent = await findByManagedCandidateId(candidateId);
  if (!agent) {
    agent = await findByManagedCandidateEmail(candidateEmail);
  }

  if (!agent || !Array.isArray(agent.managedCandidates) || agent.managedCandidates.length === 0) {
    return { isManagedCandidate: false };
  }

  const managedCandidate = agent.managedCandidates[0];
  return {
    isManagedCandidate: true,
    agentId: String(agent._id),
    agentName: agent.name || "Agent",
    agentEmail: normalizeEmail(agent.email),
    candidateId: normalizeId(managedCandidate._id || candidateId),
    candidateName: managedCandidate.name || "Managed Candidate",
    candidateEmail: normalizeEmail(managedCandidate.email || candidateEmail),
  };
};

module.exports = {
  resolveManagedCandidateNotificationTarget,
};

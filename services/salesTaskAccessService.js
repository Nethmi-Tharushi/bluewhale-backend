const Lead = require("../models/Lead");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const {
  hasFullSalesCandidateAccess,
  getVisibleSalesAssigneeIds,
  listAccessibleSalesCandidates,
} = require("./salesCandidateAccessService");

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const uniqueIds = (values) => [...new Set(values.map((value) => toIdString(value)).filter(Boolean))];

const listAccessibleSalesLeadIds = async (admin) => {
  if (!admin || hasFullSalesCandidateAccess(admin)) {
    return [];
  }

  const actorId = toIdString(admin._id);
  if (!actorId) {
    return [];
  }

  const leads = await Lead.find({ ownerAdmin: actorId }).select("_id").lean();
  return uniqueIds(leads.map((lead) => lead._id));
};

const listAccessibleSalesConversationIds = async (admin, options = {}) => {
  if (!admin || hasFullSalesCandidateAccess(admin)) {
    return [];
  }

  const visibleAssigneeIds = getVisibleSalesAssigneeIds(admin);
  const accessibleLeadIds = uniqueIds(options.accessibleLeadIds || []);
  const or = [];

  if (visibleAssigneeIds.length) {
    or.push({ agentId: { $in: visibleAssigneeIds } });
  }

  if (accessibleLeadIds.length) {
    or.push({ linkedLeadId: { $in: accessibleLeadIds } });
  }

  if (!or.length) {
    return [];
  }

  const conversations = await WhatsAppConversation.find({ $or: or }).select("_id").lean();
  return uniqueIds(conversations.map((conversation) => conversation._id));
};

const buildAccessibleSalesTaskAccess = async (admin) => {
  const accessibleCandidates = await listAccessibleSalesCandidates(admin);
  const b2cCandidateIds = [];
  const managedCandidateIds = [];

  accessibleCandidates.forEach((candidate) => {
    if (candidate.type === "B2C") {
      b2cCandidateIds.push(toIdString(candidate._id));
      return;
    }

    if (candidate.type === "B2B") {
      managedCandidateIds.push(toIdString(candidate._id));
    }
  });

  const accessibleLeadIds = await listAccessibleSalesLeadIds(admin);
  const accessibleConversationIds = await listAccessibleSalesConversationIds(admin, {
    accessibleLeadIds,
  });

  return {
    accessibleCandidates,
    b2cCandidateIds: uniqueIds(b2cCandidateIds),
    managedCandidateIds: uniqueIds(managedCandidateIds),
    accessibleLeadIds,
    accessibleConversationIds,
    taskFilter: {
      $or: [
        { candidateType: "B2C", candidate: { $in: uniqueIds(b2cCandidateIds) } },
        { candidateType: "B2B", managedCandidateId: { $in: uniqueIds(managedCandidateIds) } },
        { linkedLeadId: { $in: accessibleLeadIds } },
        { conversationId: { $in: accessibleConversationIds } },
      ],
    },
  };
};

module.exports = {
  buildAccessibleSalesTaskAccess,
  listAccessibleSalesLeadIds,
  listAccessibleSalesConversationIds,
};

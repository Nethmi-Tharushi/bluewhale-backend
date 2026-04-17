const asyncHandler = require("express-async-handler");
const Lead = require("../models/Lead");
const {
  CANONICAL_LEAD_STATUSES,
  buildLeadAccessFilter,
  formatLeadForApi,
  isSupportedLeadStatus,
  normalizeLeadSource,
  normalizeLeadStatus,
} = require("../utils/leadSupport");

const trimString = (value) => String(value || "").trim();
const WON_LEAD_STATUSES = new Set(["Converted Leads", "Paid Client"]);

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const startOfDay = (date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const endOfDay = (date) => {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
};

const resolveTimeframeRange = (timeframe) => {
  const normalized = trimString(timeframe).toLowerCase();
  if (!normalized || normalized === "all") return null;

  const now = new Date();

  switch (normalized) {
    case "today":
      return {
        $gte: startOfDay(now),
        $lte: endOfDay(now),
      };
    case "7d":
    case "last7days":
      return {
        $gte: startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)),
        $lte: endOfDay(now),
      };
    case "30d":
    case "last30days":
      return {
        $gte: startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)),
        $lte: endOfDay(now),
      };
    case "90d":
    case "last90days":
      return {
        $gte: startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89)),
        $lte: endOfDay(now),
      };
    case "month":
    case "thismonth":
      return {
        $gte: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
        $lte: endOfDay(now),
      };
    case "lastmonth":
      return {
        $gte: new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0),
        $lte: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
      };
    case "year":
    case "thisyear":
      return {
        $gte: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0),
        $lte: endOfDay(now),
      };
    default:
      return null;
  }
};

const buildReportsQuery = (req) => {
  const query = {
    ...buildLeadAccessFilter(req),
  };

  const owner = trimString(req.query.owner);
  if (owner) {
    query.assignedTo = owner;
  }

  const source = trimString(req.query.source);
  if (source) {
    query.source = normalizeLeadSource(source);
  }

  const stageTokens = trimString(req.query.stage)
    ? String(req.query.stage)
        .split(",")
        .map((item) => trimString(item))
        .filter(Boolean)
    : [];
  const normalizedStages = [...new Set(stageTokens.filter(isSupportedLeadStatus).map((item) => normalizeLeadStatus(item)))];
  if (normalizedStages.length === 1) {
    query.status = normalizedStages[0];
  } else if (normalizedStages.length > 1) {
    query.status = { $in: normalizedStages };
  }

  const dateField = trimString(req.query.dateField) === "lastContactAt" ? "lastContactAt" : "createdAt";
  const timeframeRange = resolveTimeframeRange(req.query.timeframe);
  if (timeframeRange) {
    query[dateField] = timeframeRange;
  }

  return { query, dateField };
};

const summarizeAgentPerformance = (leads = []) => {
  const grouped = new Map();

  leads.forEach((lead) => {
    const ownerId = trimString(lead?.assignedTo?._id) || "unassigned";
    const ownerName = trimString(lead?.assignedTo?.name) || "Unassigned";
    const current = grouped.get(ownerId) || {
      owner: ownerName,
      contacts: 0,
      totalValue: 0,
      won: 0,
    };

    current.contacts += 1;
    current.totalValue += toNumber(lead?.leadValue);
    if (WON_LEAD_STATUSES.has(normalizeLeadStatus(lead?.status))) {
      current.won += 1;
    }

    grouped.set(ownerId, current);
  });

  return [...grouped.values()]
    .map((item) => ({
      ...item,
      totalValue: Number(item.totalValue.toFixed(2)),
      conversionRate: item.contacts > 0 ? Number(((item.won / item.contacts) * 100).toFixed(2)) : 0,
    }))
    .sort((left, right) => right.totalValue - left.totalValue || right.contacts - left.contacts || left.owner.localeCompare(right.owner));
};

const summarizeSalesFunnel = (leads = []) =>
  CANONICAL_LEAD_STATUSES.map((stage) => {
    const stageLeads = leads.filter((lead) => normalizeLeadStatus(lead?.status) === stage);
    return {
      stage,
      contacts: stageLeads.length,
      totalValue: Number(stageLeads.reduce((sum, lead) => sum + toNumber(lead?.leadValue), 0).toFixed(2)),
    };
  });

const getSalesCrmReports = asyncHandler(async (req, res) => {
  const { query, dateField } = buildReportsQuery(req);

  const leads = await Lead.find(query)
    .populate("assignedTo", "name role")
    .sort({ [dateField]: -1, createdAt: -1 })
    .lean();

  const normalizedLeads = leads.map((lead) => formatLeadForApi(lead));
  const ownerIds = new Set(
    normalizedLeads
      .map((lead) => trimString(lead?.assignedTo?._id))
      .filter(Boolean)
  );

  const pipelineValue = normalizedLeads.reduce((sum, lead) => sum + toNumber(lead?.leadValue), 0);
  const wonConverted = normalizedLeads.filter((lead) => WON_LEAD_STATUSES.has(normalizeLeadStatus(lead?.status))).length;

  return res.json({
    success: true,
    data: {
      overview: {
        contacts: normalizedLeads.length,
        owners: ownerIds.size,
        wonConverted,
        pipelineValue: Number(pipelineValue.toFixed(2)),
      },
      agentPerformance: summarizeAgentPerformance(normalizedLeads),
      salesFunnel: summarizeSalesFunnel(normalizedLeads),
    },
  });
});

module.exports = {
  getSalesCrmReports,
};

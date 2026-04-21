const AdminUser = require("../models/AdminUser");
const SalesTeam = require("../models/SalesTeam");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppMessage = require("../models/WhatsAppMessage");

const toId = (value) => (value ? String(value) : "");

const isMainAdmin = (admin) => String(admin?.role || "") === "MainAdmin";
const isSalesAdmin = (admin) => String(admin?.role || "") === "SalesAdmin";

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

const parseOptionalDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const resolveDateRange = ({ range = "7d", from = "", to = "" } = {}) => {
  const normalizedRange = String(range || "7d").toLowerCase();
  const now = new Date();

  if (normalizedRange === "today") {
    return {
      range: "today",
      label: "Today",
      from: startOfDay(now),
      to: endOfDay(now),
    };
  }

  if (normalizedRange === "30d") {
    const fromDate = startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
    return {
      range: "30d",
      label: "Last 30 days",
      from: fromDate,
      to: endOfDay(now),
    };
  }

  if (normalizedRange === "custom") {
    const fromDate = parseOptionalDate(from);
    const toDate = parseOptionalDate(to);
    if (!fromDate || !toDate) {
      const error = new Error("Custom range requires both from and to dates");
      error.status = 400;
      throw error;
    }
    const fromBound = startOfDay(fromDate);
    const toBound = endOfDay(toDate);
    if (fromBound > toBound) {
      const error = new Error("Custom range is invalid: from date must be before to date");
      error.status = 400;
      throw error;
    }
    return {
      range: "custom",
      label: "Custom range",
      from: fromBound,
      to: toBound,
    };
  }

  const fromDate = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  return {
    range: "7d",
    label: "Last 7 days",
    from: fromDate,
    to: endOfDay(now),
  };
};

const resolveVisibleAgents = async ({ admin }) => {
  if (isMainAdmin(admin)) {
    return AdminUser.find({ role: "SalesStaff" })
      .select("_id name email role reportsTo")
      .sort({ name: 1 })
      .lean();
  }

  if (isSalesAdmin(admin)) {
    const team = await SalesTeam.findOne({ ownerAdmin: admin._id }).select("members").lean();
    const fromTeam = Array.isArray(team?.members) ? team.members.map((memberId) => toId(memberId)).filter(Boolean) : [];
    const reported = await AdminUser.find({ role: "SalesStaff", reportsTo: admin._id })
      .select("_id")
      .lean();
    const reportedIds = reported.map((row) => toId(row._id)).filter(Boolean);
    const targetIds = Array.from(new Set([...fromTeam, ...reportedIds])).filter(Boolean);
    if (!targetIds.length) return [];

    return AdminUser.find({ _id: { $in: targetIds }, role: "SalesStaff" })
      .select("_id name email role reportsTo")
      .sort({ name: 1 })
      .lean();
  }

  const error = new Error("Access denied");
  error.status = 403;
  throw error;
};

const safeDivide = (numerator, denominator) => {
  const n = Number(numerator || 0);
  const d = Number(denominator || 0);
  if (!d) return 0;
  return n / d;
};

const roundTo = (value, precision = 2) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  const factor = 10 ** precision;
  return Math.round(num * factor) / factor;
};

const buildAgentMetrics = (agent) => ({
  agentId: toId(agent?._id),
  name: String(agent?.name || "Unknown"),
  email: String(agent?.email || ""),
  role: String(agent?.role || ""),
  workload: {
    totalAssignedConversations: 0,
    activeConversations: 0,
    closedConversations: 0,
    workloadIndex: 0,
  },
  messaging: {
    inboundMessages: 0,
    outboundMessages: 0,
    totalMessages: 0,
  },
  response: {
    avgResponseSeconds: null,
    avgResponseMinutes: null,
    respondedCount: 0,
    responseRate: 0,
    fastResponsesWithin5m: 0,
    sla5mRate: 0,
  },
  efficiency: {
    score: 0,
    label: "Needs attention",
  },
});

const getEfficiencyLabel = (score) => {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Average";
  return "Needs attention";
};

const getWhatsAppAgentAnalytics = async ({ admin, query = {} }) => {
  const range = resolveDateRange({
    range: query.range,
    from: query.from,
    to: query.to,
  });

  const visibleAgents = await resolveVisibleAgents({ admin });
  const visibleAgentIds = visibleAgents.map((agent) => toId(agent._id));
  const requestedAgentId = toId(query.agentId);

  let selectedAgents = visibleAgents;
  if (requestedAgentId) {
    if (!visibleAgentIds.includes(requestedAgentId)) {
      const error = new Error("Selected agent is not accessible");
      error.status = 403;
      throw error;
    }
    selectedAgents = visibleAgents.filter((agent) => toId(agent._id) === requestedAgentId);
  }

  const selectedAgentIds = selectedAgents.map((agent) => toId(agent._id));
  if (!selectedAgentIds.length) {
    return {
      range: {
        key: range.range,
        label: range.label,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      filters: {
        agentId: requestedAgentId || null,
      },
      summary: {
        totalAgents: 0,
        activeAgents: 0,
        totalAssignedConversations: 0,
        activeConversations: 0,
        totalInboundMessages: 0,
        totalOutboundMessages: 0,
        averageResponseSeconds: null,
        averageResponseMinutes: null,
        overallSla5mRate: 0,
        averageEfficiencyScore: 0,
      },
      agents: [],
      trends: [],
      availableAgents: visibleAgents.map((agent) => ({
        _id: agent._id,
        name: agent.name || "",
        email: agent.email || "",
        role: agent.role || "",
      })),
    };
  }

  const agentMetricsMap = new Map(selectedAgents.map((agent) => [toId(agent._id), buildAgentMetrics(agent)]));
  const conversationDocs = await WhatsAppConversation.find({ agentId: { $in: selectedAgentIds } })
    .select("_id agentId status createdAt lastMessageAt")
    .lean();

  const conversationToAgentMap = new Map();
  const conversationIds = [];
  conversationDocs.forEach((conversation) => {
    const conversationId = toId(conversation?._id);
    const agentId = toId(conversation?.agentId);
    if (!conversationId || !agentId || !agentMetricsMap.has(agentId)) return;
    conversationToAgentMap.set(conversationId, agentId);
    conversationIds.push(conversationId);

    const metrics = agentMetricsMap.get(agentId);
    metrics.workload.totalAssignedConversations += 1;
    if (["open", "assigned"].includes(String(conversation?.status || "").toLowerCase())) {
      metrics.workload.activeConversations += 1;
    }
    if (String(conversation?.status || "").toLowerCase() === "closed") {
      metrics.workload.closedConversations += 1;
    }
  });

  const trendMap = new Map();
  const getTrendRow = (dateKey) => {
    if (!trendMap.has(dateKey)) {
      trendMap.set(dateKey, {
        date: dateKey,
        inboundMessages: 0,
        outboundMessages: 0,
        respondedCount: 0,
        responseSecondsTotal: 0,
      });
    }
    return trendMap.get(dateKey);
  };

  if (conversationIds.length) {
    const messages = await WhatsAppMessage.find({
      conversationId: { $in: conversationIds },
      timestamp: { $gte: range.from, $lte: range.to },
    })
      .select("conversationId direction sender agentId timestamp")
      .sort({ conversationId: 1, timestamp: 1, createdAt: 1 })
      .lean();

    const pendingInboundByConversation = new Map();

    messages.forEach((message) => {
      const conversationId = toId(message?.conversationId);
      const conversationAgentId = conversationToAgentMap.get(conversationId);
      if (!conversationAgentId || !agentMetricsMap.has(conversationAgentId)) return;

      const direction = String(message?.direction || "").toLowerCase();
      const timestamp = message?.timestamp ? new Date(message.timestamp) : null;
      if (!timestamp || Number.isNaN(timestamp.getTime())) return;

      if (direction === "inbound") {
        const metrics = agentMetricsMap.get(conversationAgentId);
        metrics.messaging.inboundMessages += 1;
        const trend = getTrendRow(toDateKey(timestamp));
        trend.inboundMessages += 1;

        if (!pendingInboundByConversation.has(conversationId)) {
          pendingInboundByConversation.set(conversationId, []);
        }
        pendingInboundByConversation.get(conversationId).push(timestamp);
        return;
      }

      if (direction !== "outbound") return;
      if (String(message?.sender || "").toLowerCase() !== "agent") return;

      const outboundAgentId = toId(message?.agentId) || conversationAgentId;
      const metrics = agentMetricsMap.get(outboundAgentId) || agentMetricsMap.get(conversationAgentId);
      if (!metrics) return;

      metrics.messaging.outboundMessages += 1;
      const trend = getTrendRow(toDateKey(timestamp));
      trend.outboundMessages += 1;

      const pendingInbound = pendingInboundByConversation.get(conversationId) || [];
      if (!pendingInbound.length) return;

      const inboundAt = pendingInbound.shift();
      if (!(inboundAt instanceof Date) || Number.isNaN(inboundAt.getTime())) return;

      const responseSeconds = Math.max(0, Math.round((timestamp.getTime() - inboundAt.getTime()) / 1000));
      metrics.response.respondedCount += 1;
      metrics.response.fastResponsesWithin5m += responseSeconds <= 300 ? 1 : 0;
      metrics.response._responseSecondsTotal = Number(metrics.response._responseSecondsTotal || 0) + responseSeconds;

      trend.respondedCount += 1;
      trend.responseSecondsTotal += responseSeconds;
    });
  }

  const agentRows = Array.from(agentMetricsMap.values()).map((metrics) => {
    const inbound = metrics.messaging.inboundMessages;
    const outbound = metrics.messaging.outboundMessages;
    const responded = metrics.response.respondedCount;
    const responseSecondsTotal = Number(metrics.response._responseSecondsTotal || 0);
    const avgResponseSeconds = responded ? roundTo(responseSecondsTotal / responded, 1) : null;
    const avgResponseMinutes = avgResponseSeconds !== null ? roundTo(avgResponseSeconds / 60, 2) : null;
    const responseRate = roundTo(safeDivide(responded, inbound) * 100, 2);
    const sla5mRate = roundTo(safeDivide(metrics.response.fastResponsesWithin5m, responded) * 100, 2);
    const efficiencyScore = Math.round((sla5mRate * 0.55) + (responseRate * 0.45));

    const workloadIndex = Number(
      (metrics.workload.activeConversations * 2) + inbound + outbound
    );

    return {
      ...metrics,
      workload: {
        ...metrics.workload,
        workloadIndex,
      },
      messaging: {
        ...metrics.messaging,
        totalMessages: inbound + outbound,
      },
      response: {
        avgResponseSeconds,
        avgResponseMinutes,
        respondedCount: responded,
        responseRate,
        fastResponsesWithin5m: metrics.response.fastResponsesWithin5m,
        sla5mRate,
      },
      efficiency: {
        score: efficiencyScore,
        label: getEfficiencyLabel(efficiencyScore),
      },
    };
  });

  agentRows.sort((left, right) => {
    if (right.workload.workloadIndex !== left.workload.workloadIndex) {
      return right.workload.workloadIndex - left.workload.workloadIndex;
    }
    return left.name.localeCompare(right.name);
  });

  const summaryAccumulator = agentRows.reduce(
    (accumulator, row) => {
      accumulator.totalAssignedConversations += row.workload.totalAssignedConversations;
      accumulator.activeConversations += row.workload.activeConversations;
      accumulator.totalInboundMessages += row.messaging.inboundMessages;
      accumulator.totalOutboundMessages += row.messaging.outboundMessages;
      accumulator.totalResponseSamples += row.response.respondedCount;
      accumulator.responseSecondsTotal += Number(row.response.avgResponseSeconds || 0) * row.response.respondedCount;
      accumulator.slaNumerator += row.response.fastResponsesWithin5m;
      accumulator.slaDenominator += row.response.respondedCount;
      accumulator.efficiencyScoreTotal += row.efficiency.score;
      if (row.messaging.totalMessages > 0 || row.workload.activeConversations > 0) {
        accumulator.activeAgents += 1;
      }
      return accumulator;
    },
    {
      totalAssignedConversations: 0,
      activeConversations: 0,
      totalInboundMessages: 0,
      totalOutboundMessages: 0,
      totalResponseSamples: 0,
      responseSecondsTotal: 0,
      slaNumerator: 0,
      slaDenominator: 0,
      efficiencyScoreTotal: 0,
      activeAgents: 0,
    }
  );

  const averageResponseSeconds = summaryAccumulator.totalResponseSamples
    ? roundTo(summaryAccumulator.responseSecondsTotal / summaryAccumulator.totalResponseSamples, 1)
    : null;

  const trends = Array.from(trendMap.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((row) => ({
      date: row.date,
      inboundMessages: row.inboundMessages,
      outboundMessages: row.outboundMessages,
      avgResponseSeconds: row.respondedCount
        ? roundTo(row.responseSecondsTotal / row.respondedCount, 1)
        : null,
      avgResponseMinutes: row.respondedCount
        ? roundTo((row.responseSecondsTotal / row.respondedCount) / 60, 2)
        : null,
      respondedCount: row.respondedCount,
    }));

  return {
    range: {
      key: range.range,
      label: range.label,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    },
    filters: {
      agentId: requestedAgentId || null,
    },
    summary: {
      totalAgents: agentRows.length,
      activeAgents: summaryAccumulator.activeAgents,
      totalAssignedConversations: summaryAccumulator.totalAssignedConversations,
      activeConversations: summaryAccumulator.activeConversations,
      totalInboundMessages: summaryAccumulator.totalInboundMessages,
      totalOutboundMessages: summaryAccumulator.totalOutboundMessages,
      averageResponseSeconds,
      averageResponseMinutes: averageResponseSeconds !== null ? roundTo(averageResponseSeconds / 60, 2) : null,
      overallSla5mRate: roundTo(safeDivide(summaryAccumulator.slaNumerator, summaryAccumulator.slaDenominator) * 100, 2),
      averageEfficiencyScore: agentRows.length
        ? roundTo(summaryAccumulator.efficiencyScoreTotal / agentRows.length, 0)
        : 0,
    },
    agents: agentRows,
    trends,
    availableAgents: visibleAgents.map((agent) => ({
      _id: agent._id,
      name: agent.name || "",
      email: agent.email || "",
      role: agent.role || "",
    })),
  };
};

module.exports = {
  getWhatsAppAgentAnalytics,
};

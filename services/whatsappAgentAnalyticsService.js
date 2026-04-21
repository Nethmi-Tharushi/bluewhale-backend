const AdminUser = require("../models/AdminUser");
const SalesTeam = require("../models/SalesTeam");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppContact = require("../models/WhatsAppContact");
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
  team: {
    teamId: "",
    teamName: "Unassigned",
    ownerId: "",
    ownerName: "Unassigned",
  },
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
  drillDown: {
    recentConversations: [],
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
      teams: [],
      trends: [],
      availableAgents: visibleAgents.map((agent) => ({
        _id: agent._id,
        name: agent.name || "",
        email: agent.email || "",
        role: agent.role || "",
      })),
    };
  }

  const selectedAgentIdSet = new Set(selectedAgentIds);
  const teams = await SalesTeam.find({
    $or: [
      { ownerAdmin: { $in: selectedAgentIds } },
      { members: { $in: selectedAgentIds } },
    ],
  })
    .select("_id name ownerAdmin members")
    .lean();

  const teamByMemberId = new Map();
  const ownerIds = new Set();
  teams.forEach((team) => {
    const ownerId = toId(team?.ownerAdmin);
    if (ownerId) ownerIds.add(ownerId);

    const members = Array.isArray(team?.members) ? team.members : [];
    members.forEach((memberId) => {
      const normalizedMemberId = toId(memberId);
      if (!normalizedMemberId || !selectedAgentIdSet.has(normalizedMemberId)) return;
      if (!teamByMemberId.has(normalizedMemberId)) {
        teamByMemberId.set(normalizedMemberId, team);
      }
    });
  });

  selectedAgents.forEach((agent) => {
    const reportsToId = toId(agent?.reportsTo);
    if (reportsToId) ownerIds.add(reportsToId);
  });

  const ownerDocs = ownerIds.size
    ? await AdminUser.find({
      _id: { $in: Array.from(ownerIds) },
      role: "SalesAdmin",
    })
      .select("_id name email")
      .lean()
    : [];
  const ownerMap = new Map(ownerDocs.map((owner) => [toId(owner?._id), owner]));

  const agentMetricsMap = new Map(selectedAgents.map((agent) => [toId(agent._id), buildAgentMetrics(agent)]));
  selectedAgents.forEach((agent) => {
    const agentId = toId(agent?._id);
    if (!agentId || !agentMetricsMap.has(agentId)) return;

    const team = teamByMemberId.get(agentId) || null;
    const ownerId = team ? toId(team?.ownerAdmin) : toId(agent?.reportsTo);
    const owner = ownerMap.get(ownerId) || null;
    const metrics = agentMetricsMap.get(agentId);

    metrics.team = {
      teamId: toId(team?._id),
      teamName: String(team?.name || owner?.name || "Unassigned"),
      ownerId,
      ownerName: String(owner?.name || "Unassigned"),
    };
  });

  const conversationDocs = await WhatsAppConversation.find({ agentId: { $in: selectedAgentIds } })
    .select("_id agentId contactId status createdAt lastMessageAt")
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

  const contactIds = Array.from(
    new Set(
      conversationDocs
        .map((conversation) => toId(conversation?.contactId))
        .filter(Boolean)
    )
  );
  const contactDocs = contactIds.length
    ? await WhatsAppContact.find({ _id: { $in: contactIds } })
      .select("_id name phone")
      .lean()
    : [];
  const contactMap = new Map(contactDocs.map((contact) => [toId(contact?._id), contact]));

  const recentConversationsByAgent = new Map(selectedAgentIds.map((agentId) => [agentId, []]));
  [...conversationDocs]
    .sort((left, right) => {
      const leftTime = new Date(left?.lastMessageAt || left?.createdAt || 0).getTime();
      const rightTime = new Date(right?.lastMessageAt || right?.createdAt || 0).getTime();
      return rightTime - leftTime;
    })
    .forEach((conversation) => {
      const agentId = toId(conversation?.agentId);
      if (!agentId || !recentConversationsByAgent.has(agentId)) return;
      const bucket = recentConversationsByAgent.get(agentId);
      if (bucket.length >= 5) return;
      bucket.push({
        conversationId: toId(conversation?._id),
        contactId: toId(conversation?.contactId),
        contactName: String(contactMap.get(toId(conversation?.contactId))?.name || "").trim(),
        contactPhone: String(contactMap.get(toId(conversation?.contactId))?.phone || "").trim(),
        status: String(conversation?.status || "").toLowerCase() || "open",
        lastMessageAt: conversation?.lastMessageAt || null,
        createdAt: conversation?.createdAt || null,
      });
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
      drillDown: {
        recentConversations: recentConversationsByAgent.get(metrics.agentId) || [],
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

  const teamAccumulatorMap = new Map();
  agentRows.forEach((row) => {
    const ownerId = toId(row?.team?.ownerId) || "unassigned";
    if (!teamAccumulatorMap.has(ownerId)) {
      teamAccumulatorMap.set(ownerId, {
        teamOwnerId: ownerId === "unassigned" ? "" : ownerId,
        teamOwnerName: String(row?.team?.ownerName || "Unassigned"),
        teamId: String(row?.team?.teamId || ""),
        teamName: String(row?.team?.teamName || "Unassigned"),
        memberCount: 0,
        totalAssignedConversations: 0,
        activeConversations: 0,
        totalInboundMessages: 0,
        totalOutboundMessages: 0,
        respondedCount: 0,
        responseSecondsTotal: 0,
        fastResponsesWithin5m: 0,
        efficiencyScoreTotal: 0,
        workloadIndexTotal: 0,
      });
    }

    const teamRow = teamAccumulatorMap.get(ownerId);
    teamRow.memberCount += 1;
    teamRow.totalAssignedConversations += Number(row?.workload?.totalAssignedConversations || 0);
    teamRow.activeConversations += Number(row?.workload?.activeConversations || 0);
    teamRow.totalInboundMessages += Number(row?.messaging?.inboundMessages || 0);
    teamRow.totalOutboundMessages += Number(row?.messaging?.outboundMessages || 0);
    teamRow.respondedCount += Number(row?.response?.respondedCount || 0);
    teamRow.responseSecondsTotal += Number(row?.response?.avgResponseSeconds || 0) * Number(row?.response?.respondedCount || 0);
    teamRow.fastResponsesWithin5m += Number(row?.response?.fastResponsesWithin5m || 0);
    teamRow.efficiencyScoreTotal += Number(row?.efficiency?.score || 0);
    teamRow.workloadIndexTotal += Number(row?.workload?.workloadIndex || 0);
  });

  const teamRows = Array.from(teamAccumulatorMap.values())
    .map((teamRow) => {
      const averageResponseSeconds = teamRow.respondedCount
        ? roundTo(teamRow.responseSecondsTotal / teamRow.respondedCount, 1)
        : null;
      const sla5mRate = roundTo(safeDivide(teamRow.fastResponsesWithin5m, teamRow.respondedCount) * 100, 2);
      const responseRate = roundTo(
        safeDivide(teamRow.respondedCount, teamRow.totalInboundMessages) * 100,
        2
      );
      const averageEfficiencyScore = teamRow.memberCount
        ? roundTo(teamRow.efficiencyScoreTotal / teamRow.memberCount, 0)
        : 0;

      return {
        ...teamRow,
        averageResponseSeconds,
        averageResponseMinutes: averageResponseSeconds !== null ? roundTo(averageResponseSeconds / 60, 2) : null,
        sla5mRate,
        responseRate,
        averageEfficiencyScore,
      };
    })
    .sort((left, right) => {
      if (right.workloadIndexTotal !== left.workloadIndexTotal) {
        return right.workloadIndexTotal - left.workloadIndexTotal;
      }
      return String(left.teamOwnerName || "").localeCompare(String(right.teamOwnerName || ""));
    });

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
    teams: teamRows,
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

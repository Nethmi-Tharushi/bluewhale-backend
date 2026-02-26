const User = require("../models/User");
const Task = require("../models/Task");
const Meeting = require("../models/Meeting");
const Application = require("../models/Application");
const Job = require("../models/Job");
const ActivityLog = require("../models/ActivityLog");

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT_MARGIN = 42;
const TOP_CONTENT_Y = 730;
const BOTTOM_LIMIT_Y = 70;

const escapePdfText = (text) =>
  String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const splitText = (text, maxChars = 86) => {
  const safe = String(text || "").trim();
  if (!safe) return [""];
  if (safe.length <= maxChars) return [safe];

  const words = safe.split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
};

const buildPdfFromPages = (pageStreams) => {
  const objects = [];
  const catalogObjNum = 1;
  const pagesObjNum = 2;
  const fontRegularObjNum = 3;
  const fontBoldObjNum = 4;

  objects.push(`${catalogObjNum} 0 obj << /Type /Catalog /Pages ${pagesObjNum} 0 R >> endobj`);
  objects.push(`${pagesObjNum} 0 obj << /Type /Pages /Kids [PAGES_KIDS] /Count ${pageStreams.length} >> endobj`);
  objects.push(`${fontRegularObjNum} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
  objects.push(`${fontBoldObjNum} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj`);

  const pageObjNums = [];
  let nextObjNum = 5;

  for (const stream of pageStreams) {
    const contentObjNum = nextObjNum++;
    const pageObjNum = nextObjNum++;
    pageObjNums.push(pageObjNum);

    objects.push(
      `${contentObjNum} 0 obj << /Length ${Buffer.byteLength(stream, "utf8")} >> stream\n${stream}\nendstream endobj`
    );

    objects.push(
      `${pageObjNum} 0 obj << /Type /Page /Parent ${pagesObjNum} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 ${fontRegularObjNum} 0 R /F2 ${fontBoldObjNum} 0 R >> >> >> endobj`
    );
  }

  const kids = pageObjNums.map((n) => `${n} 0 R`).join(" ");
  objects[1] = `${pagesObjNum} 0 obj << /Type /Pages /Kids [${kids}] /Count ${pageStreams.length} >> endobj`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${obj}\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root ${catalogObjNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
};

const buildReportPdfBuffer = ({ summary, sections, generatedAtText, generatedByText, kpiCards = [] }) => {
  const pages = [];
  let cmds = [];
  let y = TOP_CONTENT_Y;

  const startPage = () => {
    cmds = [];
    y = TOP_CONTENT_Y;

    cmds.push("0.06 0.20 0.47 rg 0 760 595 82 re f");
    cmds.push("0.12 0.36 0.78 rg 0 744 595 16 re f");
    cmds.push("0.15 0.44 0.89 rg 42 776 34 34 re f");
    cmds.push(`BT /F2 16 Tf 1 1 1 rg 49 788 Td (${escapePdfText("BW")}) Tj ET`);
    cmds.push(`BT /F2 22 Tf 1 1 1 rg 86 802 Td (${escapePdfText("BLUE WHALE MIGRATION")}) Tj ET`);
    cmds.push(`BT /F1 10 Tf 0.90 0.94 1 rg 86 786 Td (${escapePdfText("Comprehensive Operations Report")}) Tj ET`);
    cmds.push(`BT /F1 10 Tf 1 1 1 rg 42 750 Td (${escapePdfText(`Generated: ${generatedAtText}`)}) Tj ET`);
    cmds.push(`BT /F1 10 Tf 1 1 1 rg 360 750 Td (${escapePdfText(`Prepared by: ${generatedByText}`)}) Tj ET`);
  };

  const flushPage = () => {
    pages.push(cmds.join("\n"));
  };

  const ensureSpace = (need = 18) => {
    if (y - need < BOTTOM_LIMIT_Y) {
      flushPage();
      startPage();
    }
  };

  const addSectionTitle = (title) => {
    ensureSpace(30);
    cmds.push("0.13 0.32 0.70 rg 42 " + (y - 10) + " 8 16 re f");
    cmds.push(`BT /F2 14 Tf 0.11 0.18 0.33 rg 58 ${y} Td (${escapePdfText(title)}) Tj ET`);
    y -= 24;
  };

  const addLine = (text, opts = {}) => {
    const font = opts.bold ? "F2" : "F1";
    const size = opts.size || (opts.bold ? 11 : 10);
    const color = opts.color || "0.15 0.20 0.30";
    const indent = opts.indent || 0;
    const maxChars = opts.maxChars || 86;
    const lines = splitText(text, maxChars);

    for (const ln of lines) {
      ensureSpace(16);
      cmds.push(`BT /${font} ${size} Tf ${color} rg ${LEFT_MARGIN + indent} ${y} Td (${escapePdfText(ln)}) Tj ET`);
      y -= opts.step || 14;
    }
  };

  const addMetricRow = (label, value) => {
    ensureSpace(16);
    cmds.push(`BT /F2 10 Tf 0.10 0.21 0.44 rg 46 ${y} Td (${escapePdfText(label)}) Tj ET`);
    cmds.push(`BT /F1 10 Tf 0.14 0.14 0.14 rg 240 ${y} Td (${escapePdfText(String(value))}) Tj ET`);
    y -= 14;
  };

  const addKpiCards = (cards) => {
    if (!cards.length) return;
    ensureSpace(170);

    const cardW = 248;
    const cardH = 64;
    const gapX = 14;
    const gapY = 12;
    const startX = LEFT_MARGIN;

    cards.slice(0, 4).forEach((card, idx) => {
      const row = Math.floor(idx / 2);
      const col = idx % 2;
      const x = startX + col * (cardW + gapX);
      const yTop = y - row * (cardH + gapY);
      const yBottom = yTop - cardH;

      const bg = card.bgColor || "0.93 0.96 1.00";
      const badge = card.badgeColor || "0.16 0.42 0.84";
      const icon = card.iconText || "K";
      const deltaColor = card.isPositive ? "0.12 0.57 0.29" : "0.78 0.12 0.12";

      cmds.push(`${bg} rg ${x} ${yBottom} ${cardW} ${cardH} re f`);
      cmds.push("0.84 0.89 0.98 RG 1 w");
      cmds.push(`${x} ${yBottom} ${cardW} ${cardH} re S`);

      cmds.push(`${badge} rg ${x + 10} ${yTop - 24} 16 16 re f`);
      cmds.push(`BT /F2 9 Tf 1 1 1 rg ${x + 14} ${yTop - 13} Td (${escapePdfText(icon)}) Tj ET`);

      cmds.push(`BT /F2 10 Tf 0.12 0.20 0.34 rg ${x + 32} ${yTop - 13} Td (${escapePdfText(card.title)}) Tj ET`);
      cmds.push(`BT /F2 15 Tf 0.08 0.12 0.22 rg ${x + 12} ${yTop - 38} Td (${escapePdfText(String(card.value))}) Tj ET`);
      cmds.push(`BT /F1 10 Tf ${deltaColor} rg ${x + 12} ${yTop - 54} Td (${escapePdfText(String(card.change))}) Tj ET`);
    });

    y -= cardH * 2 + gapY + 10;
  };

  startPage();

  addSectionTitle("Executive Summary");
  addMetricRow("Total B2C Candidates", summary.totalB2CCandidates);
  addMetricRow("Total B2B Managed Candidates", summary.totalB2BManagedCandidates);
  addMetricRow("Total Leads (B2C + B2B)", summary.totalLeads);
  addMetricRow("Total Agents", summary.totalAgents);
  addMetricRow("Total Jobs", summary.totalJobs);
  addMetricRow("Active Jobs", summary.activeJobs);
  addMetricRow("Expired Jobs", summary.expiredJobs);
  addMetricRow("Total Applications", summary.totalApplications);
  addMetricRow("Open Tasks", summary.openTasks);
  addMetricRow("Overdue Tasks", summary.overdueTasks);
  addMetricRow("Upcoming Meetings", summary.upcomingMeetingsCount);
  y -= 8;

  addSectionTitle("Dashboard KPI Cards");
  addKpiCards(kpiCards);

  for (const section of sections) {
    addSectionTitle(section.title);

    if (section.metrics?.length) {
      for (const metric of section.metrics) {
        addMetricRow(metric.label, metric.value);
      }
      y -= 4;
    }

    if (section.items?.length) {
      for (const item of section.items) {
        addLine(`- ${item}`, { maxChars: 95 });
      }
    } else if (!section.metrics?.length) {
      addLine("No records available.");
    }

    y -= 14;
  }

  flushPage();
  return buildPdfFromPages(pages);
};

const formatDate = (date) => {
  if (!date) return "-";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
};

const toMonthBounds = (date = new Date()) => {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
};

const safePct = (num) => (Number.isFinite(num) ? num : 0);

const pctChange = (current, previous) => {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

const aggregateManagedCandidatesBetween = async (start, end) => {
  const result = await User.aggregate([
    { $match: { userType: "agent" } },
    { $unwind: "$managedCandidates" },
    {
      $match: {
        "managedCandidates.addedAt": { $gte: start, $lt: end },
      },
    },
    { $count: "count" },
  ]);
  return result[0]?.count || 0;
};

const aggregateRevenueBetween = async (start, end) => {
  const rows = await Application.aggregate([
    {
      $match: {
        status: "Accepted",
        appliedAt: { $gte: start, $lt: end },
      },
    },
    {
      $lookup: {
        from: "jobs",
        localField: "job",
        foreignField: "_id",
        as: "jobDoc",
      },
    },
    { $unwind: { path: "$jobDoc", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        total: { $sum: { $ifNull: ["$jobDoc.pricing.candidatePrice", 0] } },
      },
    },
  ]);
  return rows[0]?.total || 0;
};

const formatSignedPercent = (value) => {
  const n = Number(value || 0);
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
};

const computeDashboardSummaryData = async (now = new Date()) => {
  const { start: curStart, end: curEnd } = toMonthBounds(now);
  const { start: prevStart, end: prevEnd } = toMonthBounds(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const [
    totalB2CCandidates,
    agents,
    currentB2CLeads,
    previousB2CLeads,
    currentB2BLeads,
    previousB2BLeads,
    activeDealsNow,
    totalApplications,
    acceptedApplications,
    curMonthApplications,
    curMonthAccepted,
    prevMonthApplications,
    prevMonthAccepted,
    currentRevenue,
    previousRevenue,
  ] = await Promise.all([
    User.countDocuments({ userType: "candidate" }),
    User.find({ userType: "agent" }).select("managedCandidates"),
    User.countDocuments({ userType: "candidate", createdAt: { $gte: curStart, $lt: curEnd } }),
    User.countDocuments({ userType: "candidate", createdAt: { $gte: prevStart, $lt: prevEnd } }),
    aggregateManagedCandidatesBetween(curStart, curEnd),
    aggregateManagedCandidatesBetween(prevStart, prevEnd),
    Application.countDocuments({ status: { $in: ["Pending", "In Review"] } }),
    Application.countDocuments({}),
    Application.countDocuments({ status: "Accepted" }),
    Application.countDocuments({ appliedAt: { $gte: curStart, $lt: curEnd } }),
    Application.countDocuments({ status: "Accepted", appliedAt: { $gte: curStart, $lt: curEnd } }),
    Application.countDocuments({ appliedAt: { $gte: prevStart, $lt: prevEnd } }),
    Application.countDocuments({ status: "Accepted", appliedAt: { $gte: prevStart, $lt: prevEnd } }),
    aggregateRevenueBetween(curStart, curEnd),
    aggregateRevenueBetween(prevStart, prevEnd),
  ]);

  const totalB2BManagedCandidates = agents.reduce(
    (sum, agent) => sum + (Array.isArray(agent.managedCandidates) ? agent.managedCandidates.length : 0),
    0
  );
  const totalLeads = totalB2CCandidates + totalB2BManagedCandidates;

  const leadChange = pctChange(currentB2CLeads + currentB2BLeads, previousB2CLeads + previousB2BLeads);
  const activeDealsChange = pctChange(curMonthApplications, prevMonthApplications);
  const revenueChange = pctChange(currentRevenue, previousRevenue);

  const conversionRate = totalApplications ? (acceptedApplications / totalApplications) * 100 : 0;
  const currentConversion = curMonthApplications ? (curMonthAccepted / curMonthApplications) * 100 : 0;
  const previousConversion = prevMonthApplications ? (prevMonthAccepted / prevMonthApplications) * 100 : 0;
  const conversionChange = currentConversion - previousConversion;

  return {
    totalLeads,
    totalLeadsChange: safePct(leadChange),
    activeDeals: activeDealsNow,
    activeDealsChange: safePct(activeDealsChange),
    monthlyRevenue: currentRevenue,
    monthlyRevenueChange: safePct(revenueChange),
    conversionRate: safePct(conversionRate),
    conversionRateChange: safePct(conversionChange),
    totalB2CCandidates,
    totalB2BManagedCandidates,
    totalAgents: agents.length,
  };
};

const getDashboardSummary = async (req, res) => {
  try {
    const summary = await computeDashboardSummaryData(new Date());
    return res.json({
      success: true,
      data: summary,
    });
  } catch (err) {
    console.error("Error fetching dashboard summary:", err);
    return res.status(500).json({ message: "Failed to fetch dashboard summary" });
  }
};

const getStatusMap = (rows) => {
  const map = {};
  for (const r of rows || []) {
    map[r._id || "Unknown"] = r.count || 0;
  }
  return map;
};

const toMonthKey = (year, month) => `${year}-${String(month).padStart(2, "0")}`;

const getLastMonthBuckets = (count = 8, now = new Date()) => {
  const buckets = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    buckets.push({
      key: toMonthKey(year, month),
      label: d.toLocaleString("en-US", { month: "short" }),
      start: new Date(year, d.getMonth(), 1, 0, 0, 0, 0),
      end: new Date(year, d.getMonth() + 1, 1, 0, 0, 0, 0),
    });
  }
  return buckets;
};

const getReportsOverview = async (_req, res) => {
  try {
    const now = new Date();
    const summary = await computeDashboardSummaryData(now);
    const buckets = getLastMonthBuckets(8, now);
    const rangeStart = buckets[0].start;
    const rangeEnd = buckets[buckets.length - 1].end;

    const [
      totalApplications,
      placedCandidates,
      openJobPosts,
      agents,
      meetingsCount,
      directApplications,
      agentApplications,
      b2cLeadsRows,
      b2bLeadsRows,
      placedRows,
      agentPerformanceRows,
    ] = await Promise.all([
      Application.countDocuments({}),
      Application.countDocuments({ status: "Accepted" }),
      Job.countDocuments({ expiringAt: { $gte: now } }),
      User.find({ userType: "agent" }).select("name managedCandidates"),
      Meeting.countDocuments({}),
      Application.countDocuments({ user: { $ne: null } }),
      Application.countDocuments({ agent: { $ne: null } }),
      User.aggregate([
        {
          $match: {
            userType: "candidate",
            createdAt: { $gte: rangeStart, $lt: rangeEnd },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      User.aggregate([
        { $match: { userType: "agent" } },
        { $unwind: "$managedCandidates" },
        {
          $match: {
            "managedCandidates.addedAt": { $gte: rangeStart, $lt: rangeEnd },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$managedCandidates.addedAt" },
              month: { $month: "$managedCandidates.addedAt" },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      Application.aggregate([
        {
          $match: {
            status: "Accepted",
            appliedAt: { $gte: rangeStart, $lt: rangeEnd },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$appliedAt" },
              month: { $month: "$appliedAt" },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      Application.aggregate([
        { $match: { agent: { $ne: null } } },
        {
          $group: {
            _id: "$agent",
            total: { $sum: 1 },
            accepted: {
              $sum: {
                $cond: [{ $eq: ["$status", "Accepted"] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    const leadMap = {};
    const placedMap = {};
    for (const bucket of buckets) {
      leadMap[bucket.key] = 0;
      placedMap[bucket.key] = 0;
    }

    for (const row of b2cLeadsRows || []) {
      const key = toMonthKey(row?._id?.year, row?._id?.month);
      leadMap[key] = (leadMap[key] || 0) + (row?.count || 0);
    }
    for (const row of b2bLeadsRows || []) {
      const key = toMonthKey(row?._id?.year, row?._id?.month);
      leadMap[key] = (leadMap[key] || 0) + (row?.count || 0);
    }
    for (const row of placedRows || []) {
      const key = toMonthKey(row?._id?.year, row?._id?.month);
      placedMap[key] = (placedMap[key] || 0) + (row?.count || 0);
    }

    const leadsOverTime = buckets.map((bucket) => ({
      name: bucket.label,
      leads: Number(leadMap[bucket.key] || 0),
      placed: Number(placedMap[bucket.key] || 0),
    }));

    const leadSources = [
      { name: "Portal Signups", count: Number(summary.totalB2CCandidates || 0) },
      { name: "Agent Managed", count: Number(summary.totalB2BManagedCandidates || 0) },
      { name: "Direct Applies", count: Number(directApplications || 0) },
      { name: "Agent Applies", count: Number(agentApplications || 0) },
      { name: "Meetings", count: Number(meetingsCount || 0) },
    ];

    const perfMap = {};
    for (const row of agentPerformanceRows || []) {
      perfMap[String(row._id)] = {
        total: Number(row.total || 0),
        accepted: Number(row.accepted || 0),
      };
    }

    const agentPerformance = (agents || [])
      .map((agent) => {
        const managedCount = Array.isArray(agent.managedCandidates) ? agent.managedCandidates.length : 0;
        const perf = perfMap[String(agent._id)] || { total: 0, accepted: 0 };
        const successRate = perf.total > 0 ? (perf.accepted / perf.total) * 100 : 0;
        return {
          id: String(agent._id),
          name: agent.name || "Unknown Agent",
          activeCases: managedCount,
          successRate: `${successRate.toFixed(1)}%`,
          successRateValue: Number(successRate.toFixed(1)),
        };
      })
      .sort((a, b) => b.activeCases - a.activeCases)
      .slice(0, 8);

    return res.json({
      success: true,
      data: {
        cards: {
          totalCandidates: Number(summary.totalLeads || 0),
          placedCandidates: Number(placedCandidates || 0),
          activeAgents: Number((agents || []).length || 0),
          openJobPosts: Number(openJobPosts || 0),
          totalApplications: Number(totalApplications || 0),
        },
        leadsOverTime,
        leadSources,
        agentPerformance,
      },
    });
  } catch (err) {
    console.error("Error fetching reports overview:", err);
    return res.status(500).json({ message: "Failed to fetch reports overview" });
  }
};

const getFullReport = async (req, res) => {
  try {
    const now = new Date();
    const dashboardSummary = await computeDashboardSummaryData(now);

    const [
      b2cCandidates,
      agents,
      totalJobs,
      activeJobs,
      totalApplications,
      applicationsByStatusRows,
      tasksByStatusRows,
      tasksByPriorityRows,
      openTasks,
      overdueTasks,
      upcomingMeetings,
      meetingsByStatusRows,
      recentTasks,
      recentActivities,
    ] = await Promise.all([
      User.countDocuments({ userType: "candidate" }),
      User.find({ userType: "agent" }).select("name companyName managedCandidates"),
      Job.countDocuments({}),
      Job.countDocuments({ expiringAt: { $gte: now } }),
      Application.countDocuments({}),
      Application.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Task.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Task.aggregate([{ $group: { _id: "$priority", count: { $sum: 1 } } }]),
      Task.countDocuments({ status: { $nin: ["Completed", "Cancelled"] } }),
      Task.countDocuments({ dueDate: { $lt: now }, status: { $nin: ["Completed", "Cancelled"] } }),
      Meeting.find({ date: { $gte: now }, status: { $ne: "Canceled" } })
        .sort({ date: 1 })
        .limit(8)
        .select("title date status locationType clientName candidateType"),
      Meeting.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Task.find({})
        .sort({ createdAt: -1 })
        .limit(8)
        .select("title status priority dueDate candidateType"),
      ActivityLog.find({ admin: req.admin._id }).sort({ createdAt: -1 }).limit(12).select("title description type createdAt"),
    ]);

    const b2bManagedCandidates = agents.reduce(
      (sum, agent) => sum + (Array.isArray(agent.managedCandidates) ? agent.managedCandidates.length : 0),
      0
    );

    const totalLeads = b2cCandidates + b2bManagedCandidates;
    const totalAgents = agents.length;
    const expiredJobs = Math.max(totalJobs - activeJobs, 0);
    const upcomingMeetingsCount = upcomingMeetings.length;

    const applicationsByStatus = getStatusMap(applicationsByStatusRows);
    const tasksByStatus = getStatusMap(tasksByStatusRows);
    const tasksByPriority = getStatusMap(tasksByPriorityRows);
    const meetingsByStatus = getStatusMap(meetingsByStatusRows);

    const topAgents = agents
      .map((a) => ({
        name: a.name || "Unknown Agent",
        company: a.companyName || "N/A",
        count: Array.isArray(a.managedCandidates) ? a.managedCandidates.length : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const sections = [
      {
        title: "Dashboard KPI (Live Values)",
        metrics: [
          { label: "Total Leads", value: `${dashboardSummary.totalLeads} (${formatSignedPercent(dashboardSummary.totalLeadsChange)})` },
          { label: "Active Deals", value: `${dashboardSummary.activeDeals} (${formatSignedPercent(dashboardSummary.activeDealsChange)})` },
          {
            label: "Monthly Revenue",
            value: `${Number(dashboardSummary.monthlyRevenue || 0).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 0,
            })} (${formatSignedPercent(dashboardSummary.monthlyRevenueChange)})`,
          },
          {
            label: "Conversion Rate",
            value: `${Number(dashboardSummary.conversionRate || 0).toFixed(1)}% (${formatSignedPercent(
              dashboardSummary.conversionRateChange
            )})`,
          },
        ],
      },
      {
        title: "Candidate and Agent Breakdown",
        metrics: [
          { label: "B2C Candidate Count", value: b2cCandidates },
          { label: "B2B Managed Candidate Count", value: b2bManagedCandidates },
          { label: "Registered Agent Count", value: totalAgents },
        ],
        items: topAgents.map((a, i) => `Top Agent ${i + 1}: ${a.name} (${a.company}) - ${a.count} managed candidate(s)`),
      },
      {
        title: "Application Analytics",
        metrics: [
          { label: "Pending Applications", value: applicationsByStatus.Pending || 0 },
          { label: "In Review Applications", value: applicationsByStatus["In Review"] || 0 },
          { label: "Accepted Applications", value: applicationsByStatus.Accepted || 0 },
          { label: "Rejected Applications", value: applicationsByStatus.Rejected || 0 },
        ],
      },
      {
        title: "Task Analytics",
        metrics: [
          { label: "Pending Tasks", value: tasksByStatus.Pending || 0 },
          { label: "In Progress Tasks", value: tasksByStatus["In Progress"] || 0 },
          { label: "Completed Tasks", value: tasksByStatus.Completed || 0 },
          { label: "Cancelled Tasks", value: tasksByStatus.Cancelled || 0 },
          { label: "High Priority Tasks", value: tasksByPriority.High || 0 },
          { label: "Medium Priority Tasks", value: tasksByPriority.Medium || 0 },
          { label: "Low Priority Tasks", value: tasksByPriority.Low || 0 },
        ],
        items: recentTasks.map(
          (t, i) =>
            `Recent Task ${i + 1}: ${t.title || "Untitled"} | ${t.status || "-"} | ${t.priority || "-"} | Due: ${formatDate(
              t.dueDate
            )} | ${t.candidateType || "-"}`
        ),
      },
      {
        title: "Meeting Analytics",
        metrics: [
          { label: "Scheduled Meetings", value: meetingsByStatus.Scheduled || 0 },
          { label: "Completed Meetings", value: meetingsByStatus.Completed || 0 },
          { label: "Canceled Meetings", value: meetingsByStatus.Canceled || 0 },
        ],
        items: upcomingMeetings.map(
          (m, i) =>
            `Upcoming Meeting ${i + 1}: ${m.title || "Untitled"} | ${m.clientName || "N/A"} | ${formatDate(m.date)} | ${
              m.locationType || "-"
            } | ${m.candidateType || "-"}`
        ),
      },
      {
        title: "Recent Activity Timeline",
        items: recentActivities.map(
          (a, i) =>
            `Activity ${i + 1}: [${String(a.type || "system").toUpperCase()}] ${a.title || "Activity"} | ${
              a.description || "No description"
            } | ${formatDate(a.createdAt)}`
        ),
      },
      {
        title: "Conclusion and Action Notes",
        items: [
          "Use overdue tasks and pending applications as immediate follow-up priorities.",
          "Monitor top agents with higher managed-candidate loads for balanced distribution.",
          "Track scheduled meetings daily to avoid missed client milestones.",
          "Generate this report periodically to measure operational progress and compliance.",
        ],
      },
    ];

    const summary = {
      totalB2CCandidates: b2cCandidates,
      totalB2BManagedCandidates: b2bManagedCandidates,
      totalLeads,
      totalAgents,
      totalJobs,
      activeJobs,
      expiredJobs,
      totalApplications,
      openTasks,
      overdueTasks,
      upcomingMeetingsCount,
    };

    const kpiCards = [
      {
        title: "Total Leads",
        value: Number(dashboardSummary.totalLeads || 0).toLocaleString(),
        change: formatSignedPercent(dashboardSummary.totalLeadsChange),
        isPositive: Number(dashboardSummary.totalLeadsChange || 0) >= 0,
        iconText: "L",
        bgColor: "0.91 0.95 1.00",
        badgeColor: "0.16 0.42 0.84",
      },
      {
        title: "Active Deals",
        value: Number(dashboardSummary.activeDeals || 0).toLocaleString(),
        change: formatSignedPercent(dashboardSummary.activeDealsChange),
        isPositive: Number(dashboardSummary.activeDealsChange || 0) >= 0,
        iconText: "D",
        bgColor: "0.90 0.98 0.93",
        badgeColor: "0.10 0.72 0.33",
      },
      {
        title: "Monthly Revenue",
        value: Number(dashboardSummary.monthlyRevenue || 0).toLocaleString(undefined, {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }),
        change: formatSignedPercent(dashboardSummary.monthlyRevenueChange),
        isPositive: Number(dashboardSummary.monthlyRevenueChange || 0) >= 0,
        iconText: "$",
        bgColor: "0.95 0.92 1.00",
        badgeColor: "0.58 0.20 0.84",
      },
      {
        title: "Conversion Rate",
        value: `${Number(dashboardSummary.conversionRate || 0).toFixed(1)}%`,
        change: formatSignedPercent(dashboardSummary.conversionRateChange),
        isPositive: Number(dashboardSummary.conversionRateChange || 0) >= 0,
        iconText: "%",
        bgColor: "1.00 0.97 0.89",
        badgeColor: "0.94 0.62 0.08",
      },
    ];

    const pdfBuffer = buildReportPdfBuffer({
      summary,
      sections,
      generatedAtText: formatDate(now),
      generatedByText: `${req.admin?.name || "Admin"} (${req.admin?.role || "Admin"})`,
      kpiCards,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="full-report.pdf"');
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error("Error generating full report:", err);
    return res.status(500).json({ message: "Failed to generate report" });
  }
};

const getMigrationStatusSummary = async (_req, res) => {
  try {
    const statusOrder = ["Not Started", "Processing", "Approved", "Rejected", "Completed"];
    const statusColors = {
      "Not Started": "slate",
      Processing: "amber",
      Approved: "green",
      Rejected: "red",
      Completed: "blue",
    };

    const [b2cRows, b2bRows] = await Promise.all([
      User.aggregate([
        { $match: { userType: "candidate" } },
        { $group: { _id: "$visaStatus", count: { $sum: 1 } } },
      ]),
      User.aggregate([
        { $match: { userType: "agent" } },
        { $unwind: "$managedCandidates" },
        { $group: { _id: "$managedCandidates.visaStatus", count: { $sum: 1 } } },
      ]),
    ]);

    const counts = {};
    for (const s of statusOrder) counts[s] = 0;

    for (const r of b2cRows) {
      const key = r?._id || "Not Started";
      if (counts[key] === undefined) counts[key] = 0;
      counts[key] += r?.count || 0;
    }
    for (const r of b2bRows) {
      const key = r?._id || "Not Started";
      if (counts[key] === undefined) counts[key] = 0;
      counts[key] += r?.count || 0;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const data = statusOrder.map((status) => {
      const count = counts[status] || 0;
      const percentage = total ? (count / total) * 100 : 0;
      return {
        key: status,
        label: status,
        count,
        percentage: Number(percentage.toFixed(1)),
        tone: statusColors[status] || "slate",
      };
    });

    return res.json({
      success: true,
      data,
      total,
    });
  } catch (err) {
    console.error("Error fetching migration status summary:", err);
    return res.status(500).json({ message: "Failed to fetch migration status summary" });
  }
};

module.exports = { getFullReport, getDashboardSummary, getMigrationStatusSummary, getReportsOverview };

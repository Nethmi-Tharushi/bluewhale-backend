const asyncHandler = require("express-async-handler");
const AdminUser = require("../models/AdminUser");
const SalesTeam = require("../models/SalesTeam");
const Invoice = require("../models/Invoice");
const SalesTarget = require("../models/SalesTarget");
const SalesProposal = require("../models/SalesProposal");
const SalesEstimate = require("../models/SalesEstimate");
const {
  createInvoiceWithGeneratedNumber,
  normalizeInvoicePersistenceError,
} = require("../services/invoiceNumberService");
const { getSalesScope, buildOwnedFilter } = require("../utils/salesScope");

const PROPOSAL_STATUSES = ["Draft", "Sent", "Accepted", "Rejected", "Expired", "Converted"];
const ESTIMATE_STATUSES = ["Draft", "Sent", "Approved", "Rejected", "Expired", "Invoiced"];
const TARGET_STATUSES = ["Active", "Completed", "Archived"];

const toNum = (value) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
};

const parseItems = (items = []) => {
  const normalized = Array.isArray(items) ? items : [];
  if (normalized.length === 0) throw new Error("At least one line item is required");

  const rows = normalized.map((item) => {
    const quantity = toNum(item.quantity);
    const unitPrice = toNum(item.unitPrice);
    const discount = toNum(item.discount);
    const taxRate = toNum(item.taxRate);
    const base = quantity * unitPrice;
    const taxable = Math.max(base - discount, 0);
    const tax = taxable * (taxRate / 100);

    return {
      description: String(item.description || "").trim(),
      quantity,
      unitPrice,
      discount,
      taxRate,
      lineTotal: Number((taxable + tax).toFixed(2)),
    };
  });

  return {
    items: rows,
    subtotal: Number(rows.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0).toFixed(2)),
    discountTotal: Number(rows.reduce((sum, item) => sum + item.discount, 0).toFixed(2)),
    taxTotal: Number(
      rows.reduce((sum, item) => {
        const base = item.quantity * item.unitPrice;
        const taxable = Math.max(base - item.discount, 0);
        return sum + taxable * (item.taxRate / 100);
      }, 0).toFixed(2)
    ),
  };
};

const withTotals = (payload) => {
  const totals = parseItems(payload.items);
  return {
    ...totals,
    grandTotal: Number((totals.subtotal - totals.discountTotal + totals.taxTotal).toFixed(2)),
  };
};

const generateDocumentNumber = async (Model, prefix) => {
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const docPrefix = `${prefix}-${period}`;
  const pattern = new RegExp(`^${docPrefix}-\\d{4}$`);
  const latest = await Model.findOne({ [`${prefix === "PRP" ? "proposalNumber" : "estimateNumber"}`]: { $regex: pattern } })
    .sort({ createdAt: -1 })
    .lean();
  const latestNumber = latest?.proposalNumber || latest?.estimateNumber || "";
  const seq = latestNumber ? Number(String(latestNumber).split("-").pop()) + 1 : 1;
  return `${docPrefix}-${String(seq).padStart(4, "0")}`;
};

const normalizeTeamId = (value) => {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const mapAdminUser = (user) => ({
  _id: user?._id,
  name: user?.name || "",
  email: user?.email || "",
  role: user?.role || "",
  reportsTo: user?.reportsTo || null,
});

const mapTeamDoc = (team) => {
  const owner = team?.ownerAdmin && typeof team.ownerAdmin === "object" ? team.ownerAdmin : null;
  const members = Array.isArray(team?.members) ? team.members.filter(Boolean) : [];
  return {
    _id: team?._id,
    name: team?.name || `${owner?.name || "Team"} Team`,
    ownerAdminId: normalizeTeamId(team?.ownerAdmin),
    ownerAdmin: owner ? mapAdminUser(owner) : null,
    members: members.map((member) => mapAdminUser(member)),
    memberIds: members.map((member) => normalizeTeamId(member)),
    createdAt: team?.createdAt || null,
    updatedAt: team?.updatedAt || null,
  };
};

const loadTeamSnapshot = async (scope) => {
  const ownerQuery = scope.isMainAdmin
    ? { role: "SalesAdmin" }
    : scope.isSalesAdmin
    ? { _id: scope.actorId, role: "SalesAdmin" }
    : { _id: scope.actorId, role: { $in: ["SalesAdmin", "SalesStaff"] } };

  const staffQuery = scope.isMainAdmin
    ? { role: "SalesStaff" }
    : scope.isSalesAdmin
    ? { role: "SalesStaff", reportsTo: scope.actorId }
    : { _id: scope.actorId };

  const teamQuery = scope.isMainAdmin
    ? {}
    : scope.isSalesAdmin
    ? { ownerAdmin: scope.actorId }
    : {
        $or: [{ members: scope.actorId }, ...(scope.managerId ? [{ ownerAdmin: scope.managerId }] : [])],
      };

  const [owners, staff, teams] = await Promise.all([
    AdminUser.find(ownerQuery).select("_id name email role reportsTo").sort({ name: 1 }).lean(),
    AdminUser.find(staffQuery).select("_id name email role reportsTo").sort({ name: 1 }).lean(),
    SalesTeam.find(teamQuery)
      .populate("ownerAdmin", "_id name email role reportsTo")
      .populate("members", "_id name email role reportsTo")
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean(),
  ]);

  const ownerTeamMap = new Map();
  const memberTeamMap = new Map();
  const teamRows = teams.map((team) => {
    const row = mapTeamDoc(team);
    if (row.ownerAdminId) ownerTeamMap.set(row.ownerAdminId, row);
    row.memberIds.forEach((memberId) => {
      if (memberId) memberTeamMap.set(memberId, row);
    });
    return row;
  });

  const ownersWithTeam = owners.map((owner) => ({
    ...mapAdminUser(owner),
    teamName: ownerTeamMap.get(normalizeTeamId(owner._id))?.name || "",
    teamId: ownerTeamMap.get(normalizeTeamId(owner._id))?._id || null,
    teamMemberCount: ownerTeamMap.get(normalizeTeamId(owner._id))?.memberIds.length || 0,
  }));

  const staffWithTeam = staff.map((member) => {
    const team = memberTeamMap.get(normalizeTeamId(member._id)) || ownerTeamMap.get(normalizeTeamId(member.reportsTo));
    return {
      ...mapAdminUser(member),
      teamName: team?.name || "",
      teamId: team?._id || null,
      teamOwnerId: team?.ownerAdminId || normalizeTeamId(member.reportsTo) || null,
    };
  });

  const assignedStaffIds = new Set(
    teamRows.flatMap((team) => team.memberIds.map((memberId) => normalizeTeamId(memberId)).filter(Boolean))
  );
  const unassignedStaff = staffWithTeam.filter((member) => !assignedStaffIds.has(normalizeTeamId(member._id)));

  return {
    owners: ownersWithTeam,
    staff: staffWithTeam,
    teams: teamRows,
    unassignedStaff,
  };
};

const getTeamStaff = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const query = scope.isMainAdmin
    ? { role: { $in: ["SalesAdmin", "SalesStaff"] } }
    : scope.isSalesAdmin
    ? { $or: [{ _id: scope.actorId }, { reportsTo: scope.actorId, role: "SalesStaff" }] }
    : { _id: scope.actorId };

  const staff = await AdminUser.find(query).select("_id name email role reportsTo").sort({ name: 1 }).lean();
  return res.json({ success: true, data: staff });
});

const getTeams = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const snapshot = await loadTeamSnapshot(scope);
  return res.json({
    success: true,
    data: {
      role: scope.role,
      owners: snapshot.owners,
      staff: snapshot.staff,
      teams: snapshot.teams,
      unassignedStaff: snapshot.unassignedStaff,
    },
  });
});

const saveTeam = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const payload = req.body || {};
  const ownerAdminId = normalizeTeamId(payload.ownerAdminId || req.params.ownerId || scope.actorId);
  const name = String(payload.name || payload.teamName || "").trim();
  const memberIds = Array.from(
    new Set(
      (Array.isArray(payload.memberIds) ? payload.memberIds : Array.isArray(payload.members) ? payload.members : [])
        .map(normalizeTeamId)
        .filter(Boolean)
    )
  );

  const ownerAdmin = await AdminUser.findOne({ _id: ownerAdminId, role: "SalesAdmin" })
    .select("_id name email role reportsTo")
    .lean();
  if (!ownerAdmin) return res.status(404).json({ message: "SalesAdmin owner not found" });
  if (scope.isSalesAdmin && normalizeTeamId(ownerAdmin._id) !== normalizeTeamId(scope.actorId)) {
    return res.status(403).json({ message: "SalesAdmin can only manage their own team" });
  }

  const memberQuery = {
    _id: { $in: memberIds },
    role: "SalesStaff",
  };
  if (scope.isSalesAdmin && !scope.isMainAdmin) {
    memberQuery.reportsTo = ownerAdmin._id;
  }

  const members = memberIds.length
    ? await AdminUser.find(memberQuery).select("_id name email role reportsTo").sort({ name: 1 }).lean()
    : [];

  if (members.length !== memberIds.length) {
    return res.status(400).json({ message: "One or more selected members are invalid SalesStaff users" });
  }

  const team = await SalesTeam.findOneAndUpdate(
    { ownerAdmin: ownerAdmin._id },
    {
      $set: {
        name: name || `${ownerAdmin.name || "Team"} Team`,
        ownerAdmin: ownerAdmin._id,
        members: members.map((member) => member._id),
        updatedBy: scope.actorId,
      },
      $setOnInsert: {
        createdBy: scope.actorId,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
    .populate("ownerAdmin", "_id name email role reportsTo")
    .populate("members", "_id name email role reportsTo")
    .lean();

  return res.json({ success: true, data: mapTeamDoc(team) });
});

const deleteTeam = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const ownerAdminId = normalizeTeamId(req.params.ownerId || req.params.leaderId || req.body?.ownerAdminId);
  if (!ownerAdminId) return res.status(400).json({ message: "Team owner is required" });

  const ownerAdmin = await AdminUser.findOne({ _id: ownerAdminId, role: "SalesAdmin" }).select("_id role").lean();
  if (!ownerAdmin) return res.status(404).json({ message: "SalesAdmin owner not found" });
  if (scope.isSalesAdmin && normalizeTeamId(ownerAdmin._id) !== normalizeTeamId(scope.actorId)) {
    return res.status(403).json({ message: "SalesAdmin can only manage their own team" });
  }

  const result = await SalesTeam.deleteOne({ ownerAdmin: ownerAdmin._id });
  if (!result.deletedCount) return res.status(404).json({ message: "Team not found" });
  return res.json({ success: true, message: "Team deleted successfully" });
});

const getSalesOverview = asyncHandler(async (req, res) => {
  const filter = buildOwnedFilter(req, "ownerAdmin", "teamAdmin");

  const [targets, proposals, estimates, invoices] = await Promise.all([
    SalesTarget.find(filter).lean(),
    SalesProposal.find(filter).lean(),
    SalesEstimate.find(filter).lean(),
    Invoice.find(buildOwnedFilter(req, "salesAdmin", "teamAdmin")).lean(),
  ]);

  const targetTotal = targets.reduce((sum, item) => sum + toNum(item.targetAmount), 0);
  const paidRevenue = invoices.reduce((sum, item) => sum + toNum(item.paidAmount), 0);
  const openRevenue = invoices.reduce((sum, item) => sum + toNum(item.balanceDue), 0);
  const wonProposals = proposals.filter((item) => item.status === "Accepted").length;

  return res.json({
    success: true,
    data: {
      totalTargets: targets.length,
      targetAmount: Number(targetTotal.toFixed(2)),
      achievedAmount: Number(paidRevenue.toFixed(2)),
      openBalance: Number(openRevenue.toFixed(2)),
      proposalCount: proposals.length,
      estimateCount: estimates.length,
      invoiceCount: invoices.length,
      paymentCount: invoices.reduce((sum, item) => sum + (Array.isArray(item.payments) ? item.payments.length : 0), 0),
      proposalWins: wonProposals,
    },
  });
});

const listTargets = asyncHandler(async (req, res) => {
  const filter = buildOwnedFilter(req, "ownerAdmin", "teamAdmin");
  const targets = await SalesTarget.find(filter)
    .populate("ownerAdmin", "name email role")
    .sort({ periodStart: -1, createdAt: -1 })
    .lean();

  const invoiceFilter = buildOwnedFilter(req, "salesAdmin", "teamAdmin");
  const invoices = await Invoice.find(invoiceFilter).select("salesAdmin paidAmount").lean();
  const achievedMap = new Map();

  invoices.forEach((invoice) => {
    const key = String(invoice.salesAdmin || "");
    achievedMap.set(key, Number(((achievedMap.get(key) || 0) + toNum(invoice.paidAmount)).toFixed(2)));
  });

  const data = targets.map((target) => {
    const achievedAmount = achievedMap.get(String(target.ownerAdmin?._id || target.ownerAdmin || "")) || 0;
    return {
      ...target,
      achievedAmount,
      completionPercent: target.targetAmount > 0 ? Math.min(100, Number(((achievedAmount / target.targetAmount) * 100).toFixed(2))) : 0,
    };
  });

  return res.json({ success: true, data });
});

const createTarget = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const { title, description, targetAmount, periodStart, periodEnd, ownerAdminId, status } = req.body || {};

  if (!title || !periodStart || !periodEnd) return res.status(400).json({ message: "Title, period start, and period end are required" });
  if (toNum(targetAmount) <= 0) return res.status(400).json({ message: "Target amount must be greater than zero" });
  if (status && !TARGET_STATUSES.includes(status)) return res.status(400).json({ message: "Invalid target status" });

  const ownerAdmin = scope.isSalesStaff ? scope.actorId : ownerAdminId || scope.actorId;
  if (scope.isSalesAdmin && ownerAdminId) {
    const staff = await AdminUser.findOne({
      _id: ownerAdminId,
      $or: [{ _id: scope.actorId }, { reportsTo: scope.actorId, role: "SalesStaff" }],
    }).select("_id");
    if (!staff) return res.status(404).json({ message: "Selected staff member not found" });
  }
  if (scope.isMainAdmin && ownerAdminId) {
    const staff = await AdminUser.findOne({
      _id: ownerAdminId,
      role: { $in: ["MainAdmin", "SalesAdmin", "SalesStaff"] },
    }).select("_id");
    if (!staff) return res.status(404).json({ message: "Selected staff member not found" });
  }

  const target = await SalesTarget.create({
    teamAdmin: scope.managerId,
    ownerAdmin,
    createdBy: scope.actorId,
    title,
    description: description || "",
    targetAmount: toNum(targetAmount),
    periodStart,
    periodEnd,
    status: status || "Active",
  });

  return res.status(201).json({ success: true, data: target });
});

const deleteTarget = asyncHandler(async (req, res) => {
  const filter = { _id: req.params.id, ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin") };
  const target = await SalesTarget.findOneAndDelete(filter);
  if (!target) return res.status(404).json({ message: "Target not found" });
  return res.json({ success: true, message: "Target deleted successfully" });
});

const listProposals = asyncHandler(async (req, res) => {
  const proposals = await SalesProposal.find(buildOwnedFilter(req, "ownerAdmin", "teamAdmin"))
    .populate("ownerAdmin", "name email role")
    .populate("estimateId", "_id estimateNumber status")
    .sort({ createdAt: -1 })
    .lean();
  return res.json({ success: true, data: proposals });
});

const createProposal = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const body = req.body || {};
  const customer = body.customer || {};
  const status = body.status || "Draft";
  if (!customer.name || !customer.email || !body.title || !body.issueDate || !body.validUntil) {
    return res.status(400).json({ message: "Customer, title, issue date, and validity date are required" });
  }
  if (!PROPOSAL_STATUSES.includes(status)) return res.status(400).json({ message: "Invalid proposal status" });

  const totals = withTotals(body);
  const proposalNumber = await generateDocumentNumber(SalesProposal, "PRP");

  const proposal = await SalesProposal.create({
    proposalNumber,
    teamAdmin: scope.managerId,
    ownerAdmin: scope.actorId,
    createdBy: scope.actorId,
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone || "",
      company: customer.company || "",
      address: customer.address || "",
      candidateId: customer.candidateId || null,
      candidateType: customer.candidateType || "Other",
    },
    title: body.title,
    issueDate: body.issueDate,
    validUntil: body.validUntil,
    currency: body.currency || "USD",
    notes: body.notes || "",
    status,
    ...totals,
  });

  return res.status(201).json({ success: true, data: proposal });
});

const updateProposalStatus = asyncHandler(async (req, res) => {
  const proposal = await SalesProposal.findOne({
    _id: req.params.id,
    ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin"),
  });
  if (!proposal) return res.status(404).json({ message: "Proposal not found" });

  const { status } = req.body || {};
  if (!PROPOSAL_STATUSES.includes(status)) return res.status(400).json({ message: "Invalid proposal status" });
  proposal.status = status;
  await proposal.save();

  return res.json({ success: true, data: proposal });
});

const convertProposalToEstimate = asyncHandler(async (req, res) => {
  const proposal = await SalesProposal.findOne({
    _id: req.params.id,
    ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin"),
  });
  if (!proposal) return res.status(404).json({ message: "Proposal not found" });
  if (proposal.estimateId) return res.status(400).json({ message: "Proposal already converted to estimate" });

  const estimateNumber = await generateDocumentNumber(SalesEstimate, "EST");
  const estimate = await SalesEstimate.create({
    estimateNumber,
    teamAdmin: proposal.teamAdmin,
    ownerAdmin: proposal.ownerAdmin,
    createdBy: req.admin._id,
    proposalId: proposal._id,
    customer: proposal.customer,
    title: proposal.title,
    issueDate: proposal.issueDate,
    validUntil: proposal.validUntil,
    currency: proposal.currency,
    items: proposal.items,
    subtotal: proposal.subtotal,
    discountTotal: proposal.discountTotal,
    taxTotal: proposal.taxTotal,
    grandTotal: proposal.grandTotal,
    notes: proposal.notes,
    status: "Draft",
  });

  proposal.status = "Converted";
  proposal.estimateId = estimate._id;
  await proposal.save();

  return res.status(201).json({ success: true, data: estimate });
});

const listEstimates = asyncHandler(async (req, res) => {
  const estimates = await SalesEstimate.find(buildOwnedFilter(req, "ownerAdmin", "teamAdmin"))
    .populate("ownerAdmin", "name email role")
    .populate("proposalId", "_id proposalNumber status")
    .populate("invoiceId", "_id invoiceNumber status")
    .sort({ createdAt: -1 })
    .lean();
  return res.json({ success: true, data: estimates });
});

const createEstimate = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const body = req.body || {};
  const customer = body.customer || {};
  const status = body.status || "Draft";
  if (!customer.name || !customer.email || !body.title || !body.issueDate || !body.validUntil) {
    return res.status(400).json({ message: "Customer, title, issue date, and validity date are required" });
  }
  if (!ESTIMATE_STATUSES.includes(status)) return res.status(400).json({ message: "Invalid estimate status" });

  const totals = withTotals(body);
  const estimateNumber = await generateDocumentNumber(SalesEstimate, "EST");

  const estimate = await SalesEstimate.create({
    estimateNumber,
    teamAdmin: scope.managerId,
    ownerAdmin: scope.actorId,
    createdBy: scope.actorId,
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone || "",
      company: customer.company || "",
      address: customer.address || "",
      candidateId: customer.candidateId || null,
      candidateType: customer.candidateType || "Other",
    },
    title: body.title,
    issueDate: body.issueDate,
    validUntil: body.validUntil,
    currency: body.currency || "USD",
    notes: body.notes || "",
    status,
    ...totals,
  });

  return res.status(201).json({ success: true, data: estimate });
});

const updateEstimateStatus = asyncHandler(async (req, res) => {
  const estimate = await SalesEstimate.findOne({
    _id: req.params.id,
    ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin"),
  });
  if (!estimate) return res.status(404).json({ message: "Estimate not found" });

  const { status } = req.body || {};
  if (!ESTIMATE_STATUSES.includes(status)) return res.status(400).json({ message: "Invalid estimate status" });
  estimate.status = status;
  await estimate.save();

  return res.json({ success: true, data: estimate });
});

const convertEstimateToInvoice = asyncHandler(async (req, res) => {
  try {
    const estimate = await SalesEstimate.findOne({
      _id: req.params.id,
      ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin"),
    });
    if (!estimate) return res.status(404).json({ message: "Estimate not found" });
    if (estimate.invoiceId) return res.status(400).json({ message: "Estimate already invoiced" });

    const invoice = await createInvoiceWithGeneratedNumber({
      salesAdmin: estimate.ownerAdmin,
      teamAdmin: estimate.teamAdmin,
      customer: estimate.customer,
      issueDate: estimate.issueDate,
      dueDate: estimate.validUntil,
      currency: estimate.currency,
      items: estimate.items,
      subtotal: estimate.subtotal,
      discountTotal: estimate.discountTotal,
      taxTotal: estimate.taxTotal,
      grandTotal: estimate.grandTotal,
      paidAmount: 0,
      balanceDue: estimate.grandTotal,
      notes: estimate.notes,
      status: "Draft",
    });

    estimate.invoiceId = invoice._id;
    estimate.status = "Invoiced";
    await estimate.save();

    return res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    const normalizedError = normalizeInvoicePersistenceError(error, "Failed to convert estimate to invoice");
    return res.status(normalizedError?.statusCode || 500).json({
      message: normalizedError?.message || "Failed to convert estimate to invoice",
      details: normalizedError?.details || null,
    });
  }
});

const listPayments = asyncHandler(async (req, res) => {
  const invoices = await Invoice.find(buildOwnedFilter(req, "salesAdmin", "teamAdmin"))
    .select("invoiceNumber customer currency grandTotal paidAmount balanceDue status payments")
    .sort({ createdAt: -1 })
    .lean();

  const payments = invoices.flatMap((invoice) =>
    (invoice.payments || []).map((payment, index) => ({
      id: `${invoice._id}-${index}`,
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customer?.name || "",
      customerEmail: invoice.customer?.email || "",
      currency: invoice.currency,
      invoiceStatus: invoice.status,
      invoiceTotal: invoice.grandTotal,
      balanceDue: invoice.balanceDue,
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference,
      notes: payment.notes,
      proofUrl: payment.proofUrl,
      proofFileName: payment.proofFileName,
      paidAt: payment.paidAt,
    }))
  );

  return res.json({ success: true, data: payments.sort((a, b) => new Date(b.paidAt || 0) - new Date(a.paidAt || 0)) });
});

module.exports = {
  getTeamStaff,
  getTeams,
  saveTeam,
  deleteTeam,
  getSalesOverview,
  listTargets,
  createTarget,
  deleteTarget,
  listProposals,
  createProposal,
  updateProposalStatus,
  convertProposalToEstimate,
  listEstimates,
  createEstimate,
  updateEstimateStatus,
  convertEstimateToInvoice,
  listPayments,
};


const asyncHandler = require("express-async-handler");
const Invoice = require("../models/Invoice");
const User = require("../models/User");
const { buildInvoicePdfBuffer } = require("../services/invoicePdfService");
const { sendInvoiceEmail } = require("../services/emailService");
const { resolveManagedCandidateNotificationTarget } = require("../services/managedCandidateNotificationService");

const INVOICE_STATUSES = ["Draft", "Sent", "Paid", "Overdue", "Cancelled"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toNum = (v) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};

const ensureStatus = (invoice) => {
  if (!invoice) return invoice;
  if (invoice.status === "Sent" && invoice.dueDate && new Date(invoice.dueDate) < new Date() && toNum(invoice.balanceDue) > 0) {
    invoice.status = "Overdue";
  }
  return invoice;
};

const computeFinancials = (payload) => {
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (rawItems.length === 0) throw new Error("At least one invoice item is required");

  const items = rawItems.map((item) => {
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

  const subtotal = Number(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0).toFixed(2));
  const discountTotal = Number(items.reduce((sum, i) => sum + i.discount, 0).toFixed(2));
  const taxTotal = Number(
    items.reduce((sum, i) => {
      const base = i.quantity * i.unitPrice;
      const taxable = Math.max(base - i.discount, 0);
      return sum + taxable * (i.taxRate / 100);
    }, 0).toFixed(2)
  );
  const grandTotal = Number((subtotal - discountTotal + taxTotal).toFixed(2));
  const paidAmount = toNum(payload.paidAmount);
  const balanceDue = Number(Math.max(grandTotal - paidAmount, 0).toFixed(2));

  return { items, subtotal, discountTotal, taxTotal, grandTotal, paidAmount, balanceDue };
};

const generateInvoiceNumber = async () => {
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const pattern = new RegExp(`^${prefix}-\\d{4}$`);
  const latest = await Invoice.findOne({ invoiceNumber: { $regex: pattern } }).sort({ invoiceNumber: -1 }).select("invoiceNumber");
  const seq = latest ? Number(String(latest.invoiceNumber).split("-").pop()) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
};

const assertSalesAdmin = (req) => {
  if (!req.admin || req.admin.role !== "SalesAdmin") {
    const err = new Error("Access denied");
    err.statusCode = 403;
    throw err;
  }
};

const buildUserInvoiceFilter = async (req) => {
  const managedCandidateId = String(req.query?.managedCandidateId || "").trim();
  const userEmail = String(req.user?.email || "").trim().toLowerCase();
  const userId = req.user?._id;

  if (managedCandidateId) {
    const agent = await User.findById(userId).select("managedCandidates._id managedCandidates.email");
    if (!agent) {
      const err = new Error("Agent not found");
      err.statusCode = 404;
      throw err;
    }

    const managedCandidate = agent.managedCandidates?.id(managedCandidateId);
    if (!managedCandidate) {
      const err = new Error("Managed candidate not found");
      err.statusCode = 404;
      throw err;
    }

    const managedEmail = String(managedCandidate.email || "").trim().toLowerCase();
    const managedFilter = { $or: [{ "customer.candidateId": managedCandidateId }] };
    if (managedEmail) managedFilter.$or.push({ "customer.email": managedEmail });
    return managedFilter;
  }

  const filter = { $or: [] };
  if (userEmail) filter.$or.push({ "customer.email": userEmail });
  if (userId) filter.$or.push({ "customer.candidateId": userId });
  return filter;
};

const getUploadedProofFile = (req) => {
  if (req.file) return req.file;
  if (Array.isArray(req.files) && req.files.length > 0) return req.files[0];
  if (req.files && typeof req.files === "object") {
    const keys = ["paymentSlip", "slip", "proof", "file", "document", "image"];
    for (const key of keys) {
      if (Array.isArray(req.files[key]) && req.files[key].length > 0) return req.files[key][0];
    }
    const firstKey = Object.keys(req.files)[0];
    if (firstKey && Array.isArray(req.files[firstKey]) && req.files[firstKey].length > 0) {
      return req.files[firstKey][0];
    }
  }
  return null;
};

const toObjectMaybe = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return fallback;
};

const toArrayMaybe = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return fallback;
};

const getUploadedInvoiceFile = (req) => {
  if (req.file) return req.file;
  if (Array.isArray(req.files) && req.files.length > 0) return req.files[0];
  if (req.files && typeof req.files === "object") {
    const keys = ["attachment", "file", "document", "invoiceFile", "pdf"];
    for (const key of keys) {
      if (Array.isArray(req.files[key]) && req.files[key].length > 0) return req.files[key][0];
    }
    const firstKey = Object.keys(req.files)[0];
    if (firstKey && Array.isArray(req.files[firstKey]) && req.files[firstKey].length > 0) return req.files[firstKey][0];
  }
  return null;
};

const getLatestProof = (invoice) => {
  const payments = Array.isArray(invoice?.payments) ? invoice.payments : [];
  const latest = payments.length ? payments[payments.length - 1] : null;
  if (!latest) return null;
  return {
    paidAt: latest.paidAt || null,
    reference: latest.reference || "",
    notes: latest.notes || "",
    proofUrl: latest.proofUrl || "",
    proofFileName: latest.proofFileName || "",
  };
};

const createInvoice = asyncHandler(async (req, res) => {
  assertSalesAdmin(req);

  const body = req.body || {};
  const customer = toObjectMaybe(body.customer, {});
  const items = toArrayMaybe(body.items, []);
  const issueDate = body.issueDate;
  const dueDate = body.dueDate;
  const currency = body.currency || "USD";
  const notes = body.notes || "";
  const status = body.status || "Draft";
  const attachmentUrlFromBody = String(body.attachmentUrl || body.fileUrl || "").trim();
  const uploadedFile = getUploadedInvoiceFile(req);

  if (!customer.name || !customer.email) return res.status(400).json({ message: "Customer name and email are required" });
  if (!issueDate || !dueDate) return res.status(400).json({ message: "Issue date and due date are required" });
  if (!INVOICE_STATUSES.includes(status)) return res.status(400).json({ message: "Invalid invoice status" });

  const financials = computeFinancials({
    ...body,
    items,
    paidAmount: body.paidAmount,
  });
  const invoiceNumber = await generateInvoiceNumber();

  const invoice = await Invoice.create({
    invoiceNumber,
    salesAdmin: req.admin._id,
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone || "",
      address: customer.address || "",
      candidateId: customer.candidateId || null,
      candidateType: customer.candidateType || "Other",
    },
    issueDate,
    dueDate,
    currency,
    notes,
    attachmentUrl: uploadedFile?.path || attachmentUrlFromBody || "",
    attachmentFileName: uploadedFile?.originalname || "",
    status,
    ...financials,
    sentAt: status === "Sent" ? new Date() : null,
    paidAt: status === "Paid" ? new Date() : null,
  });

  return res.status(201).json({ success: true, data: ensureStatus(invoice.toObject()) });
});

const listInvoices = asyncHandler(async (req, res) => {
  assertSalesAdmin(req);
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
  const status = req.query.status;
  const q = String(req.query.q || "").trim();

  const filter = { salesAdmin: req.admin._id };
  if (status && INVOICE_STATUSES.includes(status)) filter.status = status;
  if (q) {
    filter.$or = [
      { invoiceNumber: { $regex: q, $options: "i" } },
      { "customer.name": { $regex: q, $options: "i" } },
      { "customer.email": { $regex: q, $options: "i" } },
    ];
  }

  const [rows, total] = await Promise.all([
    Invoice.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Invoice.countDocuments(filter),
  ]);

  const data = rows.map((row) => ensureStatus(row));
  return res.json({ success: true, page, limit, total, data });
});

const listUserInvoices = asyncHandler(async (req, res) => {
  const filter = await buildUserInvoiceFilter(req);
  if (filter.$or.length === 0) return res.status(400).json({ message: "User identity is required" });

  const rows = await Invoice.find(filter)
    .sort({ createdAt: -1 })
    .select("_id invoiceNumber status grandTotal currency dueDate payments")
    .lean();

  const invoices = rows.map((row) => {
    const normalized = ensureStatus(row);
    const latestProof = getLatestProof(normalized);
    return {
      _id: normalized._id,
      invoiceNumber: normalized.invoiceNumber,
      status: normalized.status,
      total: normalized.grandTotal,
      currency: normalized.currency,
      dueDate: normalized.dueDate,
      pdfUrl: `/api/users/invoices/${normalized._id}/pdf`,
      hasPaymentProof: !!latestProof,
      latestProof,
    };
  });

  return res.json({ success: true, invoices, data: invoices });
});

const getUserInvoiceById = asyncHandler(async (req, res) => {
  const filter = await buildUserInvoiceFilter(req);
  if (filter.$or.length === 0) return res.status(400).json({ message: "User identity is required" });

  const invoice = await Invoice.findOne({
    _id: req.params.id,
    ...filter,
  }).lean();

  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  const normalized = ensureStatus(invoice);
  const latestProof = getLatestProof(normalized);
  return res.json({
    success: true,
    data: {
      ...normalized,
      total: normalized.grandTotal,
      hasPaymentProof: !!latestProof,
      latestProof,
      pdfUrl: `/api/users/invoices/${normalized._id}/pdf`,
    },
  });
});

const downloadUserInvoicePdf = asyncHandler(async (req, res) => {
  const filter = await buildUserInvoiceFilter(req);
  if (filter.$or.length === 0) return res.status(400).json({ message: "User identity is required" });

  const invoice = await Invoice.findOne({
    _id: req.params.id,
    ...filter,
  }).lean();

  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  const pdfBuffer = buildInvoicePdfBuffer(invoice);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${invoice.invoiceNumber}.pdf"`);
  return res.status(200).send(pdfBuffer);
});

const submitUserPaymentProof = asyncHandler(async (req, res) => {
  const filter = await buildUserInvoiceFilter(req);
  if (filter.$or.length === 0) return res.status(400).json({ message: "User identity is required" });

  const invoice = await Invoice.findOne({
    _id: req.params.id,
    ...filter,
  });

  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  if (invoice.status === "Cancelled") return res.status(400).json({ message: "Cancelled invoice cannot accept payment proof" });

  const file = getUploadedProofFile(req);
  const reference = String(req.body?.reference || req.body?.paymentReference || "").trim();
  const notes = String(req.body?.notes || "").trim();

  if (!file && !reference && !notes) {
    return res.status(400).json({ message: "Provide payment slip, reference, or notes" });
  }

  invoice.payments.push({
    amount: 0,
    paidAt: new Date(),
    method: "ProofSubmitted",
    reference,
    notes,
    proofUrl: file?.path || "",
    proofFileName: file?.originalname || "",
  });

  if (invoice.status === "Draft") {
    invoice.status = "Sent";
    if (!invoice.sentAt) invoice.sentAt = new Date();
  }

  await invoice.save();

  return res.status(201).json({
    success: true,
    message: "Payment proof submitted successfully",
    data: {
      _id: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      status: ensureStatus(invoice.toObject()).status,
      latestProof: invoice.payments[invoice.payments.length - 1],
    },
  });
});

const getInvoiceById = asyncHandler(async (req, res) => {
  assertSalesAdmin(req);
  const invoice = await Invoice.findOne({ _id: req.params.id, salesAdmin: req.admin._id }).lean();
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  return res.json({ success: true, data: ensureStatus(invoice) });
});

const updateInvoice = asyncHandler(async (req, res) => {
  assertSalesAdmin(req);
  const invoice = await Invoice.findOne({ _id: req.params.id, salesAdmin: req.admin._id });
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  if (invoice.status !== "Draft") return res.status(400).json({ message: "Only Draft invoices can be edited" });

  const body = req.body || {};
  const customer = toObjectMaybe(body.customer, {});
  const issueDate = body.issueDate;
  const dueDate = body.dueDate;
  const currency = body.currency;
  const notes = body.notes;
  const items = toArrayMaybe(body.items, []);
  const attachmentUrlFromBody = String(body.attachmentUrl || body.fileUrl || "").trim();
  const uploadedFile = getUploadedInvoiceFile(req);

  if (customer.name) invoice.customer.name = customer.name;
  if (customer.email) invoice.customer.email = customer.email;
  if (customer.phone !== undefined) invoice.customer.phone = customer.phone;
  if (customer.address !== undefined) invoice.customer.address = customer.address;
  if (customer.candidateId !== undefined) invoice.customer.candidateId = customer.candidateId || null;
  if (customer.candidateType) invoice.customer.candidateType = customer.candidateType;

  if (issueDate) invoice.issueDate = issueDate;
  if (dueDate) invoice.dueDate = dueDate;
  if (currency) invoice.currency = currency;
  if (notes !== undefined) invoice.notes = notes;
  if (uploadedFile) {
    invoice.attachmentUrl = uploadedFile.path || "";
    invoice.attachmentFileName = uploadedFile.originalname || "";
  } else if (attachmentUrlFromBody) {
    invoice.attachmentUrl = attachmentUrlFromBody;
    if (body.attachmentFileName !== undefined) invoice.attachmentFileName = String(body.attachmentFileName || "");
  }

  const financials = computeFinancials({
    ...body,
    items,
    paidAmount: body.paidAmount,
  });
  invoice.items = financials.items;
  invoice.subtotal = financials.subtotal;
  invoice.discountTotal = financials.discountTotal;
  invoice.taxTotal = financials.taxTotal;
  invoice.grandTotal = financials.grandTotal;
  invoice.paidAmount = financials.paidAmount;
  invoice.balanceDue = financials.balanceDue;

  await invoice.save();
  return res.json({ success: true, data: ensureStatus(invoice.toObject()) });
});

const updateInvoiceStatus = asyncHandler(async (req, res) => {
  assertSalesAdmin(req);
  const { status } = req.body;
  if (!INVOICE_STATUSES.includes(status)) return res.status(400).json({ message: "Invalid invoice status" });

  const invoice = await Invoice.findOne({ _id: req.params.id, salesAdmin: req.admin._id });
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  invoice.status = status;
  if (status === "Sent" && !invoice.sentAt) invoice.sentAt = new Date();
  if (status === "Paid") {
    invoice.paidAt = new Date();
    invoice.paidAmount = invoice.grandTotal;
    invoice.balanceDue = 0;
  }
  if (status === "Cancelled") invoice.cancelledAt = new Date();

  await invoice.save();
  return res.json({ success: true, data: ensureStatus(invoice.toObject()) });
});

const markInvoicePaid = asyncHandler(async (req, res) => {
  assertSalesAdmin(req);
  const invoice = await Invoice.findOne({ _id: req.params.id, salesAdmin: req.admin._id });
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  if (invoice.status === "Cancelled") return res.status(400).json({ message: "Cancelled invoice cannot be paid" });

  const amount = toNum(req.body.amount || invoice.balanceDue);
  if (amount <= 0) return res.status(400).json({ message: "Payment amount must be greater than 0" });
  if (amount > invoice.balanceDue) return res.status(400).json({ message: "Payment amount exceeds balance due" });

  invoice.payments.push({
    amount,
    paidAt: req.body.paidAt || new Date(),
    method: req.body.method || "Manual",
    reference: req.body.reference || "",
    notes: req.body.notes || "",
  });
  invoice.paidAmount = Number((toNum(invoice.paidAmount) + amount).toFixed(2));
  invoice.balanceDue = Number(Math.max(toNum(invoice.grandTotal) - invoice.paidAmount, 0).toFixed(2));

  if (invoice.balanceDue === 0) {
    invoice.status = "Paid";
    invoice.paidAt = new Date();
  } else if (invoice.status === "Draft") {
    invoice.status = "Sent";
  }

  await invoice.save();
  return res.json({ success: true, data: ensureStatus(invoice.toObject()) });
});

const downloadInvoicePdf = asyncHandler(async (req, res) => {
  assertSalesAdmin(req);
  const invoice = await Invoice.findOne({ _id: req.params.id, salesAdmin: req.admin._id }).lean();
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  const pdfBuffer = buildInvoicePdfBuffer(invoice);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${invoice.invoiceNumber}.pdf"`);
  return res.status(200).send(pdfBuffer);
});

const sendInvoiceByEmail = asyncHandler(async (req, res) => {
  assertSalesAdmin(req);
  const invoice = await Invoice.findOne({ _id: req.params.id, salesAdmin: req.admin._id });
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  const requestedTo = String(req.body?.to || invoice.customer?.email || "").trim();
  const shouldResolveManagedTarget = String(invoice.customer?.candidateType || "").toUpperCase() !== "B2C";
  const managedTarget = shouldResolveManagedTarget
    ? await resolveManagedCandidateNotificationTarget({
        candidateId: invoice.customer?.candidateId,
        candidateEmail: invoice.customer?.email,
      })
    : { isManagedCandidate: false };

  // For managed candidates, always route to the owning agent email.
  const to = managedTarget.isManagedCandidate
    ? String(managedTarget.agentEmail || "").trim()
    : requestedTo;

  if (!to) return res.status(400).json({ message: "Recipient email is required" });
  if (!EMAIL_REGEX.test(to)) return res.status(400).json({ message: "Recipient email is invalid" });

  try {
    const pdfBuffer = buildInvoicePdfBuffer(invoice.toObject());
    await sendInvoiceEmail({
      to,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customer?.name,
      pdfBuffer,
      context: managedTarget.isManagedCandidate
        ? {
            targetType: "managedCandidate",
            agentName: managedTarget.agentName,
            candidateName: managedTarget.candidateName || invoice.customer?.name,
            candidateEmail: managedTarget.candidateEmail || invoice.customer?.email,
            candidateId: managedTarget.candidateId || String(invoice.customer?.candidateId || ""),
          }
        : undefined,
    });
  } catch (err) {
    return res.status(err?.statusCode || 500).json({
      message: err?.message || "Failed to send invoice email",
    });
  }

  if (invoice.status === "Draft") invoice.status = "Sent";
  if (!invoice.sentAt) invoice.sentAt = new Date();
  await invoice.save();

  return res.json({
    success: true,
    message: "Invoice email sent successfully",
    recipientEmail: to,
    data: ensureStatus(invoice.toObject()),
  });
});

module.exports = {
  createInvoice,
  listInvoices,
  listUserInvoices,
  getUserInvoiceById,
  downloadUserInvoicePdf,
  submitUserPaymentProof,
  getInvoiceById,
  updateInvoice,
  updateInvoiceStatus,
  markInvoicePaid,
  downloadInvoicePdf,
  sendInvoiceByEmail,
};

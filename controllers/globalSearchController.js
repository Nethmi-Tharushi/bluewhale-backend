const AdminUser = require("../models/AdminUser");
const Invoice = require("../models/Invoice");
const Lead = require("../models/Lead");
const Meeting = require("../models/Meeting");
const SalesEstimate = require("../models/SalesEstimate");
const SalesProposal = require("../models/SalesProposal");
const SalesTarget = require("../models/SalesTarget");
const Task = require("../models/Task");
const WhatsAppCampaign = require("../models/WhatsAppCampaign");
const WhatsAppContact = require("../models/WhatsAppContact");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppForm = require("../models/WhatsAppForm");
const WhatsAppProductCollection = require("../models/WhatsAppProductCollection");
const WhatsAppQuickReply = require("../models/WhatsAppQuickReply");
const { buildOwnedFilter, getSalesScope } = require("../utils/salesScope");
const { buildLeadAccessFilter } = require("../utils/leadSupport");

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const trimString = (value = "") => String(value || "").trim();

const buildTextSearch = (fields, query) => {
  const regex = new RegExp(escapeRegex(query), "i");
  return {
    $or: fields.map((field) => ({ [field]: regex })),
  };
};

const andFilters = (...filters) => {
  const parts = filters.filter((filter) => filter && Object.keys(filter).length > 0);
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts };
};

const toId = (value) => (value ? String(value?._id || value?.id || value) : "");

const formatWhen = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
};

const result = ({ type, label, title, subtitle = "", meta = "", path = "", icon = "Search", when = null }) => ({
  type,
  label,
  title: trimString(title),
  subtitle: trimString(subtitle),
  meta: trimString(meta),
  path,
  icon,
  when: formatWhen(when),
});

const getAccessibleAdminIdsForWhatsApp = async (scope) => {
  if (scope.isMainAdmin) return null;
  if (scope.isSalesStaff) return [scope.actorId];

  const staff = await AdminUser.find({ role: "SalesStaff", reportsTo: scope.actorId }).select("_id").lean();
  return [scope.actorId, ...staff.map((member) => member._id)];
};

const searchLeads = async (req, query, limit) => {
  const rows = await Lead.find(andFilters(
    buildLeadAccessFilter(req),
    buildTextSearch(["name", "email", "phone", "company", "source", "sourceDetails", "description", "tags"], query)
  ))
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return rows.map((lead) =>
    result({
      type: "lead",
      label: "Lead",
      title: lead.name || lead.company || `Lead #${lead.leadNumber}`,
      subtitle: [lead.company, lead.email, lead.phone].filter(Boolean).join(" - "),
      meta: [lead.status, lead.source].filter(Boolean).join(" - "),
      path: `/sales-dashboard/leads?search=${encodeURIComponent(query)}`,
      icon: "Users",
      when: lead.updatedAt || lead.createdAt,
    })
  );
};

const searchInvoices = async (req, query, limit) => {
  const rows = await Invoice.find(andFilters(
    buildOwnedFilter(req, "salesAdmin", "teamAdmin"),
    buildTextSearch(["invoiceNumber", "customer.name", "customer.email", "customer.phone", "notes", "status"], query)
  ))
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return rows.map((invoice) =>
    result({
      type: "invoice",
      label: "Invoice",
      title: invoice.invoiceNumber,
      subtitle: [invoice.customer?.name, invoice.customer?.email].filter(Boolean).join(" - "),
      meta: `${invoice.status || "Draft"} - ${invoice.currency || ""} ${Number(invoice.balanceDue || invoice.grandTotal || 0).toLocaleString()}`,
      path: "/sales-dashboard/invoices",
      icon: "Receipt",
      when: invoice.updatedAt || invoice.createdAt,
    })
  );
};

const searchSalesDocuments = async (req, query, limit) => {
  const ownedFilter = buildOwnedFilter(req, "ownerAdmin", "teamAdmin");
  const textFields = ["title", "customer.name", "customer.email", "customer.phone", "customer.company", "notes", "status"];
  const [proposals, estimates, targets] = await Promise.all([
    SalesProposal.find(andFilters(
      ownedFilter,
      buildTextSearch(["proposalNumber", ...textFields], query)
    )).sort({ updatedAt: -1 }).limit(limit).lean(),
    SalesEstimate.find(andFilters(
      ownedFilter,
      buildTextSearch(["estimateNumber", ...textFields], query)
    )).sort({ updatedAt: -1 }).limit(limit).lean(),
    SalesTarget.find(andFilters(
      ownedFilter,
      buildTextSearch(["title", "description", "status"], query)
    )).sort({ updatedAt: -1 }).limit(limit).lean(),
  ]);

  return [
    ...proposals.map((proposal) =>
      result({
        type: "proposal",
        label: "Proposal",
        title: proposal.proposalNumber || proposal.title,
        subtitle: [proposal.title, proposal.customer?.name, proposal.customer?.email].filter(Boolean).join(" - "),
        meta: `${proposal.status || "Draft"} - ${proposal.currency || ""} ${Number(proposal.grandTotal || 0).toLocaleString()}`,
        path: "/sales-dashboard/proposals",
        icon: "FileBadge2",
        when: proposal.updatedAt || proposal.createdAt,
      })
    ),
    ...estimates.map((estimate) =>
      result({
        type: "estimate",
        label: "Estimate",
        title: estimate.estimateNumber || estimate.title,
        subtitle: [estimate.title, estimate.customer?.name, estimate.customer?.email].filter(Boolean).join(" - "),
        meta: `${estimate.status || "Draft"} - ${estimate.currency || ""} ${Number(estimate.grandTotal || 0).toLocaleString()}`,
        path: "/sales-dashboard/estimates",
        icon: "FileSpreadsheet",
        when: estimate.updatedAt || estimate.createdAt,
      })
    ),
    ...targets.map((target) =>
      result({
        type: "target",
        label: "Target",
        title: target.title,
        subtitle: target.description,
        meta: `${target.status || "Active"} - ${Number(target.targetAmount || 0).toLocaleString()}`,
        path: "/sales-dashboard/targets",
        icon: "Target",
        when: target.updatedAt || target.createdAt,
      })
    ),
  ];
};

const searchPayments = async (req, query, limit) => {
  const rows = await Invoice.find(andFilters(
    buildOwnedFilter(req, "salesAdmin", "teamAdmin"),
    buildTextSearch(["invoiceNumber", "customer.name", "customer.email", "payments.method", "payments.reference", "payments.notes"], query)
  ))
    .select("invoiceNumber customer currency status payments updatedAt createdAt")
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return rows.flatMap((invoice) =>
    (invoice.payments || [])
      .filter((payment) => {
        const haystack = [invoice.invoiceNumber, invoice.customer?.name, invoice.customer?.email, payment.method, payment.reference, payment.notes]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
      .slice(0, 2)
      .map((payment) =>
        result({
          type: "payment",
          label: "Payment",
          title: invoice.invoiceNumber,
          subtitle: [invoice.customer?.name, payment.method, payment.reference].filter(Boolean).join(" - "),
          meta: `${invoice.currency || ""} ${Number(payment.amount || 0).toLocaleString()}`,
          path: "/sales-dashboard/payments",
          icon: "Wallet",
          when: payment.paidAt || invoice.updatedAt || invoice.createdAt,
        })
      )
  );
};

const searchTasks = async (req, query, limit) => {
  const scope = getSalesScope(req);
  const leadAccess = await Lead.find(buildLeadAccessFilter(req)).select("_id").lean();
  const accessibleLeadIds = leadAccess.map((lead) => lead._id);
  const taskAccess =
    scope.isSalesStaff
      ? { $or: [{ assignedBy: scope.actorId }, { linkedLeadId: { $in: accessibleLeadIds } }] }
      : scope.isMainAdmin
        ? {}
        : { $or: [{ assignedBy: scope.actorId }, { linkedLeadId: { $in: accessibleLeadIds } }] };

  const rows = await Task.find(andFilters(
    taskAccess,
    buildTextSearch(["title", "description", "status", "priority", "type", "completionNotes"], query)
  ))
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return rows.map((task) =>
    result({
      type: "task",
      label: "Task",
      title: task.title,
      subtitle: task.description || task.type,
      meta: [task.status, task.priority].filter(Boolean).join(" - "),
      path: "/sales-dashboard/tasks",
      icon: "ClipboardCheck",
      when: task.updatedAt || task.createdAt,
    })
  );
};

const searchMeetings = async (req, query, limit) => {
  const scope = getSalesScope(req);
  const filter = scope.isMainAdmin ? {} : { salesAdmin: scope.actorId };
  const rows = await Meeting.find(andFilters(
    filter,
    buildTextSearch(["title", "notes", "clientName", "customerName", "customerEmail", "customerPhone", "email", "phone", "status", "location"], query)
  ))
    .sort({ date: -1 })
    .limit(limit)
    .lean();

  return rows.map((meeting) =>
    result({
      type: "meeting",
      label: "Meeting",
      title: meeting.title,
      subtitle: [meeting.customerName || meeting.clientName, meeting.customerEmail || meeting.email].filter(Boolean).join(" - "),
      meta: [meeting.status, meeting.locationType].filter(Boolean).join(" - "),
      path: "/sales-dashboard/meetings",
      icon: "CalendarDays",
      when: meeting.date || meeting.updatedAt,
    })
  );
};

const searchWhatsApp = async (req, query, limit) => {
  const scope = getSalesScope(req);
  const adminIds = await getAccessibleAdminIdsForWhatsApp(scope);
  const contactFilter = adminIds ? { accountOwnerId: { $in: adminIds } } : {};

  const contacts = await WhatsAppContact.find(andFilters(
    contactFilter,
    buildTextSearch(["name", "email", "phone", "normalizedPhone", "waId", "status", "source", "tags", "notes"], query)
  ))
    .sort({ lastActivityAt: -1 })
    .limit(limit)
    .lean();

  const conversationFilter = adminIds ? { agentId: { $in: adminIds } } : {};
  const conversations = await WhatsAppConversation.find(andFilters(
    conversationFilter,
    buildTextSearch(["status", "lastMessagePreview", "workflowStatus"], query)
  ))
    .populate("contactId", "name phone email")
    .sort({ lastMessageAt: -1 })
    .limit(Math.max(2, Math.floor(limit / 2)))
    .lean();

  return [
    ...contacts.map((contact) =>
      result({
        type: "whatsapp_contact",
        label: "WhatsApp Contact",
        title: contact.name || contact.phone,
        subtitle: [contact.phone, contact.email].filter(Boolean).join(" - "),
        meta: contact.status || "WhatsApp",
        path: `/sales-dashboard/whatsapp-contact-hub?search=${encodeURIComponent(query)}`,
        icon: "MessageCircle",
        when: contact.lastActivityAt || contact.updatedAt,
      })
    ),
    ...conversations.map((conversation) =>
      result({
        type: "whatsapp_chat",
        label: "WhatsApp Chat",
        title: conversation.contactId?.name || conversation.contactId?.phone || "WhatsApp conversation",
        subtitle: conversation.lastMessagePreview,
        meta: conversation.status,
        path: `/sales-dashboard/whatsapp?conversationId=${encodeURIComponent(toId(conversation._id))}`,
        icon: "MessageSquare",
        when: conversation.lastMessageAt || conversation.updatedAt,
      })
    ),
  ];
};

const searchWhatsAppAssets = async (query, limit) => {
  const [quickReplies, forms, campaigns, collections] = await Promise.all([
    WhatsAppQuickReply.find(buildTextSearch(["title", "shortcut", "category", "content", "folder"], query))
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean(),
    WhatsAppForm.find(buildTextSearch(["name", "slug", "description", "category", "submitButtonText", "successMessage"], query))
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean(),
    WhatsAppCampaign.find(buildTextSearch(["name", "type", "channel", "status", "templateName", "contentLabel", "messageTitle", "bodyText"], query))
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean(),
    WhatsAppProductCollection.find(buildTextSearch(["name", "slug", "description", "buttonText", "category", "items.title", "items.description"], query))
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean(),
  ]);

  return [
    ...quickReplies.map((item) =>
      result({
        type: "quick_reply",
        label: "Quick Reply",
        title: item.title,
        subtitle: item.content,
        meta: [item.shortcut, item.category].filter(Boolean).join(" - "),
        path: "/sales-dashboard/whatsapp-quick-replies",
        icon: "MessageSquare",
        when: item.updatedAt || item.createdAt,
      })
    ),
    ...forms.map((item) =>
      result({
        type: "whatsapp_form",
        label: "WhatsApp Form",
        title: item.name,
        subtitle: item.description,
        meta: item.category || (item.isActive === false ? "Inactive" : "Active"),
        path: "/sales-dashboard/whatsapp-forms",
        icon: "FileText",
        when: item.updatedAt || item.createdAt,
      })
    ),
    ...campaigns.map((item) =>
      result({
        type: "whatsapp_campaign",
        label: "WhatsApp Campaign",
        title: item.name,
        subtitle: [item.type, item.channel].filter(Boolean).join(" - "),
        meta: item.status,
        path: "/sales-dashboard/whatsapp-campaigns",
        icon: "Megaphone",
        when: item.updatedAt || item.createdAt,
      })
    ),
    ...collections.map((item) =>
      result({
        type: "commerce_collection",
        label: "Commerce Collection",
        title: item.name,
        subtitle: item.description,
        meta: [item.category, item.buttonText].filter(Boolean).join(" - "),
        path: "/sales-dashboard/whatsapp-commerce",
        icon: "ShoppingBag",
        when: item.updatedAt || item.createdAt,
      })
    ),
  ];
};

exports.globalSearch = async (req, res) => {
  try {
    const query = trimString(req.query.q || req.query.search || "");
    if (query.length < 2) {
      return res.json({ success: true, query, results: [], total: 0 });
    }

    getSalesScope(req);
    const limit = Math.min(Math.max(Number(req.query.limit || 6), 2), 10);

    const groups = await Promise.all([
      searchLeads(req, query, limit),
      searchInvoices(req, query, limit),
      searchSalesDocuments(req, query, limit),
      searchPayments(req, query, limit),
      searchTasks(req, query, limit),
      searchMeetings(req, query, limit),
      searchWhatsApp(req, query, limit),
      searchWhatsAppAssets(query, limit),
    ]);

    const results = groups
      .flat()
      .filter((item) => item.title)
      .sort((a, b) => new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime())
      .slice(0, 24);

    return res.json({ success: true, query, results, total: results.length });
  } catch (error) {
    console.error("Global search failed:", error);
    return res.status(error.statusCode || error.status || 500).json({
      success: false,
      message: error.message || "Global search failed",
    });
  }
};

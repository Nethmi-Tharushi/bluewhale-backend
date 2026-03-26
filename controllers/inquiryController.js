const mongoose = require("mongoose");
const JobInquiry = require('../models/Inquiries');
const Job = require('../models/Job');
const User = require('../models/User');
const { sendInquiryResponseEmail } = require("../services/emailService");
const { resolveManagedCandidateNotificationTarget } = require("../services/managedCandidateNotificationService");
const { listAccessibleSalesCandidates } = require("../services/salesCandidateAccessService");
const {
  listAccessibleSalesLeadIds,
  listAccessibleSalesConversationIds,
} = require("../services/salesTaskAccessService");

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const getInquiryCandidateType = (inquiry) => {
  const normalized = String(inquiry?.candidateType || "").trim().toUpperCase();
  if (normalized === "B2B" || inquiry?.managedCandidate?.candidateId) return "B2B";
  return "B2C";
};

const toMongoUnknownFieldIdValues = (ids = []) => {
  const seen = new Set();
  const values = [];

  ids.forEach((id) => {
    const normalized = toIdString(id);
    if (!normalized || seen.has(normalized)) return;

    seen.add(normalized);
    values.push(normalized);

    if (mongoose.Types.ObjectId.isValid(normalized)) {
      values.push(new mongoose.Types.ObjectId(normalized));
    }
  });

  return values;
};

const addIdToSet = (set, value) => {
  const normalized = toIdString(value);
  if (normalized) {
    set.add(normalized);
  }
};

const EMPTY_MANAGED_CANDIDATE_FILTERS = [
  { managedCandidate: { $exists: false } },
  { "managedCandidate.candidateId": { $exists: false } },
  { "managedCandidate.candidateId": null },
  { "managedCandidate.candidateId": "" },
];

const buildB2cInquiryFilter = (candidateIds) => (
  candidateIds.size
    ? {
        user: { $in: Array.from(candidateIds) },
        $or: EMPTY_MANAGED_CANDIDATE_FILTERS,
      }
    : null
);

const buildB2bInquiryFilter = (managedCandidateIds, agentIds) => {
  const or = [];

  if (managedCandidateIds.size) {
    or.push({
      "managedCandidate.candidateId": { $in: Array.from(managedCandidateIds) },
    });
  }

  if (agentIds.size) {
    or.push({
      "managedCandidate.agentId": { $in: Array.from(agentIds) },
      $or: EMPTY_MANAGED_CANDIDATE_FILTERS.slice(1),
    });
  }

  return or.length ? { $or: or } : null;
};

const buildCrmLinkedInquiryFilters = ({ accessibleLeadIds, accessibleConversationIds }) => {
  const filters = [];
  const leadIds = toMongoUnknownFieldIdValues(Array.from(accessibleLeadIds));
  const conversationIds = toMongoUnknownFieldIdValues(Array.from(accessibleConversationIds));

  if (leadIds.length) {
    filters.push({ linkedLeadId: { $in: leadIds } });
    filters.push({ leadId: { $in: leadIds } });
    filters.push({ "crmContext.linkedLeadId": { $in: leadIds } });
  }

  if (conversationIds.length) {
    filters.push({ conversationId: { $in: conversationIds } });
    filters.push({ "crmContext.conversationId": { $in: conversationIds } });
  }

  return filters;
};

const buildAccessibleInquiryScope = async (admin) => {
  if (admin?.role === "MainAdmin") {
    return {
      fullAccess: true,
      inquiryFilter: {},
      b2cCandidateIds: new Set(),
      b2bManagedCandidateIds: new Set(),
      b2bAgentIds: new Set(),
      accessibleLeadIds: new Set(),
      accessibleConversationIds: new Set(),
    };
  }

  const b2cCandidateIds = new Set();
  const b2bManagedCandidateIds = new Set();
  const b2bAgentIds = new Set();
  const accessibleLeadIds = new Set();
  const accessibleConversationIds = new Set();

  if (admin?.role === "SalesStaff") {
    const accessibleCandidates = await listAccessibleSalesCandidates(admin);

    accessibleCandidates.forEach((candidate) => {
      if (candidate?.type === "B2B") {
        addIdToSet(b2bManagedCandidateIds, candidate?._id);
        addIdToSet(b2bAgentIds, candidate?.agent?.id);
        return;
      }

      addIdToSet(b2cCandidateIds, candidate?._id);
    });

    const leadIds = await listAccessibleSalesLeadIds(admin);
    leadIds.forEach((id) => addIdToSet(accessibleLeadIds, id));

    const conversationIds = await listAccessibleSalesConversationIds(admin, {
      accessibleLeadIds: Array.from(accessibleLeadIds),
    });
    conversationIds.forEach((id) => addIdToSet(accessibleConversationIds, id));
  } else {
    const visibleAssigneeIds = [toIdString(admin?._id)].filter(Boolean);
    const [b2cCandidates, agents] = await Promise.all([
      User.find({
        userType: "candidate",
        assignedTo: { $in: visibleAssigneeIds },
      })
        .select("_id")
        .lean(),
      User.find({
        userType: "agent",
        $or: [
          { assignedTo: { $in: visibleAssigneeIds } },
          { "managedCandidates.assignedTo": { $in: visibleAssigneeIds } },
        ],
      })
        .select("assignedTo managedCandidates")
        .lean(),
    ]);

    b2cCandidates.forEach((candidate) => {
      addIdToSet(b2cCandidateIds, candidate._id);
    });

    agents.forEach((agent) => {
      (agent.managedCandidates || []).forEach((candidate) => {
        const effectiveAssignedTo = toIdString(candidate?.assignedTo || agent?.assignedTo);
        if (!effectiveAssignedTo || !visibleAssigneeIds.includes(effectiveAssignedTo)) {
          return;
        }

        addIdToSet(b2bManagedCandidateIds, candidate._id);
        addIdToSet(b2bAgentIds, agent._id);
      });
    });
  }

  const or = [];
  const b2cFilter = buildB2cInquiryFilter(b2cCandidateIds);
  const b2bFilter = buildB2bInquiryFilter(b2bManagedCandidateIds, b2bAgentIds);

  if (b2cFilter) {
    or.push(b2cFilter);
  }
  if (b2bFilter) {
    or.push(b2bFilter);
  }
  or.push(
    ...buildCrmLinkedInquiryFilters({
      accessibleLeadIds,
      accessibleConversationIds,
    })
  );

  return {
    fullAccess: false,
    inquiryFilter: or.length ? { $or: or } : { _id: { $in: [] } },
    b2cCandidateIds,
    b2bManagedCandidateIds,
    b2bAgentIds,
    accessibleLeadIds,
    accessibleConversationIds,
  };
};

const canAccessInquiry = (scope, inquiry) => {
  if (scope?.fullAccess) return true;

  const managedCandidateId = toIdString(inquiry?.managedCandidate?.candidateId);
  if (managedCandidateId) {
    return scope?.b2bManagedCandidateIds?.has(managedCandidateId) || false;
  }

  const managedCandidateAgentId = toIdString(inquiry?.managedCandidate?.agentId);
  if (!managedCandidateId && managedCandidateAgentId && scope?.b2bAgentIds?.has(managedCandidateAgentId)) {
    return true;
  }

  const inquiryType = getInquiryCandidateType(inquiry);
  if (inquiryType === "B2C" && scope?.b2cCandidateIds?.has(toIdString(inquiry?.user))) {
    return true;
  }

  const linkedLeadIds = [
    inquiry?.linkedLeadId,
    inquiry?.leadId,
    inquiry?.crmContext?.linkedLeadId,
  ]
    .map(toIdString)
    .filter(Boolean);

  if (linkedLeadIds.some((id) => scope?.accessibleLeadIds?.has(id))) {
    return true;
  }

  const conversationIds = [
    inquiry?.conversationId,
    inquiry?.crmContext?.conversationId,
  ]
    .map(toIdString)
    .filter(Boolean);

  return conversationIds.some((id) => scope?.accessibleConversationIds?.has(id));
};

// Create new job inquiry
exports.createInquiry = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { email, subject, message, managedCandidateId, category, attachmentUrl } = req.body;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const resolvedEmail = String(email || req.user?.email || "").trim().toLowerCase();
    const resolvedCategory = String(category || "General").trim() || "General";
    const resolvedSubject = String(subject || req.body?.category || "General Inquiry").trim();
    const resolvedMessage = String(message || "").trim();
    const resolvedAttachmentUrl = String(req.file?.path || attachmentUrl || "").trim();

    if (!resolvedEmail) {
      return res.status(400).json({ message: "Email is required" });
    }
    if (!resolvedMessage) {
      return res.status(400).json({ message: "Message is required" });
    }

    let inquiryData = {
      job: jobId,
      user: req.user._id,
      email: resolvedEmail,
      category: resolvedCategory,
      subject: resolvedSubject,
      message: resolvedMessage,
      attachmentUrl: resolvedAttachmentUrl,
      candidateType: 'B2C' // Default to B2C
    };

    // Handle managed candidate inquiry
    if (managedCandidateId) {
      // Verify the agent owns this managed candidate
      const agent = await User.findById(req.user._id);
      if (!agent || agent.userType !== "agent") {
        return res.status(403).json({ message: "Only agents can create managed-candidate inquiries" });
      }
      const managedCandidate = agent.managedCandidates.id(managedCandidateId);
      
      if (!managedCandidate) {
        return res.status(404).json({ message: "Managed candidate not found" });
      }

      inquiryData.candidateType = 'B2B'; 
      inquiryData.managedCandidate = {
        candidateId: managedCandidateId,
        agentId: req.user._id
      };
      
      // store inquiry in managed candidate's record
      managedCandidate.inquiries.push({
        content: resolvedMessage,
        jobId: jobId,
        status: 'Pending',
        createdAt: new Date()
      });
      await agent.save();
    }

    const inquiry = await JobInquiry.create(inquiryData);

    res.status(201).json({
      success: true,
      message: "Inquiry submitted successfully",
      inquiry,
    });
  } catch (error) {
    console.error("Create inquiry error:", error);
    if (error?.name === "ValidationError") {
      const details = Object.values(error.errors || {})
        .map((e) => e?.message)
        .filter(Boolean)
        .join(", ");
      return res.status(400).json({ message: details || "Invalid inquiry payload" });
    }
    res.status(500).json({ message: "Server error" });
  }
};

// Get all inquiries (role-based)
exports.getAllInquiries = async (req, res) => {
  try {
    const scope = await buildAccessibleInquiryScope(req.admin);
    const inquiries = await JobInquiry.find(scope.inquiryFilter)
      .populate('job', 'title company')
      .populate('user', 'name email')
      .populate('response.repliedBy', 'name role')
      .sort({ createdAt: -1 });

    const accessibleInquiries = scope.fullAccess
      ? inquiries
      : inquiries.filter((inquiry) => canAccessInquiry(scope, inquiry));

    res.json({ success: true, count: accessibleInquiries.length, inquiries: accessibleInquiries });
  } catch (error) {
    console.error("Fetch inquiries error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

//  Get inquiries for logged-in user candidate
exports.getUserInquiries = async (req, res) => {
  try {
    let inquiries;
    
    if (req.user.userType === 'agent') {
      // Get inquiries where user is the agent OR managed candidate inquiries
      inquiries = await JobInquiry.find({
        $or: [
          { user: req.user._id },
          { 'managedCandidate.agentId': req.user._id }
        ]
      })
      .populate('job', 'title company')
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    } else {
      // Regular B2C candidate - only their own inquiries
      inquiries = await JobInquiry.find({ 
        user: req.user._id,
        candidateType: 'B2C' 
      })
      .populate('job', 'title company')
      .sort({ createdAt: -1 });
    }

    res.json({ success: true, inquiries });
  } catch (error) {
    console.error("Fetch user inquiries error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.respondToInquiry = async (req, res) => {
  try {
    const { message } = req.body;
    const inquiry = await JobInquiry.findById(req.params.id);

    if (!inquiry) return res.status(404).json({ message: "Inquiry not found" });

    const scope = await buildAccessibleInquiryScope(req.admin);
    if (!canAccessInquiry(scope, inquiry)) {
      return res.status(403).json({ message: "Unauthorized to respond to this inquiry" });
    }

    inquiry.response = {
      message,
      repliedBy: req.admin._id,
      repliedAt: new Date(),
    };
    inquiry.status = "Responded";
    await inquiry.save();

    // For B2B inquiries, send email to agent instead of managed candidate email.
    let recipientEmail = inquiry.email;
    let emailContext = undefined;

    if (inquiry.candidateType === 'B2B') {
      const managedTarget = await resolveManagedCandidateNotificationTarget({
        candidateId: inquiry.managedCandidate?.candidateId,
        candidateEmail: inquiry.email,
      });

      if (managedTarget.isManagedCandidate && managedTarget.agentEmail) {
        recipientEmail = managedTarget.agentEmail;
        emailContext = {
          targetType: "managedCandidate",
          agentName: managedTarget.agentName,
          candidateName: managedTarget.candidateName,
          candidateEmail: managedTarget.candidateEmail,
          candidateId: managedTarget.candidateId,
        };
      }
    }

    await sendInquiryResponseEmail(inquiry, message, recipientEmail, emailContext);

    res.json({ success: true, message: "Response sent successfully", inquiry });
  } catch (error) {
    console.error("Respond error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.deleteInquiry = async (req, res) => {
  try {
    const { id } = req.params;

    const inquiry = await JobInquiry.findByIdAndDelete(id);

    if (!inquiry) {
      return res.status(404).json({ message: "Inquiry not found" });
    }

    res.status(200).json({ message: "Inquiry deleted successfully" });
  } catch (err) {
    console.error("Delete Inquiry Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

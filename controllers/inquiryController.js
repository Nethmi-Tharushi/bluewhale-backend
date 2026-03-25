const JobInquiry = require('../models/Inquiries');
const Job = require('../models/Job');
const User = require('../models/User');
const { sendInquiryResponseEmail } = require("../services/emailService");
const { resolveManagedCandidateNotificationTarget } = require("../services/managedCandidateNotificationService");

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
    let filter = {};

    if (req.admin.role === "SalesAdmin" || req.admin.role === "SalesStaff") {
      const assignedCandidates = await User.find({ assignedTo: req.admin._id }).select("_id");
      const assignedCandidateIds = assignedCandidates.map((user) => user._id);

      const agentOwners = await User.find({ "managedCandidates.assignedTo": req.admin._id }).select("managedCandidates");
      const managedCandidateIds = agentOwners.flatMap((agent) =>
        (agent.managedCandidates || [])
          .filter((candidate) => candidate?.assignedTo?.toString() === req.admin._id.toString())
          .map((candidate) => String(candidate._id))
      );

      filter = {
        $or: [
          { user: { $in: assignedCandidateIds } },
          { "managedCandidate.candidateId": { $in: managedCandidateIds } },
        ],
      };
    }

    const inquiries = await JobInquiry.find(filter)
      .populate('job', 'title company')
      .populate('user', 'name email')
      .populate('response.repliedBy', 'name role')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: inquiries.length, inquiries });
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

    // Sales team members can only respond to inquiries tied to their assigned candidates.
    if (req.admin.role === "SalesAdmin" || req.admin.role === "SalesStaff") {
      const user = await User.findById(inquiry.user).select("assignedTo managedCandidates");
      const ownsDirectCandidate = user?.assignedTo?.toString() === req.admin._id.toString();
      const ownsManagedCandidate = (user?.managedCandidates || []).some(
        (candidate) =>
          String(candidate?._id) === String(inquiry.managedCandidate?.candidateId || "") &&
          candidate?.assignedTo?.toString() === req.admin._id.toString()
      );

      if (!ownsDirectCandidate && !ownsManagedCandidate) {
        return res.status(403).json({ message: "Unauthorized to respond to this inquiry" });
      }
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

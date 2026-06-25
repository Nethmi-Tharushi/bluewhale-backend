const Message = require("../models/Message");
const AdminUser = require("../models/AdminUser");
const {
  CHAT_BRAND_NAME,
  normalizeObjectId,
  resolvePortalThreadScopeByUserId,
  canAdminAccessPortalThread,
  fetchPortalThreadMessages,
  getVisiblePortalUsersForAdmin,
  createUserToAdminMessage,
  createAdminToUserMessage,
} = require("../services/chatService");

const getAllowedInternalAdminFilter = (admin) => {
  const role = String(admin?.role || "");
  if (role === "MainAdmin") {
    return { role: "SalesAdmin" };
  }
  if (role === "SalesAdmin") {
    return {
      $or: [
        { role: "MainAdmin" },
        { role: "SalesStaff", reportsTo: admin._id },
      ],
    };
  }
  if (role === "SalesStaff") {
    if (admin?.reportsTo) {
      return { _id: admin.reportsTo, role: "SalesAdmin" };
    }
    return { _id: null };
  }
  return { _id: null };
};

const canAccessInternalAdminContact = async (admin, targetAdminId) => {
  const normalizedTargetAdminId = normalizeObjectId(targetAdminId);
  if (!normalizedTargetAdminId) return null;
  return AdminUser.findOne({
    _id: normalizedTargetAdminId,
    ...getAllowedInternalAdminFilter(admin),
  }).select("_id name email role reportsTo");
};

exports.getUserMessages = async (req, res) => {
  try {
    const scope = await resolvePortalThreadScopeByUserId(req.user._id, req.query?.managedCandidateId);
    if (!scope?.primaryAdmin?._id) {
      return res.status(404).json({ message: "No assigned sales staff found for this chat" });
    }

    const requestedAdminId = normalizeObjectId(req.params.adminId);
    if (requestedAdminId && !scope.adminIds.includes(requestedAdminId)) {
      return res.status(403).json({ message: "Unauthorized to access this chat" });
    }

    const messages = await fetchPortalThreadMessages({
      userId: req.user._id,
      adminIds: scope.adminIds,
      managedCandidateId: req.query?.managedCandidateId,
    });

    res.json(messages);
  } catch (err) {
    console.error("getUserMessages error:", err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
};

exports.getAdminMessages = async (req, res) => {
  try {
    const access = await canAdminAccessPortalThread(req.admin, req.params.userId, req.query?.managedCandidateId);
    if (!access.allowed) {
      return res.status(403).json({ message: access.reason || "Unauthorized to access this chat" });
    }

    const messages = await fetchPortalThreadMessages({
      userId: access.scope.user._id,
      adminIds: access.scope.adminIds,
      managedCandidateId: req.query?.managedCandidateId,
    });

    res.json(messages);
  } catch (err) {
    console.error("getAdminMessages error:", err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
};

exports.getUsersForAdmin = async (req, res) => {
  try {
    const users = await getVisiblePortalUsersForAdmin(req.admin);
    res.json(users);
  } catch (err) {
    console.error("getUsersForAdmin error:", err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
};

exports.getAdminsForUser = async (req, res) => {
  try {
    const scope = await resolvePortalThreadScopeByUserId(req.user._id, req.query?.managedCandidateId);
    if (!scope?.primaryAdmin?._id) {
      return res.json([]);
    }

    const messages = await fetchPortalThreadMessages({
      userId: req.user._id,
      adminIds: scope.adminIds,
      managedCandidateId: req.query?.managedCandidateId,
    });
    const lastMessage = messages.length ? messages[messages.length - 1] : null;

    return res.json([
      {
        _id: scope.primaryAdmin._id,
        name: CHAT_BRAND_NAME,
        email: scope.primaryAdmin.email || "",
        role: scope.primaryAdmin.role || "SalesStaff",
        companyName: CHAT_BRAND_NAME,
        lastMessageAt: lastMessage?.createdAt || null,
        lastMessage: String(lastMessage?.content || "").trim(),
      },
    ]);
  } catch (err) {
    console.error("getAdminsForUser error:", err);
    res.status(500).json({ message: "Failed to fetch admins" });
  }
};

exports.getAssignedAdmin = async (req, res) => {
  try {
    const scope = await resolvePortalThreadScopeByUserId(req.user._id, req.query?.managedCandidateId);
    if (!scope?.primaryAdmin?._id) {
      return res.status(404).json({ message: "No admin assigned" });
    }

    res.json({
      assignedAdmin: {
        _id: scope.primaryAdmin._id,
        name: CHAT_BRAND_NAME,
        email: scope.primaryAdmin.email || "",
        role: scope.primaryAdmin.role || "SalesStaff",
        companyName: CHAT_BRAND_NAME,
      },
    });
  } catch (err) {
    console.error("getAssignedAdmin error:", err);
    res.status(500).json({ message: "Failed to fetch assigned admin" });
  }
};

exports.sendMessageToAdmin = async (req, res) => {
  try {
    const content = String(req.body?.content || req.body?.message || "").trim();
    if (!content) {
      return res.status(400).json({ message: "Message content required" });
    }

    const { message, rooms } = await createUserToAdminMessage({
      userId: req.user._id,
      managedCandidateId: req.query?.managedCandidateId || req.body?.managedCandidateId || "",
      content,
    });

    const io = req.app.get("io");
    if (io) {
      rooms.forEach((room) => io.to(room).emit("receiveMessage", message));
    }

    return res.status(201).json(message);
  } catch (err) {
    console.error("sendMessageToAdmin error:", err);
    return res.status(500).json({ message: err.message || "Failed to send message" });
  }
};

exports.sendMessageToUser = async (req, res) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (!content) {
      return res.status(400).json({ message: "Message content required" });
    }

    const { message, rooms } = await createAdminToUserMessage({
      admin: req.admin,
      userId: req.params.userId,
      managedCandidateId: req.query?.managedCandidateId || req.body?.managedCandidateId || "",
      content,
    });

    const io = req.app.get("io");
    if (io) {
      rooms.forEach((room) => io.to(room).emit("receiveMessage", message));
    }

    res.status(201).json(message);
  } catch (err) {
    console.error("sendMessageToUser error:", err);
    res.status(500).json({ message: err.message || "Failed to send message" });
  }
};

exports.getInternalAdminsForAdmin = async (req, res) => {
  try {
    const admin = req.admin;
    const filter = getAllowedInternalAdminFilter(admin);
    const contacts = await AdminUser.find(filter)
      .select("_id name email role reportsTo createdAt")
      .sort({ createdAt: 1 })
      .lean();

    const contactIds = contacts.map((contact) => contact._id);
    const lastMessageRows = contactIds.length
      ? await Message.aggregate([
          {
            $match: {
              senderType: "admin",
              recipientType: "admin",
              $or: [
                { senderId: admin._id, recipientId: { $in: contactIds } },
                { senderId: { $in: contactIds }, recipientId: admin._id },
              ],
            },
          },
          {
            $project: {
              otherAdminId: {
                $cond: [{ $eq: ["$senderId", admin._id] }, "$recipientId", "$senderId"],
              },
              createdAt: 1,
            },
          },
          {
            $group: {
              _id: "$otherAdminId",
              lastMessageAt: { $max: "$createdAt" },
            },
          },
        ])
      : [];

    const lastMessageMap = new Map(lastMessageRows.map((row) => [String(row._id), row.lastMessageAt || null]));

    const mapped = contacts
      .map((contact) => ({
        _id: contact._id,
        name: contact.name,
        email: contact.email,
        role: contact.role,
        reportsTo: contact.reportsTo || null,
        lastMessageAt: lastMessageMap.get(String(contact._id)) || null,
        hasConversation: lastMessageMap.has(String(contact._id)),
      }))
      .sort((a, b) => {
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        if (bTime !== aTime) return bTime - aTime;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });

    res.json(mapped);
  } catch (err) {
    console.error("getInternalAdminsForAdmin error:", err);
    res.status(500).json({ message: "Failed to load internal chat contacts" });
  }
};

exports.getInternalAdminMessages = async (req, res) => {
  try {
    const targetAdmin = await canAccessInternalAdminContact(req.admin, req.params.adminId);
    if (!targetAdmin) {
      return res.status(403).json({ message: "Unauthorized to access this internal chat" });
    }

    const messages = await Message.find({
      senderType: "admin",
      recipientType: "admin",
      $or: [
        { senderId: req.admin._id, recipientId: targetAdmin._id },
        { senderId: targetAdmin._id, recipientId: req.admin._id },
      ],
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (err) {
    console.error("getInternalAdminMessages error:", err);
    res.status(500).json({ message: "Failed to fetch internal messages" });
  }
};

exports.sendMessageToInternalAdmin = async (req, res) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (!content) {
      return res.status(400).json({ message: "Message content required" });
    }

    const targetAdmin = await canAccessInternalAdminContact(req.admin, req.params.adminId);
    if (!targetAdmin) {
      return res.status(403).json({ message: "Unauthorized to message this admin" });
    }

    const newMessage = await Message.create({
      content,
      senderId: req.admin._id,
      senderType: "admin",
      senderName: req.admin.name,
      senderModel: "AdminUser",
      senderRole: req.admin.role || "Admin",
      recipientId: targetAdmin._id,
      recipientType: "admin",
      recipientName: targetAdmin.name,
      recipientModel: "AdminUser",
      recipientRole: targetAdmin.role || "Admin",
    });

    const io = req.app.get("io");
    if (io) {
      io.to(targetAdmin._id.toString()).emit("receiveMessage", newMessage);
      io.to(req.admin._id.toString()).emit("receiveMessage", newMessage);
    }

    res.status(201).json(newMessage);
  } catch (err) {
    console.error("sendMessageToInternalAdmin error:", err);
    res.status(500).json({ message: "Failed to send internal message" });
  }
};

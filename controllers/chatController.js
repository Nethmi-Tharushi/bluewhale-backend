// server/controllers/chatController.js
const Message = require("../models/Message");
const AdminUser = require("../models/AdminUser");
const User = require("../models/User");
const mongoose = require("mongoose");

const normalizeObjectId = (value) => {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getAllowedInternalAdminFilter = (admin) => {
  const role = String(admin?.role || "");
  if (role === "MainAdmin") {
    return { _id: { $ne: admin._id } };
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
    const filters = [{ role: "MainAdmin" }];
    if (admin?.reportsTo) {
      filters.push({ _id: admin.reportsTo, role: "SalesAdmin" });
    }
    return { $or: filters };
  }
  return { _id: { $ne: admin._id } };
};

const canAccessInternalAdminContact = async (admin, targetAdminId) => {
  if (!mongoose.Types.ObjectId.isValid(String(targetAdminId || ""))) return null;
  return AdminUser.findOne({
    _id: targetAdminId,
    ...getAllowedInternalAdminFilter(admin),
  }).select("_id name email role reportsTo");
};

const pickAdminForUserSend = async ({ adminIdParam, body = {}, userId }) => {
  const candidateIds = [
    adminIdParam,
    body.adminId,
    body.recipientId,
    body.contactId,
    body.targetId,
  ].filter(Boolean);

  for (const rawId of candidateIds) {
    const id = String(rawId).trim();
    if (mongoose.Types.ObjectId.isValid(id)) {
      const byId = await AdminUser.findById(id).select("_id name email role");
      if (byId) return byId;
    }
  }

  const candidateEmail = String(body.adminEmail || body.email || "").trim().toLowerCase();
  if (candidateEmail) {
    const byEmail = await AdminUser.findOne({ email: candidateEmail }).select("_id name email role");
    if (byEmail) return byEmail;
  }

  const candidateName = String(body.adminName || body.contactName || body.name || "").trim();
  if (candidateName) {
    if (/super admin/i.test(candidateName)) {
      const mainAdmin = await AdminUser.findOne({ role: "MainAdmin" }).sort({ createdAt: 1 });
      if (mainAdmin) return mainAdmin;
    }

    const byName = await AdminUser.findOne({
      name: { $regex: `^${candidateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    }).select("_id name email role");
    if (byName) return byName;
  }

  const latest = await Message.findOne({
    $or: [
      { senderId: userId, senderType: "user", recipientType: "admin" },
      { recipientId: userId, recipientType: "user", senderType: "admin" },
    ],
  })
    .sort({ createdAt: -1 })
    .select("senderId senderType recipientId");

  if (latest) {
    const lastAdminId = latest.senderType === "admin" ? latest.senderId : latest.recipientId;
    const byLatest = await AdminUser.findById(lastAdminId).select("_id name email role");
    if (byLatest) return byLatest;
  }

  const primaryMainAdmin = await AdminUser.findOne({ role: "MainAdmin" }).sort({ createdAt: 1 });
  if (primaryMainAdmin) return primaryMainAdmin;

  return AdminUser.findOne({}).sort({ createdAt: 1 }).select("_id name email role");
};

// --- USER: Fetch messages with assigned admin ---
exports.getUserMessages = async (req, res) => {
  try {
    const adminId = req.params.adminId;

    const messages = await Message.find({
      $or: [
        { senderId: req.user._id, recipientId: adminId },
        { senderId: adminId, recipientId: req.user._id },
      ],
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (err) {
    console.error("getUserMessages error:", err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
};

// --- ADMIN: Fetch messages with a specific user ---
exports.getAdminMessages = async (req, res) => {
  try {
    const userId = req.params.userId;

    const user = await User.findById(userId).select("name email");
    if (!user) return res.status(404).json({ message: "User not found" });

    const messages = await Message.find({
      $or: [
        { senderId: req.admin._id, recipientId: userId },
        { senderId: userId, recipientId: req.admin._id },
      ],
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (err) {
    console.error("getAdminMessages error:", err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
};

// --- ADMIN: Get users who chatted with this admin (incoming OR outgoing) ---
exports.getUsersForAdmin = async (req, res) => {
  try {
    const adminId = req.admin._id;

    // Get latest message timestamp per user conversation with this admin
    const conversationRows = await Message.aggregate([
      {
        $match: {
          $or: [
            // user -> admin
            { recipientId: adminId, recipientType: "admin", senderType: "user" },
            // admin -> user
            { senderId: adminId, senderType: "admin", recipientType: "user" },
          ],
        },
      },
      {
        $project: {
          otherUserId: {
            $cond: [{ $eq: ["$senderType", "user"] }, "$senderId", "$recipientId"],
          },
          createdAt: 1,
        },
      },
      {
        $group: {
          _id: "$otherUserId",
          lastMessageAt: { $max: "$createdAt" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 1,
          name: "$user.name",
          email: "$user.email",
          lastMessageAt: 1,
        },
      },
      { $sort: { lastMessageAt: -1 } },
    ]);

    const lastMessageMap = new Map(
      conversationRows.map((row) => [String(row._id), row.lastMessageAt || null])
    );

    const allUsers = await User.find({})
      .select("_id name email createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const users = allUsers.map((user) => ({
      _id: user._id,
      name: user.name,
      email: user.email,
      lastMessageAt: lastMessageMap.get(String(user._id)) || null,
      hasConversation: lastMessageMap.has(String(user._id)),
    }));

    users.sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    res.json(users);
  } catch (err) {
    console.error("getUsersForAdmin error:", err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
};

// --- USER: Get admins this user has chatted with (separate conversation threads) ---
exports.getAdminsForUser = async (req, res) => {
  try {
    const userId = req.user._id;

    const admins = await Message.aggregate([
      {
        $match: {
          $or: [
            { senderId: userId, senderType: "user", recipientType: "admin" },
            { recipientId: userId, recipientType: "user", senderType: "admin" },
          ],
        },
      },
      {
        $project: {
          otherAdminId: {
            $cond: [{ $eq: ["$senderType", "admin"] }, "$senderId", "$recipientId"],
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
      {
        $lookup: {
          from: "adminusers",
          localField: "_id",
          foreignField: "_id",
          as: "admin",
        },
      },
      { $unwind: "$admin" },
      {
        $project: {
          _id: "$admin._id",
          name: "$admin.name",
          email: "$admin.email",
          role: "$admin.role",
          lastMessageAt: 1,
        },
      },
      { $sort: { lastMessageAt: -1 } },
    ]);

    if (admins.length > 0) {
      return res.json(admins);
    }

    // Fallback: first-time users can still start with any available admin.
    const allAdmins = await AdminUser.find({})
      .select("_id name email role")
      .sort({ createdAt: 1 })
      .lean();
    return res.json(allAdmins);
  } catch (err) {
    console.error("getAdminsForUser error:", err);
    res.status(500).json({ message: "Failed to fetch admins" });
  }
};

// --- USER: Get assigned admin ---
exports.getAssignedAdmin = async (req, res) => {
  try {
    const userId = req.user._id;

    // Prefer the latest admin who has chatted with this user.
    const latestMessage = await Message.findOne({
      $or: [
        { senderId: userId, senderType: "user", recipientType: "admin" },
        { recipientId: userId, recipientType: "user", senderType: "admin" },
      ],
    })
      .sort({ createdAt: -1 })
      .select("senderId senderType recipientId recipientType");

    let admin = null;
    if (latestMessage) {
      const adminId =
        latestMessage.senderType === "admin" ? latestMessage.senderId : latestMessage.recipientId;
      admin = await AdminUser.findById(adminId);
    }

    // Fallback for first-time chat users
    if (!admin) {
      admin = await AdminUser.findOne();
    }

    if (!admin) return res.status(404).json({ message: "No admin assigned" });
    res.json({ assignedAdmin: admin });
  } catch (err) {
    console.error("getAssignedAdmin error:", err);
    res.status(500).json({ message: "Failed to fetch assigned admin" });
  }
};

// --- USER: Send message to admin (supports id, name, email, or fallback mapping) ---
exports.sendMessageToAdmin = async (req, res) => {
  try {
    const content = String(req.body?.content || req.body?.message || "").trim();
    if (!content) {
      return res.status(400).json({ message: "Message content required" });
    }

    const admin = await pickAdminForUserSend({
      adminIdParam: req.params.adminId,
      body: req.body,
      userId: req.user._id,
    });

    if (!admin) {
      return res.status(404).json({ message: "No admin available" });
    }

    const senderUser = await User.findById(req.user._id).select("name");

    const newMessage = await Message.create({
      content,
      senderId: req.user._id,
      senderType: "user",
      senderName: senderUser?.name || "User",
      senderModel: "User",

      recipientId: admin._id,
      recipientType: "admin",
      recipientName: admin.name || "Admin",
      recipientModel: "AdminUser",
    });

    const io = req.app.get("io");
    if (io) {
      io.to(admin._id.toString()).emit("receiveMessage", newMessage);
      io.to(req.user._id.toString()).emit("receiveMessage", newMessage);
    }

    return res.status(201).json(newMessage);
  } catch (err) {
    console.error("sendMessageToAdmin error:", err);
    return res.status(500).json({ message: "Failed to send message" });
  }
};

// --- ADMIN: Send message to user (FIXED senderType/recipientType) ---
exports.sendMessageToUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const content = (req.body?.content || "").trim();

    if (!content) {
      return res.status(400).json({ message: "Message content required" });
    }

    const user = await User.findById(userId).select("name email");
    if (!user) return res.status(404).json({ message: "User not found" });

    const admin = req.admin;

    // ✅ IMPORTANT: senderType/recipientType MUST match Message schema enum
    const newMessage = await Message.create({
      content,
      senderId: admin._id,
      senderType: "admin", // ✅ FIX
      senderName: admin.name,
      senderModel: "AdminUser",

      recipientId: user._id,
      recipientType: "user", // ✅ FIX
      recipientName: user.name,
      recipientModel: "User",
    });

    // Emit via Socket.IO if user connected
    const io = req.app.get("io");
    if (io) {
      io.to(user._id.toString()).emit("receiveMessage", newMessage);
      io.to(admin._id.toString()).emit("receiveMessage", newMessage);
    }

    res.status(201).json(newMessage);
  } catch (err) {
    console.error("sendMessageToUser error:", err); // ✅ this will show the REAL reason if any
    res.status(500).json({ message: "Failed to send message" });
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
      recipientId: targetAdmin._id,
      recipientType: "admin",
      recipientName: targetAdmin.name,
      recipientModel: "AdminUser",
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

const ActivityLog = require("../models/ActivityLog");

const createActivityLog = async (req, res) => {
  try {
    const { title, description, type } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ message: "title is required" });
    }

    const activity = await ActivityLog.create({
      admin: req.admin._id,
      role: req.admin.role,
      title: String(title).trim(),
      description: description ? String(description).trim() : "",
      type: type || "system",
    });

    return res.status(201).json({ success: true, data: activity });
  } catch (err) {
    console.error("Error creating activity log:", err);
    return res.status(500).json({ message: err.message || "Failed to create activity log" });
  }
};

const getActivityLogs = async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 12;

    const logs = await ActivityLog.find({ admin: req.admin._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ success: true, data: logs });
  } catch (err) {
    console.error("Error fetching activity logs:", err);
    return res.status(500).json({ message: err.message || "Failed to fetch activity logs" });
  }
};

module.exports = {
  createActivityLog,
  getActivityLogs,
};

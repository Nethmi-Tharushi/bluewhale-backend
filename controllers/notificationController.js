const Notification = require("../models/Notification");
const { formatNotification, getGlobalNotificationSettings } = require("../services/notificationService");
const { mergeInAppNotificationSettings } = require("../utils/notificationSettings");

const parseLimit = (value, fallback = 30) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), 100);
};

const listNotifications = async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const onlyUnread = String(req.query.unread || "").toLowerCase() === "true";
    const query = {
      recipient: req.admin._id,
      ...(onlyUnread ? { readAt: null } : {}),
    };

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).limit(limit).lean(),
      Notification.countDocuments({ recipient: req.admin._id, readAt: null }),
    ]);

    res.json({
      success: true,
      data: notifications.map(formatNotification),
      unreadCount,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to load notifications" });
  }
};

const markNotificationRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        recipient: req.admin._id,
      },
      {
        $set: { readAt: new Date() },
      },
      { new: true }
    ).lean();

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const unreadCount = await Notification.countDocuments({ recipient: req.admin._id, readAt: null });
    res.json({
      success: true,
      data: formatNotification(notification),
      unreadCount,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to update notification" });
  }
};

const markAllNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      {
        recipient: req.admin._id,
        readAt: null,
      },
      {
        $set: { readAt: new Date() },
      }
    );

    res.json({
      success: true,
      unreadCount: 0,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to update notifications" });
  }
};

const getNotificationSettings = async (_req, res) => {
  try {
    const settings = await getGlobalNotificationSettings();
    res.json({
      success: true,
      settings,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to load notification settings" });
  }
};

const updateNotificationSettings = async (req, res) => {
  try {
    if (String(req.admin?.role || "") !== "MainAdmin") {
      return res.status(403).json({ message: "Only MainAdmin can manage notification settings" });
    }

    req.admin.settings = req.admin.settings || {};
    req.admin.settings.inAppNotifications = mergeInAppNotificationSettings(req.body?.settings || {});
    req.admin.markModified("settings.inAppNotifications");
    await req.admin.save();

    res.json({
      success: true,
      settings: req.admin.settings.inAppNotifications,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to save notification settings" });
  }
};

module.exports = {
  getNotificationSettings,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationSettings,
};

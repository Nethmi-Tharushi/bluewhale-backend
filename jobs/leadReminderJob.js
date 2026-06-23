const cron = require("node-cron");
const LeadReminder = require("../models/LeadReminder");
const Lead = require("../models/Lead");
const AdminUser = require("../models/AdminUser");
const { notifyLeadReminderDue } = require("../services/leadReminderService");

cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const dueReminders = await LeadReminder.find({
      status: "Pending",
      remindAt: { $lte: now },
    })
      .sort({ remindAt: 1, createdAt: 1 })
      .limit(100)
      .lean();

    if (!dueReminders.length) {
      return;
    }

    const io = global.__crm_io || null;

    for (const reminder of dueReminders) {
      const claimed = await LeadReminder.findOneAndUpdate(
        { _id: reminder._id, status: "Pending" },
        { $set: { status: "Sent", sentAt: now } },
        { new: true }
      ).lean();

      if (!claimed) {
        continue;
      }

      const lead = await Lead.findById(claimed.lead)
        .select("_id name email phone teamAdmin ownerAdmin assignedTo linkedUser portalAccountType")
        .lean();

      if (!lead) {
        continue;
      }

      const creatorAdmin = claimed.createdBy
        ? await AdminUser.findById(claimed.createdBy).select("_id name email role").lean()
        : null;

      await notifyLeadReminderDue({
        io,
        lead,
        reminder: claimed,
        creatorAdmin,
      });
    }
  } catch (error) {
    console.error("[LeadReminderJob] Error in cron job:", error);
  }
});

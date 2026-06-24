const cron = require("node-cron");
const LeadReminder = require("../models/LeadReminder");
const Lead = require("../models/Lead");
const AdminUser = require("../models/AdminUser");
const { notifyLeadReminderDue } = require("../services/leadReminderService");
const { sendLeadReminderEmail } = require("../services/emailService");

const processReminderEmail = async ({ claimed, lead, creatorAdmin }) => {
  if (creatorAdmin?.email) {
    try {
      await sendLeadReminderEmail({
        to: creatorAdmin.email,
        creatorName: creatorAdmin.name,
        leadName: lead.name,
        leadEmail: lead.email,
        leadPhone: lead.phone,
        title: claimed.title,
        message: claimed.message,
        remindAt: claimed.remindAt,
      });

      await LeadReminder.findByIdAndUpdate(claimed._id, {
        $set: {
          emailDeliveryStatus: "Sent",
          emailSentAt: new Date(),
          emailError: "",
        },
      });
      return;
    } catch (emailError) {
      await LeadReminder.findByIdAndUpdate(claimed._id, {
        $set: {
          emailDeliveryStatus: "Failed",
          emailSentAt: null,
          emailError: String(emailError?.message || emailError || "").slice(0, 500),
        },
      });
      console.error(
        `[LeadReminderJob] Failed to send reminder email to ${creatorAdmin.email}:`,
        emailError.message || emailError
      );
      return;
    }
  }

  await LeadReminder.findByIdAndUpdate(claimed._id, {
    $set: {
      emailDeliveryStatus: "Skipped",
      emailSentAt: null,
      emailError: creatorAdmin ? "Creator admin does not have an email address." : "Creator admin not found.",
    },
  });
};

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

    const emailBackfillReminders = await LeadReminder.find({
      status: "Sent",
      remindAt: { $lte: now },
      $or: [
        { emailDeliveryStatus: { $exists: false } },
        { emailDeliveryStatus: null },
        { emailDeliveryStatus: "" },
        { emailDeliveryStatus: "Pending" },
      ],
    })
      .sort({ remindAt: 1, createdAt: 1 })
      .limit(100)
      .lean();

    if (!dueReminders.length && !emailBackfillReminders.length) {
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

      await processReminderEmail({ claimed, lead, creatorAdmin });

      await notifyLeadReminderDue({
        io,
        lead,
        reminder: claimed,
        creatorAdmin,
      });
    }

    for (const reminder of emailBackfillReminders) {
      const lead = await Lead.findById(reminder.lead)
        .select("_id name email phone teamAdmin ownerAdmin assignedTo linkedUser portalAccountType")
        .lean();

      if (!lead) {
        continue;
      }

      const creatorAdmin = reminder.createdBy
        ? await AdminUser.findById(reminder.createdBy).select("_id name email role").lean()
        : null;

      await processReminderEmail({ claimed: reminder, lead, creatorAdmin });
    }
  } catch (error) {
    console.error("[LeadReminderJob] Error in cron job:", error);
  }
});

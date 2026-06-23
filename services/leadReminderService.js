const Lead = require("../models/Lead");
const AdminUser = require("../models/AdminUser");
const { createNotificationsForEvent } = require("./notificationService");

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return String(value._id);
  return String(value);
};

const uniqueIds = (values = []) => [...new Set(values.map((value) => toIdString(value)).filter(Boolean))];

const collectLeadReminderAdminIds = async ({ lead, creatorAdminId = null } = {}) => {
  const leadId = toIdString(lead?._id || lead?.id);
  const sourceLead = leadId
    ? await Lead.findById(leadId).select("teamAdmin ownerAdmin assignedTo").lean()
    : lead;

  const ids = [
    sourceLead?.teamAdmin,
    sourceLead?.ownerAdmin,
    sourceLead?.assignedTo,
    creatorAdminId,
  ];

  const assignedToId = sourceLead?.assignedTo?._id || sourceLead?.assignedTo;
  if (assignedToId) {
    const assignedAdmin = await AdminUser.findById(assignedToId).select("reportsTo").lean();
    ids.push(assignedAdmin?.reportsTo);
  }

  return uniqueIds(ids);
};

const notifyLeadReminderDue = async ({
  io,
  lead,
  reminder,
  creatorAdmin = null,
  creatorAdminId = null,
}) => {
  const relatedAdminIds = await collectLeadReminderAdminIds({
    lead,
    creatorAdminId: creatorAdminId || creatorAdmin?._id || creatorAdmin,
  });

  return createNotificationsForEvent({
    io,
    eventType: "lead_reminder_due",
    entityType: "Lead",
    entity: lead,
    title: reminder?.title || `Reminder due: ${lead?.name || "Lead"}`,
    message: reminder?.message || `A reminder is due for ${lead?.name || "this lead"}.`,
    actor: creatorAdmin || null,
    actorModel: "AdminUser",
    relatedAdminIds,
    metadata: {
      reminderId: toIdString(reminder?._id || reminder?.id),
      remindAt: reminder?.remindAt || null,
      leadName: lead?.name || "",
    },
  });
};

module.exports = {
  collectLeadReminderAdminIds,
  notifyLeadReminderDue,
};

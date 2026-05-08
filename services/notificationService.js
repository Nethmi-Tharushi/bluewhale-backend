const AdminUser = require("../models/AdminUser");
const Lead = require("../models/Lead");
const Meeting = require("../models/Meeting");
const Notification = require("../models/Notification");
const User = require("../models/User");
const {
  NOTIFICATION_ROLES,
  getEnabledRolesForEvent,
  mergeInAppNotificationSettings,
} = require("../utils/notificationSettings");

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return String(value._id);
  return String(value);
};

const uniqueIds = (values = []) => [...new Set(values.map(toIdString).filter(Boolean))];

const pickEntityId = (entity) => toIdString(entity?._id || entity?.id);

const getActorSnapshot = (actor = null, fallbackModel = "AdminUser") => ({
  actor: actor?._id || actor?.id || null,
  actorModel: actor?._id || actor?.id ? fallbackModel : null,
  actorName: String(actor?.name || actor?.email || "System").trim(),
});

const getGlobalNotificationSettings = async () => {
  const mainAdmin = await AdminUser.findOne({ role: "MainAdmin" })
    .select("settings.inAppNotifications")
    .lean();

  return mergeInAppNotificationSettings(mainAdmin?.settings?.inAppNotifications || {});
};

const getTaskRelatedAdminIds = async (task) => {
  const ids = [task?.assignedBy];
  const candidateId = task?.candidate?._id || task?.candidate;
  const managedCandidateId = task?.managedCandidateId?._id || task?.managedCandidateId;
  const agentId = task?.agent?._id || task?.agent;

  if (candidateId) {
    const candidate = await User.findById(candidateId).select("assignedTo").lean();
    ids.push(candidate?.assignedTo);
  }

  if (agentId && managedCandidateId) {
    const agent = await User.findById(agentId)
      .select("assignedTo managedCandidates._id managedCandidates.assignedTo")
      .lean();
    const managedCandidate = (agent?.managedCandidates || []).find(
      (item) => toIdString(item?._id) === toIdString(managedCandidateId)
    );
    ids.push(managedCandidate?.assignedTo || agent?.assignedTo);
  }

  return uniqueIds(ids);
};

const getLeadRelatedAdminIds = async (lead) => {
  const ids = [lead?.teamAdmin, lead?.ownerAdmin, lead?.assignedTo];
  const assignedToId = lead?.assignedTo?._id || lead?.assignedTo;

  if (assignedToId) {
    const assignedAdmin = await AdminUser.findById(assignedToId).select("reportsTo").lean();
    ids.push(assignedAdmin?.reportsTo);
  }

  return uniqueIds(ids);
};

const getMeetingRelatedAdminIds = async (meeting) => {
  const meetingId = meeting?._id || meeting?.id;
  const source = meetingId
    ? await Meeting.findById(meetingId)
        .select("candidate candidateType managedCandidateId salesAdmin mainAdmin linkedLeadId")
        .lean()
    : meeting;

  const ids = [source?.salesAdmin, source?.mainAdmin];
  const candidateId = source?.candidate?._id || source?.candidate;
  const managedCandidateId = source?.managedCandidateId || (source?.candidateType === "B2B" ? candidateId : null);

  if (source?.linkedLeadId) {
    const lead = await Lead.findById(source.linkedLeadId).select("teamAdmin ownerAdmin assignedTo").lean();
    ids.push(...(await getLeadRelatedAdminIds(lead)));
  }

  if (source?.candidateType === "B2B" || managedCandidateId) {
    const agent = await User.findOne({
      userType: "agent",
      "managedCandidates._id": managedCandidateId,
    }).select("assignedTo managedCandidates._id managedCandidates.assignedTo").lean();
    const managedCandidate = (agent?.managedCandidates || []).find(
      (item) => toIdString(item?._id) === toIdString(managedCandidateId)
    );
    ids.push(managedCandidate?.assignedTo || agent?.assignedTo);
  } else if (candidateId) {
    const candidate = await User.findById(candidateId).select("assignedTo").lean();
    ids.push(candidate?.assignedTo);
  }

  return uniqueIds(ids);
};

const buildActionUrl = ({ recipientRole, entityType, entityId }) => {
  const base = recipientRole === "MainAdmin" ? "/admin-dashboard" : "/sales-dashboard";
  if (entityType === "Lead") return `${base}/leads/${entityId}`;
  if (entityType === "Task") return `${base}/tasks`;
  if (entityType === "Meeting") return `${base}/meetings`;
  return base;
};

const formatNotification = (notification) => {
  const plain = notification?.toObject ? notification.toObject() : notification;
  if (!plain) return null;
  return {
    id: toIdString(plain._id || plain.id),
    _id: toIdString(plain._id || plain.id),
    type: plain.type,
    title: plain.title,
    message: plain.message || "",
    entityType: plain.entityType,
    entityId: toIdString(plain.entityId),
    actorName: plain.actorName || "",
    actionUrl: plain.actionUrl || "",
    metadata: plain.metadata || {},
    readAt: plain.readAt || null,
    createdAt: plain.createdAt || null,
  };
};

const resolveRecipients = async ({ eventType, relatedAdminIds = [] }) => {
  const settings = await getGlobalNotificationSettings();
  const enabledRoles = getEnabledRolesForEvent(settings, eventType);

  if (!enabledRoles.length) {
    return [];
  }

  const relatedSet = new Set(uniqueIds(relatedAdminIds));
  const admins = await AdminUser.find({ role: { $in: enabledRoles } })
    .select("_id name email role")
    .lean();

  return admins.filter((admin) => {
    if (!NOTIFICATION_ROLES.includes(admin.role)) return false;
    if (admin.role === "MainAdmin") return true;
    if (relatedSet.size === 0) return true;
    return relatedSet.has(toIdString(admin._id));
  });
};

const emitNotifications = (io, notifications = []) => {
  if (!io) return;

  notifications.forEach((notification) => {
    const recipientId = toIdString(notification.recipient);
    const payload = formatNotification(notification);
    if (recipientId && payload) {
      io.to(recipientId).emit("crm:notification", payload);
    }
  });
};

const createNotificationsForEvent = async ({
  io,
  eventType,
  entityType,
  entity,
  title,
  message,
  actor = null,
  actorModel = "AdminUser",
  relatedAdminIds = [],
  metadata = {},
}) => {
  const entityId = pickEntityId(entity);
  if (!eventType || !entityType || !entityId || !title) {
    return [];
  }

  const recipients = await resolveRecipients({ eventType, relatedAdminIds });
  if (!recipients.length) {
    return [];
  }

  const actorSnapshot = getActorSnapshot(actor, actorModel);
  const docs = await Notification.insertMany(
    recipients.map((recipient) => ({
      recipient: recipient._id,
      type: eventType,
      title,
      message,
      entityType,
      entityId,
      ...actorSnapshot,
      actionUrl: buildActionUrl({
        recipientRole: recipient.role,
        entityType,
        entityId,
      }),
      metadata: {
        ...metadata,
        recipientRole: recipient.role,
      },
    }))
  );

  emitNotifications(io, docs);
  return docs;
};

const notifyTaskEvent = async ({ req, eventType, task, title, message, metadata = {}, actor = null, actorModel = "AdminUser" }) => {
  try {
    const relatedAdminIds = await getTaskRelatedAdminIds(task);
    return createNotificationsForEvent({
      io: req?.app?.get("io"),
      eventType,
      entityType: "Task",
      entity: task,
      title,
      message,
      actor: actor || req?.admin || req?.user || null,
      actorModel: actorModel || (req?.user ? "User" : "AdminUser"),
      relatedAdminIds,
      metadata,
    });
  } catch (error) {
    console.error("Task notification failed:", error);
    return [];
  }
};

const notifyLeadEvent = async ({ req, eventType, lead, title, message, metadata = {} }) => {
  try {
    return createNotificationsForEvent({
      io: req?.app?.get("io"),
      eventType,
      entityType: "Lead",
      entity: lead,
      title,
      message,
      actor: req?.admin || null,
      actorModel: "AdminUser",
      relatedAdminIds: await getLeadRelatedAdminIds(lead),
      metadata,
    });
  } catch (error) {
    console.error("Lead notification failed:", error);
    return [];
  }
};

const notifyMeetingEvent = async ({ req, eventType, meeting, title, message, metadata = {} }) => {
  try {
    return createNotificationsForEvent({
      io: req?.app?.get("io"),
      eventType,
      entityType: "Meeting",
      entity: meeting,
      title,
      message,
      actor: req?.admin || null,
      actorModel: "AdminUser",
      relatedAdminIds: await getMeetingRelatedAdminIds(meeting),
      metadata,
    });
  } catch (error) {
    console.error("Meeting notification failed:", error);
    return [];
  }
};

module.exports = {
  createNotificationsForEvent,
  formatNotification,
  getGlobalNotificationSettings,
  notifyLeadEvent,
  notifyMeetingEvent,
  notifyTaskEvent,
};

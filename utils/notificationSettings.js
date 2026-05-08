const NOTIFICATION_ROLES = ["MainAdmin", "SalesAdmin", "SalesStaff"];

const NOTIFICATION_EVENTS = {
  task_created: {
    label: "Task created",
    group: "Tasks",
  },
  task_updated: {
    label: "Task updated",
    group: "Tasks",
  },
  task_completed: {
    label: "Task completed",
    group: "Tasks",
  },
  meeting_created: {
    label: "Meeting created",
    group: "Meetings",
  },
  meeting_updated: {
    label: "Meeting updated",
    group: "Meetings",
  },
  meeting_status_changed: {
    label: "Meeting status changed",
    group: "Meetings",
  },
  lead_created: {
    label: "Lead created",
    group: "Leads",
  },
  lead_assigned: {
    label: "Lead assigned",
    group: "Leads",
  },
  lead_reassigned: {
    label: "Lead reassigned",
    group: "Leads",
  },
  lead_status_changed: {
    label: "Lead status changed",
    group: "Leads",
  },
};

const buildDefaultInAppNotificationSettings = () => ({
  task_created: {
    MainAdmin: true,
    SalesAdmin: true,
    SalesStaff: false,
  },
  task_updated: {
    MainAdmin: true,
    SalesAdmin: true,
    SalesStaff: false,
  },
  task_completed: {
    MainAdmin: true,
    SalesAdmin: true,
    SalesStaff: false,
  },
  meeting_created: {
    MainAdmin: true,
    SalesAdmin: true,
    SalesStaff: true,
  },
  meeting_updated: {
    MainAdmin: true,
    SalesAdmin: true,
    SalesStaff: true,
  },
  meeting_status_changed: {
    MainAdmin: true,
    SalesAdmin: true,
    SalesStaff: true,
  },
  lead_created: {
    MainAdmin: true,
    SalesAdmin: true,
    SalesStaff: false,
  },
  lead_assigned: {
    MainAdmin: true,
    SalesAdmin: true,
    SalesStaff: true,
  },
  lead_reassigned: {
    MainAdmin: true,
    SalesAdmin: true,
    SalesStaff: true,
  },
  lead_status_changed: {
    MainAdmin: true,
    SalesAdmin: true,
    SalesStaff: true,
  },
});

const normalizeRoleMap = (value = {}, fallback = {}) =>
  NOTIFICATION_ROLES.reduce((next, role) => {
    next[role] = typeof value?.[role] === "boolean" ? value[role] : Boolean(fallback?.[role]);
    return next;
  }, {});

const mergeInAppNotificationSettings = (value = {}) => {
  const defaults = buildDefaultInAppNotificationSettings();
  const source = value && typeof value === "object" ? value : {};

  return Object.keys(NOTIFICATION_EVENTS).reduce((next, eventKey) => {
    next[eventKey] = normalizeRoleMap(source[eventKey], defaults[eventKey]);
    return next;
  }, {});
};

const getEnabledRolesForEvent = (settings = {}, eventType = "") => {
  const merged = mergeInAppNotificationSettings(settings);
  return NOTIFICATION_ROLES.filter((role) => Boolean(merged?.[eventType]?.[role]));
};

module.exports = {
  NOTIFICATION_EVENTS,
  NOTIFICATION_ROLES,
  buildDefaultInAppNotificationSettings,
  mergeInAppNotificationSettings,
  getEnabledRolesForEvent,
};

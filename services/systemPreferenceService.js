const SystemPreference = require("../models/SystemPreference");

const DEFAULT_SYSTEM_TIMEZONE = "Asia/Dubai";
const SYSTEM_TIMEZONE_OPTIONS = Object.freeze([
  { value: "Asia/Dubai", label: "Dubai (GMT+04:00)" },
  { value: "Asia/Colombo", label: "Sri Lanka (GMT+05:30)" },
  { value: "Asia/Kolkata", label: "India (GMT+05:30)" },
  { value: "Europe/London", label: "London (GMT+00:00 / GMT+01:00)" },
  { value: "America/New_York", label: "New York (GMT-05:00 / GMT-04:00)" },
  { value: "UTC", label: "UTC (GMT+00:00)" },
]);

const trimString = (value) => String(value || "").trim();

const isSupportedTimeZone = (value = "") => {
  const candidate = trimString(value);
  if (!candidate) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const normalizeSystemTimeZone = (value = "") => {
  const candidate = trimString(value);
  if (!candidate) return DEFAULT_SYSTEM_TIMEZONE;
  if (!isSupportedTimeZone(candidate)) {
    throw new Error("timezone must be a valid IANA timezone");
  }
  return candidate;
};

const getSystemTimeZoneLabel = (value = "") =>
  SYSTEM_TIMEZONE_OPTIONS.find((item) => item.value === value)?.label || value || DEFAULT_SYSTEM_TIMEZONE;

const getSystemPreferenceDocument = async () => {
  let doc = await SystemPreference.findOne({ key: "global" });
  if (!doc) {
    doc = await SystemPreference.create({
      key: "global",
      timezone: DEFAULT_SYSTEM_TIMEZONE,
    });
  }

  if (!isSupportedTimeZone(doc.timezone)) {
    doc.timezone = DEFAULT_SYSTEM_TIMEZONE;
    await doc.save();
  }

  return doc;
};

const getSystemPreferencePayload = async () => {
  const doc = await getSystemPreferenceDocument();
  const timezone = normalizeSystemTimeZone(doc.timezone || DEFAULT_SYSTEM_TIMEZONE);

  return {
    timezone,
    timezoneLabel: getSystemTimeZoneLabel(timezone),
    availableTimezones: SYSTEM_TIMEZONE_OPTIONS,
    updatedAt: doc.updatedAt || null,
    updatedBy: doc.updatedBy || null,
  };
};

const updateSystemTimezone = async ({ timezone, adminId = null }) => {
  const normalizedTimezone = normalizeSystemTimeZone(timezone);
  const doc = await getSystemPreferenceDocument();
  doc.timezone = normalizedTimezone;
  doc.updatedBy = adminId || null;
  await doc.save();
  return getSystemPreferencePayload();
};

const getTimeZoneOffsetMinutes = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const partMap = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});

  const utcTimestamp = Date.UTC(
    Number(partMap.year || 0),
    Math.max(0, Number(partMap.month || 1) - 1),
    Number(partMap.day || 1),
    Number(partMap.hour || 0),
    Number(partMap.minute || 0),
    Number(partMap.second || 0)
  );

  return Math.round((utcTimestamp - date.getTime()) / 60000);
};

const buildUtcDateFromZonedDateTime = ({ date, time = "00:00", timeZone = DEFAULT_SYSTEM_TIMEZONE }) => {
  const safeDate = trimString(date);
  const safeTime = trimString(time) || "00:00";
  const matchedDate = safeDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const matchedTime = safeTime.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);

  if (!matchedDate || !matchedTime) {
    return null;
  }

  const [, yearText, monthText, dayText] = matchedDate;
  const [, hourText, minuteText, secondText = "00"] = matchedTime;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if ([year, month, day, hour, minute, second].some((value) => !Number.isFinite(value))) {
    return null;
  }

  const normalizedTimeZone = normalizeSystemTimeZone(timeZone);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = getTimeZoneOffsetMinutes(new Date(utcGuess), normalizedTimeZone);
  let resolvedTimestamp = utcGuess - firstOffset * 60000;
  const secondOffset = getTimeZoneOffsetMinutes(new Date(resolvedTimestamp), normalizedTimeZone);
  if (secondOffset !== firstOffset) {
    resolvedTimestamp = utcGuess - secondOffset * 60000;
  }

  const resolvedDate = new Date(resolvedTimestamp);
  return Number.isNaN(resolvedDate.getTime()) ? null : resolvedDate;
};

const parseSystemDateInput = async (value, fallbackTime = "00:00") => {
  const raw = trimString(value);
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const { timezone } = await getSystemPreferencePayload();
    return buildUtcDateFromZonedDateTime({
      date: raw,
      time: fallbackTime,
      timeZone: timezone,
    });
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    const [datePart, timePart] = raw.split("T");
    const { timezone } = await getSystemPreferencePayload();
    return buildUtcDateFromZonedDateTime({
      date: datePart,
      time: timePart,
      timeZone: timezone,
    });
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getCurrentSystemDate = async () => {
  const { timezone } = await getSystemPreferencePayload();
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const partMap = formatter.formatToParts(now).reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});

  return new Date(
    Date.UTC(
      Number(partMap.year || 0),
      Math.max(0, Number(partMap.month || 1) - 1),
      Number(partMap.day || 1),
      Number(partMap.hour || 0),
      Number(partMap.minute || 0),
      Number(partMap.second || 0)
    )
  );
};

module.exports = {
  DEFAULT_SYSTEM_TIMEZONE,
  SYSTEM_TIMEZONE_OPTIONS,
  normalizeSystemTimeZone,
  getSystemPreferencePayload,
  updateSystemTimezone,
  buildUtcDateFromZonedDateTime,
  parseSystemDateInput,
  getCurrentSystemDate,
};

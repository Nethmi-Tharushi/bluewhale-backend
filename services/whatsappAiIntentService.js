const AdminUser = require("../models/AdminUser");

const trimString = (value) => String(value || "").trim();
const toMinor = (amount) => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric * 100));
};

const buildFallbackSettings = () => ({
  enabled: String(process.env.WHATSAPP_AI_INTENT_ENABLED || "").toLowerCase() === "true",
  chargeMinor: toMinor(
    process.env.WHATSAPP_AI_INTENT_CHARGE_MINOR ||
      process.env.WHATSAPP_AI_INTENT_CHARGE ||
      process.env.WHATSAPP_AI_INTENT_PRICE ||
      0.01
  ),
  matchThreshold: Math.min(
    0.95,
    Math.max(0.1, Number(process.env.WHATSAPP_AI_INTENT_MATCH_THRESHOLD || 0.55) || 0.55)
  ),
  source: "environment",
});

const normalizeAiIntentSettings = (value = {}) => {
  const fallback = buildFallbackSettings();
  const saved = value && typeof value === "object" ? value : {};
  const enabled = typeof saved.enabled === "boolean" ? saved.enabled : fallback.enabled;
  const chargeMinor = Number.isFinite(Number(saved.chargeMinor))
    ? Math.max(0, Math.round(Number(saved.chargeMinor)))
    : fallback.chargeMinor;
  const matchThreshold = Number.isFinite(Number(saved.matchThreshold))
    ? Math.min(0.95, Math.max(0.1, Number(saved.matchThreshold)))
    : fallback.matchThreshold;

  return {
    enabled,
    chargeMinor,
    charge: Number((chargeMinor / 100).toFixed(2)),
    matchThreshold,
    source: trimString(saved.enabled !== undefined || saved.chargeMinor !== undefined || saved.matchThreshold !== undefined)
      ? "settings"
      : fallback.source,
    isConfigured: Boolean(enabled || chargeMinor > 0),
    isSavedConfigured: Boolean(saved.enabled !== undefined || saved.chargeMinor !== undefined || saved.matchThreshold !== undefined),
    isFallbackConfigured: Boolean(fallback.enabled || fallback.chargeMinor > 0),
  };
};

let cachedSettings = null;
let cachedAt = 0;
const CACHE_TTL_MS = 15000;

const loadWhatsAppAiIntentSettings = async ({ refresh = false } = {}) => {
  if (!refresh && cachedSettings && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }

  const mainAdmin = await AdminUser.findOne({ role: "MainAdmin" })
    .select("settings.whatsappAiIntentAutomation")
    .lean();

  cachedSettings = normalizeAiIntentSettings(mainAdmin?.settings?.whatsappAiIntentAutomation || {});
  cachedAt = Date.now();
  return cachedSettings;
};

const getWhatsAppAiIntentSettingsSnapshot = () => cachedSettings || normalizeAiIntentSettings({});

const syncWhatsAppAiIntentSettingsCache = (value = {}) => {
  cachedSettings = normalizeAiIntentSettings(value);
  cachedAt = Date.now();
  return cachedSettings;
};

module.exports = {
  loadWhatsAppAiIntentSettings,
  getWhatsAppAiIntentSettingsSnapshot,
  syncWhatsAppAiIntentSettingsCache,
  normalizeAiIntentSettings,
  toMinor,
};

const {
  getSystemPreferencePayload,
  updateSystemTimezone,
} = require("../services/systemPreferenceService");

const getPublicSystemPreferences = async (_req, res) => {
  try {
    const payload = await getSystemPreferencePayload();
    res.json({ success: true, ...payload });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to load system preferences" });
  }
};

const updateSystemPreferences = async (req, res) => {
  try {
    const payload = await updateSystemTimezone({
      timezone: req.body?.timezone,
      adminId: req.admin?._id || null,
    });
    res.json({ success: true, message: "System timezone updated", ...payload });
  } catch (error) {
    const statusCode =
      String(error.message || "").toLowerCase().includes("timezone must be a valid iana timezone") ? 400 : 500;
    res.status(statusCode).json({ message: error.message || "Failed to update system timezone" });
  }
};

module.exports = {
  getPublicSystemPreferences,
  updateSystemPreferences,
};

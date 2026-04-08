const {
  listAgentSettings,
  getAgentSettingsMeta,
} = require("../services/adminManagementService");

const handleAdminManagementError = (res, error) => {
  if (error?.status) {
    const payload = {
      success: false,
      message: error.message,
    };

    if (error.code) {
      payload.code = error.code;
    }

    return res.status(error.status).json(payload);
  }

  return res.status(500).json({
    success: false,
    message: error?.message || "Internal server error",
  });
};

exports.getAgentSettings = async (req, res) => {
  try {
    const data = await listAgentSettings(req.query || {}, req.admin);
    return res.json({ success: true, data });
  } catch (error) {
    return handleAdminManagementError(res, error);
  }
};

exports.getAgentSettingsMetadata = async (req, res) => {
  try {
    const data = await getAgentSettingsMeta(req.admin);
    return res.json({ success: true, data });
  } catch (error) {
    return handleAdminManagementError(res, error);
  }
};

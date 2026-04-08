const {
  listRolePermissionProfiles,
  getRolePermissionProfile,
  updateRolePermissionProfile,
  resetRolePermissionProfiles,
} = require("../services/rolePermissionProfileService");

const handleRolePermissionError = (res, error) => {
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

exports.listRolePermissions = async (req, res) => {
  try {
    const data = await listRolePermissionProfiles({
      actorId: req.admin?._id || null,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleRolePermissionError(res, error);
  }
};

exports.getRolePermission = async (req, res) => {
  try {
    const data = await getRolePermissionProfile(req.params.profileKey, {
      actorId: req.admin?._id || null,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleRolePermissionError(res, error);
  }
};

exports.updateRolePermission = async (req, res) => {
  try {
    const data = await updateRolePermissionProfile(
      req.params.profileKey,
      req.body?.permissions || {},
      req.admin
    );
    return res.json({ success: true, data });
  } catch (error) {
    return handleRolePermissionError(res, error);
  }
};

exports.resetRolePermissions = async (req, res) => {
  try {
    const data = await resetRolePermissionProfiles({
      profileKey: req.body?.profileKey || null,
      all: Boolean(req.body?.all),
      actor: req.admin,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleRolePermissionError(res, error);
  }
};

const {
  getWhatsAppBusinessProfile,
  updateWhatsAppBusinessProfile,
  uploadWhatsAppBusinessProfileLogo,
  deleteWhatsAppBusinessProfileLogo,
} = require("../services/whatsappProfileService");

const handleProfileError = (res, error, fallbackMessage) => {
  console.error(fallbackMessage, error);
  return res.status(error?.status || 400).json({
    success: false,
    message: error?.message || fallbackMessage,
    ...(error?.code ? { code: error.code } : {}),
  });
};

const getWhatsAppProfile = async (_req, res) => {
  try {
    const data = await getWhatsAppBusinessProfile();
    return res.json({ success: true, data });
  } catch (error) {
    return handleProfileError(res, error, "Failed to fetch WhatsApp profile");
  }
};

const updateWhatsAppProfile = async (req, res) => {
  try {
    const data = await updateWhatsAppBusinessProfile(req.body || {}, req.admin);
    return res.json({ success: true, data });
  } catch (error) {
    return handleProfileError(res, error, "Failed to update WhatsApp profile");
  }
};

const uploadWhatsAppProfileLogo = async (req, res) => {
  try {
    const data = await uploadWhatsAppBusinessProfileLogo({
      file: req.file,
      actor: req.admin,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleProfileError(res, error, "Failed to upload WhatsApp profile logo");
  }
};

const removeWhatsAppProfileLogo = async (req, res) => {
  try {
    const data = await deleteWhatsAppBusinessProfileLogo({
      actor: req.admin,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleProfileError(res, error, "Failed to remove WhatsApp profile logo");
  }
};

module.exports = {
  getWhatsAppProfile,
  updateWhatsAppProfile,
  uploadWhatsAppProfileLogo,
  removeWhatsAppProfileLogo,
};

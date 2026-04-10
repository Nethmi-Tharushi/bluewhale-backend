const {
  getAiIntentMatchingOverview,
  updateAiIntentMatchingSettings,
  listAiIntentMatchHistory,
  previewAiIntentMatch,
} = require("../services/whatsappAiIntentMatchingService");

const trimString = (value) => String(value || "").trim();

const getWhatsAppAiIntentMatching = async (_req, res) => {
  try {
    const overview = await getAiIntentMatchingOverview();
    return res.json({ success: true, data: overview });
  } catch (error) {
    console.error("Failed to fetch WhatsApp AI intent matching settings:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch AI intent matching settings" });
  }
};

const updateWhatsAppAiIntentMatching = async (req, res) => {
  try {
    const overview = await updateAiIntentMatchingSettings({
      payload: req.body || {},
      actor: req.admin || null,
    });

    return res.json({ success: true, data: overview });
  } catch (error) {
    console.error("Failed to update WhatsApp AI intent matching settings:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to update AI intent matching settings" });
  }
};

const getWhatsAppAiIntentMatchingHistory = async (req, res) => {
  try {
    const history = await listAiIntentMatchHistory({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      matchMode: req.query.matchMode,
      search: req.query.search,
    });

    return res.json({ success: true, data: history });
  } catch (error) {
    console.error("Failed to fetch WhatsApp AI intent matching history:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to fetch AI intent matching history" });
  }
};

const testWhatsAppAiIntentMatching = async (req, res) => {
  try {
    const result = await previewAiIntentMatch({
      app: req.app,
      actor: req.admin || null,
      message: req.body?.message,
      conversationId: req.body?.conversationId,
      customerPhone: req.body?.customerPhone,
      send: req.body?.send,
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Failed to test WhatsApp AI intent matching:", error);
    const statusCode = error.status || (/required|invalid/i.test(trimString(error.message)) ? 400 : 500);
    return res.status(statusCode).json({ message: error.message || "Failed to test AI intent matching" });
  }
};

module.exports = {
  getWhatsAppAiIntentMatching,
  updateWhatsAppAiIntentMatching,
  getWhatsAppAiIntentMatchingHistory,
  testWhatsAppAiIntentMatching,
};

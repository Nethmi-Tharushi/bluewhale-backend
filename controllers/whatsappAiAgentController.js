const {
  getWhatsAppAiAgentOverview,
  updateWhatsAppAiAgentSettings,
  createWhatsAppAiAgentInterest,
  listWhatsAppAiAgentInterests,
  updateWhatsAppAiAgentInterestStatus,
  updateWhatsAppAiAgentInterest,
  previewWhatsAppAiAgent,
  listWhatsAppAiAgentHistory,
} = require("../services/whatsappAiAgentService");

const trimString = (value) => String(value || "").trim();

const getWhatsAppAiAgent = async (_req, res) => {
  try {
    const overview = await getWhatsAppAiAgentOverview();
    return res.json({ success: true, data: overview });
  } catch (error) {
    console.error("Failed to fetch WhatsApp AI Agent settings:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch WhatsApp AI Agent settings" });
  }
};

const updateWhatsAppAiAgent = async (req, res) => {
  try {
    const overview = await updateWhatsAppAiAgentSettings({
      payload: req.body || {},
      actor: req.admin || null,
    });
    return res.json({ success: true, data: overview });
  } catch (error) {
    console.error("Failed to update WhatsApp AI Agent settings:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to update WhatsApp AI Agent settings" });
  }
};

const submitWhatsAppAiAgentInterest = async (req, res) => {
  try {
    const item = await createWhatsAppAiAgentInterest({
      payload: req.body || {},
      actor: req.admin || null,
    });
    return res.status(201).json({ success: true, data: item });
  } catch (error) {
    console.error("Failed to create WhatsApp AI Agent interest submission:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to create interest submission" });
  }
};

const getWhatsAppAiAgentInterests = async (req, res) => {
  try {
    const list = await listWhatsAppAiAgentInterests({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      search: req.query.search,
    });
    return res.json({ success: true, data: list });
  } catch (error) {
    console.error("Failed to fetch WhatsApp AI Agent interests:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to fetch AI Agent interests" });
  }
};

const patchWhatsAppAiAgentInterestStatus = async (req, res) => {
  try {
    const item = await updateWhatsAppAiAgentInterestStatus({
      id: req.params.id,
      status: req.body?.status,
      actor: req.admin || null,
    });
    return res.json({ success: true, data: item });
  } catch (error) {
    console.error("Failed to update WhatsApp AI Agent interest status:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to update AI Agent interest status" });
  }
};

const patchWhatsAppAiAgentInterest = async (req, res) => {
  try {
    const item = await updateWhatsAppAiAgentInterest({
      id: req.params.id,
      payload: req.body || {},
      actor: req.admin || null,
    });
    return res.json({ success: true, data: item });
  } catch (error) {
    console.error("Failed to update WhatsApp AI Agent interest:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to update AI Agent interest" });
  }
};

const testWhatsAppAiAgent = async (req, res) => {
  try {
    const result = await previewWhatsAppAiAgent({
      app: req.app,
      actor: req.admin || null,
      agentType: req.body?.agentType,
      message: req.body?.message,
      conversationId: req.body?.conversationId,
      customerPhone: req.body?.customerPhone,
      send: req.body?.send,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Failed to preview WhatsApp AI Agent:", error);
    const statusCode = error.status || (/required|invalid/i.test(trimString(error.message)) ? 400 : 500);
    return res.status(statusCode).json({ message: error.message || "Failed to preview WhatsApp AI Agent" });
  }
};

const getWhatsAppAiAgentHistory = async (req, res) => {
  try {
    const history = await listWhatsAppAiAgentHistory({
      page: req.query.page,
      limit: req.query.limit,
      agentType: req.query.agentType,
      responseSource: req.query.responseSource,
      handoffTriggered: req.query.handoffTriggered,
      leadCaptured: req.query.leadCaptured,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      customerPhone: req.query.customerPhone,
      conversationId: req.query.conversationId,
    });
    return res.json({ success: true, data: history });
  } catch (error) {
    console.error("Failed to fetch WhatsApp AI Agent history:", error);
    return res.status(error.status || 400).json({ message: error.message || "Failed to fetch WhatsApp AI Agent history" });
  }
};

module.exports = {
  getWhatsAppAiAgent,
  updateWhatsAppAiAgent,
  submitWhatsAppAiAgentInterest,
  getWhatsAppAiAgentInterests,
  patchWhatsAppAiAgentInterestStatus,
  patchWhatsAppAiAgentInterest,
  testWhatsAppAiAgent,
  getWhatsAppAiAgentHistory,
};

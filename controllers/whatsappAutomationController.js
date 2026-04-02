const AdminUser = require("../models/AdminUser");
const { listTemplates } = require("../services/whatsappTemplateService");
const {
  listAutomations,
  listAutomationJobs,
  createAutomation,
  updateAutomation,
  toggleAutomation,
  deleteAutomation,
} = require("../services/whatsappAutomationService");

const canManageAutomations = (admin) => ["MainAdmin", "SalesAdmin"].includes(String(admin?.role || ""));

const getWhatsAppAutomations = async (_req, res) => {
  try {
    const [automations, recentRuns, agents, templates] = await Promise.all([
      listAutomations(),
      listAutomationJobs({}),
      AdminUser.find({ role: "SalesStaff" }).select("_id name email role").sort({ createdAt: 1 }).lean(),
      listTemplates({ status: "APPROVED" }),
    ]);

    return res.json({
      success: true,
      data: automations,
      recentRuns,
      agents,
      approvedTemplates: templates,
    });
  } catch (error) {
    console.error("Failed to load WhatsApp automations:", error);
    return res.status(500).json({ message: error.message || "Failed to load WhatsApp automations" });
  }
};

const createWhatsAppAutomation = async (req, res) => {
  try {
    if (!canManageAutomations(req.admin)) {
      return res.status(403).json({ message: "Access denied: only MainAdmin or SalesAdmin can manage automations" });
    }

    const automation = await createAutomation({
      payload: req.body,
      adminId: req.admin?._id || null,
    });

    return res.status(201).json({ success: true, data: automation });
  } catch (error) {
    console.error("Failed to create WhatsApp automation:", error);
    return res.status(400).json({ message: error.message || "Failed to create WhatsApp automation" });
  }
};

const updateWhatsAppAutomation = async (req, res) => {
  try {
    if (!canManageAutomations(req.admin)) {
      return res.status(403).json({ message: "Access denied: only MainAdmin or SalesAdmin can manage automations" });
    }

    const automation = await updateAutomation({
      automationId: req.params.automationId,
      payload: req.body,
      adminId: req.admin?._id || null,
    });

    return res.json({ success: true, data: automation });
  } catch (error) {
    console.error("Failed to update WhatsApp automation:", error);
    return res.status(400).json({ message: error.message || "Failed to update WhatsApp automation" });
  }
};

const setWhatsAppAutomationEnabled = async (req, res) => {
  try {
    if (!canManageAutomations(req.admin)) {
      return res.status(403).json({ message: "Access denied: only MainAdmin or SalesAdmin can manage automations" });
    }

    const automation = await toggleAutomation({
      automationId: req.params.automationId,
      enabled: req.body?.enabled !== false,
      adminId: req.admin?._id || null,
    });

    return res.json({ success: true, data: automation });
  } catch (error) {
    console.error("Failed to update WhatsApp automation status:", error);
    return res.status(400).json({ message: error.message || "Failed to update WhatsApp automation status" });
  }
};

const removeWhatsAppAutomation = async (req, res) => {
  try {
    if (!canManageAutomations(req.admin)) {
      return res.status(403).json({ message: "Access denied: only MainAdmin or SalesAdmin can manage automations" });
    }

    await deleteAutomation({ automationId: req.params.automationId });
    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete WhatsApp automation:", error);
    return res.status(400).json({ message: error.message || "Failed to delete WhatsApp automation" });
  }
};

module.exports = {
  getWhatsAppAutomations,
  createWhatsAppAutomation,
  updateWhatsAppAutomation,
  setWhatsAppAutomationEnabled,
  removeWhatsAppAutomation,
};

const {
  listWhatsAppContactHub,
  createWhatsAppContactHubRecord,
  updateWhatsAppContactHubRecord,
  updateWhatsAppContactHubStatus,
  bulkUpdateWhatsAppContactHub,
  exportWhatsAppContactHubCsv,
  getWhatsAppContactHubMeta,
} = require("../services/whatsappContactHubService");

const trimString = (value) => String(value || "").trim();

const buildStructuredErrorPayload = (error, fallbackMessage) => ({
  success: false,
  message: error.message || fallbackMessage,
  ...(error.code ? { code: trimString(error.code) } : {}),
  ...(error.field ? { field: trimString(error.field) } : {}),
  ...(error.details && typeof error.details === "object" ? { details: error.details } : {}),
});

const getAuthenticatedActor = (req) => req.admin || req.user || null;

const listContactHub = async (req, res) => {
  try {
    const result = await listWhatsAppContactHub(req.query || {});
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Failed to fetch WhatsApp contact hub:", error);
    return res.status(error.status || 400).json(buildStructuredErrorPayload(error, "Failed to fetch WhatsApp contact hub"));
  }
};

const createContactHubRecord = async (req, res) => {
  try {
    const actor = getAuthenticatedActor(req);
    const result = await createWhatsAppContactHubRecord(req.body || {}, actor?._id || null);
    return res.status(result.created ? 201 : 200).json({
      success: true,
      data: result.item,
    });
  } catch (error) {
    console.error("Failed to create WhatsApp contact hub record:", error);
    return res.status(error.status || 400).json(buildStructuredErrorPayload(error, "Failed to create WhatsApp contact hub record"));
  }
};

const updateContactHubRecord = async (req, res) => {
  try {
    const actor = getAuthenticatedActor(req);
    const result = await updateWhatsAppContactHubRecord(req.params.id, req.body || {}, actor?._id || null);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Failed to update WhatsApp contact hub record:", error);
    return res.status(error.status || 400).json(buildStructuredErrorPayload(error, "Failed to update WhatsApp contact hub record"));
  }
};

const updateContactHubStatus = async (req, res) => {
  try {
    const actor = getAuthenticatedActor(req);
    const result = await updateWhatsAppContactHubStatus(req.params.id, req.body?.status, actor?._id || null);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Failed to update WhatsApp contact hub status:", error);
    return res.status(error.status || 400).json(buildStructuredErrorPayload(error, "Failed to update WhatsApp contact hub status"));
  }
};

const bulkUpdateContactHub = async (req, res) => {
  try {
    const actor = getAuthenticatedActor(req);
    const result = await bulkUpdateWhatsAppContactHub({
      ids: req.body?.ids,
      action: req.body?.action,
      payload: req.body?.payload || {},
      actorId: actor?._id || null,
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Failed to bulk update WhatsApp contact hub records:", error);
    return res.status(error.status || 400).json(buildStructuredErrorPayload(error, "Failed to bulk update WhatsApp contact hub records"));
  }
};

const exportContactHubCsv = async (req, res) => {
  try {
    const csv = await exportWhatsAppContactHubCsv(req.query || {});
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"whatsapp-contact-hub.csv\"");
    return res.status(200).send(csv);
  } catch (error) {
    console.error("Failed to export WhatsApp contact hub CSV:", error);
    return res.status(error.status || 400).json(buildStructuredErrorPayload(error, "Failed to export WhatsApp contact hub CSV"));
  }
};

const getContactHubMeta = async (_req, res) => {
  try {
    const result = await getWhatsAppContactHubMeta();
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Failed to fetch WhatsApp contact hub meta:", error);
    return res.status(error.status || 400).json(buildStructuredErrorPayload(error, "Failed to fetch WhatsApp contact hub meta"));
  }
};

module.exports = {
  listContactHub,
  createContactHubRecord,
  updateContactHubRecord,
  updateContactHubStatus,
  bulkUpdateContactHub,
  exportContactHubCsv,
  getContactHubMeta,
};

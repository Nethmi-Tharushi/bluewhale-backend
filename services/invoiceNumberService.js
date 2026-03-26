const Invoice = require("../models/Invoice");

const generateInvoiceNumber = async () => {
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const pattern = new RegExp(`^${prefix}-\\d{4}$`);
  const latest = await Invoice.findOne({ invoiceNumber: { $regex: pattern } })
    .sort({ invoiceNumber: -1 })
    .select("invoiceNumber");
  const seq = latest ? Number(String(latest.invoiceNumber).split("-").pop()) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
};

const isDuplicateInvoiceNumberError = (error) => (
  error?.code === 11000 && Object.prototype.hasOwnProperty.call(error?.keyPattern || {}, "invoiceNumber")
);

const normalizeInvoicePersistenceError = (error, fallbackMessage = "Failed to create invoice") => {
  if (isDuplicateInvoiceNumberError(error)) {
    const normalized = new Error("Invoice number conflict. Please retry the conversion.");
    normalized.statusCode = 409;
    normalized.details = {
      invoiceNumber: error?.keyValue?.invoiceNumber || "",
    };
    return normalized;
  }

  if (error?.name === "ValidationError") {
    const normalized = new Error(error.message || fallbackMessage);
    normalized.statusCode = 400;
    normalized.details = Object.values(error.errors || {}).map((item) => item.message);
    return normalized;
  }

  return error;
};

const createInvoiceWithGeneratedNumber = async (invoiceData, options = {}) => {
  const maxAttempts = Number(options.maxAttempts || 3);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const invoiceNumber = await generateInvoiceNumber();

    try {
      return await Invoice.create({
        ...invoiceData,
        invoiceNumber,
      });
    } catch (error) {
      if (isDuplicateInvoiceNumberError(error) && attempt < maxAttempts) {
        continue;
      }

      throw normalizeInvoicePersistenceError(error);
    }
  }

  const exhausted = new Error("Failed to generate a unique invoice number");
  exhausted.statusCode = 409;
  throw exhausted;
};

module.exports = {
  createInvoiceWithGeneratedNumber,
  generateInvoiceNumber,
  normalizeInvoicePersistenceError,
};

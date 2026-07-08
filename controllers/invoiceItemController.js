const asyncHandler = require("express-async-handler");
const { Types } = require("mongoose");
const Invoice = require("../models/Invoice");
const InvoiceItem = require("../models/InvoiceItem");
const { INSTALLMENT_TYPES } = require("../models/InvoiceItem");

const READ_ROLES = new Set(["MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"]);
const MANAGE_ROLES = new Set(["MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"]);

const toIdString = (value) => String(value?._id || value || "");

const formatInvoiceItem = (item) => {
  const plain = item?.toObject ? item.toObject() : item || {};
  return {
    ...plain,
    _id: toIdString(plain._id),
    itemName: String(plain.itemName || "").trim(),
    packageCountry: String(plain.packageCountry || "").trim(),
    packageName: String(plain.packageName || "").trim(),
    installmentType: String(plain.installmentType || "No Installment / General Item").trim(),
    price: Number(plain.price || 0),
    currency: String(plain.currency || "USD").trim().toUpperCase(),
    description: String(plain.description || "").trim(),
    isActive: plain.isActive !== false,
    createdBy: toIdString(plain.createdBy),
    updatedBy: toIdString(plain.updatedBy),
  };
};

const ensureReadAccess = (req) => {
  const role = String(req.admin?.role || "");
  if (!READ_ROLES.has(role)) {
    const error = new Error("Access denied");
    error.statusCode = 403;
    throw error;
  }
};

const ensureManageAccess = (req) => {
  const role = String(req.admin?.role || "");
  if (!MANAGE_ROLES.has(role)) {
    const error = new Error("Only Main Admin, Sales Admin, Sales Staff, and Accountant can manage invoice items");
    error.statusCode = 403;
    throw error;
  }
};

const parseBooleanFilter = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "all") return null;
  if (["true", "active", "1", "yes"].includes(normalized)) return true;
  if (["false", "inactive", "0", "no"].includes(normalized)) return false;
  return null;
};

const validatePayload = (body = {}, partial = false) => {
  const hasItemName = Object.prototype.hasOwnProperty.call(body, "itemName") || Object.prototype.hasOwnProperty.call(body, "name");
  const hasInstallmentType = Object.prototype.hasOwnProperty.call(body, "installmentType");
  const hasCurrency = Object.prototype.hasOwnProperty.call(body, "currency");
  const hasPackageCountry = Object.prototype.hasOwnProperty.call(body, "packageCountry") || Object.prototype.hasOwnProperty.call(body, "country");
  const hasPackageName = Object.prototype.hasOwnProperty.call(body, "packageName");
  const hasDescription = Object.prototype.hasOwnProperty.call(body, "description") || Object.prototype.hasOwnProperty.call(body, "notes");
  const itemName = String(body.itemName || body.name || "").trim();
  const installmentType = String(body.installmentType || (partial ? "" : "No Installment / General Item")).trim();
  const hasPrice = Object.prototype.hasOwnProperty.call(body, "price");
  const price = hasPrice ? Number(body.price) : undefined;
  const currency = String(body.currency || (partial ? "" : "USD")).trim().toUpperCase();

  if (!partial && !itemName) return { error: "Item name is required" };
  if (hasItemName && itemName.length > 180) return { error: "Item name is too long" };
  if (hasInstallmentType && !INSTALLMENT_TYPES.includes(installmentType)) return { error: "Invalid installment type" };
  if (!partial && !hasPrice) return { error: "Price is required" };
  if (hasPrice && (!Number.isFinite(price) || price < 0)) return { error: "Price must be a non-negative number" };
  if (hasCurrency && currency && !/^[A-Z]{3}$/.test(currency)) return { error: "Currency must be a 3-letter code" };

  return {
    value: {
      ...(hasItemName ? { itemName } : {}),
      ...(hasPackageCountry ? { packageCountry: String(body.packageCountry || body.country || "").trim() } : {}),
      ...(hasPackageName ? { packageName: String(body.packageName || "").trim() } : {}),
      ...(hasInstallmentType || !partial ? { installmentType } : {}),
      ...(hasPrice ? { price } : {}),
      ...(hasCurrency || !partial ? { currency: currency || "USD" } : {}),
      ...(hasDescription ? { description: String(body.description || body.notes || "").trim() } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "isActive") ? { isActive: body.isActive === true || body.isActive === "true" || body.isActive === 1 || body.isActive === "1" } : {}),
    },
  };
};

const buildFilter = (query = {}) => {
  const filter = {};
  const q = String(query.q || query.search || "").trim();
  const country = String(query.country || "").trim();
  const packageName = String(query.packageName || "").trim();
  const installmentType = String(query.installmentType || "").trim();
  const active = parseBooleanFilter(query.active ?? query.isActive);

  if (q) {
    filter.$or = [
      { itemName: { $regex: q, $options: "i" } },
      { packageCountry: { $regex: q, $options: "i" } },
      { packageName: { $regex: q, $options: "i" } },
      { description: { $regex: q, $options: "i" } },
    ];
  }
  if (country) filter.packageCountry = { $regex: `^${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" };
  if (packageName) filter.packageName = { $regex: packageName, $options: "i" };
  if (installmentType && INSTALLMENT_TYPES.includes(installmentType)) filter.installmentType = installmentType;
  if (active !== null) filter.isActive = active;

  return filter;
};

const listInvoiceItems = asyncHandler(async (req, res) => {
  ensureReadAccess(req);
  const filter = buildFilter(req.query || {});
  const items = await InvoiceItem.find(filter).sort({ isActive: -1, packageCountry: 1, packageName: 1, itemName: 1 }).lean();
  return res.json({ success: true, data: items.map(formatInvoiceItem), installmentTypes: INSTALLMENT_TYPES });
});

const getInvoiceItemById = asyncHandler(async (req, res) => {
  ensureReadAccess(req);
  const id = String(req.params.id || "").trim();
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid invoice item id" });

  const item = await InvoiceItem.findById(id).lean();
  if (!item) return res.status(404).json({ message: "Invoice item not found" });
  return res.json({ success: true, data: formatInvoiceItem(item) });
});

const createInvoiceItem = asyncHandler(async (req, res) => {
  ensureManageAccess(req);
  const parsed = validatePayload(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const item = await InvoiceItem.create({
    ...parsed.value,
    createdBy: req.admin?._id || null,
    updatedBy: req.admin?._id || null,
  });

  return res.status(201).json({ success: true, data: formatInvoiceItem(item) });
});

const updateInvoiceItem = asyncHandler(async (req, res) => {
  ensureManageAccess(req);
  const id = String(req.params.id || "").trim();
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid invoice item id" });

  const parsed = validatePayload(req.body || {}, true);
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const item = await InvoiceItem.findById(id);
  if (!item) return res.status(404).json({ message: "Invoice item not found" });

  Object.assign(item, parsed.value, { updatedBy: req.admin?._id || null });
  await item.save();
  return res.json({ success: true, data: formatInvoiceItem(item) });
});

const deleteInvoiceItem = asyncHandler(async (req, res) => {
  ensureManageAccess(req);
  const id = String(req.params.id || "").trim();
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid invoice item id" });

  const item = await InvoiceItem.findById(id);
  if (!item) return res.status(404).json({ message: "Invoice item not found" });

  const usedCount = await Invoice.countDocuments({ "items.predefinedItemId": item._id });
  if (usedCount > 0) {
    item.isActive = false;
    item.updatedBy = req.admin?._id || null;
    await item.save();
    return res.json({
      success: true,
      message: "Invoice item is used by existing invoices, so it was deactivated instead of deleted",
      data: formatInvoiceItem(item),
      deactivated: true,
    });
  }

  await InvoiceItem.deleteOne({ _id: item._id });
  return res.json({ success: true, message: "Invoice item deleted successfully", deleted: true });
});

module.exports = {
  INSTALLMENT_TYPES,
  listInvoiceItems,
  getInvoiceItemById,
  createInvoiceItem,
  updateInvoiceItem,
  deleteInvoiceItem,
};

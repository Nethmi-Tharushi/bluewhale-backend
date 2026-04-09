const { Types } = require("mongoose");
const WhatsAppProductCollection = require("../models/WhatsAppProductCollection");
const { loadWhatsAppMetaConnection } = require("./whatsappMetaConnectionService");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_BUTTON_TEXT_LENGTH = 20;
const MAX_PRODUCT_ITEMS = 30;

const trimString = (value) => String(value || "").trim();
const slugify = (value) =>
  trimString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const clampPositiveInteger = (value, fallback, maxValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.trunc(parsed);
  if (normalized < 1) {
    return fallback;
  }

  if (maxValue && normalized > maxValue) {
    return maxValue;
  }

  return normalized;
};

const normalizeProductCollectionItem = (item = {}, index = 0) => {
  const id = trimString(item.id || item.value || item.itemId || `item_${index + 1}`);
  const title = trimString(item.title || item.label || item.name);

  return {
    id,
    title,
    description: trimString(item.description),
  };
};

const normalizeProductCollectionItems = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item, index) => normalizeProductCollectionItem(item, index))
    .filter((item) => item.id && item.title);

const countProductCollectionItems = (items = []) => normalizeProductCollectionItems(items).length;

const buildProductCollectionValidationError = (reason, status = 400) => {
  const error = new Error(reason);
  error.status = status;
  return error;
};

const validateProductCollectionSnapshot = ({
  items = [],
  buttonText = "",
  requireActive = false,
  isActive = true,
} = {}) => {
  const normalizedItems = normalizeProductCollectionItems(items);
  const trimmedButtonText = trimString(buttonText);
  const itemIds = normalizedItems.map((item) => item.id);
  const duplicateItemId = itemIds.find((itemId, index) => itemIds.indexOf(itemId) !== index);

  if (requireActive && isActive === false) {
    return { valid: false, reason: "Product collection is inactive", items: normalizedItems };
  }

  if (!trimmedButtonText) {
    return { valid: false, reason: "Product collection button text is required", items: normalizedItems };
  }

  if (trimmedButtonText.length > MAX_BUTTON_TEXT_LENGTH) {
    return {
      valid: false,
      reason: `Product collection button text must be ${MAX_BUTTON_TEXT_LENGTH} characters or fewer`,
      items: normalizedItems,
    };
  }

  if (normalizedItems.length < 1) {
    return { valid: false, reason: "Product collection must contain at least one item", items: normalizedItems };
  }

  if (normalizedItems.length > MAX_PRODUCT_ITEMS) {
    return {
      valid: false,
      reason: `Product collection supports at most ${MAX_PRODUCT_ITEMS} items`,
      items: normalizedItems,
    };
  }

  if (itemIds.some((itemId) => !trimString(itemId))) {
    return { valid: false, reason: "Product collection items require non-empty ids", items: normalizedItems };
  }

  if (duplicateItemId) {
    return {
      valid: false,
      reason: `Product collection item ids must be unique. Duplicate id: ${duplicateItemId}`,
      items: normalizedItems,
    };
  }

  return {
    valid: true,
    reason: "",
    items: normalizedItems,
    itemCount: normalizedItems.length,
  };
};

const normalizeProductCollectionPayload = (payload = {}, current = {}) => {
  const name = trimString(payload.name ?? current.name);
  const buttonText = trimString(payload.buttonText ?? current.buttonText);
  const description = trimString(payload.description ?? current.description);
  const category = trimString(payload.category ?? current.category);
  const isActive =
    payload.isActive === undefined
      ? current.isActive === undefined
        ? true
        : Boolean(current.isActive)
      : Boolean(payload.isActive);
  const items = normalizeProductCollectionItems(payload.items ?? current.items);

  if (!name) {
    throw buildProductCollectionValidationError("Product collection name is required");
  }

  if (!buttonText) {
    throw buildProductCollectionValidationError("Product collection button text is required");
  }

  const validation = validateProductCollectionSnapshot({
    items,
    buttonText,
    requireActive: false,
    isActive,
  });

  if (!validation.valid) {
    throw buildProductCollectionValidationError(validation.reason);
  }

  return {
    name,
    description,
    buttonText,
    category,
    isActive,
    items: validation.items,
  };
};

const findProductCollectionDocument = async (id) => {
  const productCollectionId = trimString(id);
  if (!productCollectionId) {
    return null;
  }

  const filter = Types.ObjectId.isValid(productCollectionId)
    ? { $or: [{ _id: productCollectionId }, { slug: productCollectionId }] }
    : { slug: slugify(productCollectionId) };

  return WhatsAppProductCollection.findOne(filter);
};

const resolveUniqueSlug = async (name, currentId = null) => {
  const baseSlug = slugify(name) || `collection-${Date.now()}`;
  let candidate = baseSlug;
  let suffix = 1;

  while (await WhatsAppProductCollection.exists({
    slug: candidate,
    ...(currentId ? { _id: { $ne: currentId } } : {}),
  })) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return candidate;
};

const serializeProductCollection = (record = {}) => {
  const plain = record?.toObject ? record.toObject() : record || {};
  const items = normalizeProductCollectionItems(plain.items);
  const validation = validateProductCollectionSnapshot({
    items,
    buttonText: plain.buttonText,
    isActive: plain.isActive !== false,
  });

  return {
    id: trimString(plain._id || plain.id),
    slug: trimString(plain.slug || slugify(plain.name)),
    name: trimString(plain.name),
    description: trimString(plain.description),
    buttonText: trimString(plain.buttonText),
    category: trimString(plain.category),
    isActive: plain.isActive !== false,
    items: validation.items,
    itemCount: validation.itemCount || countProductCollectionItems(validation.items),
    updatedAt: plain.updatedAt ? new Date(plain.updatedAt).toISOString() : null,
  };
};

const buildProductCollectionResourceFromConfig = (config = {}) => {
  const items = normalizeProductCollectionItems(config.productCollectionItems);
  const validation = validateProductCollectionSnapshot({
    items,
    buttonText: config.actionButtonText || config.buttonText,
  });

  return {
    id: trimString(config.productCollectionId),
    slug: slugify(config.productCollectionName || config.productCollectionId),
    name: trimString(config.productCollectionName),
    description: trimString(config.productCollectionDescription),
    buttonText: trimString(config.actionButtonText),
    category: trimString(config.productCollectionCategory),
    isActive: true,
    items: validation.items,
    itemCount: Number(config.productCollectionItemCount || validation.itemCount || 0),
    updatedAt: null,
  };
};

const listProductCollections = async (query = {}) => {
  const page = clampPositiveInteger(query.page, DEFAULT_PAGE);
  const limit = clampPositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const search = trimString(query.search);
  const activeOnly =
    query.activeOnly === true
    || trimString(query.activeOnly).toLowerCase() === "true"
    || trimString(query.status).toLowerCase() === "active";

  const filter = {};

  if (activeOnly) {
    filter.isActive = true;
  } else if (trimString(query.status).toLowerCase() === "inactive") {
    filter.isActive = false;
  }

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
      { category: { $regex: search, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    WhatsAppProductCollection.find(filter)
      .sort({ updatedAt: -1, name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    WhatsAppProductCollection.countDocuments(filter),
  ]);

  const serializedItems = items.map(serializeProductCollection);
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    items: serializedItems,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: totalPages > 0 && page < totalPages,
      hasPrevPage: page > 1 && totalPages > 0,
    },
    filters: {
      search,
      activeOnly,
      status: trimString(query.status),
    },
  };
};

const listAvailableProductCollections = async () => {
  const result = await listProductCollections({ activeOnly: true, limit: MAX_LIMIT, page: 1 });
  return result.items;
};

const getProductCollectionById = async (id, options = {}) => {
  const record = await findProductCollectionDocument(id).lean();
  if (!record) {
    return null;
  }

  const serialized = serializeProductCollection(record);
  if (options.activeOnly && serialized.isActive === false) {
    return null;
  }

  return serialized;
};

const createProductCollection = async (payload = {}, actorId = null) => {
  const normalized = normalizeProductCollectionPayload(payload, { isActive: payload.isActive });
  const slug = await resolveUniqueSlug(normalized.name);
  const record = await WhatsAppProductCollection.create({
    slug,
    name: normalized.name,
    description: normalized.description,
    buttonText: normalized.buttonText,
    category: normalized.category,
    isActive: normalized.isActive,
    items: normalized.items,
    createdBy: actorId || null,
    updatedBy: actorId || null,
  });

  return serializeProductCollection(record);
};

const updateProductCollection = async (id, payload = {}, actorId = null) => {
  const record = await findProductCollectionDocument(id);
  if (!record) {
    const error = new Error("Product collection not found");
    error.status = 404;
    throw error;
  }

  const normalized = normalizeProductCollectionPayload(payload, {
    name: record.name,
    description: record.description,
    buttonText: record.buttonText,
    category: record.category,
    isActive: record.isActive,
    items: record.items,
  });

  record.slug = await resolveUniqueSlug(normalized.name, record._id);
  record.name = normalized.name;
  record.description = normalized.description;
  record.buttonText = normalized.buttonText;
  record.category = normalized.category;
  record.isActive = normalized.isActive;
  record.items = normalized.items;
  record.updatedBy = actorId || record.updatedBy || null;

  await record.save();
  return serializeProductCollection(record);
};

const toggleProductCollection = async (id, isActive, actorId = null) => {
  const record = await findProductCollectionDocument(id);
  if (!record) {
    const error = new Error("Product collection not found");
    error.status = 404;
    throw error;
  }

  record.isActive = Boolean(isActive);
  record.updatedBy = actorId || record.updatedBy || null;
  await record.save();
  return serializeProductCollection(record);
};

const deleteProductCollection = async (id) => {
  const record = await findProductCollectionDocument(id);
  if (!record) {
    const error = new Error("Product collection not found");
    error.status = 404;
    throw error;
  }

  await WhatsAppProductCollection.deleteOne({ _id: record._id });
  return serializeProductCollection(record);
};

const isProductCollectionProviderConfigured = async () => Boolean(trimString((await loadWhatsAppMetaConnection()).catalogId));

const getProductCollectionProviderConfig = async () => ({
  catalogId: trimString((await loadWhatsAppMetaConnection()).catalogId),
});

module.exports = {
  MAX_BUTTON_TEXT_LENGTH,
  MAX_PRODUCT_ITEMS,
  normalizeProductCollectionItems,
  countProductCollectionItems,
  validateProductCollectionSnapshot,
  serializeProductCollection,
  buildProductCollectionResourceFromConfig,
  listProductCollections,
  listAvailableProductCollections,
  getProductCollectionById,
  createProductCollection,
  updateProductCollection,
  toggleProductCollection,
  deleteProductCollection,
  isProductCollectionProviderConfigured,
  getProductCollectionProviderConfig,
  slugify,
};

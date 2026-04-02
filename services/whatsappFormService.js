const WhatsAppForm = require("../models/WhatsAppForm");

const WHATSAPP_FORM_FIELD_TYPES = WhatsAppForm.WHATSAPP_FORM_FIELD_TYPES || [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "select",
  "radio",
  "checkbox",
  "date",
];
const WHATSAPP_FORM_PROVIDER_FLOW_MODES = WhatsAppForm.WHATSAPP_FORM_PROVIDER_FLOW_MODES || ["published", "draft"];

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const FORM_POPULATE = [
  { path: "createdBy", select: "_id name email" },
  { path: "updatedBy", select: "_id name email" },
];
const STATUS_FILTER_OPTIONS = ["all", "active", "inactive"];
const OPTION_FIELD_TYPES = new Set(["select", "radio", "checkbox"]);

const trimString = (value) => String(value || "").trim();
const hasOwnProperty = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const createHttpError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const withFormPopulation = (query) =>
  FORM_POPULATE.reduce((currentQuery, populateConfig) => currentQuery.populate(populateConfig), query);

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

const normalizeBoolean = (value, fieldLabel, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === 0) {
    return Boolean(value);
  }

  if (typeof value === "string") {
    const normalized = trimString(value).toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  throw createHttpError(`${fieldLabel} must be true or false`);
};

const normalizeProviderFlowMode = (value, defaultValue = "published") => {
  if (value === undefined) {
    return defaultValue;
  }

  const providerFlowMode = trimString(value) || defaultValue;
  if (!WHATSAPP_FORM_PROVIDER_FLOW_MODES.includes(providerFlowMode)) {
    throw createHttpError(`providerFlowMode must be one of: ${WHATSAPP_FORM_PROVIDER_FLOW_MODES.join(", ")}`);
  }

  return providerFlowMode;
};

const slugify = (value) =>
  trimString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeSlug = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const slug = slugify(value);
  return slug || null;
};

const normalizeFieldOptions = (options = []) =>
  [...new Set(
    (Array.isArray(options) ? options : [])
      .map((option) => {
        if (typeof option === "string") {
          return trimString(option);
        }

        if (option && typeof option === "object") {
          return trimString(option.label || option.value);
        }

        return "";
      })
      .filter(Boolean)
  )];

const normalizeField = (field = {}, index = 0) => {
  if (!field || typeof field !== "object" || Array.isArray(field)) {
    throw createHttpError(`fields[${index}] must be an object`);
  }

  const id = trimString(field.id);
  const label = trimString(field.label);
  const type = trimString(field.type);

  if (!id) {
    throw createHttpError(`fields[${index}].id is required`);
  }

  if (!label) {
    throw createHttpError(`fields[${index}].label is required`);
  }

  if (!WHATSAPP_FORM_FIELD_TYPES.includes(type)) {
    throw createHttpError(`fields[${index}].type must be one of: ${WHATSAPP_FORM_FIELD_TYPES.join(", ")}`);
  }

  const options = normalizeFieldOptions(field.options);
  if (OPTION_FIELD_TYPES.has(type) && options.length === 0) {
    throw createHttpError(`fields[${index}].options must contain at least one option for ${type} fields`);
  }

  return {
    id,
    label,
    type,
    required: Boolean(field.required),
    placeholder: trimString(field.placeholder),
    options: OPTION_FIELD_TYPES.has(type) ? options : [],
  };
};

const normalizeFields = (value, { partial = false } = {}) => {
  if (value === undefined) {
    return partial ? undefined : [];
  }

  if (!Array.isArray(value)) {
    throw createHttpError("fields must be an array");
  }

  const normalizedFields = value.map((field, index) => normalizeField(field, index));
  const duplicateFieldId = normalizedFields.find(
    (field, index) => normalizedFields.findIndex((item) => item.id === field.id) !== index
  );

  if (duplicateFieldId) {
    throw createHttpError(`Duplicate field id: ${duplicateFieldId.id}`);
  }

  return normalizedFields;
};

const normalizeFormPayload = (payload = {}, options = {}) => {
  const partial = Boolean(options.partial);
  const current = options.current || {};
  const normalized = {};

  if (!partial || hasOwnProperty(payload, "name")) {
    const name = trimString(payload.name);
    if (!name) {
      throw createHttpError("name is required");
    }
    normalized.name = name;
  }

  if (!partial || hasOwnProperty(payload, "slug")) {
    normalized.slug = normalizeSlug(payload.slug);
  }

  if (!partial || hasOwnProperty(payload, "description")) {
    normalized.description = trimString(payload.description);
  }

  if (!partial || hasOwnProperty(payload, "isActive")) {
    normalized.isActive = normalizeBoolean(payload.isActive, "isActive", true);
  }

  if (!partial || hasOwnProperty(payload, "category")) {
    normalized.category = trimString(payload.category);
  }

  if (!partial || hasOwnProperty(payload, "fields")) {
    normalized.fields = normalizeFields(payload.fields, { partial });
  }

  if (!partial || hasOwnProperty(payload, "submitButtonText")) {
    normalized.submitButtonText = trimString(payload.submitButtonText) || "Submit";
  }

  if (!partial || hasOwnProperty(payload, "successMessage")) {
    normalized.successMessage = trimString(payload.successMessage);
  }

  if (!partial || hasOwnProperty(payload, "providerFlowId")) {
    normalized.providerFlowId = trimString(payload.providerFlowId);
  }

  if (!partial || hasOwnProperty(payload, "providerFlowName")) {
    normalized.providerFlowName = trimString(payload.providerFlowName);
  }

  if (!partial || hasOwnProperty(payload, "providerFlowMode")) {
    normalized.providerFlowMode = normalizeProviderFlowMode(payload.providerFlowMode, "published");
  }

  if (!partial || hasOwnProperty(payload, "providerFlowFirstScreenId")) {
    normalized.providerFlowFirstScreenId = trimString(payload.providerFlowFirstScreenId);
  }

  const providerFlowMode = normalized.providerFlowMode !== undefined
    ? normalized.providerFlowMode
    : trimString(current.providerFlowMode) || "published";
  const providerFlowId = normalized.providerFlowId !== undefined
    ? normalized.providerFlowId
    : trimString(current.providerFlowId);
  const providerFlowName = normalized.providerFlowName !== undefined
    ? normalized.providerFlowName
    : trimString(current.providerFlowName);

  if (providerFlowId && providerFlowName && !providerFlowMode) {
    normalized.providerFlowMode = "published";
  }

  if (providerFlowMode === "published" && providerFlowName && !providerFlowId) {
    throw createHttpError("providerFlowId is required when providerFlowMode is published");
  }

  if (providerFlowMode === "draft" && providerFlowId && !providerFlowName) {
    throw createHttpError("providerFlowName is required when providerFlowMode is draft");
  }

  if (!partial && options.actorId) {
    normalized.createdBy = options.actorId;
    normalized.updatedBy = options.actorId;
  }

  if (partial && options.actorId) {
    normalized.updatedBy = options.actorId;
  }

  return normalized;
};

const buildListQueryOptions = (query = {}) => {
  const page = clampPositiveInteger(query.page, DEFAULT_PAGE);
  const limit = clampPositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const search = trimString(query.search);
  const category = trimString(query.category);
  const status = trimString(query.status || "all").toLowerCase() || "all";

  if (!STATUS_FILTER_OPTIONS.includes(status)) {
    throw createHttpError("status must be all, active, or inactive");
  }

  return {
    page,
    limit,
    search,
    category,
    status,
  };
};

const buildFormFilter = (queryOptions = {}) => {
  const filter = {};

  if (queryOptions.status === "active") {
    filter.isActive = true;
  }

  if (queryOptions.status === "inactive") {
    filter.isActive = false;
  }

  if (queryOptions.category) {
    filter.category = {
      $regex: new RegExp(`^${escapeRegex(queryOptions.category)}$`, "i"),
    };
  }

  if (queryOptions.search) {
    const searchRegex = new RegExp(escapeRegex(queryOptions.search), "i");
    filter.$or = [
      { name: searchRegex },
      { slug: searchRegex },
      { category: searchRegex },
      { description: searchRegex },
    ];
  }

  return filter;
};

const buildPagination = (page, limit, total) => {
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: totalPages > 0 && page < totalPages,
    hasPrevPage: page > 1 && totalPages > 0,
  };
};

const listWhatsAppForms = async (query = {}) => {
  const queryOptions = buildListQueryOptions(query);
  const filter = buildFormFilter(queryOptions);
  const skip = (queryOptions.page - 1) * queryOptions.limit;
  const categoryFilter = { ...filter };

  delete categoryFilter.category;

  const [items, total, categoryOptions] = await Promise.all([
    withFormPopulation(
      WhatsAppForm.find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip(skip)
        .limit(queryOptions.limit)
    ).lean(),
    WhatsAppForm.countDocuments(filter),
    WhatsAppForm.distinct("category", {
      ...categoryFilter,
      category: {
        $type: "string",
        $gt: "",
      },
    }),
  ]);

  return {
    items,
    pagination: buildPagination(queryOptions.page, queryOptions.limit, total),
    filters: {
      categoryOptions: categoryOptions
        .map((value) => trimString(value))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    },
  };
};

const getWhatsAppFormById = async (id) => withFormPopulation(WhatsAppForm.findById(id)).lean();

const createWhatsAppForm = async (payload = {}, actorId = null) => {
  const normalizedPayload = normalizeFormPayload(payload, { actorId, current: {} });
  const form = await WhatsAppForm.create(normalizedPayload);
  return getWhatsAppFormById(form._id);
};

const updateWhatsAppForm = async (id, payload = {}, actorId = null) => {
  const form = await WhatsAppForm.findById(id);

  if (!form) {
    throw createHttpError("WhatsApp form not found", 404);
  }

  const normalizedPayload = normalizeFormPayload(payload, {
    partial: true,
    actorId,
    current: form.toObject ? form.toObject() : form,
  });

  Object.assign(form, normalizedPayload);
  await form.save();

  return getWhatsAppFormById(form._id);
};

const deleteWhatsAppForm = async (id) => {
  const deleted = await WhatsAppForm.findByIdAndDelete(id);
  if (!deleted) {
    throw createHttpError("WhatsApp form not found", 404);
  }
  return deleted;
};

const toggleWhatsAppForm = async (id, actorId = null) => {
  const form = await WhatsAppForm.findById(id);

  if (!form) {
    throw createHttpError("WhatsApp form not found", 404);
  }

  form.isActive = !form.isActive;
  if (actorId) {
    form.updatedBy = actorId;
  }
  await form.save();

  return getWhatsAppFormById(form._id);
};

const listAvailableWhatsAppForms = async ({ activeOnly = true } = {}) => {
  const filter = activeOnly ? { isActive: true } : {};
  const forms = await WhatsAppForm.find(filter)
    .select("_id name")
    .sort({ name: 1, createdAt: -1 })
    .lean();

  return forms.map((form) => ({
    id: String(form._id),
    name: trimString(form.name),
  }));
};

module.exports = {
  listWhatsAppForms,
  getWhatsAppFormById,
  createWhatsAppForm,
  updateWhatsAppForm,
  deleteWhatsAppForm,
  toggleWhatsAppForm,
  listAvailableWhatsAppForms,
};

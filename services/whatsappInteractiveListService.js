const { Types } = require("mongoose");
const WhatsAppInteractiveList = require("../models/WhatsAppInteractiveList");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const trimString = (value) => String(value || "").trim();

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

const normalizeInteractiveListRow = (row = {}, index = 0, sectionIndex = 0) => {
  const id = trimString(row.id || row.value || row.rowId || `row_${sectionIndex + 1}_${index + 1}`);
  const title = trimString(row.title || row.label || row.name);

  return {
    id,
    title,
    description: trimString(row.description),
  };
};

const normalizeInteractiveListSections = (sections = []) =>
  (Array.isArray(sections) ? sections : [])
    .map((section, sectionIndex) => ({
      title: trimString(section?.title || section?.name),
      rows: (Array.isArray(section?.rows) ? section.rows : [])
        .map((row, rowIndex) => normalizeInteractiveListRow(row, rowIndex, sectionIndex))
        .filter((row) => row.id && row.title),
    }))
    .filter((section) => section.rows.length > 0);

const countInteractiveListRows = (sections = []) =>
  normalizeInteractiveListSections(sections).reduce((total, section) => total + section.rows.length, 0);

const validateInteractiveListSnapshot = ({
  sections = [],
  buttonText = "",
  requireActive = false,
  isActive = true,
} = {}) => {
  const normalizedSections = normalizeInteractiveListSections(sections);
  const trimmedButtonText = trimString(buttonText);
  const rowIds = [];

  for (const section of normalizedSections) {
    for (const row of section.rows) {
      rowIds.push(row.id);
    }
  }

  const duplicateRowId = rowIds.find((rowId, index) => rowIds.indexOf(rowId) !== index);

  if (requireActive && isActive === false) {
    return { valid: false, reason: "Interactive list is inactive", sections: normalizedSections };
  }

  if (!trimmedButtonText) {
    return { valid: false, reason: "Interactive list button text is required", sections: normalizedSections };
  }

  if (trimmedButtonText.length > 20) {
    return { valid: false, reason: "Interactive list button text must be 20 characters or fewer", sections: normalizedSections };
  }

  if (normalizedSections.length < 1) {
    return { valid: false, reason: "Interactive list must contain at least one section", sections: normalizedSections };
  }

  if (normalizedSections.length > 10) {
    return { valid: false, reason: "Interactive list supports at most 10 sections", sections: normalizedSections };
  }

  if (rowIds.length < 1) {
    return { valid: false, reason: "Interactive list must contain at least one row", sections: normalizedSections };
  }

  if (rowIds.some((rowId) => !trimString(rowId))) {
    return { valid: false, reason: "Interactive list rows require non-empty ids", sections: normalizedSections };
  }

  if (duplicateRowId) {
    return { valid: false, reason: `Interactive list row ids must be unique. Duplicate id: ${duplicateRowId}`, sections: normalizedSections };
  }

  return {
    valid: true,
    reason: "",
    sections: normalizedSections,
    sectionCount: normalizedSections.length,
    rowCount: rowIds.length,
  };
};

const serializeInteractiveList = (record = {}) => {
  const plain = record?.toObject ? record.toObject() : record || {};
  const sections = normalizeInteractiveListSections(plain.sections);
  const validation = validateInteractiveListSnapshot({
    sections,
    buttonText: plain.buttonText,
    isActive: plain.isActive !== false,
  });

  return {
    id: trimString(plain._id || plain.id),
    name: trimString(plain.name),
    description: trimString(plain.description),
    headerText: trimString(plain.headerText),
    footerText: trimString(plain.footerText),
    buttonText: trimString(plain.buttonText),
    category: trimString(plain.category),
    isActive: plain.isActive !== false,
    sections: validation.sections,
    sectionCount: validation.sectionCount || validation.sections.length,
    rowCount: validation.rowCount || countInteractiveListRows(validation.sections),
    updatedAt: plain.updatedAt ? new Date(plain.updatedAt).toISOString() : null,
  };
};

const buildInteractiveListResourceFromConfig = (config = {}) => {
  const sections = normalizeInteractiveListSections(config.interactiveListSections);
  const validation = validateInteractiveListSnapshot({
    sections,
    buttonText: config.actionButtonText || config.buttonText,
  });

  return {
    id: trimString(config.interactiveListId),
    name: trimString(config.interactiveListName),
    description: trimString(config.interactiveListDescription),
    headerText: "",
    footerText: "",
    buttonText: trimString(config.actionButtonText),
    category: "",
    isActive: true,
    sections: validation.sections,
    sectionCount: Number(config.interactiveListSectionCount || validation.sectionCount || 0),
    rowCount: Number(config.interactiveListRowCount || validation.rowCount || 0),
    updatedAt: null,
  };
};

const listInteractiveLists = async (query = {}) => {
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
    WhatsAppInteractiveList.find(filter)
      .sort({ updatedAt: -1, name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    WhatsAppInteractiveList.countDocuments(filter),
  ]);

  const serializedItems = items.map(serializeInteractiveList);
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

const listAvailableInteractiveLists = async () => {
  const result = await listInteractiveLists({ activeOnly: true, limit: MAX_LIMIT, page: 1 });
  return result.items;
};

const getInteractiveListById = async (id, options = {}) => {
  const interactiveListId = trimString(id);
  if (!interactiveListId || !Types.ObjectId.isValid(interactiveListId)) {
    return null;
  }

  const record = await WhatsAppInteractiveList.findById(interactiveListId).lean();
  if (!record) {
    return null;
  }

  const serialized = serializeInteractiveList(record);
  if (options.activeOnly && serialized.isActive === false) {
    return null;
  }

  return serialized;
};

module.exports = {
  normalizeInteractiveListSections,
  countInteractiveListRows,
  serializeInteractiveList,
  buildInteractiveListResourceFromConfig,
  validateInteractiveListSnapshot,
  listInteractiveLists,
  listAvailableInteractiveLists,
  getInteractiveListById,
};

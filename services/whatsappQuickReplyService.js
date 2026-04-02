const WhatsAppQuickReply = require("../models/WhatsAppQuickReply");

const QUICK_REPLY_CATEGORIES = WhatsAppQuickReply.QUICK_REPLY_CATEGORIES || [
  "Greeting",
  "Follow-up",
  "Documents",
  "Consultation",
  "Payment",
  "Job Inquiry",
  "Visa Inquiry",
  "Closing",
  "General",
];

const DEFAULT_FOLDER = "General";
const MAX_FOLDER_LENGTH = 60;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_SUGGESTION_LIMIT = 8;
const MAX_SUGGESTION_LIMIT = 20;
const ALLOWED_STATUS_FILTERS = ["all", "active", "inactive"];
const ALLOWED_SORT_FIELDS = ["updatedAt", "createdAt", "usageCount", "title", "lastUsedAt"];
const QUICK_REPLY_POPULATE = [
  { path: "createdBy", select: "_id name email" },
  { path: "updatedBy", select: "_id name email" },
];

const trimString = (value) => String(value || "").trim();
const hasOwnProperty = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const createHttpError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const withQuickReplyPopulation = (query) =>
  QUICK_REPLY_POPULATE.reduce((currentQuery, populateConfig) => currentQuery.populate(populateConfig), query);

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

const normalizeShortcut = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const shortcut = trimString(value);
  if (!shortcut) {
    return null;
  }

  if (!shortcut.startsWith("/")) {
    throw createHttpError("shortcut must start with /");
  }

  return shortcut;
};

const normalizeFolder = (value, options = {}) => {
  const allowDefault = options.allowDefault !== false;

  if (value === null || value === undefined) {
    return allowDefault ? DEFAULT_FOLDER : "";
  }

  const folder = trimString(value);
  const normalizedFolder = folder || (allowDefault ? DEFAULT_FOLDER : "");

  if (normalizedFolder.length > MAX_FOLDER_LENGTH) {
    throw createHttpError(`folder must be ${MAX_FOLDER_LENGTH} characters or fewer`);
  }

  return normalizedFolder;
};

const normalizeCategory = (value) => {
  const category = trimString(value) || "General";
  if (!QUICK_REPLY_CATEGORIES.includes(category)) {
    throw createHttpError(`category must be one of: ${QUICK_REPLY_CATEGORIES.join(", ")}`);
  }
  return category;
};

const normalizeQuickReplyPayload = (payload = {}, options = {}) => {
  const partial = Boolean(options.partial);
  const normalized = {};

  if (!partial || hasOwnProperty(payload, "title")) {
    const title = trimString(payload.title);
    if (!title) {
      throw createHttpError("title is required");
    }
    normalized.title = title;
  }

  if (!partial || hasOwnProperty(payload, "content")) {
    const content = trimString(payload.content);
    if (!content) {
      throw createHttpError("content is required");
    }
    normalized.content = content;
  }

  if (!partial || hasOwnProperty(payload, "category")) {
    normalized.category = normalizeCategory(payload.category);
  }

  if (!partial || hasOwnProperty(payload, "shortcut")) {
    normalized.shortcut = normalizeShortcut(payload.shortcut);
  }

  if (!partial || hasOwnProperty(payload, "isActive")) {
    normalized.isActive = normalizeBoolean(payload.isActive, "isActive", true);
  }

  if (!partial || hasOwnProperty(payload, "isPinned")) {
    normalized.isPinned = normalizeBoolean(payload.isPinned, "isPinned", false);
  }

  if (!partial || hasOwnProperty(payload, "folder")) {
    normalized.folder = normalizeFolder(payload.folder);
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
  const folder = trimString(query.folder);
  const status = trimString(query.status || "all").toLowerCase() || "all";
  const sortBy = trimString(query.sortBy);
  const sortOrder = trimString(query.sortOrder || "desc").toLowerCase() || "desc";
  const pinned = query.pinned === undefined ? undefined : normalizeBoolean(query.pinned, "pinned");

  if (!ALLOWED_STATUS_FILTERS.includes(status)) {
    throw createHttpError("status must be all, active, or inactive");
  }

  if (category) {
    normalizeCategory(category);
  }

  if (folder) {
    normalizeFolder(folder);
  }

  if (sortBy && !ALLOWED_SORT_FIELDS.includes(sortBy)) {
    throw createHttpError(`sortBy must be one of: ${ALLOWED_SORT_FIELDS.join(", ")}`);
  }

  if (!["asc", "desc"].includes(sortOrder)) {
    throw createHttpError("sortOrder must be asc or desc");
  }

  return {
    page,
    limit,
    search,
    category,
    folder,
    status,
    pinned,
    sortBy,
    sortOrder,
  };
};

const buildQuickReplyFilter = (queryOptions = {}) => {
  const filter = {};

  if (queryOptions.status === "active") {
    filter.isActive = true;
  }

  if (queryOptions.status === "inactive") {
    filter.isActive = false;
  }

  if (queryOptions.category) {
    filter.category = queryOptions.category;
  }

  if (queryOptions.folder) {
    filter.folder = {
      $regex: new RegExp(`^${escapeRegex(normalizeFolder(queryOptions.folder))}$`, "i"),
    };
  }

  if (typeof queryOptions.pinned === "boolean") {
    filter.isPinned = queryOptions.pinned;
  }

  if (queryOptions.search) {
    const searchRegex = new RegExp(escapeRegex(queryOptions.search), "i");
    filter.$or = [
      { title: searchRegex },
      { shortcut: searchRegex },
      { category: searchRegex },
      { folder: searchRegex },
      { content: searchRegex },
    ];
  }

  return filter;
};

const buildQuickReplySort = (queryOptions = {}) => {
  if (!queryOptions.sortBy) {
    return { isPinned: -1, updatedAt: -1, _id: -1 };
  }

  const direction = queryOptions.sortOrder === "asc" ? 1 : -1;
  const sort = {
    [queryOptions.sortBy]: direction,
  };

  if (queryOptions.sortBy !== "updatedAt") {
    sort.updatedAt = -1;
  }

  sort._id = -1;
  return sort;
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

const formatFolderList = (folders = []) =>
  [...new Set(folders.map((folder) => trimString(folder)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

const fetchQuickReplyById = async (id) => withQuickReplyPopulation(WhatsAppQuickReply.findById(id)).lean();

const listQuickReplyFolders = async (filter = {}) => {
  const folders = await WhatsAppQuickReply.distinct("folder", {
    ...filter,
    folder: {
      $type: "string",
      $gt: "",
    },
  });

  return formatFolderList(folders);
};

const listQuickReplies = async (query = {}) => {
  const queryOptions = buildListQueryOptions(query);
  const filter = buildQuickReplyFilter(queryOptions);
  const sort = buildQuickReplySort(queryOptions);
  const skip = (queryOptions.page - 1) * queryOptions.limit;
  const folderFilter = { ...filter };

  delete folderFilter.folder;

  const [items, total, folderOptions] = await Promise.all([
    withQuickReplyPopulation(
      WhatsAppQuickReply.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(queryOptions.limit)
    ).lean(),
    WhatsAppQuickReply.countDocuments(filter),
    listQuickReplyFolders(folderFilter),
  ]);

  return {
    items,
    pagination: buildPagination(queryOptions.page, queryOptions.limit, total),
    filters: {
      folderOptions,
      categoryOptions: QUICK_REPLY_CATEGORIES,
    },
  };
};

const getQuickReplyById = async (id) => fetchQuickReplyById(id);

const createQuickReply = async (payload = {}, actorId = null) => {
  const quickReply = await WhatsAppQuickReply.create(normalizeQuickReplyPayload(payload, { actorId }));
  return fetchQuickReplyById(quickReply._id);
};

const updateQuickReply = async (id, payload = {}, actorId = null) => {
  const quickReply = await WhatsAppQuickReply.findById(id);
  if (!quickReply) {
    throw createHttpError("Quick reply not found", 404);
  }

  const normalized = normalizeQuickReplyPayload(payload, { partial: true, actorId });
  Object.entries(normalized).forEach(([key, value]) => {
    quickReply[key] = value;
  });

  await quickReply.save();
  return fetchQuickReplyById(quickReply._id);
};

const deleteQuickReply = async (id) => {
  const quickReply = await WhatsAppQuickReply.findByIdAndDelete(id).lean();
  if (!quickReply) {
    throw createHttpError("Quick reply not found", 404);
  }

  return quickReply;
};

const toggleQuickReply = async (id, actorId = null) => {
  const quickReply = await WhatsAppQuickReply.findById(id);
  if (!quickReply) {
    throw createHttpError("Quick reply not found", 404);
  }

  quickReply.isActive = !quickReply.isActive;
  if (actorId) {
    quickReply.updatedBy = actorId;
  }

  await quickReply.save();
  return fetchQuickReplyById(quickReply._id);
};

const toggleQuickReplyPin = async (id, actorId = null) => {
  const quickReply = await WhatsAppQuickReply.findById(id);
  if (!quickReply) {
    throw createHttpError("Quick reply not found", 404);
  }

  quickReply.isPinned = !quickReply.isPinned;
  if (actorId) {
    quickReply.updatedBy = actorId;
  }

  await quickReply.save();
  return fetchQuickReplyById(quickReply._id);
};

const markQuickReplyUsed = async (id, actorId = null) => {
  const quickReply = await WhatsAppQuickReply.findById(id);
  if (!quickReply) {
    throw createHttpError("Quick reply not found", 404);
  }

  quickReply.usageCount += 1;
  quickReply.lastUsedAt = new Date();
  if (actorId) {
    quickReply.updatedBy = actorId;
  }

  await quickReply.save();
  return fetchQuickReplyById(quickReply._id);
};

const listQuickReplySuggestions = async (query = {}) => {
  const rawQuery = trimString(query.query);
  const limit = clampPositiveInteger(query.limit, DEFAULT_SUGGESTION_LIMIT, MAX_SUGGESTION_LIMIT);

  if (!rawQuery) {
    return [];
  }

  const filter = {
    isActive: true,
  };

  if (rawQuery === "/") {
    filter.shortcut = {
      $regex: /^\/.+/i,
    };
  } else {
    const shortcutPrefix = rawQuery.startsWith("/") ? rawQuery : `/${rawQuery}`;
    const titleQuery = rawQuery.replace(/^\//, "");

    filter.$or = [
      {
        shortcut: {
          $regex: new RegExp(`^${escapeRegex(shortcutPrefix)}`, "i"),
        },
      },
    ];

    if (titleQuery) {
      filter.$or.push({
        title: {
          $regex: new RegExp(escapeRegex(titleQuery), "i"),
        },
      });
    }
  }

  return WhatsAppQuickReply.find(filter)
    .select("_id title shortcut content category isPinned usageCount updatedAt")
    .sort({ isPinned: -1, usageCount: -1, updatedAt: -1, _id: -1 })
    .limit(limit)
    .lean();
};

module.exports = {
  QUICK_REPLY_CATEGORIES,
  normalizeQuickReplyPayload,
  listQuickReplies,
  listQuickReplyFolders,
  listQuickReplySuggestions,
  getQuickReplyById,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  toggleQuickReply,
  toggleQuickReplyPin,
  markQuickReplyUsed,
};

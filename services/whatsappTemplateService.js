const streamifier = require("streamifier");
const cloudinary = require("../config/cloudinary");
const WhatsAppTemplate = require("../models/WhatsAppTemplate");
const WhatsAppTemplateDefaultMedia = require("../models/WhatsAppTemplateDefaultMedia");
const { loadWhatsAppMetaConnection } = require("./whatsappMetaConnectionService");

const SUPPORTED_TEMPLATE_CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"];
const SUPPORTED_TEMPLATE_BUTTONS = ["QUICK_REPLY", "URL", "PHONE_NUMBER"];
const SUPPORTED_TEMPLATE_HEADER_FORMATS = ["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"];
const MEDIA_HEADER_FORMATS = ["IMAGE", "VIDEO", "DOCUMENT"];

const trimString = (value) => String(value || "").trim();

const getWhatsAppConfig = async () => {
  const connection = await loadWhatsAppMetaConnection();
  const accessToken = trimString(connection.accessToken);
  const businessAccountId = trimString(connection.businessAccountId);

  if (!accessToken || !businessAccountId) {
    throw new Error("Missing WhatsApp template credentials");
  }

  return { accessToken, businessAccountId, graphApiVersion: trimString(connection.graphApiVersion || "v21.0") || "v21.0" };
};

const buildGraphUrl = (path, searchParams = {}, graphApiVersion = "v21.0") => {
  const url = new URL(`https://graph.facebook.com/${graphApiVersion}/${path}`);
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
};

const normalizeTemplateName = (value) =>
  trimString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");

const getPlaceholderIndexes = (text) => {
  const matches = [...String(text || "").matchAll(/{{\s*(\d+)\s*}}/g)];
  return matches.map((match) => Number(match[1] || 0)).filter((value) => Number.isInteger(value) && value > 0);
};

const ensureSequentialPlaceholders = (text, fieldLabel) => {
  const indexes = getPlaceholderIndexes(text);
  if (!indexes.length) return [];

  const uniqueSorted = [...new Set(indexes)].sort((a, b) => a - b);
  const expected = Array.from({ length: uniqueSorted[uniqueSorted.length - 1] }, (_, index) => index + 1);

  if (uniqueSorted.length !== expected.length || uniqueSorted.some((value, index) => value !== expected[index])) {
    throw new Error(`${fieldLabel} placeholders must be sequential and start at {{1}}`);
  }

  return indexes;
};

const toExampleList = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => trimString(item)).filter(Boolean);
};

const buildTextExamples = (text, providedSamples = [], type = "body") => {
  const indexes = ensureSequentialPlaceholders(text, type === "header" ? "Header text" : "Body text");
  if (!indexes.length) return null;

  const highestIndex = Math.max(...indexes);
  const samples = Array.from({ length: highestIndex }, (_, index) => {
    const providedValue = trimString(providedSamples[index]);
    if (providedValue) return providedValue;
    return type === "header" ? `Header value ${index + 1}` : `Sample value ${index + 1}`;
  });

  if (type === "header") {
    return {
      meta: { example: { header_text: samples } },
      client: { example: { header_text: samples } },
    };
  }

  return {
    meta: { example: { body_text: [samples] } },
    client: { example: { body_text: samples } },
  };
};

const normalizeTemplateStatus = (status) => {
  const normalized = trimString(status).toUpperCase();
  if (!normalized) return "PENDING";
  if (normalized === "APPROVED" || normalized === "ACTIVE") return "APPROVED";
  if (normalized === "REJECTED") return "REJECTED";
  if (normalized === "PAUSED") return "PAUSED";
  if (normalized === "DISABLED" || normalized === "DELETED" || normalized === "PENDING_DELETION") return "DISABLED";
  if (normalized === "IN_REVIEW" || normalized === "IN_APPEAL") return "IN_REVIEW";
  if (normalized.includes("PENDING")) return "PENDING";
  return normalized;
};

const normalizeTemplateButton = (button, index) => {
  const type = trimString(button?.type || "").toUpperCase();
  const text = trimString(button?.text || "");

  if (!SUPPORTED_TEMPLATE_BUTTONS.includes(type)) {
    throw new Error(`Unsupported button type at position ${index + 1}`);
  }

  if (!text) {
    throw new Error(`Button text is required at position ${index + 1}`);
  }

  if (type === "QUICK_REPLY") {
    return {
      meta: { type, text },
      client: { type, text, url: "", phoneNumber: "" },
    };
  }

  if (type === "URL") {
    const url = trimString(button?.url || "");
    if (!url) {
      throw new Error(`Button URL is required at position ${index + 1}`);
    }

    return {
      meta: { type, text, url },
      client: { type, text, url, phoneNumber: "" },
    };
  }

  const phoneNumber = trimString(button?.phoneNumber || button?.phone_number || "");
  if (!phoneNumber) {
    throw new Error(`Button phone number is required at position ${index + 1}`);
  }

  return {
    meta: { type, text, phone_number: phoneNumber },
    client: { type, text, url: "", phoneNumber },
  };
};

const flattenBodyExample = (value) => {
  if (!Array.isArray(value)) return [];
  if (Array.isArray(value[0])) {
    return value[0].map((item) => trimString(item)).filter(Boolean);
  }
  return value.map((item) => trimString(item)).filter(Boolean);
};

const normalizeTemplateComponentForClient = (component) => {
  const type = trimString(component?.type || "").toUpperCase();

  if (type === "HEADER") {
    const format = trimString(component?.format || "TEXT").toUpperCase();
    const normalized = {
      type: "HEADER",
      format,
    };

    if (format === "TEXT") {
      normalized.text = trimString(component?.text);
      const headerText = toExampleList(component?.example?.header_text);
      if (headerText.length) {
        normalized.example = { header_text: headerText };
      }
    } else {
      const headerHandles = toExampleList(component?.example?.header_handle);
      if (headerHandles.length) {
        normalized.example = { header_handle: headerHandles };
      }
    }

    return normalized;
  }

  if (type === "BODY") {
    const normalized = {
      type: "BODY",
      text: trimString(component?.text),
    };
    const bodyText = flattenBodyExample(component?.example?.body_text);
    if (bodyText.length) {
      normalized.example = { body_text: bodyText };
    }
    return normalized;
  }

  if (type === "FOOTER") {
    return {
      type: "FOOTER",
      text: trimString(component?.text),
    };
  }

  if (type === "BUTTONS") {
    const buttons = Array.isArray(component?.buttons)
      ? component.buttons.map((button, index) => normalizeTemplateButton(button, index).client)
      : [];

    return {
      type: "BUTTONS",
      buttons,
    };
  }

  return {
    ...component,
    type,
  };
};

const inferHeaderFormatFromComponents = (components = []) => {
  const header = Array.isArray(components)
    ? components.find((component) => trimString(component?.type).toUpperCase() === "HEADER")
    : null;

  if (!header) return "NONE";
  return trimString(header.format || "TEXT").toUpperCase() || "TEXT";
};

const normalizeDefaultHeaderMedia = (record) => {
  if (!record?.mediaUrl) return null;

  return {
    url: trimString(record.mediaUrl),
    fileName: trimString(record.fileName),
    mimeType: trimString(record.mimeType),
    resourceType: trimString(record.resourceType),
    publicId: trimString(record.cloudinaryPublicId),
    bytes: Number(record.bytes || 0),
    headerFormat: trimString(record.headerFormat).toUpperCase(),
  };
};

const buildHistoryEntry = ({ status, rawStatus, rejectedReason, reviewedAt, approvedAt, source, payload }) => ({
  status: normalizeTemplateStatus(status),
  rawStatus: trimString(rawStatus || status),
  rejectedReason: trimString(rejectedReason),
  source: source || "meta_sync",
  changedAt: new Date(),
  reviewedAt: reviewedAt || null,
  approvedAt: approvedAt || null,
  payload: payload || null,
});

const buildMetaErrorMessage = (data, fallbackMessage) => {
  const message = trimString(
    data?.error?.error_user_msg ||
      data?.error?.error_user_title ||
      data?.error?.error_data?.details ||
      data?.error?.message ||
      fallbackMessage
  );
  const lowerMessage = message.toLowerCase();
  const errorCode = Number(data?.error?.code || 0);

  if (errorCode === 190 || lowerMessage.includes("access token") || lowerMessage.includes("session has expired")) {
    return "WhatsApp access token is invalid or expired";
  }

  if (lowerMessage.includes("media handle")) {
    return "Invalid WhatsApp template media handle";
  }

  return message || fallbackMessage;
};

const graphJsonRequest = async ({ url, method = "GET", accessToken, body, headers = {}, fallbackMessage }) => {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(buildMetaErrorMessage(data, fallbackMessage));
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
};

const uploadBufferToCloudinary = ({ buffer, resourceType, publicId, filename }) =>
  new Promise((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream(
      {
        folder: "bluewhale/whatsapp/template-defaults",
        resource_type: resourceType,
        public_id: publicId,
        use_filename: !publicId,
        filename_override: filename || undefined,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(upload);
  });

const getCloudinaryResourceType = (mimeType = "") => {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "raw";
};

const uploadDefaultHeaderMedia = async ({ buffer, filename = "", mimeType = "", publicId = "" } = {}) => {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("Template media file is required");
  }

  const uploadResult = await uploadBufferToCloudinary({
    buffer,
    resourceType: getCloudinaryResourceType(trimString(mimeType || "application/octet-stream")),
    publicId: trimString(publicId),
    filename: trimString(filename || "template-media"),
  });

  return {
    url: trimString(uploadResult?.secure_url),
    fileName: trimString(uploadResult?.original_filename || filename),
    mimeType: trimString(mimeType),
    resourceType: trimString(uploadResult?.resource_type),
    publicId: trimString(uploadResult?.public_id),
    bytes: Number(uploadResult?.bytes || 0),
  };
};

const normalizeMetaTemplate = (template) => ({
  templateId: trimString(template?.id || template?.templateId),
  name: trimString(template?.name),
  category: trimString(template?.category).toUpperCase(),
  language: trimString(template?.language || "en_US"),
  status: normalizeTemplateStatus(template?.status),
  rawStatus: trimString(template?.status),
  rejectedReason: trimString(template?.rejected_reason || template?.rejectedReason),
  components: Array.isArray(template?.components)
    ? template.components.map((component) => normalizeTemplateComponentForClient(component))
    : [],
  headerFormat: inferHeaderFormatFromComponents(template?.components),
  qualityScore: template?.quality_score || template?.qualityScore || null,
  metaPayload: template || null,
});

const fetchAllTemplatesFromMeta = async () => {
  const { businessAccountId, accessToken, graphApiVersion } = await getWhatsAppConfig();
  const items = [];
  let nextUrl = buildGraphUrl(`${businessAccountId}/message_templates`, {
    limit: 100,
    fields: "id,name,status,category,language,components,quality_score,rejected_reason",
  }, graphApiVersion);

  while (nextUrl) {
    const data = await graphJsonRequest({
      url: nextUrl,
      accessToken,
      fallbackMessage: "Failed to fetch WhatsApp templates",
    });

    const pageItems = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    items.push(...pageItems);
    nextUrl = data?.paging?.next || null;
  }

  return items.map(normalizeMetaTemplate).filter((item) => item.templateId);
};

const buildClientTemplateResponse = ({ template, defaultHeaderMedia = null }) => ({
  id: trimString(template?.templateId),
  name: trimString(template?.name),
  status: normalizeTemplateStatus(template?.status),
  category: trimString(template?.category).toUpperCase(),
  language: trimString(template?.language || "en_US"),
  rejectedReason: trimString(template?.rejectedReason),
  createdAt: template?.createdAt || null,
  updatedAt: template?.updatedAt || template?.lastSyncedAt || null,
  reviewedAt: template?.reviewedAt || null,
  approvedAt: template?.approvedAt || null,
  defaultHeaderMedia,
  components: Array.isArray(template?.components) ? template.components : [],
});

const persistTemplate = async ({
  normalizedTemplate,
  adminId = null,
  source = "meta_sync",
  existingTemplate = null,
} = {}) => {
  if (!normalizedTemplate?.templateId) {
    throw new Error("Template id is required");
  }

  const template =
    existingTemplate
    || (await WhatsAppTemplate.findOne({
      $or: [{ templateId: normalizedTemplate.templateId }, { name: normalizedTemplate.name, language: normalizedTemplate.language }],
    }));

  const doc = template || new WhatsAppTemplate({ templateId: normalizedTemplate.templateId });
  const previousStatus = normalizeTemplateStatus(doc.status);
  const nextStatus = normalizeTemplateStatus(normalizedTemplate.status);
  const nextRejectedReason = trimString(normalizedTemplate.rejectedReason);

  doc.templateId = normalizedTemplate.templateId;
  doc.name = normalizedTemplate.name;
  doc.category = normalizedTemplate.category;
  doc.language = normalizedTemplate.language || "en_US";
  doc.status = nextStatus;
  doc.rawStatus = trimString(normalizedTemplate.rawStatus || normalizedTemplate.status);
  doc.rejectedReason = nextRejectedReason;
  doc.components = Array.isArray(normalizedTemplate.components) ? normalizedTemplate.components : [];
  doc.headerFormat = trimString(normalizedTemplate.headerFormat || inferHeaderFormatFromComponents(doc.components) || "NONE").toUpperCase();
  doc.allowCategoryChange = normalizedTemplate.allowCategoryChange !== false;
  doc.qualityScore = normalizedTemplate.qualityScore ?? null;
  doc.lastSyncedAt = normalizedTemplate.lastSyncedAt || new Date();
  doc.metaPayload = normalizedTemplate.metaPayload || doc.metaPayload || null;
  doc.updatedBy = adminId || doc.updatedBy || null;
  doc.deletedAt = normalizedTemplate.deletedAt || null;

  if (!doc.createdBy && adminId && source === "create") {
    doc.createdBy = adminId;
  }

  const reviewedAt =
    normalizedTemplate.reviewedAt
    || doc.reviewedAt
    || (["APPROVED", "REJECTED", "PAUSED", "DISABLED"].includes(nextStatus) ? new Date() : null);
  const approvedAt =
    normalizedTemplate.approvedAt
    || doc.approvedAt
    || (nextStatus === "APPROVED" ? new Date() : null);

  doc.reviewedAt = reviewedAt;
  doc.approvedAt = approvedAt;

  const historyChanged =
    !doc.statusHistory.length
    || previousStatus !== nextStatus
    || trimString(doc.statusHistory[doc.statusHistory.length - 1]?.rejectedReason) !== nextRejectedReason;

  if (historyChanged) {
    doc.statusHistory.push(
      buildHistoryEntry({
        status: nextStatus,
        rawStatus: doc.rawStatus,
        rejectedReason: nextRejectedReason,
        reviewedAt,
        approvedAt,
        source,
        payload: normalizedTemplate.metaPayload || null,
      })
    );
  }

  await doc.save();
  return doc.toObject();
};

const getDefaultMediaMap = async (templateIds = []) => {
  const uniqueIds = [...new Set(templateIds.map((item) => trimString(item)).filter(Boolean))];
  if (!uniqueIds.length) return new Map();

  const defaultMediaRecords = await WhatsAppTemplateDefaultMedia.find({
    templateId: { $in: uniqueIds },
  }).lean();

  return new Map(
    defaultMediaRecords.map((record) => [trimString(record.templateId), normalizeDefaultHeaderMedia(record)])
  );
};

const buildTemplateFilters = ({ search = "", status = "" } = {}) => {
  const filters = { deletedAt: null };
  const normalizedStatus = normalizeTemplateStatus(status);

  if (trimString(search)) {
    filters.name = { $regex: trimString(search), $options: "i" };
  }

  if (trimString(status)) {
    filters.status = normalizedStatus;
  }

  return filters;
};

const getLocalTemplates = async ({ search = "", status = "" } = {}) => {
  const templates = await WhatsAppTemplate.find(buildTemplateFilters({ search, status }))
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const defaultMediaMap = await getDefaultMediaMap(templates.map((template) => template.templateId));

  return templates.map((template) =>
    buildClientTemplateResponse({
      template,
      defaultHeaderMedia: defaultMediaMap.get(trimString(template.templateId)) || null,
    })
  );
};

const syncTemplatesFromMeta = async ({ search = "", status = "", adminId = null } = {}) => {
  try {
    const metaTemplates = await fetchAllTemplatesFromMeta();
    const metaTemplateIds = metaTemplates.map((template) => template.templateId);

    for (const template of metaTemplates) {
      const existing = await WhatsAppTemplate.findOne({ templateId: template.templateId });
      await persistTemplate({
        normalizedTemplate: {
          ...template,
          components: template.components,
          lastSyncedAt: new Date(),
        },
        adminId,
        source: "meta_sync",
        existingTemplate: existing,
      });
    }

    await WhatsAppTemplate.updateMany(
      {
        templateId: { $nin: metaTemplateIds },
        deletedAt: null,
      },
      {
        $set: {
          status: "DISABLED",
          rawStatus: "DELETED",
          deletedAt: new Date(),
          lastSyncedAt: new Date(),
        },
      }
    );

    return getLocalTemplates({ search, status });
  } catch (error) {
    const localTemplates = await getLocalTemplates({ search, status });
    if (localTemplates.length) {
      return localTemplates;
    }
    throw error;
  }
};

const buildTemplateDefinition = ({
  name,
  category,
  language,
  bodyText,
  bodyExamples = [],
  headerType = "NONE",
  headerText = "",
  headerExamples = [],
  headerMediaHandle = "",
  footerText = "",
  buttons = [],
  allowCategoryChange = true,
} = {}) => {
  const normalizedName = normalizeTemplateName(name);
  if (!normalizedName) {
    throw new Error("Template name is required");
  }

  const normalizedCategory = trimString(category).toUpperCase();
  if (!SUPPORTED_TEMPLATE_CATEGORIES.includes(normalizedCategory)) {
    throw new Error("Unsupported template category");
  }

  const normalizedLanguage = trimString(language || "en_US");
  const normalizedHeaderType = trimString(headerType || "NONE").toUpperCase();
  const normalizedHeaderText = trimString(headerText);
  const normalizedHeaderMediaHandle = trimString(headerMediaHandle);
  const normalizedBodyText = trimString(bodyText);
  const normalizedFooterText = trimString(footerText);
  const normalizedButtons = Array.isArray(buttons)
    ? buttons.filter((button) => trimString(button?.text || button?.url || button?.phoneNumber || button?.phone_number))
    : [];

  if (!normalizedBodyText) {
    throw new Error("Template body text is required");
  }

  if (!SUPPORTED_TEMPLATE_HEADER_FORMATS.includes(normalizedHeaderType)) {
    throw new Error("Unsupported template header type");
  }

  if (normalizedButtons.length > 10) {
    throw new Error("Too many buttons provided for the template");
  }

  const metaComponents = [];
  const clientComponents = [];

  if (normalizedHeaderType === "TEXT") {
    if (!normalizedHeaderText) {
      throw new Error("Header text is required when header type is TEXT");
    }

    const headerExamplesPayload = buildTextExamples(normalizedHeaderText, toExampleList(headerExamples), "header");
    metaComponents.push({
      type: "HEADER",
      format: "TEXT",
      text: normalizedHeaderText,
      ...(headerExamplesPayload?.meta || {}),
    });
    clientComponents.push({
      type: "HEADER",
      format: "TEXT",
      text: normalizedHeaderText,
      ...(headerExamplesPayload?.client || {}),
    });
  } else if (MEDIA_HEADER_FORMATS.includes(normalizedHeaderType)) {
    if (!normalizedHeaderMediaHandle) {
      throw new Error("A Meta media handle is required for IMAGE, VIDEO, and DOCUMENT headers");
    }

    metaComponents.push({
      type: "HEADER",
      format: normalizedHeaderType,
      example: {
        header_handle: [normalizedHeaderMediaHandle],
      },
    });
    clientComponents.push({
      type: "HEADER",
      format: normalizedHeaderType,
      example: {
        header_handle: [normalizedHeaderMediaHandle],
      },
    });
  }

  const bodyExamplesPayload = buildTextExamples(normalizedBodyText, toExampleList(bodyExamples), "body");
  metaComponents.push({
    type: "BODY",
    text: normalizedBodyText,
    ...(bodyExamplesPayload?.meta || {}),
  });
  clientComponents.push({
    type: "BODY",
    text: normalizedBodyText,
    ...(bodyExamplesPayload?.client || {}),
  });

  if (normalizedFooterText) {
    metaComponents.push({
      type: "FOOTER",
      text: normalizedFooterText,
    });
    clientComponents.push({
      type: "FOOTER",
      text: normalizedFooterText,
    });
  }

  if (normalizedButtons.length) {
    const normalized = normalizedButtons.map((button, index) => normalizeTemplateButton(button, index));
    metaComponents.push({
      type: "BUTTONS",
      buttons: normalized.map((item) => item.meta),
    });
    clientComponents.push({
      type: "BUTTONS",
      buttons: normalized.map((item) => item.client),
    });
  }

  return {
    normalizedName,
    normalizedCategory,
    normalizedLanguage,
    normalizedHeaderType,
    allowCategoryChange: allowCategoryChange !== false,
    metaPayload: {
      name: normalizedName,
      category: normalizedCategory,
      language: normalizedLanguage,
      allow_category_change: allowCategoryChange !== false,
      components: metaComponents,
    },
    clientTemplate: {
      name: normalizedName,
      category: normalizedCategory,
      language: normalizedLanguage,
      status: "PENDING",
      rawStatus: "PENDING",
      rejectedReason: "",
      components: clientComponents,
      headerFormat: normalizedHeaderType,
      allowCategoryChange: allowCategoryChange !== false,
      qualityScore: null,
    },
  };
};

const createTemplate = async ({
  name,
  category,
  language,
  bodyText,
  bodyExamples = [],
  headerType = "NONE",
  headerText = "",
  headerExamples = [],
  headerMediaHandle = "",
  footerText = "",
  buttons = [],
  allowCategoryChange = true,
  adminId = null,
} = {}) => {
  const { businessAccountId, accessToken, graphApiVersion } = await getWhatsAppConfig();
  const definition = buildTemplateDefinition({
    name,
    category,
    language,
    bodyText,
    bodyExamples,
    headerType,
    headerText,
    headerExamples,
    headerMediaHandle,
    footerText,
    buttons,
    allowCategoryChange,
  });

  const data = await graphJsonRequest({
    url: buildGraphUrl(`${businessAccountId}/message_templates`, {}, graphApiVersion),
    method: "POST",
    accessToken,
    body: definition.metaPayload,
    fallbackMessage: "Failed to create WhatsApp template",
  });

  const normalizedTemplate = await persistTemplate({
    normalizedTemplate: {
      templateId: trimString(data?.id),
      ...definition.clientTemplate,
      status: normalizeTemplateStatus(data?.status || "PENDING"),
      rawStatus: trimString(data?.status || "PENDING"),
      lastSyncedAt: new Date(),
      metaPayload: {
        request: definition.metaPayload,
        response: data,
      },
    },
    adminId,
    source: "create",
  });

  return {
    id: trimString(normalizedTemplate.templateId),
  };
};

const uploadTemplateHeaderMedia = async ({ buffer, filename = "", mimeType = "" } = {}) => {
  const { accessToken, appId, graphApiVersion } = await getWhatsAppConfig();

  if (!appId) {
    throw new Error("Missing WhatsApp app id");
  }

  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("Template media file is required");
  }

  const normalizedMimeType = trimString(mimeType || "application/octet-stream");
  const normalizedFilename = trimString(filename || "template-media");

  const sessionData = await graphJsonRequest({
    url: buildGraphUrl(`${appId}/uploads`, {
      file_name: normalizedFilename,
      file_length: String(buffer.length),
      file_type: normalizedMimeType,
    }, graphApiVersion),
    method: "POST",
    accessToken,
    fallbackMessage: "Failed to start WhatsApp template media upload",
  });

  const uploadSessionId = trimString(sessionData?.id);
  if (!uploadSessionId) {
    throw new Error("Meta did not return an upload session id");
  }

  const uploadResponse = await fetch(buildGraphUrl(uploadSessionId, {}, graphApiVersion), {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_offset: "0",
      "Content-Type": normalizedMimeType,
    },
    body: buffer,
  });

  const uploadData = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok) {
    const error = new Error(buildMetaErrorMessage(uploadData, "Failed to upload WhatsApp template media file"));
    error.status = uploadResponse.status;
    error.payload = uploadData;
    throw error;
  }

  const mediaHandle = trimString(uploadData?.h || uploadData?.handle);
  if (!mediaHandle) {
    throw new Error("Meta did not return a template media handle");
  }

  const defaultMedia = await uploadDefaultHeaderMedia({
    buffer,
    filename: normalizedFilename,
    mimeType: normalizedMimeType,
    publicId: `wa_template_default_${Date.now()}_${Math.round(Math.random() * 1e9)}`,
  });

  return {
    mediaHandle,
    defaultMedia: {
      ...defaultMedia,
      headerFormat: normalizedMimeType.startsWith("image/")
        ? "IMAGE"
        : normalizedMimeType.startsWith("video/")
          ? "VIDEO"
          : "DOCUMENT",
    },
  };
};

const findTemplateRecord = async ({ templateId = "", templateName = "", language = "" } = {}) => {
  const normalizedTemplateId = trimString(templateId);
  const normalizedTemplateName = trimString(templateName);
  const normalizedLanguage = trimString(language);

  if (normalizedTemplateId) {
    const byTemplateId = await WhatsAppTemplate.findOne({ templateId: normalizedTemplateId }).lean();
    if (byTemplateId) return byTemplateId;
  }

  if (normalizedTemplateName) {
    const query = {
      name: normalizedTemplateName,
      ...(normalizedLanguage ? { language: normalizedLanguage } : {}),
    };
    const byName = await WhatsAppTemplate.findOne(query).lean();
    if (byName) return byName;
  }

  return null;
};

const getTemplateById = async (templateId, { includeSyncFallback = true } = {}) => {
  const normalizedTemplateId = trimString(templateId);
  if (!normalizedTemplateId) return null;

  let template = await findTemplateRecord({ templateId: normalizedTemplateId });
  if (!template && includeSyncFallback) {
    await syncTemplatesFromMeta();
    template = await findTemplateRecord({ templateId: normalizedTemplateId });
  }

  if (!template) return null;

  const defaultMediaMap = await getDefaultMediaMap([normalizedTemplateId]);

  return buildClientTemplateResponse({
    template,
    defaultHeaderMedia: defaultMediaMap.get(normalizedTemplateId) || null,
  });
};

const listTemplates = async ({ search = "", status = "" } = {}) => syncTemplatesFromMeta({ search, status });

const saveTemplateDefaultMedia = async ({
  templateId,
  templateName = "",
  headerFormat = "",
  defaultMedia = null,
  adminId = null,
} = {}) => {
  const normalizedTemplateId = trimString(templateId);
  if (!normalizedTemplateId) {
    throw new Error("Template id is required");
  }

  const template = await findTemplateRecord({ templateId: normalizedTemplateId });
  const normalizedHeaderFormat = trimString(headerFormat || template?.headerFormat).toUpperCase();

  if (!MEDIA_HEADER_FORMATS.includes(normalizedHeaderFormat)) {
    throw new Error("Default media can only be stored for IMAGE, VIDEO, or DOCUMENT headers");
  }

  if (template && normalizeTemplateStatus(template.status) !== "APPROVED") {
    throw new Error("Default media can only be saved for approved templates");
  }

  if (!defaultMedia?.url) {
    throw new Error("Default media url is required");
  }

  const update = {
    templateName: trimString(templateName || template?.name),
    headerFormat: normalizedHeaderFormat,
    mediaUrl: trimString(defaultMedia.url),
    fileName: trimString(defaultMedia.fileName || defaultMedia.filename),
    mimeType: trimString(defaultMedia.mimeType),
    resourceType: trimString(defaultMedia.resourceType),
    cloudinaryPublicId: trimString(defaultMedia.publicId),
    bytes: Number(defaultMedia.bytes || 0),
    updatedBy: adminId || null,
  };

  const record = await WhatsAppTemplateDefaultMedia.findOneAndUpdate(
    { templateId: normalizedTemplateId },
    {
      $set: update,
      $setOnInsert: {
        createdBy: adminId || null,
      },
    },
    {
      new: true,
      upsert: true,
    }
  ).lean();

  if (template) {
    await WhatsAppTemplate.updateOne(
      { templateId: normalizedTemplateId },
      {
        $set: {
          headerFormat: normalizedHeaderFormat,
          updatedBy: adminId || null,
        },
      }
    );
  }

  return normalizeDefaultHeaderMedia(record);
};

const removeTemplateDefaultMedia = async ({ templateId } = {}) => {
  const normalizedTemplateId = trimString(templateId);
  if (!normalizedTemplateId) {
    throw new Error("Template id is required");
  }

  const record = await WhatsAppTemplateDefaultMedia.findOneAndDelete({ templateId: normalizedTemplateId }).lean();

  if (record?.cloudinaryPublicId) {
    try {
      await cloudinary.uploader.destroy(record.cloudinaryPublicId, {
        resource_type: record.resourceType || "raw",
      });
    } catch (error) {
      console.error("Failed to delete template default media from Cloudinary:", error);
    }
  }

  return Boolean(record);
};

const updateTemplate = async ({
  templateId,
  name,
  category,
  language,
  bodyText,
  bodyExamples = [],
  headerType = "NONE",
  headerText = "",
  headerExamples = [],
  headerMediaHandle = "",
  footerText = "",
  buttons = [],
  allowCategoryChange = true,
  adminId = null,
} = {}) => {
  const normalizedTemplateId = trimString(templateId);
  if (!normalizedTemplateId) {
    throw new Error("Template id is required");
  }

  const localTemplate = await findTemplateRecord({ templateId: normalizedTemplateId });
  if (!localTemplate) {
    throw new Error("Template not found");
  }

  const { accessToken, graphApiVersion } = await getWhatsAppConfig();
  const definition = buildTemplateDefinition({
    name: name || localTemplate.name,
    category: category || localTemplate.category,
    language: language || localTemplate.language,
    bodyText,
    bodyExamples,
    headerType,
    headerText,
    headerExamples,
    headerMediaHandle,
    footerText,
    buttons,
    allowCategoryChange,
  });

  const data = await graphJsonRequest({
    url: buildGraphUrl(normalizedTemplateId, {}, graphApiVersion),
    method: "POST",
    accessToken,
    body: definition.metaPayload,
    fallbackMessage: "Failed to resubmit WhatsApp template",
  });

  const updatedTemplate = await persistTemplate({
    normalizedTemplate: {
      templateId: normalizedTemplateId,
      ...definition.clientTemplate,
      status: normalizeTemplateStatus(data?.status || "PENDING"),
      rawStatus: trimString(data?.status || "PENDING"),
      lastSyncedAt: new Date(),
      metaPayload: {
        request: definition.metaPayload,
        response: data,
      },
    },
    adminId,
    source: "resubmit",
  });

  return {
    id: trimString(updatedTemplate.templateId),
  };
};

const deleteTemplate = async ({ templateId, adminId = null } = {}) => {
  const normalizedTemplateId = trimString(templateId);
  if (!normalizedTemplateId) {
    throw new Error("Template id is required");
  }

  const localTemplate = await findTemplateRecord({ templateId: normalizedTemplateId });
  if (!localTemplate) {
    throw new Error("Template not found");
  }

  const { accessToken, businessAccountId, graphApiVersion } = await getWhatsAppConfig();
  let deleted = false;
  let lastError = null;

  const deleteAttempts = [
    {
      url: buildGraphUrl(normalizedTemplateId, {}, graphApiVersion),
      method: "DELETE",
    },
    {
      url: buildGraphUrl(`${businessAccountId}/message_templates`, { name: localTemplate.name }, graphApiVersion),
      method: "DELETE",
    },
  ];

  for (const attempt of deleteAttempts) {
    try {
      await graphJsonRequest({
        url: attempt.url,
        method: attempt.method,
        accessToken,
        fallbackMessage: "Failed to delete WhatsApp template",
      });
      deleted = true;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!deleted && lastError) {
    throw lastError;
  }

  await WhatsAppTemplate.updateOne(
    { templateId: normalizedTemplateId },
    {
      $set: {
        status: "DISABLED",
        rawStatus: "DELETED",
        deletedAt: new Date(),
        updatedBy: adminId || null,
        lastSyncedAt: new Date(),
      },
      $push: {
        statusHistory: buildHistoryEntry({
          status: "DISABLED",
          rawStatus: "DELETED",
          rejectedReason: "",
          reviewedAt: localTemplate.reviewedAt || new Date(),
          approvedAt: localTemplate.approvedAt || null,
          source: "delete",
          payload: null,
        }),
      },
    }
  );

  return true;
};

const getTemplateHistory = async ({ templateId } = {}) => {
  const normalizedTemplateId = trimString(templateId);
  if (!normalizedTemplateId) {
    throw new Error("Template id is required");
  }

  const template = await WhatsAppTemplate.findOne({ templateId: normalizedTemplateId }).lean();
  if (!template) {
    throw new Error("Template not found");
  }

  return (Array.isArray(template.statusHistory) ? template.statusHistory : [])
    .slice()
    .sort((a, b) => new Date(b.changedAt || 0).getTime() - new Date(a.changedAt || 0).getTime())
    .map((entry) => ({
      status: normalizeTemplateStatus(entry?.status),
      rawStatus: trimString(entry?.rawStatus),
      rejectedReason: trimString(entry?.rejectedReason),
      source: trimString(entry?.source),
      changedAt: entry?.changedAt || null,
      reviewedAt: entry?.reviewedAt || null,
      approvedAt: entry?.approvedAt || null,
    }));
};

const normalizeSendParameter = (parameter) => {
  const type = trimString(parameter?.type).toLowerCase();
  if (!type) {
    throw new Error("Template parameter type is required");
  }

  if (type === "text") {
    const text = trimString(parameter?.text);
    if (!text) {
      throw new Error("Template text parameters require a text value");
    }
    return { type, text };
  }

  if (type === "currency" || type === "date_time") {
    return { ...parameter, type };
  }

  if (MEDIA_HEADER_FORMATS.map((item) => item.toLowerCase()).includes(type)) {
    const mediaPayload = parameter?.[type];
    if (!trimString(mediaPayload?.link)) {
      throw new Error(`Template ${type} header requires a valid media link`);
    }
    return {
      type,
      [type]: {
        link: trimString(mediaPayload.link),
        ...(type === "document" && trimString(mediaPayload?.filename)
          ? { filename: trimString(mediaPayload.filename) }
          : {}),
      },
    };
  }

  return { ...parameter, type };
};

const normalizeSendComponent = (component) => {
  const type = trimString(component?.type).toLowerCase();
  if (!type) {
    throw new Error("Template component type is required");
  }

  const normalized = { type };

  if (type === "button" && component?.sub_type) {
    normalized.sub_type = trimString(component.sub_type).toLowerCase();
  }

  if (component?.index !== undefined && component?.index !== null && component?.index !== "") {
    normalized.index = String(component.index);
  }

  if (Array.isArray(component?.parameters)) {
    normalized.parameters = component.parameters.map(normalizeSendParameter);
  }

  return normalized;
};

const prepareTemplateMessage = async ({ template, media = null } = {}) => {
  if (!template || typeof template !== "object") {
    throw new Error("template is required for template messages");
  }

  const requestedTemplateId = trimString(template.id || template.templateId);
  const requestedName = trimString(template.name);
  const requestedLanguage = trimString(template.languageCode || template.language || "en_US");

  let localTemplate = await findTemplateRecord({
    templateId: requestedTemplateId,
    templateName: requestedName,
    language: requestedLanguage,
  });

  if (!localTemplate) {
    await syncTemplatesFromMeta();
    localTemplate = await findTemplateRecord({
      templateId: requestedTemplateId,
      templateName: requestedName,
      language: requestedLanguage,
    });
  }

  if (!localTemplate && !requestedName) {
    throw new Error("Template id or template name is required");
  }

  if (!localTemplate) {
    const error = new Error("Template not found");
    error.status = 404;
    throw error;
  }

  if (normalizeTemplateStatus(localTemplate.status) !== "APPROVED") {
    const error = new Error("Template is not approved yet");
    error.status = 400;
    throw error;
  }

  const templateId = trimString(localTemplate?.templateId || requestedTemplateId);
  const templateName = trimString(localTemplate?.name || requestedName);
  const languageCode = trimString(localTemplate?.language || requestedLanguage || "en_US");
  const headerFormat = trimString(template.headerFormat || localTemplate?.headerFormat || "NONE").toUpperCase();

  const defaultMediaMap = templateId ? await getDefaultMediaMap([templateId]) : new Map();
  const persistedDefaultMedia = templateId ? defaultMediaMap.get(templateId) : null;
  const requestedDefaultMedia = template?.defaultHeaderMedia?.url
    ? {
        url: trimString(template.defaultHeaderMedia.url),
        fileName: trimString(template.defaultHeaderMedia.fileName || template.defaultHeaderMedia.filename),
        mimeType: trimString(template.defaultHeaderMedia.mimeType),
        publicId: trimString(template.defaultHeaderMedia.publicId),
        bytes: Number(template.defaultHeaderMedia.bytes || 0),
        headerFormat: trimString(template.defaultHeaderMedia.headerFormat || headerFormat).toUpperCase(),
      }
    : null;

  const resolvedDefaultMedia = requestedDefaultMedia || persistedDefaultMedia || null;
  const requestedComponents = Array.isArray(template?.components) ? template.components.map(normalizeSendComponent) : [];
  const localHeader = Array.isArray(localTemplate?.components)
    ? localTemplate.components.find((component) => trimString(component?.type).toUpperCase() === "HEADER")
    : null;
  const localBody = Array.isArray(localTemplate?.components)
    ? localTemplate.components.find((component) => trimString(component?.type).toUpperCase() === "BODY")
    : null;
  let components = requestedComponents.filter((component) => component.type !== "header");
  const bodyComponent = requestedComponents.find((component) => component.type === "body");

  if (headerFormat === "TEXT") {
    const providedHeaderComponent = requestedComponents.find((component) => component.type === "header");
    if (String(localHeader?.text || "").includes("{{") && !(providedHeaderComponent?.parameters || []).length) {
      const error = new Error("Header text parameters are required for this template");
      error.status = 400;
      throw error;
    }
    if (providedHeaderComponent) {
      components = [providedHeaderComponent, ...components];
    }
  }

  if (String(localBody?.text || "").includes("{{") && !(bodyComponent?.parameters || []).length) {
    const error = new Error("Body text parameters are required for this template");
    error.status = 400;
    throw error;
  }

  if (MEDIA_HEADER_FORMATS.includes(headerFormat)) {
    const mediaType = headerFormat.toLowerCase();
    const resolvedMedia =
      media?.url
        ? {
            url: trimString(media.url),
            filename: trimString(media.filename),
          }
        : resolvedDefaultMedia?.url
          ? {
              url: trimString(resolvedDefaultMedia.url),
              filename: trimString(resolvedDefaultMedia.fileName),
            }
          : null;

    if (!resolvedMedia?.url) {
      const error = new Error(`Missing header media for ${headerFormat.toLowerCase()} template`);
      error.status = 400;
      throw error;
    }

    const headerComponent = {
      type: "header",
      parameters: [
        {
          type: mediaType,
          [mediaType]: {
            link: resolvedMedia.url,
            ...(mediaType === "document" && resolvedMedia.filename ? { filename: resolvedMedia.filename } : {}),
          },
        },
      ],
    };

    components = [headerComponent, ...components];
  }

  return {
    name: templateName,
    category: trimString(localTemplate?.category || template?.category || "").toUpperCase(),
    languageCode,
    headerFormat,
    defaultHeaderMedia: resolvedDefaultMedia,
    components,
    templateId,
    status: normalizeTemplateStatus(localTemplate?.status || template?.status || "APPROVED"),
  };
};

module.exports = {
  SUPPORTED_TEMPLATE_CATEGORIES,
  SUPPORTED_TEMPLATE_BUTTONS,
  SUPPORTED_TEMPLATE_HEADER_FORMATS,
  listTemplates,
  syncTemplatesFromMeta,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getTemplateById,
  getTemplateHistory,
  uploadTemplateHeaderMedia,
  saveTemplateDefaultMedia,
  removeTemplateDefaultMedia,
  uploadDefaultHeaderMedia,
  prepareTemplateMessage,
};

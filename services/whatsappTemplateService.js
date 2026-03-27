const streamifier = require("streamifier");
const cloudinary = require("../config/cloudinary");
const WhatsAppTemplateDefaultMedia = require("../models/WhatsAppTemplateDefaultMedia");

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0";

const SUPPORTED_TEMPLATE_CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"];
const SUPPORTED_TEMPLATE_BUTTONS = ["QUICK_REPLY", "URL", "PHONE_NUMBER"];
const SUPPORTED_TEMPLATE_HEADER_FORMATS = ["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"];

const getWhatsAppConfig = () => {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

  if (!accessToken || !businessAccountId) {
    throw new Error("Missing WhatsApp template credentials in environment variables");
  }

  return { accessToken, businessAccountId };
};

const buildGraphUrl = (path, searchParams = {}) => {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`);
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
};

const trimString = (value) => String(value || "").trim();

const normalizeTemplateName = (value) =>
  trimString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");

const getPlaceholderIndexes = (text) => {
  const matches = [...String(text || "").matchAll(/{{\s*(\d+)\s*}}/g)];
  return matches.map((match) => Number(match[1] || 0)).filter((value) => Number.isFinite(value) && value > 0);
};

const buildTextExamples = (text, providedSamples = [], type = "body") => {
  const indexes = getPlaceholderIndexes(text);
  if (!indexes.length) return null;

  const highestIndex = Math.max(...indexes);
  const samples = Array.from({ length: highestIndex }, (_, index) => {
    const providedValue = trimString(providedSamples[index]);
    if (providedValue) return providedValue;
    return type === "header" ? `Header value ${index + 1}` : `Sample value ${index + 1}`;
  });

  if (type === "header") {
    return { header_text: samples };
  }

  return { body_text: [samples] };
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
      type,
      text,
    };
  }

  if (type === "URL") {
    const url = trimString(button?.url || "");
    if (!url) {
      throw new Error(`Button URL is required at position ${index + 1}`);
    }
    return {
      type,
      text,
      url,
    };
  }

  const phoneNumber = trimString(button?.phoneNumber || button?.phone_number || "");
  if (!phoneNumber) {
    throw new Error(`Button phone number is required at position ${index + 1}`);
  }

  return {
    type,
    text,
    phone_number: phoneNumber,
  };
};

const normalizeTemplateForClient = (template) => ({
  id: trimString(template?.id),
  name: trimString(template?.name),
  status: trimString(template?.status || "UNKNOWN"),
  category: trimString(template?.category),
  language: trimString(template?.language),
  qualityScore: template?.quality_score || null,
  rejectedReason: trimString(template?.rejected_reason),
  components: Array.isArray(template?.components) ? template.components : [],
});

const normalizeDefaultHeaderMedia = (record) => {
  if (!record?.mediaUrl) return null;

  return {
    url: trimString(record.mediaUrl),
    fileName: trimString(record.fileName),
    mimeType: trimString(record.mimeType),
    resourceType: trimString(record.resourceType),
    publicId: trimString(record.cloudinaryPublicId),
    bytes: Number(record.bytes || 0),
    headerFormat: trimString(record.headerFormat || "").toUpperCase(),
  };
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

const fetchAllTemplates = async () => {
  const { businessAccountId } = getWhatsAppConfig();
  const items = [];
  let nextUrl = buildGraphUrl(`${businessAccountId}/message_templates`, {
    limit: 100,
    fields: "id,name,status,category,language,components,quality_score,rejected_reason",
  });

  while (nextUrl) {
    const { accessToken } = getWhatsAppConfig();
    const response = await fetch(nextUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(data?.error?.message || "Failed to fetch WhatsApp templates");
      error.status = response.status;
      error.payload = data;
      throw error;
    }

    items.push(...(Array.isArray(data?.data) ? data.data : []));
    nextUrl = data?.paging?.next || null;
  }

  return items.map(normalizeTemplateForClient);
};

const uploadTemplateHeaderMedia = async ({ buffer, filename = "", mimeType = "" } = {}) => {
  const { accessToken } = getWhatsAppConfig();
  const appId = trimString(process.env.WHATSAPP_APP_ID || process.env.META_APP_ID || "");

  if (!appId) {
    throw new Error("Missing WhatsApp app id in environment variables");
  }

  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("Template media file is required");
  }

  const normalizedMimeType = trimString(mimeType || "application/octet-stream");
  const normalizedFilename = trimString(filename || "template-media");

  const sessionResponse = await fetch(buildGraphUrl(`${appId}/uploads`, {
    file_name: normalizedFilename,
    file_length: String(buffer.length),
    file_type: normalizedMimeType,
  }), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const sessionData = await sessionResponse.json().catch(() => ({}));

  if (!sessionResponse.ok) {
    const error = new Error(sessionData?.error?.message || "Failed to start WhatsApp template media upload");
    error.status = sessionResponse.status;
    error.payload = sessionData;
    throw error;
  }

  const uploadSessionId = trimString(sessionData?.id);
  if (!uploadSessionId) {
    throw new Error("Meta did not return an upload session id");
  }

  const uploadResponse = await fetch(buildGraphUrl(uploadSessionId), {
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
    const error = new Error(uploadData?.error?.message || "Failed to upload WhatsApp template media file");
    error.status = uploadResponse.status;
    error.payload = uploadData;
    throw error;
  }

  const handle = trimString(uploadData?.h || uploadData?.handle);
  if (!handle) {
    throw new Error("Meta did not return a template media handle");
  }

  const defaultMedia = await uploadDefaultHeaderMedia({
    buffer,
    filename: normalizedFilename,
    mimeType: normalizedMimeType,
    publicId: `wa_template_default_${Date.now()}_${Math.round(Math.random() * 1e9)}`,
  });

  return {
    id: handle,
    filename: normalizedFilename,
    mimeType: normalizedMimeType,
    defaultMedia,
  };
};

const listTemplates = async ({ search = "", status = "" } = {}) => {
  const templates = await fetchAllTemplates();
  const defaultMediaRecords = await WhatsAppTemplateDefaultMedia.find({
    templateId: {
      $in: templates.map((template) => trimString(template.id)).filter(Boolean),
    },
  }).lean();
  const defaultMediaByTemplateId = new Map(
    defaultMediaRecords.map((record) => [trimString(record.templateId), normalizeDefaultHeaderMedia(record)])
  );

  return templates.filter((template) => {
    const matchesSearch = !search
      || String(template.name || "").toLowerCase().includes(String(search).toLowerCase());
    const matchesStatus = !status
      || String(template.status || "").toUpperCase() === String(status).toUpperCase();
    return matchesSearch && matchesStatus;
  }).map((template) => {
    const defaultHeaderMedia = defaultMediaByTemplateId.get(trimString(template.id)) || null;
    return {
      ...template,
      hasDefaultHeaderMedia: Boolean(defaultHeaderMedia?.url),
      defaultHeaderMedia,
    };
  });
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
} = {}) => {
  const { businessAccountId, accessToken } = getWhatsAppConfig();

  const normalizedName = normalizeTemplateName(name);
  if (!normalizedName) {
    throw new Error("Template name is required");
  }

  const normalizedCategory = trimString(category || "").toUpperCase();
  if (!SUPPORTED_TEMPLATE_CATEGORIES.includes(normalizedCategory)) {
    throw new Error("Unsupported template category");
  }

  const normalizedLanguage = trimString(language || "en_US");
  const normalizedBodyText = trimString(bodyText);
  if (!normalizedBodyText) {
    throw new Error("Template body text is required");
  }

  const normalizedHeaderType = trimString(headerType || "NONE").toUpperCase();
  if (!SUPPORTED_TEMPLATE_HEADER_FORMATS.includes(normalizedHeaderType)) {
    throw new Error("Unsupported template header type");
  }

  const normalizedHeaderText = trimString(headerText);
  const normalizedHeaderMediaHandle = trimString(headerMediaHandle);
  const normalizedFooterText = trimString(footerText);
  const normalizedButtons = Array.isArray(buttons)
    ? buttons.filter((button) => trimString(button?.text || button?.url || button?.phoneNumber || button?.phone_number || ""))
    : [];

  if (normalizedButtons.length > 10) {
    throw new Error("Too many buttons provided for the template");
  }

  const components = [];

  if (normalizedHeaderType === "TEXT") {
    if (!normalizedHeaderText) {
      throw new Error("Header text is required when header type is Text");
    }

    components.push({
      type: "HEADER",
      format: "TEXT",
      text: normalizedHeaderText,
      ...(buildTextExamples(normalizedHeaderText, headerExamples, "header") || {}),
    });
  } else if (normalizedHeaderType !== "NONE") {
    if (!normalizedHeaderMediaHandle) {
      throw new Error("A Meta media handle is required for image, video, or document headers");
    }

    components.push({
      type: "HEADER",
      format: normalizedHeaderType,
      example: {
        header_handle: [normalizedHeaderMediaHandle],
      },
    });
  }

  components.push({
    type: "BODY",
    text: normalizedBodyText,
    ...(buildTextExamples(normalizedBodyText, bodyExamples, "body") || {}),
  });

  if (normalizedFooterText) {
    components.push({
      type: "FOOTER",
      text: normalizedFooterText,
    });
  }

  if (normalizedButtons.length) {
    components.push({
      type: "BUTTONS",
      buttons: normalizedButtons.map(normalizeTemplateButton),
    });
  }

  const response = await fetch(buildGraphUrl(`${businessAccountId}/message_templates`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: normalizedName,
      category: normalizedCategory,
      language: normalizedLanguage,
      allow_category_change: Boolean(allowCategoryChange),
      components,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data?.error?.message || "Failed to create WhatsApp template");
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return normalizeTemplateForClient({
    ...data,
    name: normalizedName,
    category: normalizedCategory,
    language: normalizedLanguage,
    components,
  });
};

const saveTemplateDefaultMedia = async ({
  templateId,
  templateName = "",
  headerFormat = "",
  defaultMedia = null,
  adminId = null,
} = {}) => {
  const normalizedTemplateId = trimString(templateId);
  const normalizedHeaderFormat = trimString(headerFormat).toUpperCase();

  if (!normalizedTemplateId) {
    throw new Error("Template id is required");
  }

  if (!["IMAGE", "VIDEO", "DOCUMENT"].includes(normalizedHeaderFormat)) {
    throw new Error("Default media can only be stored for image, video, or document headers");
  }

  if (!defaultMedia?.url) {
    throw new Error("Default media url is required");
  }

  const update = {
    templateName: trimString(templateName),
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

module.exports = {
  listTemplates,
  createTemplate,
  uploadTemplateHeaderMedia,
  saveTemplateDefaultMedia,
  removeTemplateDefaultMedia,
  uploadDefaultHeaderMedia,
};

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

const listTemplates = async ({ search = "", status = "" } = {}) => {
  const templates = await fetchAllTemplates();
  return templates.filter((template) => {
    const matchesSearch = !search
      || String(template.name || "").toLowerCase().includes(String(search).toLowerCase());
    const matchesStatus = !status
      || String(template.status || "").toUpperCase() === String(status).toUpperCase();
    return matchesSearch && matchesStatus;
  });
};

const createTemplate = async ({
  name,
  category,
  language,
  bodyText,
  bodyExamples = [],
  headerType = "TEXT",
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

  const normalizedHeaderType = trimString(headerType || "TEXT").toUpperCase();
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

module.exports = {
  listTemplates,
  createTemplate,
};

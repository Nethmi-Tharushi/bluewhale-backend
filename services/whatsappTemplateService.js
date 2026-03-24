const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0";

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

  return items;
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

module.exports = {
  listTemplates,
};

const trimString = (value) => String(value || "").trim();

const encodeQuery = (params = {}) =>
  Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");

const normalizeGraphVersion = (value, fallback = "v21.0") => trimString(value || fallback) || fallback;

const buildMetaGraphUrl = (version = "v21.0", path = "", params = {}) => {
  const normalizedVersion = normalizeGraphVersion(version);
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const query = encodeQuery(params);
  return `https://graph.facebook.com/${normalizedVersion}/${normalizedPath}${query ? `?${query}` : ""}`;
};

const buildMetaAppAccessToken = ({ appId, appSecret } = {}) => {
  const normalizedAppId = trimString(appId);
  const normalizedAppSecret = trimString(appSecret);
  if (!normalizedAppId || !normalizedAppSecret) return "";
  return `${normalizedAppId}|${normalizedAppSecret}`;
};

const maskSecret = (value, { start = 4, end = 2 } = {}) => {
  const normalized = trimString(value);
  if (!normalized) return "";
  if (normalized.length <= start + end) return "*".repeat(Math.max(normalized.length, 4));
  return `${normalized.slice(0, start)}${"*".repeat(Math.max(normalized.length - start - end, 4))}${normalized.slice(-end)}`;
};

const buildMetaError = ({ response, data, fallbackMessage, statusCode }) => {
  const message = trimString(data?.error?.message || data?.message || fallbackMessage || "Meta Graph request failed");
  const error = new Error(message);
  error.status = statusCode || response?.status || 400;
  error.code = trimString(data?.error?.code || data?.code || "META_GRAPH_REQUEST_FAILED") || "META_GRAPH_REQUEST_FAILED";
  error.details = data?.error || data || {};
  return error;
};

const metaGraphRequest = async ({
  version = "v21.0",
  path = "",
  method = "GET",
  query = {},
  body = null,
  headers = {},
} = {}) => {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const url = buildMetaGraphUrl(version, path, normalizedMethod === "GET" ? query : {});
  const requestHeaders = { ...headers };
  const requestOptions = {
    method: normalizedMethod,
    headers: requestHeaders,
  };

  if (normalizedMethod !== "GET" && body !== null && body !== undefined) {
    if (body instanceof URLSearchParams) {
      requestHeaders["Content-Type"] = requestHeaders["Content-Type"] || "application/x-www-form-urlencoded";
      requestOptions.body = body.toString();
    } else if (typeof body === "string" || Buffer.isBuffer(body)) {
      requestOptions.body = body;
    } else if (body && typeof body === "object") {
      requestHeaders["Content-Type"] = requestHeaders["Content-Type"] || "application/x-www-form-urlencoded";
      requestOptions.body = new URLSearchParams(
        Object.entries(body).reduce((acc, [key, value]) => {
          if (value !== undefined && value !== null && String(value).trim() !== "") {
            acc[key] = String(value);
          }
          return acc;
        }, {})
      ).toString();
    }
  }

  const response = await fetch(url, requestOptions);
  const contentType = trimString(response.headers.get("content-type")).toLowerCase();
  const responseBody = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");

  if (!response.ok || responseBody?.error) {
    throw buildMetaError({
      response,
      data: typeof responseBody === "string" ? { message: responseBody } : responseBody,
      fallbackMessage: `Meta Graph request failed (${response.status})`,
      statusCode: response.status || 400,
    });
  }

  return responseBody;
};

const fetchMetaGraphCollection = async ({
  version = "v21.0",
  path = "",
  query = {},
} = {}) => {
  let nextUrl = buildMetaGraphUrl(version, path, query);
  const items = [];

  while (nextUrl) {
    const response = await fetch(nextUrl);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
      throw buildMetaError({
        response,
        data,
        fallbackMessage: `Meta Graph request failed (${response.status})`,
        statusCode: response.status || 400,
      });
    }

    if (Array.isArray(data?.data)) {
      items.push(...data.data);
    }

    nextUrl = trimString(data?.paging?.next);
  }

  return items;
};

module.exports = {
  trimString,
  encodeQuery,
  normalizeGraphVersion,
  buildMetaGraphUrl,
  buildMetaAppAccessToken,
  maskSecret,
  metaGraphRequest,
  fetchMetaGraphCollection,
};

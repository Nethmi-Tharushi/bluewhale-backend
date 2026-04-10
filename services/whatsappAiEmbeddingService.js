const DEFAULT_MODEL_CANDIDATES = [
  String(process.env.WHATSAPP_AI_INTENT_EMBEDDING_MODEL || "").trim(),
  "Xenova/multilingual-e5-small",
  "Xenova/all-MiniLM-L6-v2",
].filter(Boolean);

let pipelineFactoryPromise = null;
let encoderPromise = null;
let encoderModelName = "";
let encoderLoadError = null;
const embeddingCache = new Map();
const MAX_CACHE_SIZE = 400;

const normalizeEmbeddingText = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isE5Model = (modelName = "") => String(modelName || "").toLowerCase().includes("e5");

const buildEmbeddingInput = (value = "", role = "query", modelName = "") => {
  const normalized = normalizeEmbeddingText(value);
  if (!normalized) return "";
  if (isE5Model(modelName)) {
    return `${role === "passage" ? "passage:" : "query:"} ${normalized}`;
  }
  return normalized;
};

const getCacheKey = ({ modelName = "", role = "query", text = "" } = {}) =>
  `${String(modelName || "").trim()}::${String(role || "query").trim()}::${normalizeEmbeddingText(text)}`;

const trimCacheIfNeeded = () => {
  if (embeddingCache.size <= MAX_CACHE_SIZE) return;
  const keys = embeddingCache.keys();
  while (embeddingCache.size > MAX_CACHE_SIZE) {
    const nextKey = keys.next().value;
    if (!nextKey) break;
    embeddingCache.delete(nextKey);
  }
};

const getPipelineFactory = async () => {
  if (!pipelineFactoryPromise) {
    pipelineFactoryPromise = import("@xenova/transformers")
      .then((module) => module.pipeline)
      .catch((error) => {
        pipelineFactoryPromise = null;
        throw error;
      });
  }
  return pipelineFactoryPromise;
};

const getEncoder = async () => {
  if (encoderPromise) return encoderPromise;

  encoderPromise = (async () => {
    const pipeline = await getPipelineFactory();
    let lastError = null;

    for (const modelName of DEFAULT_MODEL_CANDIDATES) {
      try {
        const encoder = await pipeline("feature-extraction", modelName, { quantized: true });
        encoderModelName = modelName;
        encoderLoadError = null;
        return encoder;
      } catch (error) {
        lastError = error;
      }
    }

    encoderModelName = "";
    encoderLoadError = lastError;
    throw lastError || new Error("Unable to load AI intent embedding model");
  })().catch((error) => {
    encoderPromise = null;
    throw error;
  });

  return encoderPromise;
};

const flattenNumericArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.flat(Infinity).map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (ArrayBuffer.isView(value)) return Array.from(value).map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (typeof value === "object") {
    if (Array.isArray(value.data)) {
      return value.data.flat(Infinity).map((item) => Number(item)).filter((item) => Number.isFinite(item));
    }
    if (ArrayBuffer.isView(value.data)) {
      return Array.from(value.data).map((item) => Number(item)).filter((item) => Number.isFinite(item));
    }
    if (typeof value.tolist === "function") {
      return flattenNumericArray(value.tolist());
    }
  }
  return [];
};

const normalizeVector = (vector = []) => {
  const values = Array.isArray(vector) ? vector : flattenNumericArray(vector);
  const magnitude = Math.sqrt(values.reduce((sum, item) => sum + (Number(item) ** 2), 0));
  if (!Number.isFinite(magnitude) || magnitude <= 0) return values;
  return values.map((item) => Number(item) / magnitude);
};

const getSemanticEmbedding = async (value = "", { role = "query" } = {}) => {
  const normalized = normalizeEmbeddingText(value);
  if (!normalized) return null;

  const modelName = encoderModelName || DEFAULT_MODEL_CANDIDATES[0] || "";
  const cacheKey = getCacheKey({ modelName, role, text: normalized });
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey);
  }

  let encoder;
  try {
    encoder = await getEncoder();
  } catch (error) {
    encoderLoadError = error;
    return null;
  }

  const preparedInput = buildEmbeddingInput(normalized, role, encoderModelName || modelName);
  if (!preparedInput) return null;

  try {
    const output = await encoder(preparedInput, { pooling: "mean", normalize: true });
    const vector = normalizeVector(flattenNumericArray(output));
    if (!vector.length) return null;

    embeddingCache.set(cacheKey, vector);
    trimCacheIfNeeded();
    return vector;
  } catch (error) {
    encoderLoadError = error;
    return null;
  }
};

const cosineSimilarity = (left = [], right = []) => {
  const leftVector = Array.isArray(left) ? left : [];
  const rightVector = Array.isArray(right) ? right : [];
  if (!leftVector.length || !rightVector.length || leftVector.length !== rightVector.length) return 0;

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < leftVector.length; index += 1) {
    const leftValue = Number(leftVector[index] || 0);
    const rightValue = Number(rightVector[index] || 0);
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.max(0, Math.min(1, dot / denominator));
};

const getSemanticSimilarity = async (left = "", right = "") => {
  const leftEmbedding = await getSemanticEmbedding(left, { role: "query" });
  const rightEmbedding = await getSemanticEmbedding(right, { role: "passage" });

  if (!leftEmbedding || !rightEmbedding) return null;
  return cosineSimilarity(leftEmbedding, rightEmbedding);
};

const getEmbeddingStatus = () => ({
  modelName: encoderModelName || DEFAULT_MODEL_CANDIDATES[0] || "",
  ready: Boolean(encoderPromise && !encoderLoadError) || Boolean(encoderModelName),
  error: encoderLoadError ? String(encoderLoadError.message || encoderLoadError) : "",
});

module.exports = {
  cosineSimilarity,
  getEmbeddingStatus,
  getSemanticEmbedding,
  getSemanticSimilarity,
  normalizeEmbeddingText,
};

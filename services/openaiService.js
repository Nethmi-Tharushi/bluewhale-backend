const axios = require("axios");
const { buildGroundedReplyInstructions, buildOpenScopeReplyInstructions } = require("../prompts/whatsappAiAgentPrompts");

const DEFAULT_API_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";

const trimString = (value) => String(value || "").trim();

const clampPositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.trunc(parsed);
};

const truncateText = (value, maxLength = 800) => {
  const normalized = trimString(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
};

const normalizeConversationHistory = (history = []) =>
  (Array.isArray(history) ? history : [])
    .map((item) => ({
      role: trimString(item?.role).toLowerCase() === "assistant" ? "assistant" : "user",
      text: truncateText(item?.text, 600),
      timestamp: trimString(item?.timestamp),
    }))
    .filter((item) => item.text);

const getProviderName = ({ apiBaseUrl = "", apiKey = "" } = {}) => {
  const normalizedBaseUrl = trimString(apiBaseUrl).toLowerCase();
  if (normalizedBaseUrl.includes("groq")) return "Groq";
  if (normalizedBaseUrl.includes("openai")) return "OpenAI";
  if (trimString(process.env.GROQ_API_KEY) && trimString(apiKey) === trimString(process.env.GROQ_API_KEY)) return "Groq";
  return "AI provider";
};

const getOpenAiConfig = () => {
  const groqConfigured = Boolean(trimString(process.env.GROQ_API_KEY));
  const apiKey = trimString(process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY);
  const apiBaseUrl = trimString(
    process.env.OPENAI_API_BASE_URL
    || process.env.GROQ_API_BASE_URL
    || (groqConfigured ? DEFAULT_GROQ_API_BASE_URL : DEFAULT_API_BASE_URL)
  ) || (groqConfigured ? DEFAULT_GROQ_API_BASE_URL : DEFAULT_API_BASE_URL);
  const timeoutMs = clampPositiveInteger(process.env.OPENAI_TIMEOUT_MS || process.env.GROQ_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const fallbackModel = groqConfigured ? DEFAULT_GROQ_MODEL : DEFAULT_MODEL;
  const model = trimString(process.env.OPENAI_MODEL || process.env.GROQ_MODEL || fallbackModel) || fallbackModel;

  return {
    apiKey,
    apiBaseUrl,
    timeoutMs,
    model,
    faqModel: trimString(process.env.OPENAI_FAQ_MODEL || process.env.GROQ_FAQ_MODEL || model) || model,
    intentModel: trimString(process.env.OPENAI_INTENT_MODEL || process.env.GROQ_INTENT_MODEL || model) || model,
    providerName: getProviderName({ apiBaseUrl, apiKey }),
  };
};

const isOpenAiConfigured = () => Boolean(getOpenAiConfig().apiKey);

const buildErrorMessage = (error) => {
  const config = getOpenAiConfig();
  const providerName = trimString(config.providerName || "AI provider") || "AI provider";
  const apiMessage = trimString(
    error?.response?.data?.error?.message
    || error?.response?.data?.message
    || error?.message
  );

  if (!apiMessage) {
    return `${providerName} request failed`;
  }

  if (/api key/i.test(apiMessage)) {
    return `${providerName} API key is invalid or missing`;
  }

  return apiMessage;
};

const extractOutputText = (data = {}) => {
  if (typeof data?.output_text === "string" && trimString(data.output_text)) {
    return trimString(data.output_text);
  }

  const parts = [];
  const outputItems = Array.isArray(data?.output) ? data.output : [];
  outputItems.forEach((item) => {
    const contentItems = Array.isArray(item?.content) ? item.content : [];
    contentItems.forEach((content) => {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        parts.push(content.text);
      }
    });
  });

  return trimString(parts.join("\n"));
};
const normalizeKnowledgeEntries = (entries = [], limit = 8) =>
  (Array.isArray(entries) ? entries : [])
    .slice(0, Math.max(1, limit))
    .map((entry) => ({
      id: trimString(entry?.destinationId || entry?.id),
      title: trimString(entry?.title),
      answer: truncateText(entry?.answer || entry?.content, 600),
      searchableText: truncateText(entry?.searchableText, 600),
    }))
    .filter((entry) => entry.id && entry.title && entry.answer);

const normalizeCapturedContext = (capturedContext = {}) => {
  if (!capturedContext || typeof capturedContext !== "object" || Array.isArray(capturedContext)) {
    return {};
  }

  return Object.entries(capturedContext).reduce((accumulator, [key, value]) => {
    const normalizedKey = trimString(key);
    const normalizedValue = truncateText(value, 200);
    if (!normalizedKey || !normalizedValue) {
      return accumulator;
    }

    accumulator[normalizedKey] = normalizedValue;
    return accumulator;
  }, {});
};

const createStructuredResponse = async ({
  model,
  instructions,
  input,
  schemaName,
  schema,
  metadata = {},
} = {}) => {
  const config = getOpenAiConfig();
  if (!config.apiKey) {
    return null;
  }

  try {
    const { data } = await axios.post(
      `${config.apiBaseUrl.replace(/\/+$/, "")}/responses`,
      {
        model: trimString(model || config.model) || config.model,
        instructions: trimString(instructions),
        input,
        text: {
          format: {
            type: "json_schema",
            name: trimString(schemaName) || "structured_output",
            schema,
            strict: true,
          },
        },
        metadata,
      },
      {
        timeout: config.timeoutMs,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const outputText = extractOutputText(data);
    if (!outputText) {
      return null;
    }

    return JSON.parse(outputText);
  } catch (error) {
    throw new Error(buildErrorMessage(error));
  }
};

const rankWhatsAppIntentCandidates = async ({ message, matchMode = "balanced", candidates = [] } = {}) => {
  if (!isOpenAiConfigured()) {
    return null;
  }

  const normalizedMessage = trimString(message);
  const normalizedCandidates = Array.isArray(candidates)
    ? candidates
      .map((candidate) => ({
        destinationType: trimString(candidate?.destinationType),
        destinationId: trimString(candidate?.destinationId),
        destinationName: trimString(candidate?.destinationName || candidate?.intentLabel),
        intentLabel: trimString(candidate?.intentLabel || candidate?.destinationName),
        searchableText: truncateText(candidate?.searchableText, 700),
      }))
      .filter((candidate) => candidate.destinationType && candidate.destinationId && candidate.searchableText)
    : [];

  if (!normalizedMessage || !normalizedCandidates.length) {
    return null;
  }

  const response = await createStructuredResponse({
    model: getOpenAiConfig().intentModel,
    schemaName: "whatsapp_intent_rankings",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["rankings"],
      properties: {
        rankings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["destinationType", "destinationId", "confidence", "reason"],
            properties: {
              destinationType: { type: "string" },
              destinationId: { type: "string" },
              confidence: { type: "number" },
              reason: { type: "string" },
            },
          },
        },
      },
    },
    instructions: [
      "You rerank WhatsApp intent candidates for a CRM assistant.",
      "Judge semantic meaning, not keyword overlap alone.",
      `Use ${trimString(matchMode) || "balanced"} matching strictness.`,
      "Return only candidates that truly match the user's request.",
      "Confidence must be between 0 and 1.",
      "If nothing matches, return an empty rankings array.",
    ].join(" "),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              message: normalizedMessage,
              candidates: normalizedCandidates,
            }),
          },
        ],
      },
    ],
    metadata: {
      feature: "whatsapp_ai_intent_rerank",
      match_mode: trimString(matchMode) || "balanced",
    },
  });

  const rankings = Array.isArray(response?.rankings) ? response.rankings : [];
  return rankings
    .map((item) => ({
      destinationType: trimString(item?.destinationType),
      destinationId: trimString(item?.destinationId),
      confidence: Math.max(0, Math.min(1, Number(item?.confidence || 0))),
      reason: trimString(item?.reason || "semantic_match") || "semantic_match",
    }))
    .filter((item) => item.destinationType && item.destinationId)
    .sort((left, right) => right.confidence - left.confidence);
};

const generateGroundedWhatsAppReply = async ({
  agentType = "faq_responder",
  message,
  knowledgeEntries = [],
  businessName = "",
  conversationHistory = [],
} = {}) => {
  if (!isOpenAiConfigured()) {
    return null;
  }

  const normalizedMessage = trimString(message);
  const normalizedKnowledgeEntries = normalizeKnowledgeEntries(knowledgeEntries, 6);
  const normalizedConversationHistory = normalizeConversationHistory(conversationHistory).slice(-20);

  if (!normalizedMessage || !normalizedKnowledgeEntries.length) {
    return null;
  }

  const response = await createStructuredResponse({
    model: getOpenAiConfig().faqModel,
    schemaName: "whatsapp_grounded_reply",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["should_answer", "answer", "confidence", "matched_ids", "handoff", "reason"],
      properties: {
        should_answer: { type: "boolean" },
        answer: { type: "string" },
        confidence: { type: "number" },
        matched_ids: {
          type: "array",
          items: { type: "string" },
        },
        handoff: { type: "boolean" },
        reason: { type: "string" },
      },
    },
    instructions: buildGroundedReplyInstructions({
      agentType,
      businessName,
    }),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              message: normalizedMessage,
              conversationHistory: normalizedConversationHistory,
              knowledgeEntries: normalizedKnowledgeEntries,
            }),
          },
        ],
      },
    ],
    metadata: {
      feature: "whatsapp_ai_agent_reply",
      agent_type: trimString(agentType) || "faq_responder",
    },
  });

  if (!response) {
    return null;
  }

  return {
    shouldAnswer: Boolean(response.should_answer),
    answer: trimString(response.answer),
    confidence: Math.max(0, Math.min(1, Number(response.confidence || 0))),
    matchedIds: Array.isArray(response.matched_ids) ? response.matched_ids.map(trimString).filter(Boolean) : [],
    handoff: Boolean(response.handoff),
    reason: trimString(response.reason),
  };
};

const generateOpenScopeWhatsAppReply = async ({
  agentType = "faq_responder",
  message,
  knowledgeEntries = [],
  businessName = "",
  conversationHistory = [],
  capturedContext = {},
  pendingField = "",
} = {}) => {
  if (!isOpenAiConfigured()) {
    return null;
  }

  const normalizedMessage = trimString(message);
  const normalizedKnowledgeEntries = normalizeKnowledgeEntries(knowledgeEntries, 8);
  const normalizedConversationHistory = normalizeConversationHistory(conversationHistory).slice(-20);
  const normalizedCapturedContext = normalizeCapturedContext(capturedContext);

  if (!normalizedMessage) {
    return null;
  }

  const response = await createStructuredResponse({
    model: getOpenAiConfig().model,
    schemaName: "whatsapp_open_scope_reply",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["should_answer", "answer", "confidence", "handoff", "reason"],
      properties: {
        should_answer: { type: "boolean" },
        answer: { type: "string" },
        confidence: { type: "number" },
        handoff: { type: "boolean" },
        reason: { type: "string" },
      },
    },
    instructions: buildOpenScopeReplyInstructions({
      agentType,
      businessName,
      pendingField,
    }),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              message: normalizedMessage,
              conversationHistory: normalizedConversationHistory,
              knowledgeEntries: normalizedKnowledgeEntries,
              capturedContext: normalizedCapturedContext,
              pendingField: trimString(pendingField),
            }),
          },
        ],
      },
    ],
    metadata: {
      feature: "whatsapp_ai_agent_open_scope_reply",
      agent_type: trimString(agentType) || "faq_responder",
    },
  });

  if (!response) {
    return null;
  }

  return {
    shouldAnswer: Boolean(response.should_answer),
    answer: trimString(response.answer),
    confidence: Math.max(0, Math.min(1, Number(response.confidence || 0))),
    handoff: Boolean(response.handoff),
    reason: trimString(response.reason),
  };
};

module.exports = {
  getOpenAiConfig,
  isOpenAiConfigured,
  rankWhatsAppIntentCandidates,
  generateGroundedWhatsAppReply,
  generateOpenScopeWhatsAppReply,
  __private: {
    buildErrorMessage,
    extractOutputText,
    truncateText,
    normalizeConversationHistory,
  },
};



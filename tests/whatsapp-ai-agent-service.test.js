const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const createQuery = (value) => ({
  populate() {
    return this;
  },
  select() {
    return this;
  },
  sort() {
    return this;
  },
  skip() {
    return this;
  },
  limit() {
    return this;
  },
  lean: async () => value,
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

module.exports = async () => {
  process.env.OPENAI_API_KEY = "";
  process.env.GROQ_API_KEY = "";

  const defaultService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiAgentService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/AdminUser": { findById: () => createQuery(null) },
    "../models/Lead": {
      findById: async () => null,
      findOne: async () => null,
      countDocuments: async () => 0,
      create: async (payload) => ({ _id: "lead_1", ...payload }),
    },
    "../models/WhatsAppAiAgentInterest": {
      INTEREST_STATUS_OPTIONS: ["new", "contacted", "qualified", "closed"],
      create: async (payload) => ({ _id: "interest_1", status: "new", createdAt: new Date("2026-04-09T10:00:00.000Z"), ...payload }),
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentLog": {
      RESPONSE_SOURCE_OPTIONS: ["ai", "knowledge_base", "catalog", "qualification_flow", "handoff", "fallback"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentSettings": {
      ROLLOUT_STATUS_OPTIONS: ["draft", "interest_collected", "pilot", "live"],
      AGENT_TYPE_OPTIONS: ["sales_agent", "faq_responder", "lead_qualifier"],
      findOne: () => createQuery(null),
      create: async (payload) => payload,
    },
    "../models/WhatsAppAutomation": { countDocuments: async () => 2 },
    "../models/WhatsAppBusinessProfile": { findOne: () => createQuery(null) },
    "../models/WhatsAppConversation": { findById: () => createQuery(null) },
    "../models/WhatsAppForm": { countDocuments: async () => 1 },
    "../models/WhatsAppQuickReply": {
      countDocuments: async () => 3,
      find: () => createQuery([]),
    },
    "./whatsappProductCollectionService": {
      listAvailableProductCollections: async () => [],
    },
    "./whatsappService": {
      sendMessage: async () => ({ payload: {}, response: { messages: [{ id: "wamid.test" }] } }),
    },
  });

  const overview = await defaultService.getWhatsAppAiAgentOverview();
  assert.equal(overview.enabled, false);
  assert.equal(overview.rolloutStatus, "draft");
  assert.equal(overview.defaultAgentType, "sales_agent");
  assert.equal(overview.stats.catalogItems, 0);
  assert.equal(overview.stats.quickReplies, 3);

  assert.throws(
    () => defaultService.__private.normalizeSettingsPayload({ defaultAgentType: "invalid" }),
    /defaultAgentType must be one of/i
  );

  const interestCreates = [];
  const interestService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiAgentService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/AdminUser": { findById: () => createQuery({ _id: "admin_1", role: "SalesAdmin", reportsTo: null }) },
    "../models/Lead": {
      findById: async () => null,
      findOne: async () => null,
      countDocuments: async () => 4,
      create: async (payload) => ({ _id: "lead_99", ...payload }),
    },
    "../models/WhatsAppAiAgentInterest": {
      INTEREST_STATUS_OPTIONS: ["new", "contacted", "qualified", "closed"],
      create: async (payload) => {
        interestCreates.push(payload);
        return { _id: "interest_1", status: "new", createdAt: new Date("2026-04-09T10:00:00.000Z"), ...payload };
      },
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentLog": {
      RESPONSE_SOURCE_OPTIONS: ["ai", "knowledge_base", "catalog", "qualification_flow", "handoff", "fallback"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentSettings": {
      ROLLOUT_STATUS_OPTIONS: ["draft", "interest_collected", "pilot", "live"],
      AGENT_TYPE_OPTIONS: ["sales_agent", "faq_responder", "lead_qualifier"],
      findOne: () => createQuery(null),
      create: async (payload) => payload,
    },
    "../models/WhatsAppAutomation": { countDocuments: async () => 0 },
    "../models/WhatsAppBusinessProfile": { findOne: () => createQuery(null) },
    "../models/WhatsAppConversation": { findById: () => createQuery(null) },
    "../models/WhatsAppForm": { countDocuments: async () => 0 },
    "../models/WhatsAppQuickReply": {
      countDocuments: async () => 0,
      find: () => createQuery([]),
    },
    "./whatsappProductCollectionService": {
      listAvailableProductCollections: async () => [],
    },
    "./whatsappService": {
      sendMessage: async () => ({ payload: {}, response: { messages: [{ id: "wamid.test" }] } }),
    },
  });

  const interestResult = await interestService.createWhatsAppAiAgentInterest({
    actor: { _id: "admin_1", role: "SalesAdmin" },
    payload: {
      companyName: "Acme Pvt Ltd",
      contactName: "John Doe",
      email: "john@acme.com",
      phone: "+1 555 000",
      preferredAgentTypes: ["sales_agent", "faq_responder"],
      monthlyConversationVolume: 5000,
      useCase: "Need product recommendations and FAQ automation",
      catalogNeeded: true,
      crmIntegrationNeeded: true,
      webinarRequested: false,
      notes: "",
    },
  });
  assert.equal(interestResult.status, "new");
  assert.equal(interestCreates.length, 1);
  assert.equal(interestCreates[0].companyName, "Acme Pvt Ltd");

  const catalogService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiAgentService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/AdminUser": { findById: () => createQuery(null) },
    "../models/Lead": {
      findById: async () => null,
      findOne: async () => null,
      countDocuments: async () => 0,
      create: async (payload) => ({ _id: "lead_1", ...payload }),
    },
    "../models/WhatsAppAiAgentInterest": {
      INTEREST_STATUS_OPTIONS: ["new", "contacted", "qualified", "closed"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentLog": {
      RESPONSE_SOURCE_OPTIONS: ["ai", "knowledge_base", "catalog", "qualification_flow", "handoff", "fallback"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentSettings": {
      ROLLOUT_STATUS_OPTIONS: ["draft", "interest_collected", "pilot", "live"],
      AGENT_TYPE_OPTIONS: ["sales_agent", "faq_responder", "lead_qualifier"],
      findOne: () => createQuery(null),
      create: async (payload) => payload,
    },
    "../models/WhatsAppAutomation": { countDocuments: async () => 0 },
    "../models/WhatsAppBusinessProfile": { findOne: () => createQuery(null) },
    "../models/WhatsAppConversation": { findById: () => createQuery(null) },
    "../models/WhatsAppForm": { countDocuments: async () => 0 },
    "../models/WhatsAppQuickReply": {
      countDocuments: async () => 0,
      find: () => createQuery([]),
    },
    "./whatsappProductCollectionService": {
      listAvailableProductCollections: async () => [
        {
          id: "collection_1",
          name: "Office Wear",
          description: "Formal and smart casual office outfits",
          category: "Kurtas",
          itemCount: 2,
          items: [
            { id: "kurta_1", title: "Blue Straight Cotton Kurta", description: "Ideal for office wear" },
            { id: "kurta_2", title: "Grey Formal Kurta", description: "Minimal style for work days" },
          ],
        },
      ],
    },
    "./whatsappService": {
      sendMessage: async () => ({ payload: {}, response: { messages: [{ id: "wamid.test" }] } }),
    },
  });

  const salesResult = await catalogService.resolveWhatsAppAiAgentResponse(
    "I need a kurta for office wear",
    {},
    {
      settings: {
        ...overview,
        enabled: true,
        defaultAgentType: "sales_agent",
        salesAgent: { enabled: true, catalogEnabled: true, handoffEnabled: true, fallbackMessage: "" },
      },
    }
  );
  assert.equal(salesResult.responseSource, "catalog");
  assert.equal(Array.isArray(salesResult.suggestions), true);
  assert.equal(salesResult.suggestions.length > 0, true);

  let capturedSalesAiPayload = null;
  const aiSalesService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiAgentService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/AdminUser": { findById: () => createQuery(null) },
    "../models/Lead": {
      findById: async () => null,
      findOne: async () => null,
      countDocuments: async () => 0,
      create: async (payload) => ({ _id: "lead_1", ...payload }),
    },
    "../models/WhatsAppAiAgentInterest": {
      INTEREST_STATUS_OPTIONS: ["new", "contacted", "qualified", "closed"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentLog": {
      RESPONSE_SOURCE_OPTIONS: ["ai", "knowledge_base", "catalog", "qualification_flow", "handoff", "fallback"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentSettings": {
      ROLLOUT_STATUS_OPTIONS: ["draft", "interest_collected", "pilot", "live"],
      AGENT_TYPE_OPTIONS: ["sales_agent", "faq_responder", "lead_qualifier"],
      findOne: () => createQuery(null),
      create: async (payload) => payload,
    },
    "../models/WhatsAppAutomation": { countDocuments: async () => 0 },
    "../models/WhatsAppBusinessProfile": {
      findOne: () => createQuery({ businessName: "Blue Whale Migration" }),
    },
    "../models/WhatsAppConversation": { findById: () => createQuery(null) },
    "../models/WhatsAppForm": { countDocuments: async () => 0 },
    "../models/WhatsAppMessage": {
      find: () => createQuery([
        {
          direction: "inbound",
          sender: "customer",
          content: "Australia",
          timestamp: new Date("2026-04-09T10:01:00.000Z"),
          type: "text",
        },
        {
          direction: "outbound",
          sender: "system",
          content: "Which country are you interested in?",
          timestamp: new Date("2026-04-09T10:00:00.000Z"),
          type: "text",
        },
      ]),
    },
    "../models/WhatsAppQuickReply": {
      countDocuments: async () => 0,
      find: () => createQuery([]),
    },
    "./openaiService": {
      isOpenAiConfigured: () => true,
      generateGroundedWhatsAppReply: async (payload) => {
        capturedSalesAiPayload = payload;
        return {
          shouldAnswer: true,
          answer: "For Australia, the skilled migration package is the best starting point. I can also guide you on the documents needed for that pathway.",
          confidence: 0.88,
          matchedIds: ["visa_1"],
          handoff: false,
          reason: "history_context",
        };
      },
      generateOpenScopeWhatsAppReply: async (payload) => {
        capturedSalesAiPayload = payload;
        return {
          shouldAnswer: true,
          answer: "For Australia, the skilled migration package is the best starting point. I can also guide you on the documents needed for that pathway.",
          confidence: 0.88,
          handoff: false,
          reason: "open_scope_fallback",
        };
      },
    },
    "./whatsappProductCollectionService": {
      listAvailableProductCollections: async () => [
        {
          id: "collection_1",
          name: "Australia Migration",
          description: "Migration help for Australia",
          category: "migration",
          itemCount: 1,
          items: [{ id: "visa_1", title: "What Documents Should I Upload for Skilled Migration", description: "Support for skilled migration applications including document upload guidance" }],
        },
      ],
    },
    "./whatsappService": {
      sendMessage: async () => ({ payload: {}, response: { messages: [{ id: "wamid.test" }] } }),
    },
  });

  const aiSalesResult = await aiSalesService.resolveWhatsAppAiAgentResponse(
    "What documents should I upload?",
    {
      conversation: { _id: "507f1f77bcf86cd799439030" },
      contact: { phone: "+15550001", name: "Nethmi" },
    },
    {
      settings: {
        ...overview,
        enabled: true,
        defaultAgentType: "sales_agent",
        salesAgent: { enabled: true, catalogEnabled: true, handoffEnabled: true, fallbackMessage: "" },
      },
    }
  );
  assert.equal(aiSalesResult.responseSource, "catalog");
  assert.match(aiSalesResult.reply, /Australia/i);
  assert.deepEqual(aiSalesResult.matchedCatalogItemIds, ["visa_1"]);
  assert.equal(Array.isArray(capturedSalesAiPayload.conversationHistory), true);
  assert.equal(capturedSalesAiPayload.conversationHistory.length, 2);
  assert.equal(capturedSalesAiPayload.conversationHistory[0].role, "assistant");
  assert.equal(capturedSalesAiPayload.conversationHistory[1].text, "Australia");

  const salesCountryFollowUpService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiAgentService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/AdminUser": { findById: () => createQuery(null) },
    "../models/Lead": {
      findById: async () => null,
      findOne: async () => null,
      countDocuments: async () => 0,
      create: async (payload) => ({ _id: "lead_1", ...payload }),
    },
    "../models/WhatsAppAiAgentInterest": {
      INTEREST_STATUS_OPTIONS: ["new", "contacted", "qualified", "closed"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentLog": {
      RESPONSE_SOURCE_OPTIONS: ["ai", "knowledge_base", "catalog", "qualification_flow", "handoff", "fallback"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentSettings": {
      ROLLOUT_STATUS_OPTIONS: ["draft", "interest_collected", "pilot", "live"],
      AGENT_TYPE_OPTIONS: ["sales_agent", "faq_responder", "lead_qualifier"],
      findOne: () => createQuery(null),
      create: async (payload) => payload,
    },
    "../models/WhatsAppAutomation": { countDocuments: async () => 0 },
    "../models/WhatsAppBusinessProfile": { findOne: () => createQuery({ businessName: "Blue Whale Migration" }) },
    "../models/WhatsAppConversation": { findById: () => createQuery(null) },
    "../models/WhatsAppForm": { countDocuments: async () => 0 },
    "../models/WhatsAppMessage": {
      find: () => createQuery([
        {
          direction: "inbound",
          sender: "customer",
          content: "I need help choosing the right migration package",
          timestamp: new Date("2026-04-09T10:00:00.000Z"),
          type: "text",
        },
        {
          direction: "outbound",
          sender: "system",
          content: "Which country are you interested in?",
          timestamp: new Date("2026-04-09T10:01:00.000Z"),
          type: "text",
        },
      ]),
    },
    "../models/WhatsAppQuickReply": { countDocuments: async () => 0, find: () => createQuery([]) },
    "./openaiService": {
      isOpenAiConfigured: () => false,
      generateGroundedWhatsAppReply: async () => null,
    },
    "./whatsappProductCollectionService": {
      listAvailableProductCollections: async () => [
        {
          id: "collection_1",
          name: "Migration Packages",
          description: "Migration help",
          category: "migration",
          itemCount: 1,
          items: [{ id: "pkg_1", title: "General Migration Package", description: "Migration support package" }],
        },
      ],
    },
    "./whatsappService": {
      sendMessage: async () => ({ payload: {}, response: { messages: [{ id: "wamid.test" }] } }),
    },
  });

  const japanFollowUpResult = await salesCountryFollowUpService.resolveWhatsAppAiAgentResponse(
    "Japan",
    {
      conversation: { _id: "507f1f77bcf86cd799439031" },
      contact: { phone: "+15550001", name: "Nethmi" },
    },
    {
      settings: {
        ...overview,
        enabled: true,
        defaultAgentType: "sales_agent",
        salesAgent: { enabled: true, catalogEnabled: true, handoffEnabled: true, fallbackMessage: "" },
      },
    }
  );
  assert.equal(japanFollowUpResult.responseSource, "catalog");
  assert.equal(japanFollowUpResult.handoffTriggered, false);
  assert.match(japanFollowUpResult.reply, /Japan/i);
  assert.match(japanFollowUpResult.reply, /work, study, or migration support/i);

  const faqService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiAgentService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/AdminUser": { findById: () => createQuery(null) },
    "../models/Lead": {
      findById: async () => null,
      findOne: async () => null,
      countDocuments: async () => 0,
      create: async (payload) => ({ _id: "lead_1", ...payload }),
    },
    "../models/WhatsAppAiAgentInterest": {
      INTEREST_STATUS_OPTIONS: ["new", "contacted", "qualified", "closed"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentLog": {
      RESPONSE_SOURCE_OPTIONS: ["ai", "knowledge_base", "catalog", "qualification_flow", "handoff", "fallback"],
      create: async (payload) => payload,
      find: () => createQuery([{ _id: "log_1", agentType: "faq_responder", direction: "inbound", messageText: "what is your website", responseText: "https://example.com", responseSource: "knowledge_base", createdAt: new Date("2026-04-09T10:00:00.000Z") }]),
      countDocuments: async () => 1,
    },
    "../models/WhatsAppAiAgentSettings": {
      ROLLOUT_STATUS_OPTIONS: ["draft", "interest_collected", "pilot", "live"],
      AGENT_TYPE_OPTIONS: ["sales_agent", "faq_responder", "lead_qualifier"],
      findOne: () => createQuery(null),
      create: async (payload) => payload,
    },
    "../models/WhatsAppAutomation": { countDocuments: async () => 0 },
    "../models/WhatsAppBusinessProfile": {
      findOne: () => createQuery({ businessName: "Blue Whale CRM", website: "https://bluewhale.example" }),
    },
    "../models/WhatsAppConversation": { findById: () => createQuery(null) },
    "../models/WhatsAppForm": { countDocuments: async () => 0 },
    "../models/WhatsAppQuickReply": {
      countDocuments: async () => 1,
      find: () => createQuery([
        { _id: "qr_1", title: "Shipping Policy", category: "General", folder: "FAQ", content: "Shipping takes 3-5 business days." },
      ]),
    },
    "./whatsappProductCollectionService": {
      listAvailableProductCollections: async () => [],
    },
    "./whatsappService": {
      sendMessage: async () => ({ payload: {}, response: { messages: [{ id: "wamid.test" }] } }),
    },
  });

  const faqResult = await faqService.resolveWhatsAppAiAgentResponse(
    "Tell me your shipping policy",
    {},
    {
      settings: {
        ...overview,
        enabled: true,
        defaultAgentType: "faq_responder",
        faqResponder: { enabled: true, knowledgeBaseEnabled: true, handoffEnabled: true, fallbackMessage: "" },
      },
    }
  );
  assert.equal(faqResult.responseSource, "knowledge_base");
  assert.match(faqResult.reply, /shipping/i);

  const qualificationConversation = {
    agentId: "admin_1",
    linkedLeadId: null,
    automationState: { aiAgent: { qualification: {} } },
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
  };

  const leadService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiAgentService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/AdminUser": { findById: () => createQuery({ _id: "admin_1", role: "SalesAdmin", reportsTo: null }) },
    "../models/Lead": {
      findById: async () => null,
      findOne: async () => null,
      countDocuments: async () => 7,
      create: async (payload) => ({ _id: "lead_7", ...payload }),
    },
    "../models/WhatsAppAiAgentInterest": {
      INTEREST_STATUS_OPTIONS: ["new", "contacted", "qualified", "closed"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentLog": {
      RESPONSE_SOURCE_OPTIONS: ["ai", "knowledge_base", "catalog", "qualification_flow", "handoff", "fallback"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentSettings": {
      ROLLOUT_STATUS_OPTIONS: ["draft", "interest_collected", "pilot", "live"],
      AGENT_TYPE_OPTIONS: ["sales_agent", "faq_responder", "lead_qualifier"],
      findOne: () => createQuery(null),
      create: async (payload) => payload,
    },
    "../models/WhatsAppAutomation": { countDocuments: async () => 0 },
    "../models/WhatsAppBusinessProfile": { findOne: () => createQuery(null) },
    "../models/WhatsAppConversation": { findById: () => createQuery(null) },
    "../models/WhatsAppForm": { countDocuments: async () => 0 },
    "../models/WhatsAppQuickReply": {
      countDocuments: async () => 0,
      find: () => createQuery([]),
    },
    "./whatsappProductCollectionService": {
      listAvailableProductCollections: async () => [],
    },
    "./whatsappService": {
      sendMessage: async () => ({ payload: {}, response: { messages: [{ id: "wamid.test" }] } }),
    },
  });

  const leadSettings = {
    ...overview,
    enabled: true,
    defaultAgentType: "lead_qualifier",
    leadQualifier: {
      enabled: true,
      qualificationFields: ["name", "budget", "timeline"],
      crmSyncTarget: "crm_leads",
      handoffEnabled: true,
      fallbackMessage: "",
    },
  };

  const progressiveResult = await leadService.resolveWhatsAppAiAgentResponse(
    "hello",
    { conversation: qualificationConversation, contact: { phone: "+15550001" } },
    { settings: leadSettings, agentType: "lead_qualifier", actorId: "admin_1" }
  );
  assert.equal(progressiveResult.responseSource, "qualification_flow");
  assert.equal(progressiveResult.leadCapture.needed, true);
  assert.equal(progressiveResult.leadCapture.fields[0], "name");

  const capturedConversation = {
    agentId: "admin_1",
    linkedLeadId: null,
    automationState: {
      aiAgent: {
        qualification: {
          capturedFields: { name: "John Doe", budget: "1500 USD" },
          pendingField: "timeline",
        },
      },
    },
    async save() {
      return this;
    },
  };

  const qualifiedResult = await leadService.resolveWhatsAppAiAgentResponse(
    "Next month",
    { conversation: capturedConversation, contact: { phone: "+15550001", name: "John Doe" } },
    { settings: leadSettings, agentType: "lead_qualifier", actorId: "admin_1" }
  );
  assert.equal(qualifiedResult.leadCaptured, true);
  assert.equal(String(qualifiedResult.leadId), "lead_7");

  const countryConversation = {
    agentId: "admin_1",
    linkedLeadId: null,
    automationState: {
      aiAgent: {
        qualification: {
          capturedFields: { name: "Nethmi", budget: "1000000" },
          pendingField: "country",
        },
      },
    },
    async save() {
      return this;
    },
  };

  const countryResult = await leadService.resolveWhatsAppAiAgentResponse(
    "australia",
    { conversation: countryConversation, contact: { phone: "+15550001", name: "Nethmi" } },
    {
      settings: {
        ...overview,
        enabled: true,
        defaultAgentType: "lead_qualifier",
        leadQualifier: {
          enabled: true,
          qualificationFields: ["name", "budget", "country", "timeline"],
          crmSyncTarget: "crm_leads",
          handoffEnabled: true,
          fallbackMessage: "",
        },
      },
      agentType: "lead_qualifier",
      actorId: "admin_1",
    }
  );
  assert.equal(countryResult.responseSource, "qualification_flow");
  assert.equal(countryResult.leadCapture.needed, true);
  assert.equal(countryResult.leadCapture.fields[0], "timeline");

  const handoffResult = await defaultService.resolveWhatsAppAiAgentResponse(
    "I want to speak to a human agent",
    {},
    {
      settings: {
        ...overview,
        enabled: true,
        defaultAgentType: "sales_agent",
        salesAgent: { enabled: true, catalogEnabled: true, handoffEnabled: true, fallbackMessage: "" },
      },
    }
  );
  assert.equal(handoffResult.responseSource, "handoff");
  assert.equal(handoffResult.handoffTriggered, true);
  assert.equal(
    defaultService.__private.shouldPersistHandoffBlock({
      handoffTriggered: true,
      handoffReason: "Customer requested a human handoff",
    }),
    true
  );
  assert.equal(
    defaultService.__private.shouldPersistHandoffBlock({
      handoffTriggered: true,
      handoffReason: "Low confidence triggered human handoff",
    }),
    false
  );
  assert.equal(
    defaultService.__private.isConversationEligibleForAiAgent({
      automationState: {
        aiAgent: {
          handoffTriggered: true,
          handoffReason: "Low confidence triggered human handoff",
        },
      },
      workflowContext: {},
    }),
    true
  );
  assert.equal(
    defaultService.__private.isConversationEligibleForAiAgent({
      automationState: {
        aiAgent: {
          handoffTriggered: true,
          handoffReason: "Customer requested a human handoff",
        },
      },
      workflowContext: {},
    }),
    false
  );

  const history = await faqService.listWhatsAppAiAgentHistory({ page: 1, limit: 20 });
  assert.equal(history.items.length, 1);
  assert.equal(history.pagination.total, 1);
  assert.deepEqual(history.items[0].notes, []);

  let historyFindFilter = null;
  let historyCountFilter = null;
  const historyFilterService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiAgentService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/AdminUser": { findById: () => createQuery(null) },
    "../models/Lead": {
      findById: async () => null,
      findOne: async () => null,
      countDocuments: async () => 0,
      create: async (payload) => ({ _id: "lead_1", ...payload }),
    },
    "../models/WhatsAppAiAgentInterest": {
      INTEREST_STATUS_OPTIONS: ["new", "contacted", "qualified", "closed"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
      findById: async () => null,
    },
    "../models/WhatsAppAiAgentLog": {
      RESPONSE_SOURCE_OPTIONS: ["ai", "knowledge_base", "catalog", "qualification_flow", "handoff", "fallback"],
      create: async (payload) => payload,
      find: (filter) => {
        historyFindFilter = filter;
        return createQuery([
          {
            _id: "log_2",
            conversationId: "507f1f77bcf86cd799439020",
            messageId: "wamid.2",
            customerPhone: "+15551234",
            agentType: "sales_agent",
            direction: "inbound",
            messageText: "hello",
            responseText: "hi",
            responseSource: "catalog",
            confidence: 0.88,
            leadCaptured: true,
            leadId: "507f1f77bcf86cd799439021",
            handoffTriggered: false,
            notes: ["catalog_match"],
            createdAt: new Date("2026-04-09T10:00:00.000Z"),
          },
        ]);
      },
      countDocuments: async (filter) => {
        historyCountFilter = filter;
        return 1;
      },
    },
    "../models/WhatsAppAiAgentSettings": {
      ROLLOUT_STATUS_OPTIONS: ["draft", "interest_collected", "pilot", "live"],
      AGENT_TYPE_OPTIONS: ["sales_agent", "faq_responder", "lead_qualifier"],
      findOne: () => createQuery(null),
      create: async (payload) => payload,
    },
    "../models/WhatsAppAutomation": { countDocuments: async () => 0 },
    "../models/WhatsAppBusinessProfile": { findOne: () => createQuery(null) },
    "../models/WhatsAppConversation": { findById: () => createQuery(null) },
    "../models/WhatsAppForm": { countDocuments: async () => 0 },
    "../models/WhatsAppQuickReply": { countDocuments: async () => 0, find: () => createQuery([]) },
    "./whatsappProductCollectionService": { listAvailableProductCollections: async () => [] },
    "./whatsappService": { sendMessage: async () => ({ payload: {}, response: { messages: [{ id: "wamid.test" }] } }) },
  });

  const filteredHistory = await historyFilterService.listWhatsAppAiAgentHistory({
    page: 1,
    limit: 20,
    agentType: "sales_agent",
    responseSource: "catalog",
    handoffTriggered: "false",
    leadCaptured: "true",
    dateFrom: "2026-04-01",
    dateTo: "2026-04-30",
    customerPhone: "+1555",
    conversationId: "507f1f77bcf86cd799439020",
  });
  assert.equal(filteredHistory.items.length, 1);
  assert.equal(historyFindFilter.agentType, "sales_agent");
  assert.equal(historyFindFilter.responseSource, "catalog");
  assert.equal(historyFindFilter.handoffTriggered, false);
  assert.equal(historyFindFilter.leadCaptured, true);
  assert.equal(historyFindFilter.conversationId, "507f1f77bcf86cd799439020");
  assert.equal(historyCountFilter.responseSource, "catalog");

  let interestsFindFilter = null;
  const interestListService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiAgentService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/AdminUser": { findById: () => createQuery(null) },
    "../models/Lead": {
      findById: async () => null,
      findOne: async () => null,
      countDocuments: async () => 0,
      create: async (payload) => ({ _id: "lead_1", ...payload }),
    },
    "../models/WhatsAppAiAgentInterest": {
      INTEREST_STATUS_OPTIONS: ["new", "contacted", "qualified", "closed"],
      create: async (payload) => payload,
      find: (filter) => {
        interestsFindFilter = filter;
        return createQuery([
          {
            _id: "interest_2",
            companyName: "Acme Pvt Ltd",
            contactName: "John Doe",
            email: "john@acme.com",
            phone: "+1555",
            whatsappNumber: "+1555",
            preferredAgentTypes: ["sales_agent"],
            monthlyConversationVolume: 5000,
            useCase: "Need product recommendations",
            catalogNeeded: true,
            crmIntegrationNeeded: true,
            webinarRequested: false,
            notes: "priority",
            status: "new",
            createdAt: new Date("2026-04-09T10:00:00.000Z"),
            updatedAt: new Date("2026-04-09T12:00:00.000Z"),
          },
        ]);
      },
      countDocuments: async () => 1,
      findById: async () => null,
    },
    "../models/WhatsAppAiAgentLog": {
      RESPONSE_SOURCE_OPTIONS: ["ai", "knowledge_base", "catalog", "qualification_flow", "handoff", "fallback"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentSettings": {
      ROLLOUT_STATUS_OPTIONS: ["draft", "interest_collected", "pilot", "live"],
      AGENT_TYPE_OPTIONS: ["sales_agent", "faq_responder", "lead_qualifier"],
      findOne: () => createQuery(null),
      create: async (payload) => payload,
    },
    "../models/WhatsAppAutomation": { countDocuments: async () => 0 },
    "../models/WhatsAppBusinessProfile": { findOne: () => createQuery(null) },
    "../models/WhatsAppConversation": { findById: () => createQuery(null) },
    "../models/WhatsAppForm": { countDocuments: async () => 0 },
    "../models/WhatsAppQuickReply": { countDocuments: async () => 0, find: () => createQuery([]) },
    "./whatsappProductCollectionService": { listAvailableProductCollections: async () => [] },
    "./whatsappService": { sendMessage: async () => ({ payload: {}, response: { messages: [{ id: "wamid.test" }] } }) },
  });

  const interestList = await interestListService.listWhatsAppAiAgentInterests({
    page: 1,
    limit: 20,
    status: "new",
    search: "acme",
  });
  assert.equal(interestList.items.length, 1);
  assert.equal(interestList.items[0].whatsappNumber, "+1555");
  assert.equal(interestList.items[0].useCase, "Need product recommendations");
  assert.equal(interestsFindFilter.status, "new");
  assert.equal(Array.isArray(interestsFindFilter.$or), true);

  const editableInterest = {
    _id: "507f1f77bcf86cd799439030",
    companyName: "Acme Pvt Ltd",
    contactName: "John Doe",
    email: "john@acme.com",
    phone: "+1555",
    whatsappNumber: "+1555",
    preferredAgentTypes: ["sales_agent"],
    monthlyConversationVolume: 5000,
    useCase: "Need product recommendations",
    catalogNeeded: true,
    crmIntegrationNeeded: true,
    webinarRequested: false,
    notes: "",
    status: "new",
    createdAt: new Date("2026-04-09T10:00:00.000Z"),
    updatedAt: new Date("2026-04-09T10:00:00.000Z"),
    async save() {
      this.updatedAt = new Date("2026-04-09T12:00:00.000Z");
      return this;
    },
  };

  const patchService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiAgentService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/AdminUser": { findById: () => createQuery(null) },
    "../models/Lead": {
      findById: async () => null,
      findOne: async () => null,
      countDocuments: async () => 0,
      create: async (payload) => ({ _id: "lead_1", ...payload }),
    },
    "../models/WhatsAppAiAgentInterest": {
      INTEREST_STATUS_OPTIONS: ["new", "contacted", "qualified", "closed"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
      findById: async (id) => (id === editableInterest._id ? editableInterest : null),
    },
    "../models/WhatsAppAiAgentLog": {
      RESPONSE_SOURCE_OPTIONS: ["ai", "knowledge_base", "catalog", "qualification_flow", "handoff", "fallback"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentSettings": {
      ROLLOUT_STATUS_OPTIONS: ["draft", "interest_collected", "pilot", "live"],
      AGENT_TYPE_OPTIONS: ["sales_agent", "faq_responder", "lead_qualifier"],
      findOne: () => createQuery(null),
      create: async (payload) => payload,
    },
    "../models/WhatsAppAutomation": { countDocuments: async () => 0 },
    "../models/WhatsAppBusinessProfile": { findOne: () => createQuery(null) },
    "../models/WhatsAppConversation": { findById: () => createQuery(null) },
    "../models/WhatsAppForm": { countDocuments: async () => 0 },
    "../models/WhatsAppQuickReply": { countDocuments: async () => 0, find: () => createQuery([]) },
    "./whatsappProductCollectionService": { listAvailableProductCollections: async () => [] },
    "./whatsappService": { sendMessage: async () => ({ payload: {}, response: { messages: [{ id: "wamid.test" }] } }) },
  });

  await assert.rejects(
    () => patchService.updateWhatsAppAiAgentInterestStatus({ id: "bad-id", status: "contacted" }),
    /valid id/i
  );

  const patchedStatus = await patchService.updateWhatsAppAiAgentInterestStatus({
    id: editableInterest._id,
    status: "contacted",
    actor: { _id: "admin_1", role: "SalesAdmin" },
  });
  assert.equal(patchedStatus.status, "contacted");
  assert.equal(String(patchedStatus._id), editableInterest._id);

  const previewService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiAgentService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/AdminUser": { findById: () => createQuery(null) },
    "../models/Lead": {
      findById: async () => null,
      findOne: async () => null,
      countDocuments: async () => 0,
      create: async (payload) => ({ _id: "lead_1", ...payload }),
    },
    "../models/WhatsAppAiAgentInterest": {
      INTEREST_STATUS_OPTIONS: ["new", "contacted", "qualified", "closed"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
      findById: async () => null,
    },
    "../models/WhatsAppAiAgentLog": {
      RESPONSE_SOURCE_OPTIONS: ["ai", "knowledge_base", "catalog", "qualification_flow", "handoff", "fallback"],
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiAgentSettings": {
      ROLLOUT_STATUS_OPTIONS: ["draft", "interest_collected", "pilot", "live"],
      AGENT_TYPE_OPTIONS: ["sales_agent", "faq_responder", "lead_qualifier"],
      findOne: () => createQuery({
        enabled: true,
        defaultAgentType: "sales_agent",
        salesAgent: { enabled: true, catalogEnabled: true, handoffEnabled: true, fallbackMessage: "" },
        faqResponder: { enabled: false, knowledgeBaseEnabled: true, handoffEnabled: true, fallbackMessage: "" },
        leadQualifier: { enabled: false, qualificationFields: [], crmSyncTarget: "", handoffEnabled: true, fallbackMessage: "" },
      }),
      create: async (payload) => payload,
    },
    "../models/WhatsAppAutomation": { countDocuments: async () => 0 },
    "../models/WhatsAppBusinessProfile": { findOne: () => createQuery(null) },
    "../models/WhatsAppConversation": { findById: () => createQuery(null) },
    "../models/WhatsAppForm": { countDocuments: async () => 0 },
    "../models/WhatsAppQuickReply": { countDocuments: async () => 0, find: () => createQuery([]) },
    "./whatsappProductCollectionService": {
      listAvailableProductCollections: async () => [
        {
          id: "collection_1",
          name: "Office Wear",
          description: "Formal and smart casual office outfits",
          category: "office_wear",
          itemCount: 1,
          items: [{ id: "kurta_1", title: "Blue Straight Cotton Kurta", description: "Ideal for office wear" }],
        },
      ],
    },
    "./whatsappService": { sendMessage: async () => ({ payload: {}, response: { messages: [{ id: "wamid.test" }] } }) },
  });

  const preview = await previewService.previewWhatsAppAiAgent({
    app: {},
    actor: { _id: "admin_1" },
    agentType: "sales_agent",
    message: "I need a kurta for office wear",
    send: false,
  });
  assert.equal(preview.agentType, "sales_agent");
  assert.ok(Object.prototype.hasOwnProperty.call(preview, "reply"));
  assert.ok(Object.prototype.hasOwnProperty.call(preview, "actionTaken"));
  assert.equal(typeof preview.handoffTriggered, "boolean");
  assert.equal(Array.isArray(preview.notes), true);
  assert.equal(Array.isArray(preview.matchedCatalogItemIds), true);
};

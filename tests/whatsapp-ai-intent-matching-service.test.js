const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const createQuery = (items) => ({
  select() {
    return this;
  },
  sort() {
    return this;
  },
  lean: async () => items,
  populate() {
    return this;
  },
  skip() {
    return this;
  },
  limit() {
    return this;
  },
});

const createTrackedQuery = ({ items, tracker }) => ({
  sort() {
    return this;
  },
  skip(value) {
    tracker.skip = value;
    return this;
  },
  limit(value) {
    tracker.limit = value;
    return this;
  },
  lean: async () => items,
});

const setCacheMock = (modulePath, exportsValue) => {
  const resolvedPath = require.resolve(modulePath);
  const previous = require.cache[resolvedPath];
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: exportsValue,
  };

  return () => {
    if (previous) {
      require.cache[resolvedPath] = previous;
      return;
    }

    delete require.cache[resolvedPath];
  };
};

const createCandidate = ({
  destinationType = "workflow",
  destinationId,
  destinationName,
  searchableText,
  execution = {},
  matchFields = {},
  keywordBuckets = undefined,
}) => ({
  destinationType,
  destinationId,
  destinationName,
  intentLabel: destinationName,
  searchableText,
  execution,
  ...(keywordBuckets ? { keywordBuckets } : {}),
  matchFields: {
    destinationName,
    intentLabel: destinationName,
    description: searchableText,
    searchableText,
    ...matchFields,
  },
});

module.exports = async () => {
  process.env.CLOUDINARY_NAME = process.env.CLOUDINARY_NAME || "test-cloud";
  process.env.CLOUDINARY_KEY = process.env.CLOUDINARY_KEY || "test-key";
  process.env.CLOUDINARY_SECRET = process.env.CLOUDINARY_SECRET || "test-secret";

  const logs = [];
  const walletCalls = [];

  const service = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiIntentMatchingService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/WhatsAppAiIntentMatchLog": {
      create: async (payload) => {
        logs.push(payload);
        return payload;
      },
      find: () => createQuery(logs),
      countDocuments: async () => logs.length,
    },
    "../models/WhatsAppAiIntentMatchingSettings": {
      MATCH_MODE_OPTIONS: ["balanced", "precise", "aggressive"],
      LOW_CONFIDENCE_ACTION_OPTIONS: ["no_match", "fallback_to_team"],
      findOne: () => ({
        populate() {
          return this;
        },
      }),
    },
    "../models/WhatsAppAutomation": {
      find: () => createQuery([
        {
          _id: "workflow_1",
          name: "Order Tracking Workflow",
          description: "where is my order order tracking support",
          enabled: true,
          triggerType: "keyword_match",
          triggerConfig: { keywords: ["order", "tracking"] },
          workflowGraph: {
            nodes: [{ nodeId: "trigger-node", label: "Order tracking" }],
          },
          actions: [{ type: "send_text", label: "Send order update" }],
        },
      ]),
      countDocuments: async () => 1,
    },
    "../models/WhatsAppAutomationJob": {
      countDocuments: async () => 4,
    },
    "../models/WhatsAppConversation": {
      findById: () => ({
        populate() {
          return this;
        },
        lean: async () => ({
          _id: "conversation_1",
          contactId: { _id: "contact_1", phone: "+94770000000", name: "Jane" },
        }),
      }),
    },
    "../models/WhatsAppForm": {
      find: () => createQuery([
        {
          _id: "form_1",
          name: "Visa Assessment Form",
          description: "Collect customer visa details",
          category: "Assessment",
          fields: [{ label: "Travel date" }, { label: "Destination" }],
          providerFlowId: "flow_1",
          providerFlowName: "",
          providerFlowMode: "published",
          providerFlowFirstScreenId: "screen_1",
        },
      ]),
      countDocuments: async () => 1,
      findById: () => ({
        select() {
          return this;
        },
        lean: async () => ({
          _id: "form_1",
          name: "Visa Assessment Form",
          description: "Collect customer visa details",
          isActive: true,
          providerFlowId: "flow_1",
          providerFlowName: "",
          providerFlowMode: "published",
          providerFlowFirstScreenId: "screen_1",
        }),
      }),
    },
    "../models/WhatsAppQuickReply": {
      find: () => createQuery([
        {
          _id: "quick_reply_1",
          title: "Order status",
          shortcut: "/order-status",
          category: "General",
          folder: "Support",
          content: "where is my order order tracking support",
        },
      ]),
      countDocuments: async () => 1,
    },
    "./whatsappBasicAutomationService": {
      getBasicAutomationSettings: async () => ({
        automations: {
          outOfOffice: { enabled: false },
          welcome: {
            enabled: true,
            message: "Welcome to Blue Whale",
            templateName: "",
            templateCategory: "",
            replyActionType: "none",
            formName: "",
            interactiveListName: "",
            productCollectionName: "",
          },
          delayedResponse: { enabled: false },
        },
      }),
    },
    "./whatsappWalletService": {
      getWalletSummary: async () => ({ currency: "INR", isActive: true }),
      reserveWalletAmount: async (payload) => {
        walletCalls.push({ type: "reserve", payload });
        return { reservationId: "reservation_1" };
      },
      commitWalletReservation: async (payload) => {
        walletCalls.push({ type: "commit", payload });
        return { reservationId: payload.reservationId };
      },
    },
  });

  const persistedOverviewService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiIntentMatchingService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/WhatsAppAiIntentMatchLog": {
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiIntentMatchingSettings": {
      MATCH_MODE_OPTIONS: ["balanced", "precise", "aggressive"],
      LOW_CONFIDENCE_ACTION_OPTIONS: ["no_match", "fallback_to_team"],
      findOne: () => ({
        populate() {
          return this;
        },
        then(resolve, reject) {
          return Promise.resolve({
            enabled: true,
            matchMode: "aggressive",
            billingEnabled: true,
            pricePerSuccessfulMatchMinor: 55,
            currency: "USD",
            lowConfidenceAction: "no_match",
            updatedAt: new Date("2026-04-09T10:00:00.000Z"),
            updatedBy: { _id: "admin_1", name: "Alex" },
          }).then(resolve, reject);
        },
      }),
    },
    "../models/WhatsAppAutomation": { countDocuments: async () => 3, find: () => createQuery([]) },
    "../models/WhatsAppAutomationJob": { countDocuments: async () => 5 },
    "../models/WhatsAppConversation": {},
    "../models/WhatsAppForm": { countDocuments: async () => 2, find: () => createQuery([]) },
    "../models/WhatsAppQuickReply": { countDocuments: async () => 4, find: () => createQuery([]) },
    "./whatsappBasicAutomationService": {
      getBasicAutomationSettings: async () => ({
        automations: {
          outOfOffice: { enabled: true },
          welcome: { enabled: false },
          delayedResponse: { enabled: true },
        },
      }),
    },
    "./whatsappWalletService": {
      getWalletSummary: async () => ({ currency: "INR", isActive: true }),
      reserveWalletAmount: async () => ({ reservationId: "reservation_1" }),
      commitWalletReservation: async () => ({ reservationId: "reservation_1" }),
    },
  });

  const persistedOverview = await persistedOverviewService.getAiIntentMatchingOverview();
  assert.equal(persistedOverview.enabled, true);
  assert.equal(persistedOverview.matchMode, "aggressive");
  assert.equal(persistedOverview.billingEnabled, true);
  assert.equal(persistedOverview.pricePerSuccessfulMatchMinor, 55);
  assert.equal(persistedOverview.currency, "USD");
  assert.equal(persistedOverview.lowConfidenceAction, "no_match");
  assert.equal(persistedOverview.stats.quickReplies, 4);
  assert.equal(persistedOverview.stats.forms, 2);
  assert.equal(persistedOverview.stats.basicAutomations, 2);
  assert.equal(persistedOverview.stats.workflows, 3);
  assert.equal(persistedOverview.stats.recentWorkflowRuns, 5);
  assert.equal(persistedOverview.updatedBy.name, "Alex");

  assert.throws(
    () => persistedOverviewService.__private.normalizeSettingsPayload({ matchMode: "invalid" }),
    /matchMode must be one of/i
  );
  assert.throws(
    () => persistedOverviewService.__private.normalizeSettingsPayload({ billingEnabled: "maybe" }),
    /billingEnabled must be boolean/i
  );
  assert.throws(
    () => persistedOverviewService.__private.normalizeSettingsPayload({ pricePerSuccessfulMatchMinor: -1 }),
    /pricePerSuccessfulMatchMinor must be greater than or equal to 0/i
  );
  assert.throws(
    () => persistedOverviewService.__private.normalizeSettingsPayload({ currency: "x" }),
    /currency must be a valid code/i
  );
  assert.throws(
    () => persistedOverviewService.__private.normalizeSettingsPayload({ lowConfidenceAction: "invalid" }),
    /lowConfidenceAction must be one of/i
  );

  const candidateCatalog = await service.buildAiIntentCandidateCatalog();
  assert.equal(candidateCatalog.length, 4);
  assert.deepEqual(
    candidateCatalog.map((candidate) => candidate.destinationType),
    ["quick_reply", "basic_automation", "form", "workflow"]
  );
  assert.equal(Array.isArray(candidateCatalog[0].keywordBuckets.primaryKeywords), true);
  assert.equal(Array.isArray(candidateCatalog[0].keywordBuckets.secondaryKeywords), true);
  assert.equal(Array.isArray(candidateCatalog[0].keywordBuckets.phrases), true);

  const balancedVsPrecise = await service.resolveAiIntentMatch("order status", {}, {
    settings: { matchMode: "balanced" },
    matchMode: "balanced",
    candidateCatalog: [
      createCandidate({
        destinationId: "workflow_balanced",
        destinationName: "Order Status Help",
        searchableText: "order status help workflow tracking",
        matchFields: {
          aliases: ["order status", "track order"],
          phrases: ["order status"],
          keywords: ["order", "status", "tracking"],
        },
        execution: { automationId: "workflow_balanced" },
      }),
    ],
  });
  assert.equal(balancedVsPrecise.status, "matched");
  assert.equal(typeof balancedVsPrecise.topMatch.reason, "string");

  const preciseResult = await service.resolveAiIntentMatch("order status", {}, {
    settings: { matchMode: "precise" },
    matchMode: "precise",
    candidateCatalog: [
      createCandidate({
        destinationId: "workflow_precise",
        destinationName: "Order Tracking Updates",
        searchableText: "track order updates workflow progress",
        matchFields: {
          aliases: ["track order", "order update"],
          phrases: ["track order"],
          keywords: ["order", "tracking", "update"],
        },
        execution: { automationId: "workflow_precise" },
      }),
    ],
  });
  assert.equal(preciseResult.status, "no_match");

  const aggressiveResult = await service.resolveAiIntentMatch("where is my order", {}, {
    settings: { matchMode: "aggressive" },
    matchMode: "aggressive",
    candidateCatalog: [
      createCandidate({
        destinationId: "workflow_aggressive",
        destinationName: "My Order Status Workflow",
        searchableText: "my order status tracking workflow where is my order",
        matchFields: {
          aliases: ["where is my order", "track my order"],
          phrases: ["where is my order", "order status"],
          keywords: ["order", "status", "tracking"],
        },
        execution: { automationId: "workflow_aggressive" },
      }),
    ],
  });
  assert.equal(aggressiveResult.status, "matched");

  const consultationResult = await service.resolveAiIntentMatch("I want to book a consultation", {}, {
    settings: { matchMode: "balanced", lowConfidenceAction: "fallback_to_team" },
    matchMode: "balanced",
    candidateCatalog: [
      createCandidate({
        destinationType: "quick_reply",
        destinationId: "consultation_1",
        destinationName: "Consultation Booking",
        searchableText: "consultation booking appointment book a call schedule consultation",
        matchFields: {
          aliases: ["book consultation", "consultation booking", "appointment"],
          phrases: ["book consultation", "schedule consultation"],
          keywords: ["consultation", "booking", "appointment"],
          messageBody: "Use this to book a consultation with our team.",
        },
      }),
      createCandidate({
        destinationType: "quick_reply",
        destinationId: "generic_1",
        destinationName: "General Support",
        searchableText: "support assistance help",
      }),
    ],
  });
  assert.equal(consultationResult.status, "matched");
  assert.equal(consultationResult.topMatch.destinationId, "consultation_1");

  const documentsResult = await service.resolveAiIntentMatch("Can you send me the required documents?", {}, {
    settings: { matchMode: "balanced", lowConfidenceAction: "fallback_to_team" },
    matchMode: "balanced",
    candidateCatalog: [
      createCandidate({
        destinationType: "quick_reply",
        destinationId: "documents_1",
        destinationName: "Documents Request",
        searchableText: "documents request required documents checklist paperwork document list",
        matchFields: {
          aliases: ["required documents", "document list", "checklist"],
          phrases: ["required documents", "document checklist"],
          keywords: ["documents", "checklist", "paperwork"],
          messageBody: "Here is the required documents checklist.",
        },
      }),
    ],
  });
  assert.equal(documentsResult.status, "matched");
  assert.equal(documentsResult.topMatch.destinationId, "documents_1");

  const visaResult = await service.resolveAiIntentMatch("I need visa information", {}, {
    settings: { matchMode: "balanced", lowConfidenceAction: "fallback_to_team" },
    matchMode: "balanced",
    candidateCatalog: [
      createCandidate({
        destinationType: "form",
        destinationId: "visa_1",
        destinationName: "Visa Information",
        searchableText: "visa information visa processing migration requirements student visa",
        matchFields: {
          aliases: ["visa info", "visa requirements"],
          phrases: ["visa information", "visa processing"],
          keywords: ["visa", "processing", "migration"],
          description: "Get information about visa processing and requirements.",
        },
      }),
    ],
  });
  assert.equal(visaResult.status, "matched");
  assert.equal(visaResult.topMatch.destinationId, "visa_1");

  const followUpResult = await service.resolveAiIntentMatch("Please follow up on my application", {}, {
    settings: { matchMode: "balanced", lowConfidenceAction: "fallback_to_team" },
    matchMode: "balanced",
    candidateCatalog: [
      createCandidate({
        destinationType: "workflow",
        destinationId: "followup_1",
        destinationName: "Application Follow Up",
        searchableText: "application follow up status update check progress",
        matchFields: {
          aliases: ["follow up", "application status"],
          phrases: ["follow up on application", "check progress"],
          keywords: ["follow up", "status", "progress"],
          description: "Workflow for application status updates and follow up.",
        },
      }),
    ],
  });
  assert.equal(followUpResult.status, "matched");
  assert.equal(followUpResult.topMatch.destinationId, "followup_1");

  const lowConfidenceResult = await service.resolveAiIntentMatch("refund request", {}, {
    settings: { matchMode: "balanced" },
    matchMode: "balanced",
    candidateCatalog: [
      createCandidate({
        destinationId: "workflow_low",
        destinationName: "Order Tracking Workflow",
        searchableText: "order tracking workflow support",
        execution: { automationId: "workflow_low" },
      }),
    ],
  });
  assert.equal(lowConfidenceResult.status, "no_match");

  const safetyMarginResult = await service.resolveAiIntentMatch("where is my order", {}, {
    settings: { matchMode: "balanced" },
    matchMode: "balanced",
    candidateCatalog: [
      createCandidate({
        destinationId: "workflow_one",
        destinationName: "Where Is My Order Support",
        searchableText: "where is my order support",
        execution: { automationId: "workflow_one" },
      }),
      createCandidate({
        destinationId: "workflow_two",
        destinationName: "Where Is My Order Team",
        searchableText: "where is my order team",
        execution: { automationId: "workflow_two" },
      }),
    ],
  });
  assert.equal(safetyMarginResult.status, "no_match");
  assert.match(safetyMarginResult.notes.join(" | "), /safety margin/i);

  const exactPhraseOutranksGeneric = await service.resolveAiIntentMatch("I want to book a consultation", {}, {
    settings: { matchMode: "balanced", lowConfidenceAction: "fallback_to_team" },
    matchMode: "balanced",
    candidateCatalog: [
      createCandidate({
        destinationId: "generic_consult",
        destinationName: "Consultation",
        searchableText: "consultation help support general consultation",
      }),
      createCandidate({
        destinationId: "exact_booking",
        destinationName: "Consultation Booking",
        searchableText: "book consultation consultation booking appointment schedule",
        matchFields: {
          aliases: ["book consultation", "consultation booking"],
          phrases: ["book consultation"],
          keywords: ["consultation", "booking", "appointment"],
        },
      }),
    ],
  });
  assert.equal(exactPhraseOutranksGeneric.status, "matched");
  assert.equal(exactPhraseOutranksGeneric.topMatch.destinationId, "exact_booking");

  const sendCalls = [];
  const saveCalls = [];
  const basicAutomationCalls = [];
  const workflowCalls = [];

  const restoreWhatsAppService = setCacheMock(
    path.resolve(__dirname, "../services/whatsappService.js"),
    {
      sendMessage: async (payload) => {
        sendCalls.push(payload);
        return {
          payload: { type: payload.type },
          response: { messages: [{ id: `wamid.${payload.type}` }] },
        };
      },
    }
  );
  const restoreCRMService = setCacheMock(
    path.resolve(__dirname, "../services/whatsappCRMService.js"),
    {
      saveOutgoingMessage: async (payload) => {
        saveCalls.push(payload);
        return { _id: `saved_${payload.messageType}`, ...payload };
      },
      dispatchAutomationMessage: async () => ({ _id: "saved_basic" }),
      ensureConversation: async () => ({ _id: "conversation_1", agentId: null }),
      upsertContact: async () => ({ _id: "contact_1", phone: "+94770000000" }),
    }
  );
  const restoreBasicRuntime = setCacheMock(
    path.resolve(__dirname, "../services/whatsappBasicAutomationRuntimeService.js"),
    {
      triggerBasicAutomation: async (payload) => {
        basicAutomationCalls.push(payload);
        return { status: "sent", savedMessage: { _id: "basic_message" } };
      },
    }
  );
  const restoreAutomationService = setCacheMock(
    path.resolve(__dirname, "../services/whatsappAutomationService.js"),
    {
      triggerAutomationById: async (payload) => {
        workflowCalls.push(payload);
        return {
          automation: { name: "Order Tracking Workflow" },
          results: [{ actionType: "send_text", summary: "Triggered workflow" }],
        };
      },
    }
  );

  const baseContext = {
    app: {},
    conversation: { _id: "conversation_1", agentId: null },
    contact: { _id: "contact_1", phone: "+94770000000" },
    inboundMessage: { _id: "message_1", externalMessageId: "wamid.inbound.1", content: "where is my order" },
  };

  const quickReplyExecution = await service.executeResolvedAiIntentMatch({
    ...baseContext,
    match: {
      destinationType: "quick_reply",
      destinationId: "quick_reply_1",
      intentLabel: "Order status",
      confidence: 0.91,
      execution: { content: "Your order is on the way." },
    },
  });
  assert.equal(quickReplyExecution.actionStatus, "sent");
  assert.equal(sendCalls[0].type, "text");
  assert.equal(saveCalls[0].messageType, "text");

  const formExecution = await service.executeResolvedAiIntentMatch({
    ...baseContext,
    match: {
      destinationType: "form",
      destinationId: "form_1",
      intentLabel: "Visa Assessment Form",
      confidence: 0.9,
      execution: { formId: "507f1f77bcf86cd799439011" },
    },
  });
  assert.equal(formExecution.actionStatus, "sent");
  assert.equal(sendCalls[1].type, "interactive");
  assert.equal(saveCalls[1].messageType, "interactive");

  const basicExecution = await service.executeResolvedAiIntentMatch({
    ...baseContext,
    match: {
      destinationType: "basic_automation",
      destinationId: "welcome",
      intentLabel: "Welcome",
      confidence: 0.88,
      execution: { automationKey: "welcome" },
    },
  });
  assert.equal(basicExecution.actionStatus, "sent");
  assert.equal(basicAutomationCalls.length, 1);

  const workflowExecution = await service.executeResolvedAiIntentMatch({
    ...baseContext,
    match: {
      destinationType: "workflow",
      destinationId: "workflow_1",
      intentLabel: "Order Tracking Workflow",
      confidence: 0.89,
      execution: { automationId: "workflow_1" },
    },
  });
  assert.equal(workflowExecution.actionStatus, "triggered");
  assert.equal(workflowCalls.length, 1);

  const billingSuccess = await service.__private.maybeChargeForMatchedIntent({
    settings: { billingEnabled: true, pricePerSuccessfulMatchMinor: 20, currency: "INR" },
    actorId: "admin_1",
    logNotes: [],
    metadata: { source: "test" },
  });
  assert.equal(billingSuccess.charged, true);
  assert.equal(walletCalls.length, 2);

  restoreAutomationService();
  restoreBasicRuntime();
  restoreCRMService();
  restoreWhatsAppService();

  const failingWalletCalls = [];
  const failingService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiIntentMatchingService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/WhatsAppAiIntentMatchLog": {
      create: async (payload) => payload,
      find: () => createQuery([]),
      countDocuments: async () => 0,
    },
    "../models/WhatsAppAiIntentMatchingSettings": {
      MATCH_MODE_OPTIONS: ["balanced", "precise", "aggressive"],
      LOW_CONFIDENCE_ACTION_OPTIONS: ["no_match", "fallback_to_team"],
      findOne: () => ({
        populate() {
          return this;
        },
      }),
    },
    "../models/WhatsAppAutomation": { find: () => createQuery([]), countDocuments: async () => 0 },
    "../models/WhatsAppAutomationJob": { countDocuments: async () => 0 },
    "../models/WhatsAppConversation": { findById: () => ({ populate() { return this; }, lean: async () => null }) },
    "../models/WhatsAppForm": { find: () => createQuery([]), countDocuments: async () => 0 },
    "../models/WhatsAppQuickReply": { find: () => createQuery([]), countDocuments: async () => 0 },
    "./whatsappBasicAutomationService": {
      getBasicAutomationSettings: async () => ({ automations: { outOfOffice: { enabled: false }, welcome: { enabled: false }, delayedResponse: { enabled: false } } }),
    },
    "./whatsappWalletService": {
      getWalletSummary: async () => ({ currency: "INR", isActive: true }),
      reserveWalletAmount: async () => {
        failingWalletCalls.push("reserve");
        throw new Error("Wallet inactive");
      },
      commitWalletReservation: async () => {
        failingWalletCalls.push("commit");
      },
    },
  });

  const failingCharge = await failingService.__private.maybeChargeForMatchedIntent({
    settings: { billingEnabled: true, pricePerSuccessfulMatchMinor: 20, currency: "INR" },
    actorId: "admin_2",
    logNotes: [],
    metadata: { source: "test-fail" },
  });
  assert.equal(failingCharge.charged, false);
  assert.deepEqual(failingWalletCalls, ["reserve"]);
  assert.match(failingCharge.notes.join(" | "), /billing skipped/i);

  let capturedFindFilter = null;
  let capturedCountFilter = null;
  const paginationTracker = {};
  const historyFilterService = loadWithMocks(path.resolve(__dirname, "../services/whatsappAiIntentMatchingService.js"), {
    "../models/ActivityLog": { create: async () => ({}) },
    "../models/WhatsAppAiIntentMatchLog": {
      create: async (payload) => payload,
      find: (filter) => {
        capturedFindFilter = filter;
        return createTrackedQuery({
          tracker: paginationTracker,
          items: [
            {
              _id: "log_1",
              status: "matched",
              conversationId: "507f1f77bcf86cd799439011",
              messageId: "wamid.123",
              customerPhone: "+94770000000",
              inboundText: "where is my order",
              matchedIntentLabel: "Order tracking",
              matchedDestinationType: "workflow",
              matchedDestinationId: "workflow_1",
              confidence: 0.88,
              matchMode: "balanced",
              charged: false,
              chargedAmountMinor: 0,
              createdAt: new Date("2026-04-09T10:00:00.000Z"),
            },
          ],
        });
      },
      countDocuments: async (filter) => {
        capturedCountFilter = filter;
        return 1;
      },
    },
    "../models/WhatsAppAiIntentMatchingSettings": {
      MATCH_MODE_OPTIONS: ["balanced", "precise", "aggressive"],
      LOW_CONFIDENCE_ACTION_OPTIONS: ["no_match", "fallback_to_team"],
      findOne: () => ({
        populate() {
          return this;
        },
      }),
    },
    "../models/WhatsAppAutomation": { countDocuments: async () => 0, find: () => createQuery([]) },
    "../models/WhatsAppAutomationJob": { countDocuments: async () => 0 },
    "../models/WhatsAppConversation": {},
    "../models/WhatsAppForm": { countDocuments: async () => 0, find: () => createQuery([]) },
    "../models/WhatsAppQuickReply": { countDocuments: async () => 0, find: () => createQuery([]) },
    "./whatsappBasicAutomationService": {
      getBasicAutomationSettings: async () => ({
        automations: { outOfOffice: { enabled: false }, welcome: { enabled: false }, delayedResponse: { enabled: false } },
      }),
    },
    "./whatsappWalletService": {
      getWalletSummary: async () => ({ currency: "INR", isActive: true }),
      reserveWalletAmount: async () => ({ reservationId: "reservation_1" }),
      commitWalletReservation: async () => ({ reservationId: "reservation_1" }),
    },
  });

  const filteredHistory = await historyFilterService.listAiIntentMatchHistory({
    page: 2,
    limit: 8,
    status: "matched",
    matchMode: "balanced",
    search: "order",
  });
  assert.equal(filteredHistory.items.length, 1);
  assert.equal(capturedFindFilter.status, "matched");
  assert.equal(capturedFindFilter.matchMode, "balanced");
  assert.equal(Array.isArray(capturedFindFilter.$or), true);
  assert.equal(capturedCountFilter.status, "matched");
  assert.equal(paginationTracker.skip, 8);
  assert.equal(paginationTracker.limit, 8);

  const searchByObjectIdFilter = historyFilterService.__private.buildHistoryFilter({
    search: "507f1f77bcf86cd799439011",
  });
  assert.equal(searchByObjectIdFilter.$or.some((entry) => entry.conversationId === "507f1f77bcf86cd799439011"), true);

  assert.throws(
    () => historyFilterService.__private.buildHistoryFilter({ status: "invalid" }),
    /status must be one of/i
  );
  assert.throws(
    () => historyFilterService.__private.buildHistoryFilter({ matchMode: "wrong" }),
    /matchMode must be one of/i
  );

  const previewShape = await service.previewAiIntentMatch({
    app: {},
    actor: null,
    message: "I want to book a consultation",
    send: false,
  });
  assert.equal(
    previewShape.topMatch === null || typeof previewShape.topMatch.reason === "string",
    true
  );
  assert.equal(Array.isArray(previewShape.candidates), true);
  if (previewShape.debug) {
    assert.equal(typeof previewShape.debug.threshold, "number");
    assert.equal(typeof previewShape.debug.topScore, "number");
    assert.equal(typeof previewShape.debug.margin, "number");
  }
};

const assert = require("node:assert/strict");
const path = require("path");

const automationService = require("../services/whatsappBasicAutomationService");
const { validateProductCollectionSnapshot } = require("../services/whatsappProductCollectionService");
const { loadWithMocks } = require("./helpers/loadWithMocks");

module.exports = async () => {
  const validPayload = automationService.__private.normalizeOutOfOfficePayload(
    {
      replyActionType: "product_collection",
      actionButtonText: "View options",
      productCollectionId: "680f1c2c9d8e3b0012349999",
      productCollectionName: "Consultations & Assessments",
      productCollectionDescription: "Guide new leads into consultation, eligibility, and first-step assessment offers.",
      productCollectionCategory: "Lead Intake",
      productCollectionItems: [
        {
          id: "book_consultation",
          title: "Book Consultation",
          description: "Schedule a one-to-one migration consultation.",
        },
      ],
      productCollectionItemCount: 1,
    },
    { partial: true, current: {} }
  );

  assert.equal(validPayload.replyActionType, "product_collection");
  assert.equal(validPayload.productCollectionId, "680f1c2c9d8e3b0012349999");
  assert.equal(validPayload.productCollectionName, "Consultations & Assessments");
  assert.equal(validPayload.productCollectionCategory, "Lead Intake");
  assert.equal(validPayload.productCollectionItems.length, 1);
  assert.equal(validPayload.productCollectionItemCount, 1);

  assert.throws(
    () =>
      automationService.__private.normalizeOutOfOfficePayload(
        {
          replyActionType: "product_collection",
          actionButtonText: "View options",
          productCollectionId: "680f1c2c9d8e3b0012349999",
          productCollectionItems: [
            { id: "duplicate_item", title: "Option A" },
            { id: "duplicate_item", title: "Option B" },
          ],
        },
        { partial: true, current: {} }
      ),
    /Duplicate id: duplicate_item/
  );

  const legacySettingsDoc = {
    automations: {
      outOfOffice: {
        replyActionType: "product_collection",
        actionButtonText: "View options",
        productCollectionId: "680f1c2c9d8e3b0012349999",
        productCollectionName: "Consultations & Assessments",
      },
    },
    workingHours: {},
  };

  const settingsService = loadWithMocks(path.resolve(__dirname, "../services/whatsappBasicAutomationService.js"), {
    "../models/WhatsAppBasicAutomationSettings": {
      DAY_OPTIONS: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      TEMPLATE_MODE_OPTIONS: ["custom", "approved_template"],
      APPLY_SCOPE_OPTIONS: ["new_or_closed", "new_only", "all"],
      COOLDOWN_UNIT_OPTIONS: ["minutes", "hours"],
      REPLY_ACTION_TYPE_OPTIONS: ["none", "whatsapp_form", "interactive_list", "product_collection"],
      FORM_OPEN_MODE_OPTIONS: ["navigate_first_screen", "data_exchange"],
      findOne: () => ({
        populate() {
          return this;
        },
        lean: async () => legacySettingsDoc,
      }),
    },
    "../models/WhatsAppMessage": {},
    "../models/WhatsAppTemplate": {},
    "../models/WhatsAppForm": {},
    "./whatsappFormService": {
      listAvailableWhatsAppForms: async () => [],
    },
    "./whatsappTemplateService": {
      getTemplateById: async () => null,
    },
    "./whatsappInteractiveListService": {
      normalizeInteractiveListSections: (sections) => sections,
      countInteractiveListRows: (sections) => sections.reduce((total, section) => total + (section.rows || []).length, 0),
      buildInteractiveListResourceFromConfig: () => ({
        id: "",
        name: "",
        description: "",
        buttonText: "",
        sections: [],
        sectionCount: 0,
        rowCount: 0,
      }),
      listAvailableInteractiveLists: async () => [],
      getInteractiveListById: async () => null,
      validateInteractiveListSnapshot: () => ({ valid: true, reason: "", sections: [], sectionCount: 0, rowCount: 0 }),
    },
    "./whatsappProductCollectionService": {
      normalizeProductCollectionItems: (items) => items,
      countProductCollectionItems: (items) => items.length,
      buildProductCollectionResourceFromConfig: () => ({
        id: "",
        name: "",
        description: "",
        buttonText: "",
        category: "",
        items: [],
        itemCount: 0,
      }),
      listAvailableProductCollections: async () => [],
      getProductCollectionById: async () => null,
      validateProductCollectionSnapshot,
      MAX_BUTTON_TEXT_LENGTH: 20,
      isProductCollectionProviderConfigured: () => false,
    },
  });

  const normalizedSettings = await settingsService.getBasicAutomationSettings();
  assert.equal(normalizedSettings.automations.outOfOffice.productCollectionDescription, "");
  assert.equal(normalizedSettings.automations.outOfOffice.productCollectionCategory, "");
  assert.deepEqual(normalizedSettings.automations.outOfOffice.productCollectionItems, []);
  assert.equal(normalizedSettings.automations.outOfOffice.productCollectionItemCount, 0);

  const previewFallbackService = loadWithMocks(path.resolve(__dirname, "../services/whatsappBasicAutomationService.js"), {
    "../models/WhatsAppBasicAutomationSettings": {
      DAY_OPTIONS: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      TEMPLATE_MODE_OPTIONS: ["custom", "approved_template"],
      APPLY_SCOPE_OPTIONS: ["new_or_closed", "new_only", "all"],
      COOLDOWN_UNIT_OPTIONS: ["minutes", "hours"],
      REPLY_ACTION_TYPE_OPTIONS: ["none", "whatsapp_form", "interactive_list", "product_collection"],
      FORM_OPEN_MODE_OPTIONS: ["navigate_first_screen", "data_exchange"],
      findOne: () => ({
        populate() {
          return this;
        },
        lean: async () => ({ automations: {}, workingHours: {} }),
      }),
    },
    "../models/WhatsAppMessage": {},
    "../models/WhatsAppTemplate": {},
    "../models/WhatsAppForm": {},
    "./whatsappFormService": {
      listAvailableWhatsAppForms: async () => [],
    },
    "./whatsappTemplateService": {
      getTemplateById: async () => null,
    },
    "./whatsappInteractiveListService": {
      normalizeInteractiveListSections: (sections) => sections,
      countInteractiveListRows: (sections) => sections.reduce((total, section) => total + (section.rows || []).length, 0),
      buildInteractiveListResourceFromConfig: () => ({
        id: "",
        name: "",
        description: "",
        buttonText: "",
        sections: [],
        sectionCount: 0,
        rowCount: 0,
      }),
      listAvailableInteractiveLists: async () => [],
      getInteractiveListById: async () => null,
      validateInteractiveListSnapshot: () => ({ valid: true, reason: "", sections: [], sectionCount: 0, rowCount: 0 }),
    },
    "./whatsappProductCollectionService": {
      normalizeProductCollectionItems: (items) => items,
      countProductCollectionItems: (items) => items.length,
      buildProductCollectionResourceFromConfig: () => ({
        id: "",
        name: "",
        description: "",
        buttonText: "",
        category: "",
        items: [],
        itemCount: 0,
      }),
      listAvailableProductCollections: async () => [],
      getProductCollectionById: async () => ({
        id: "680f1c2c9d8e3b0012349999",
        name: "Consultations & Assessments",
        description: "Guide new leads into consultation, eligibility, and first-step assessment offers.",
        buttonText: "View options",
        category: "Lead Intake",
        isActive: true,
        items: [
          {
            id: "book_consultation",
            title: "Book Consultation",
            description: "Schedule a one-to-one migration consultation.",
          },
        ],
        itemCount: 1,
      }),
      validateProductCollectionSnapshot,
      MAX_BUTTON_TEXT_LENGTH: 20,
      isProductCollectionProviderConfigured: () => false,
    },
  });

  const previewFallback = await previewFallbackService.previewBasicAutomation({
    type: "outOfOffice",
    phoneNumber: "+94770000000",
    settingsOverride: {
      message: "Please choose an option below.",
      replyActionType: "product_collection",
      actionButtonText: "View options",
      productCollectionId: "680f1c2c9d8e3b0012349999",
      productCollectionName: "Consultations & Assessments",
    },
  });

  assert.equal(previewFallback.replyAction.type, "product_collection");
  assert.equal(previewFallback.replyAction.label, "Product collection");
  assert.equal(previewFallback.replyAction.mode, "catalog_preset");
  assert.equal(previewFallback.replyAction.buttonText, "View options");
  assert.equal(previewFallback.replyAction.productCollectionName, "Consultations & Assessments");
  assert.equal(previewFallback.replyAction.itemCount, 1);
  assert.equal(previewFallback.replyActionDelivered, false);
  assert.equal(previewFallback.replyActionFallbackExpected, true);
  assert.match(previewFallback.runtimeNotes.join(" | "), /provider catalog delivery is not yet configured/);

  const runtimeSuccessCalls = [];
  const runtimeSuccessService = loadWithMocks(path.resolve(__dirname, "../services/whatsappBasicAutomationRuntimeService.js"), {
    "../models/RecruitmentChannel": { findById: () => ({ select: () => ({ lean: async () => null }) }) },
    "../models/WhatsAppForm": { findById: () => ({ select: () => ({ lean: async () => null }) }) },
    "../models/WhatsAppBasicAutomationSettings": { findOneAndUpdate: async () => ({ automations: { outOfOffice: { sentCount: 1 } } }) },
    "../models/WhatsAppConversation": {},
    "../models/WhatsAppContact": {},
    "../models/WhatsAppMessage": { updateOne: async () => ({}) },
    "./whatsappInteractiveListService": {
      getInteractiveListById: async () => null,
      buildInteractiveListResourceFromConfig: () => null,
      validateInteractiveListSnapshot: () => ({ valid: true, reason: "", sections: [], sectionCount: 0, rowCount: 0 }),
    },
    "./whatsappProductCollectionService": {
      getProductCollectionById: async () => ({
        id: "680f1c2c9d8e3b0012349999",
        name: "Consultations & Assessments",
        description: "Guide new leads into consultation, eligibility, and first-step assessment offers.",
        buttonText: "View options",
        category: "Lead Intake",
        isActive: true,
        items: [
          {
            id: "book_consultation",
            title: "Book Consultation",
            description: "Schedule a one-to-one migration consultation.",
          },
        ],
        itemCount: 1,
      }),
      buildProductCollectionResourceFromConfig: (config) => ({
        id: config.productCollectionId,
        name: config.productCollectionName,
        description: config.productCollectionDescription || "",
        buttonText: config.actionButtonText,
        category: config.productCollectionCategory || "",
        isActive: true,
        items: config.productCollectionItems || [],
        itemCount: config.productCollectionItemCount || 0,
      }),
      validateProductCollectionSnapshot,
      isProductCollectionProviderConfigured: () => true,
      getProductCollectionProviderConfig: () => ({ catalogId: "catalog-123" }),
      MAX_BUTTON_TEXT_LENGTH: 20,
      MAX_PRODUCT_ITEMS: 30,
    },
    "./whatsappTemplateService": {
      prepareTemplateMessage: async () => ({}),
      getTemplateById: async () => null,
    },
    "./whatsappService": {
      normalizePhone: (value) => value,
      sendMessage: async (payload) => {
        runtimeSuccessCalls.push(payload);
        return { response: { messages: [{ id: "wamid.product.success" }] } };
      },
    },
    "./whatsappBasicAutomationService": {
      getBasicAutomationSettings: async () => ({}),
      resolveBasicAutomationConfig: async () => ({
        type: "outOfOffice",
        config: {
          message: "Please choose an option below.",
          templateMode: "custom",
          replyActionType: "product_collection",
          actionButtonText: "View options",
          productCollectionId: "680f1c2c9d8e3b0012349999",
          productCollectionName: "Consultations & Assessments",
        },
      }),
    },
  });

  const successResult = await runtimeSuccessService.sendBasicAutomationTestMessage({
    type: "outOfOffice",
    phoneNumber: "+94770000000",
  });

  assert.equal(successResult.sent, true);
  assert.equal(successResult.modeUsed, "interactive");
  assert.equal(successResult.fallbackUsed, false);
  assert.equal(successResult.replyActionUsed, "product_collection");
  assert.equal(successResult.replyActionDelivered, true);
  assert.equal(successResult.replyActionFallbackUsed, false);
  assert.equal(successResult.messageId, "wamid.product.success");
  assert.equal(runtimeSuccessCalls.length, 1);
  assert.equal(runtimeSuccessCalls[0].interactive.type, "product_list");
  assert.equal(runtimeSuccessCalls[0].interactive.action.catalog_id, "catalog-123");

  const runtimeFallbackService = loadWithMocks(path.resolve(__dirname, "../services/whatsappBasicAutomationRuntimeService.js"), {
    "../models/RecruitmentChannel": { findById: () => ({ select: () => ({ lean: async () => null }) }) },
    "../models/WhatsAppForm": { findById: () => ({ select: () => ({ lean: async () => null }) }) },
    "../models/WhatsAppBasicAutomationSettings": { findOneAndUpdate: async () => ({ automations: { outOfOffice: { sentCount: 1 } } }) },
    "../models/WhatsAppConversation": {},
    "../models/WhatsAppContact": {},
    "../models/WhatsAppMessage": { updateOne: async () => ({}) },
    "./whatsappInteractiveListService": {
      getInteractiveListById: async () => null,
      buildInteractiveListResourceFromConfig: () => null,
      validateInteractiveListSnapshot: () => ({ valid: true, reason: "", sections: [], sectionCount: 0, rowCount: 0 }),
    },
    "./whatsappProductCollectionService": {
      getProductCollectionById: async () => ({
        id: "680f1c2c9d8e3b0012349999",
        name: "Consultations & Assessments",
        description: "Guide new leads into consultation, eligibility, and first-step assessment offers.",
        buttonText: "View options",
        category: "Lead Intake",
        isActive: true,
        items: [
          {
            id: "book_consultation",
            title: "Book Consultation",
            description: "Schedule a one-to-one migration consultation.",
          },
        ],
        itemCount: 1,
      }),
      buildProductCollectionResourceFromConfig: (config) => ({
        id: config.productCollectionId,
        name: config.productCollectionName,
        description: config.productCollectionDescription || "",
        buttonText: config.actionButtonText,
        category: config.productCollectionCategory || "",
        isActive: true,
        items: config.productCollectionItems || [],
        itemCount: config.productCollectionItemCount || 0,
      }),
      validateProductCollectionSnapshot,
      isProductCollectionProviderConfigured: () => false,
      getProductCollectionProviderConfig: () => ({ catalogId: "" }),
      MAX_BUTTON_TEXT_LENGTH: 20,
      MAX_PRODUCT_ITEMS: 30,
    },
    "./whatsappTemplateService": {
      prepareTemplateMessage: async () => ({}),
      getTemplateById: async () => null,
    },
    "./whatsappService": {
      normalizePhone: (value) => value,
      sendMessage: async (payload) => ({
        response: {
          messages: [{ id: payload.type === "text" ? "wamid.product.fallback" : "wamid.product.interactive" }],
        },
      }),
    },
    "./whatsappBasicAutomationService": {
      getBasicAutomationSettings: async () => ({}),
      resolveBasicAutomationConfig: async () => ({
        type: "outOfOffice",
        config: {
          message: "Please choose an option below.",
          templateMode: "custom",
          replyActionType: "product_collection",
          actionButtonText: "View options",
          productCollectionId: "680f1c2c9d8e3b0012349999",
          productCollectionName: "Consultations & Assessments",
        },
      }),
    },
  });

  const fallbackResult = await runtimeFallbackService.sendBasicAutomationTestMessage({
    type: "outOfOffice",
    phoneNumber: "+94770000000",
  });

  assert.equal(fallbackResult.sent, true);
  assert.equal(fallbackResult.modeUsed, "text");
  assert.equal(fallbackResult.fallbackUsed, true);
  assert.equal(fallbackResult.replyActionUsed, "product_collection");
  assert.equal(fallbackResult.replyActionDelivered, false);
  assert.equal(fallbackResult.replyActionFallbackUsed, true);
  assert.equal(fallbackResult.messageId, "wamid.product.fallback");
  assert.match(fallbackResult.notes.join(" | "), /provider catalog delivery is not yet configured/);
};

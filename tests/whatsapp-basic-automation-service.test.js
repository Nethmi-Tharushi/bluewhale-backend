const assert = require("node:assert/strict");
const path = require("path");

const automationService = require("../services/whatsappBasicAutomationService");
const { validateInteractiveListSnapshot } = require("../services/whatsappInteractiveListService");
const { loadWithMocks } = require("./helpers/loadWithMocks");

module.exports = async () => {
  const payload = automationService.__private.normalizeOutOfOfficePayload(
    {
      replyActionType: "interactive_list",
      actionButtonText: "Select option",
      interactiveListId: "680f1c2c9d8e3b0012345678",
      interactiveListName: "Visa Intake List",
      interactiveListDescription: "Collect the visitor's goal",
      interactiveListSections: [
        {
          title: "Main options",
          rows: [
            { id: "visa_assessment", title: "Visa Assessment", description: "Start visa assessment" },
          ],
        },
      ],
      interactiveListSectionCount: 1,
      interactiveListRowCount: 1,
    },
    { partial: true, current: {} }
  );

  assert.equal(payload.replyActionType, "interactive_list");
  assert.equal(payload.interactiveListId, "680f1c2c9d8e3b0012345678");
  assert.equal(payload.interactiveListName, "Visa Intake List");
  assert.equal(payload.interactiveListDescription, "Collect the visitor's goal");
  assert.equal(payload.interactiveListSections.length, 1);
  assert.equal(payload.interactiveListSections[0].rows.length, 1);
  assert.equal(payload.interactiveListSectionCount, 1);
  assert.equal(payload.interactiveListRowCount, 1);

  assert.throws(
    () =>
      automationService.__private.normalizeOutOfOfficePayload(
        {
          replyActionType: "interactive_list",
          actionButtonText: "Select option",
          interactiveListId: "680f1c2c9d8e3b0012345678",
          interactiveListSections: [
            {
              title: "Main options",
              rows: [
                { id: "duplicate_row", title: "Option A" },
                { id: "duplicate_row", title: "Option B" },
              ],
            },
          ],
        },
        { partial: true, current: {} }
      ),
    /Duplicate id: duplicate_row/
  );

  const mockSettingsDoc = {
    automations: {},
    workingHours: {},
  };
  const basicAutomationService = loadWithMocks(path.resolve(__dirname, "../services/whatsappBasicAutomationService.js"), {
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
        lean: async () => mockSettingsDoc,
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
      countInteractiveListRows: (sections) =>
        sections.reduce((total, section) => total + (section.rows || []).length, 0),
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
      getInteractiveListById: async () => ({
        id: "680f1c2c9d8e3b0012345678",
        name: "Visa Intake List",
        description: "Collect the visitor's goal",
        headerText: "Choose a topic",
        footerText: "Blue Whale Migration",
        buttonText: "Select option",
        category: "intake",
        isActive: true,
        sections: [
          {
            title: "Main options",
            rows: [{ id: "visa_assessment", title: "Visa Assessment", description: "Start visa assessment" }],
          },
        ],
        sectionCount: 1,
        rowCount: 1,
      }),
      validateInteractiveListSnapshot,
    },
  });

  const preview = await basicAutomationService.previewBasicAutomation({
    type: "outOfOffice",
    phoneNumber: "+94770000000",
    settingsOverride: {
      message: "Please choose an option below.",
      replyActionType: "interactive_list",
      actionButtonText: "Select option",
      interactiveListId: "680f1c2c9d8e3b0012345678",
      interactiveListName: "Visa Intake List",
    },
  });

  assert.equal(preview.replyAction.type, "interactive_list");
  assert.equal(preview.replyAction.label, "Interactive list");
  assert.equal(preview.replyAction.buttonText, "Select option");
  assert.equal(preview.replyAction.interactiveListId, "680f1c2c9d8e3b0012345678");
  assert.equal(preview.replyAction.interactiveListName, "Visa Intake List");
  assert.equal(preview.replyAction.sectionCount, 1);
  assert.equal(preview.replyAction.rowCount, 1);
  assert.equal(preview.replyActionDelivered, true);

  assert.throws(
    () =>
      automationService.__private.normalizeWelcomePayload(
        {
          templateMode: "custom",
          message: "   ",
        },
        {
          partial: true,
          current: {
            ...automationService.buildDefaultSettings().automations.welcome,
          },
        }
      ),
    /message is required when templateMode is custom/
  );

  const approvedTemplatePayload = automationService.__private.normalizeWelcomePayload(
    {
      templateMode: "approved_template",
      message: "   ",
      templateId: "template_123",
    },
    {
      partial: true,
      current: {
        ...automationService.buildDefaultSettings().automations.welcome,
      },
    }
  );

  assert.equal(approvedTemplatePayload.templateMode, "approved_template");
  assert.equal(approvedTemplatePayload.message, "");
};

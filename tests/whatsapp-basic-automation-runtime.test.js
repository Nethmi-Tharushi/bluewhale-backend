const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

module.exports = async () => {
  const sendCalls = [];
  const successService = loadWithMocks(path.resolve(__dirname, "../services/whatsappBasicAutomationRuntimeService.js"), {
    "../models/RecruitmentChannel": { findById: () => ({ select: () => ({ lean: async () => null }) }) },
    "../models/WhatsAppForm": { findById: () => ({ select: () => ({ lean: async () => null }) }) },
    "../models/WhatsAppBasicAutomationSettings": { findOneAndUpdate: async () => ({ automations: { outOfOffice: { sentCount: 1 } } }) },
    "../models/WhatsAppConversation": {},
    "../models/WhatsAppContact": {},
    "../models/WhatsAppMessage": { updateOne: async () => ({}) },
    "./whatsappInteractiveListService": {
      getInteractiveListById: async () => ({
        id: "680f1c2c9d8e3b0012345678",
        name: "Visa Intake List",
        description: "Collect the visitor's goal",
        buttonText: "Select option",
        isActive: true,
        sections: [
          { title: "Main options", rows: [{ id: "visa_assessment", title: "Visa Assessment" }] },
        ],
        sectionCount: 1,
        rowCount: 1,
      }),
      buildInteractiveListResourceFromConfig: (config) => ({
        id: config.interactiveListId,
        name: config.interactiveListName,
        description: "",
        buttonText: config.actionButtonText,
        isActive: true,
        sections: config.interactiveListSections || [],
        sectionCount: 1,
        rowCount: 1,
      }),
      validateInteractiveListSnapshot: () => ({ valid: true, reason: "", sections: [{ title: "Main options", rows: [{ id: "visa_assessment", title: "Visa Assessment" }] }], sectionCount: 1, rowCount: 1 }),
    },
    "./whatsappTemplateService": {
      prepareTemplateMessage: async () => ({}),
      getTemplateById: async () => null,
    },
    "./whatsappService": {
      normalizePhone: (value) => value,
      sendMessage: async (payload) => {
        sendCalls.push(payload);
        return { response: { messages: [{ id: "wamid.success" }] } };
      },
    },
    "./whatsappBasicAutomationService": {
      getBasicAutomationSettings: async () => ({}),
      resolveBasicAutomationConfig: async () => ({
        type: "outOfOffice",
        config: {
          message: "Please choose an option below.",
          templateMode: "custom",
          replyActionType: "interactive_list",
          actionButtonText: "Select option",
          interactiveListId: "680f1c2c9d8e3b0012345678",
          interactiveListName: "Visa Intake List",
        },
      }),
    },
  });

  const successResult = await successService.sendBasicAutomationTestMessage({
    type: "outOfOffice",
    phoneNumber: "+94770000000",
  });

  assert.equal(successResult.sent, true);
  assert.equal(successResult.modeUsed, "interactive");
  assert.equal(successResult.fallbackUsed, false);
  assert.equal(successResult.replyActionUsed, "interactive_list");
  assert.equal(successResult.replyActionDelivered, true);
  assert.equal(successResult.replyActionFallbackUsed, false);
  assert.equal(successResult.messageId, "wamid.success");
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].interactive.type, "list");

  let callCount = 0;
  const fallbackService = loadWithMocks(path.resolve(__dirname, "../services/whatsappBasicAutomationRuntimeService.js"), {
    "../models/RecruitmentChannel": { findById: () => ({ select: () => ({ lean: async () => null }) }) },
    "../models/WhatsAppForm": { findById: () => ({ select: () => ({ lean: async () => null }) }) },
    "../models/WhatsAppBasicAutomationSettings": { findOneAndUpdate: async () => ({ automations: { outOfOffice: { sentCount: 1 } } }) },
    "../models/WhatsAppConversation": {},
    "../models/WhatsAppContact": {},
    "../models/WhatsAppMessage": { updateOne: async () => ({}) },
    "./whatsappInteractiveListService": {
      getInteractiveListById: async () => ({
        id: "680f1c2c9d8e3b0012345678",
        name: "Visa Intake List",
        description: "Collect the visitor's goal",
        buttonText: "Select option",
        isActive: true,
        sections: [
          { title: "Main options", rows: [{ id: "visa_assessment", title: "Visa Assessment" }] },
        ],
        sectionCount: 1,
        rowCount: 1,
      }),
      buildInteractiveListResourceFromConfig: (config) => ({
        id: config.interactiveListId,
        name: config.interactiveListName,
        description: "",
        buttonText: config.actionButtonText,
        isActive: true,
        sections: config.interactiveListSections || [],
        sectionCount: 1,
        rowCount: 1,
      }),
      validateInteractiveListSnapshot: () => ({ valid: true, reason: "", sections: [{ title: "Main options", rows: [{ id: "visa_assessment", title: "Visa Assessment" }] }], sectionCount: 1, rowCount: 1 }),
    },
    "./whatsappTemplateService": {
      prepareTemplateMessage: async () => ({}),
      getTemplateById: async () => null,
    },
    "./whatsappService": {
      normalizePhone: (value) => value,
      sendMessage: async () => {
        callCount += 1;
        if (callCount === 1) {
          const error = new Error("Blocked by Integrity");
          error.status = 400;
          throw error;
        }
        return { response: { messages: [{ id: "wamid.fallback" }] } };
      },
    },
    "./whatsappBasicAutomationService": {
      getBasicAutomationSettings: async () => ({}),
      resolveBasicAutomationConfig: async () => ({
        type: "outOfOffice",
        config: {
          message: "Please choose an option below.",
          templateMode: "custom",
          replyActionType: "interactive_list",
          actionButtonText: "Select option",
          interactiveListId: "680f1c2c9d8e3b0012345678",
          interactiveListName: "Visa Intake List",
        },
      }),
    },
  });

  const fallbackResult = await fallbackService.sendBasicAutomationTestMessage({
    type: "outOfOffice",
    phoneNumber: "+94770000000",
  });

  assert.equal(fallbackResult.sent, true);
  assert.equal(fallbackResult.modeUsed, "text");
  assert.equal(fallbackResult.fallbackUsed, true);
  assert.equal(fallbackResult.replyActionUsed, "interactive_list");
  assert.equal(fallbackResult.replyActionDelivered, false);
  assert.equal(fallbackResult.replyActionFallbackUsed, true);
  assert.equal(fallbackResult.messageId, "wamid.fallback");
  assert.match(fallbackResult.notes.join(" | "), /Interactive list send failed: Blocked by Integrity/);
};

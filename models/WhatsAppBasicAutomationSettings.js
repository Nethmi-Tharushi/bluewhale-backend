const mongoose = require("mongoose");

const DAY_OPTIONS = Object.freeze(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
const TEMPLATE_MODE_OPTIONS = Object.freeze(["custom", "approved_template"]);
const APPLY_SCOPE_OPTIONS = Object.freeze(["new_or_closed", "new_only", "all"]);
const REPLY_ACTION_TYPE_OPTIONS = Object.freeze(["none", "whatsapp_form", "interactive_list", "product_collection"]);
const FORM_OPEN_MODE_OPTIONS = Object.freeze(["navigate_first_screen", "data_exchange"]);
const COOLDOWN_UNIT_OPTIONS = Object.freeze(["minutes", "hours"]);

const interactiveListRowSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: "",
      trim: true,
    },
    title: {
      type: String,
      default: "",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
);

const interactiveListSectionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: "",
      trim: true,
    },
    rows: {
      type: [interactiveListRowSchema],
      default: [],
    },
  },
  { _id: false }
);

const productCollectionItemSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: "",
      trim: true,
    },
    title: {
      type: String,
      default: "",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
);

const templateConfigFields = {
  templateId: {
    type: String,
    default: "",
    trim: true,
  },
  templateName: {
    type: String,
    default: "",
    trim: true,
  },
  templateLanguage: {
    type: String,
    default: "",
    trim: true,
  },
  templateCategory: {
    type: String,
    default: "",
    trim: true,
  },
};

const cooldownFields = {
  cooldownEnabled: {
    type: Boolean,
    default: false,
  },
  cooldownValue: {
    type: Number,
    default: 30,
    min: 1,
  },
  cooldownUnit: {
    type: String,
    enum: COOLDOWN_UNIT_OPTIONS,
    default: "minutes",
    trim: true,
  },
};

const replyActionFields = {
  replyActionType: {
    type: String,
    enum: REPLY_ACTION_TYPE_OPTIONS,
    default: "none",
    trim: true,
  },
  actionButtonText: {
    type: String,
    default: "",
    trim: true,
  },
  formId: {
    type: String,
    default: "",
    trim: true,
  },
  formName: {
    type: String,
    default: "",
    trim: true,
  },
  formOpenMode: {
    type: String,
    enum: FORM_OPEN_MODE_OPTIONS,
    default: "navigate_first_screen",
    trim: true,
  },
  interactiveListId: {
    type: String,
    default: "",
    trim: true,
  },
  interactiveListName: {
    type: String,
    default: "",
    trim: true,
  },
  interactiveListDescription: {
    type: String,
    default: "",
    trim: true,
  },
  interactiveListSections: {
    type: [interactiveListSectionSchema],
    default: [],
  },
  interactiveListSectionCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  interactiveListRowCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  productCollectionId: {
    type: String,
    default: "",
    trim: true,
  },
  productCollectionName: {
    type: String,
    default: "",
    trim: true,
  },
  productCollectionDescription: {
    type: String,
    default: "",
    trim: true,
  },
  productCollectionCategory: {
    type: String,
    default: "",
    trim: true,
  },
  productCollectionItems: {
    type: [productCollectionItemSchema],
    default: [],
  },
  productCollectionItemCount: {
    type: Number,
    default: 0,
    min: 0,
  },
};

const workingHoursSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
    },
    days: {
      type: [String],
      enum: DAY_OPTIONS,
      default: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    },
    startTime: {
      type: String,
      default: "10:00",
      trim: true,
    },
    endTime: {
      type: String,
      default: "18:00",
      trim: true,
    },
    timezone: {
      type: String,
      default: "Asia/Colombo",
      trim: true,
    },
  },
  { _id: false }
);

const outOfOfficeSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
    },
    message: {
      type: String,
      default: "We are currently offline. Our team will get back to you during working hours.",
      trim: true,
    },
    sentCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    templateMode: {
      type: String,
      enum: TEMPLATE_MODE_OPTIONS,
      default: "custom",
      trim: true,
    },
    applyScope: {
      type: String,
      enum: APPLY_SCOPE_OPTIONS,
      default: "new_or_closed",
      trim: true,
    },
    ...templateConfigFields,
    ...cooldownFields,
    ...replyActionFields,
  },
  { _id: false }
);

const welcomeAutomationSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
    },
    message: {
      type: String,
      default: "Thank you for contacting Blue Whale Migration. Please tell us how we can help you.",
      trim: true,
    },
    sentCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    retriggerAfterHours: {
      type: Number,
      default: 24,
      min: 1,
    },
    templateMode: {
      type: String,
      enum: TEMPLATE_MODE_OPTIONS,
      default: "custom",
      trim: true,
    },
    ...templateConfigFields,
    ...cooldownFields,
    ...replyActionFields,
  },
  { _id: false }
);

const delayedResponseSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
    },
    message: {
      type: String,
      default: "Thanks for your message. Our team will respond shortly.",
      trim: true,
    },
    sentCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    delayMinutes: {
      type: Number,
      default: 15,
      min: 1,
    },
    templateMode: {
      type: String,
      enum: TEMPLATE_MODE_OPTIONS,
      default: "custom",
      trim: true,
    },
    ...templateConfigFields,
    ...cooldownFields,
    ...replyActionFields,
  },
  { _id: false }
);

const whatsAppBasicAutomationSettingsSchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      default: "default",
      unique: true,
      index: true,
      trim: true,
    },
    workingHours: {
      type: workingHoursSchema,
      default: () => ({}),
    },
    automations: {
      outOfOffice: {
        type: outOfOfficeSchema,
        default: () => ({}),
      },
      welcome: {
        type: welcomeAutomationSchema,
        default: () => ({}),
      },
      delayedResponse: {
        type: delayedResponseSchema,
        default: () => ({}),
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhatsAppBasicAutomationSettings", whatsAppBasicAutomationSettingsSchema);
module.exports.DAY_OPTIONS = DAY_OPTIONS;
module.exports.TEMPLATE_MODE_OPTIONS = TEMPLATE_MODE_OPTIONS;
module.exports.APPLY_SCOPE_OPTIONS = APPLY_SCOPE_OPTIONS;
module.exports.REPLY_ACTION_TYPE_OPTIONS = REPLY_ACTION_TYPE_OPTIONS;
module.exports.FORM_OPEN_MODE_OPTIONS = FORM_OPEN_MODE_OPTIONS;
module.exports.COOLDOWN_UNIT_OPTIONS = COOLDOWN_UNIT_OPTIONS;

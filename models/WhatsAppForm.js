const mongoose = require("mongoose");

const WHATSAPP_FORM_FIELD_TYPES = Object.freeze([
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "select",
  "radio",
  "checkbox",
  "date",
]);
const WHATSAPP_FORM_PROVIDER_FLOW_MODES = Object.freeze(["published", "draft"]);

const whatsAppFormFieldSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: WHATSAPP_FORM_FIELD_TYPES,
      required: true,
      trim: true,
    },
    required: {
      type: Boolean,
      default: false,
    },
    placeholder: {
      type: String,
      default: "",
      trim: true,
    },
    options: {
      type: [String],
      default: [],
    },
  },
  { _id: false }
);

const whatsAppFormSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    slug: {
      type: String,
      default: null,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    category: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    fields: {
      type: [whatsAppFormFieldSchema],
      default: [],
    },
    submitButtonText: {
      type: String,
      default: "Submit",
      trim: true,
    },
    successMessage: {
      type: String,
      default: "",
      trim: true,
    },
    providerFlowId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    providerFlowName: {
      type: String,
      default: "",
      trim: true,
    },
    providerFlowMode: {
      type: String,
      enum: WHATSAPP_FORM_PROVIDER_FLOW_MODES,
      default: "published",
      trim: true,
    },
    providerFlowFirstScreenId: {
      type: String,
      default: "",
      trim: true,
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

whatsAppFormSchema.index({ updatedAt: -1 });
whatsAppFormSchema.index({ name: 1, category: 1 });
whatsAppFormSchema.index(
  { slug: 1 },
  {
    unique: true,
    partialFilterExpression: {
      slug: {
        $type: "string",
        $gt: "",
      },
    },
  }
);

const WhatsAppForm = mongoose.model("WhatsAppForm", whatsAppFormSchema);

module.exports = WhatsAppForm;
module.exports.WHATSAPP_FORM_FIELD_TYPES = WHATSAPP_FORM_FIELD_TYPES;
module.exports.WHATSAPP_FORM_PROVIDER_FLOW_MODES = WHATSAPP_FORM_PROVIDER_FLOW_MODES;

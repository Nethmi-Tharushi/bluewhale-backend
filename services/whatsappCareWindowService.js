const CUSTOMER_CARE_WINDOW_MS = 24 * 60 * 60 * 1000;

const trimString = (value) => String(value || "").trim();
const normalizePhoneDigits = (value) => String(value || "").replace(/\D/g, "");

const toDateOrNull = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getLastCustomerMessageAt = (conversation = {}) =>
  toDateOrNull(
    conversation.lastIncomingAt
    || conversation.automationState?.lastCustomerMessageAt
    || null
  );

const hasOpenCustomerCareWindow = ({ conversation = null, referenceTime = new Date() } = {}) => {
  const lastCustomerMessageAt = getLastCustomerMessageAt(conversation || {});
  if (!lastCustomerMessageAt) {
    return false;
  }

  return referenceTime.getTime() - lastCustomerMessageAt.getTime() <= CUSTOMER_CARE_WINDOW_MS;
};

const findContactConversationByPhone = async ({
  phoneNumber,
  ContactModel,
  ConversationModel,
} = {}) => {
  const phoneDigits = normalizePhoneDigits(phoneNumber);
  if (!phoneDigits || !ContactModel || !ConversationModel) {
    return { contact: null, conversation: null };
  }

  const contacts = await ContactModel.find({
    $or: [
      { phone: phoneNumber },
      { waId: phoneNumber },
      { phone: phoneDigits },
      { waId: phoneDigits },
      { phone: `+${phoneDigits}` },
      { waId: `+${phoneDigits}` },
    ],
  }).lean();

  const matchingContacts = contacts.filter((contact) =>
    [contact.phone, contact.waId].some((value) => normalizePhoneDigits(value) === phoneDigits)
  );

  if (!matchingContacts.length) {
    return { contact: null, conversation: null };
  }

  const contactIds = new Set(matchingContacts.map((contact) => trimString(contact._id || contact.id)));
  const conversations = await ConversationModel.find({ channel: "whatsapp" }).lean();
  const conversation = conversations.find((item) =>
    contactIds.has(trimString(item.contactId?._id || item.contactId))
  ) || null;
  const contact = matchingContacts.find((item) =>
    trimString(item._id || item.id) === trimString(conversation?.contactId?._id || conversation?.contactId)
  ) || matchingContacts[0] || null;

  return { contact, conversation };
};

const assertOpenCustomerCareWindow = ({
  conversation = null,
  contact = null,
  createError = (message) => new Error(message),
  contextLabel = "Compose messages",
} = {}) => {
  if (hasOpenCustomerCareWindow({ conversation })) {
    return;
  }

  const recipientLabel = trimString(
    contact?.name
    || contact?.profile?.name
    || contact?.phone
    || contact?.waId
    || "the selected recipient"
  );
  const lastCustomerMessageAt = getLastCustomerMessageAt(conversation || {});
  const historyMessage = lastCustomerMessageAt
    ? `Last inbound WhatsApp message: ${lastCustomerMessageAt.toISOString()}.`
    : "No recent inbound WhatsApp message is recorded for this recipient.";

  throw createError(
    `${contextLabel} require an active 24-hour customer care window for ${recipientLabel}. `
    + `${historyMessage} Ask the recipient to message this WhatsApp number first, or switch to an approved template.`
  );
};

module.exports = {
  CUSTOMER_CARE_WINDOW_MS,
  getLastCustomerMessageAt,
  hasOpenCustomerCareWindow,
  findContactConversationByPhone,
  assertOpenCustomerCareWindow,
};

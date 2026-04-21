/**
 * Formats WhatsApp messages for API response
 * Ensures consistency with frontend expectations
 */

const toIdString = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const formatMessageTimestamp = (dateValue) => {
  if (!dateValue) return null;
  if (typeof dateValue === "string") return dateValue;
  if (dateValue instanceof Date) return dateValue.toISOString();
  return null;
};

const senderTypeMap = {
  customer: "customer",
  agent: "agent",
  system: "system",
};

const statusMap = {
  received: "received",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

/**
 * Format a single message for API response
 * @param {Object} messageDoc - Raw message document from database
 * @returns {Object} Formatted message object
 */
const formatMessage = (messageDoc) => {
  const message = messageDoc?.toObject ? messageDoc.toObject() : messageDoc;
  if (!message) return null;

  const timestamp = formatMessageTimestamp(message.timestamp || message.createdAt);
  const createdAt = formatMessageTimestamp(message.createdAt);

  return {
    _id: toIdString(message._id),
    id: toIdString(message._id),
    // Message content
    text: String(message.content || message.text || ""),
    content: String(message.content || message.text || ""), // Keep for compatibility
    // Sender information
    senderType: senderTypeMap[message.sender] || message.sender || "customer",
    sender: message.sender || "customer", // Keep for compatibility
    // Status information
    status: statusMap[message.status] || message.status || "sent",
    // Timestamps (provide multiple formats for compatibility)
    timestamp: timestamp,
    createdAt: createdAt,
    clientCreatedAt: timestamp,
    raw: {
      timestamp: timestamp,
      createdAt: createdAt,
    },
    // Additional metadata
    type: message.type || "text",
    conversationId: toIdString(message.conversationId),
    agentId: toIdString(message.agentId),
    metadata: message.metadata || {},
  };
};

/**
 * Format multiple messages for API response
 * @param {Array} messages - Array of raw message documents
 * @returns {Array} Array of formatted messages
 */
const formatMessages = (messages) => {
  if (!Array.isArray(messages)) return [];
  return messages.map(formatMessage).filter(Boolean);
};

module.exports = {
  formatMessage,
  formatMessages,
};

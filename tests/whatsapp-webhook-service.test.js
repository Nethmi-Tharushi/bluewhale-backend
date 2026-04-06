const assert = require("node:assert/strict");

const { parseWebhookPayload } = require("../services/whatsappWebhookService");

module.exports = async () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "1006306352574825" },
              contacts: [{ wa_id: "94770000000", profile: { name: "Test User" } }],
              messages: [
                {
                  id: "wamid.inbound",
                  from: "94770000000",
                  timestamp: "1712040000",
                  type: "interactive",
                  interactive: {
                    list_reply: {
                      id: "visa_assessment",
                      title: "Visa Assessment",
                      description: "Start visa assessment",
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const result = parseWebhookPayload(payload);

  assert.equal(result.inboundMessages.length, 1);
  assert.equal(result.inboundMessages[0].type, "interactive");
  assert.equal(result.inboundMessages[0].text, "Visa Assessment");
  assert.deepEqual(result.inboundMessages[0].interactiveReply, {
    type: "list_reply",
    id: "visa_assessment",
    title: "Visa Assessment",
    description: "Start visa assessment",
  });
};

const assert = require("node:assert/strict");
const path = require("path");

const validation = require(path.resolve(__dirname, "../middlewares/whatsappProfileValidation.js"));

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

module.exports = async () => {
  let nextCalled = false;
  validation.validateWhatsAppProfileBody(
    {
      body: {
        businessName: "Blue Whale CRM",
      },
    },
    createResponse(),
    () => {
      nextCalled = true;
    }
  );
  assert.equal(nextCalled, true);

  const emptyRes = createResponse();
  validation.validateWhatsAppProfileBody({ body: {} }, emptyRes, () => {});
  assert.equal(emptyRes.statusCode, 400);
  assert.match(emptyRes.body.message, /At least one field is required/i);

  const invalidRes = createResponse();
  validation.validateWhatsAppProfileBody(
    {
      body: {
        businessName: "Blue Whale CRM",
        logoDataUrl: "data:image/png;base64,abc",
      },
    },
    invalidRes,
    () => {}
  );
  assert.equal(invalidRes.statusCode, 400);
  assert.match(invalidRes.body.message, /Unsupported field: logoDataUrl/i);
};

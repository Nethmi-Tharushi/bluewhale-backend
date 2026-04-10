const assert = require("node:assert/strict");
const path = require("path");

const validation = require(path.resolve(__dirname, "../middlewares/rolePermissionProfileValidation.js"));

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
  validation.validateRolePermissionProfileKey(
    { params: { profileKey: "SalesAdmin" } },
    createResponse(),
    () => {
      nextCalled = true;
    }
  );
  assert.equal(nextCalled, true);

  const invalidKeyRes = createResponse();
  validation.validateRolePermissionUpdateBody(
    {
      body: {
        permissions: {
          badKey: true,
        },
      },
    },
    invalidKeyRes,
    () => {}
  );
  assert.equal(invalidKeyRes.statusCode, 400);
  assert.match(invalidKeyRes.body.message, /Unknown permission key/i);

  const invalidValueRes = createResponse();
  validation.validateRolePermissionUpdateBody(
    {
      body: {
        permissions: {
          contactHubAccess: "true",
        },
      },
    },
    invalidValueRes,
    () => {}
  );
  assert.equal(invalidValueRes.statusCode, 400);
  assert.match(invalidValueRes.body.message, /must be a boolean/i);

  const resetMissingRes = createResponse();
  validation.validateRolePermissionResetBody(
    {
      body: {},
    },
    resetMissingRes,
    () => {}
  );
  assert.equal(resetMissingRes.statusCode, 400);
  assert.match(resetMissingRes.body.message, /profileKey is required unless all=true/i);
};

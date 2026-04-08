const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

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

const loadMiddleware = (errorFactory = null) => {
  class FakeMulterError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }

  const multerMock = Object.assign(
    (_config) => ({
      single: () => (_req, _res, callback) => callback(errorFactory ? errorFactory(FakeMulterError) : null),
    }),
    {
      memoryStorage: () => ({}),
      MulterError: FakeMulterError,
    }
  );

  return loadWithMocks(path.resolve(__dirname, "../middlewares/whatsappProfileLogoUpload.js"), {
    multer: multerMock,
  });
};

module.exports = async () => {
  const successMiddleware = loadMiddleware();
  let nextCalled = false;
  successMiddleware.uploadWhatsAppProfileLogo({}, createResponse(), () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);

  const sizeMiddleware = loadMiddleware((MulterError) => new MulterError("LIMIT_FILE_SIZE"));
  const sizeRes = createResponse();
  sizeMiddleware.uploadWhatsAppProfileLogo({}, sizeRes, () => {});
  assert.equal(sizeRes.statusCode, 400);
  assert.match(sizeRes.body.message, /5MB or less/i);

  const fieldMiddleware = loadMiddleware((MulterError) => new MulterError("LIMIT_UNEXPECTED_FILE"));
  const fieldRes = createResponse();
  fieldMiddleware.uploadWhatsAppProfileLogo({}, fieldRes, () => {});
  assert.equal(fieldRes.statusCode, 400);
  assert.match(fieldRes.body.message, /field must be named file/i);

  const typeMiddleware = loadMiddleware(() => new Error("Unsupported WhatsApp profile logo type"));
  const typeRes = createResponse();
  typeMiddleware.uploadWhatsAppProfileLogo({}, typeRes, () => {});
  assert.equal(typeRes.statusCode, 400);
  assert.match(typeRes.body.message, /Unsupported WhatsApp profile logo type/i);
};

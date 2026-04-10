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

const loadController = (serviceOverrides = {}) =>
  loadWithMocks(path.resolve(__dirname, "../controllers/whatsappProfileController.js"), {
    "../services/whatsappProfileService": {
      getWhatsAppBusinessProfile: async () => ({
        businessName: "Blue Whale CRM",
        businessType: "Professional Services",
        businessDescription: "",
        address: "",
        email: "",
        website: "",
        phone: "",
        logoUrl: "",
        updatedAt: "2026-04-08T10:00:00.000Z",
        updatedBy: null,
      }),
      updateWhatsAppBusinessProfile: async () => ({
        businessName: "Blue Whale CRM",
        businessType: "Professional Services",
        logoUrl: "",
        updatedAt: "2026-04-08T10:00:00.000Z",
        updatedBy: { id: "507f1f77bcf86cd799439011", name: "Admin User" },
      }),
      uploadWhatsAppBusinessProfileLogo: async () => ({
        logoUrl: "https://cdn.example.com/logo.png",
        logoStorageKey: "wa_profile_logo_1",
      }),
      deleteWhatsAppBusinessProfileLogo: async () => ({
        businessName: "Blue Whale CRM",
        businessType: "Professional Services",
        logoUrl: "",
        updatedAt: "2026-04-08T11:00:00.000Z",
        updatedBy: { id: "507f1f77bcf86cd799439011", name: "Admin User" },
      }),
      ...serviceOverrides,
    },
  });

module.exports = async () => {
  const controller = loadController();

  const getRes = createResponse();
  await controller.getWhatsAppProfile({}, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.success, true);
  assert.equal(getRes.body.data.businessName, "Blue Whale CRM");

  const updateRes = createResponse();
  await controller.updateWhatsAppProfile(
    {
      body: { businessName: "Blue Whale CRM" },
      admin: { _id: "507f1f77bcf86cd799439011" },
    },
    updateRes
  );
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.data.updatedBy.name, "Admin User");

  const logoRes = createResponse();
  await controller.uploadWhatsAppProfileLogo(
    {
      file: { buffer: Buffer.from("logo") },
      admin: { _id: "507f1f77bcf86cd799439011" },
    },
    logoRes
  );
  assert.equal(logoRes.statusCode, 201);
  assert.equal(logoRes.body.data.logoStorageKey, "wa_profile_logo_1");

  const errorController = loadController({
    updateWhatsAppBusinessProfile: async () => {
      const error = new Error("website must be a valid URL");
      error.status = 400;
      throw error;
    },
  });

  const errorRes = createResponse();
  await errorController.updateWhatsAppProfile(
    {
      body: { website: "bad-url" },
      admin: { _id: "507f1f77bcf86cd799439011" },
    },
    errorRes
  );
  assert.equal(errorRes.statusCode, 400);
  assert.equal(errorRes.body.success, false);
};

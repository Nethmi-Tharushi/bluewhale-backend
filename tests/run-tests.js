const path = require("path");

process.env.CLOUDINARY_NAME = process.env.CLOUDINARY_NAME || "test-cloud";
process.env.CLOUDINARY_KEY = process.env.CLOUDINARY_KEY || "test-key";
process.env.CLOUDINARY_SECRET = process.env.CLOUDINARY_SECRET || "test-secret";

const testFiles = [
  "./admin-management-service.test.js",
  "./admin-management-controller.test.js",
  "./admin-auth-controller.test.js",
  "./admin-routes.test.js",
  "./role-permission-profile-service.test.js",
  "./role-permission-profile-controller.test.js",
  "./role-permission-profile-validation.test.js",
  "./whatsapp-basic-automation-service.test.js",
  "./whatsapp-basic-automation-controller.test.js",
  "./whatsapp-basic-automation-runtime.test.js",
  "./whatsapp-campaign-service.test.js",
  "./whatsapp-campaign-controller.test.js",
  "./whatsapp-campaign-runtime.test.js",
  "./whatsapp-contact-hub-service.test.js",
  "./whatsapp-contact-hub-controller.test.js",
  "./whatsapp-contact-hub-routes.test.js",
  "./whatsapp-profile-service.test.js",
  "./whatsapp-profile-controller.test.js",
  "./whatsapp-profile-routes.test.js",
  "./whatsapp-profile-logo-upload.test.js",
  "./whatsapp-profile-validation.test.js",
  "./whatsapp-product-collection.test.js",
  "./whatsapp-ai-agent-service.test.js",
  "./whatsapp-ai-agent-controller.test.js",
  "./whatsapp-ai-agent-routes.test.js",
  "./whatsapp-ai-agent-runtime.test.js",
  "./whatsapp-ai-intent-matching-service.test.js",
  "./whatsapp-ai-intent-matching-controller.test.js",
  "./whatsapp-ai-intent-matching-routes.test.js",
  "./whatsapp-ai-intent-matching-runtime.test.js",
  "./whatsapp-webhook-service.test.js",
];

(async () => {
  let failures = 0;

  for (const relativePath of testFiles) {
    const absolutePath = path.resolve(__dirname, relativePath);
    delete require.cache[absolutePath];

    try {
      const run = require(absolutePath);
      if (typeof run !== "function") {
        throw new Error("Test file must export an async function");
      }

      await run();
      console.log(`PASS ${relativePath}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${relativePath}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`PASS ${testFiles.length} test files`);
})();

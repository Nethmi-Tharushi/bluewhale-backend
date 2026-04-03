const path = require("path");

process.env.CLOUDINARY_NAME = process.env.CLOUDINARY_NAME || "test-cloud";
process.env.CLOUDINARY_KEY = process.env.CLOUDINARY_KEY || "test-key";
process.env.CLOUDINARY_SECRET = process.env.CLOUDINARY_SECRET || "test-secret";

const testFiles = [
  "./whatsapp-basic-automation-service.test.js",
  "./whatsapp-basic-automation-controller.test.js",
  "./whatsapp-basic-automation-runtime.test.js",
  "./whatsapp-product-collection.test.js",
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

const multer = require("multer");

const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error("Unsupported WhatsApp profile logo type"), false);
    }
    cb(null, true);
  },
});

const uploadWhatsAppProfileLogo = (req, res, next) =>
  upload.single("file")(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "Logo file size must be 5MB or less" });
      }

      if (error.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({ message: "Logo upload field must be named file" });
      }
    }

    return res.status(400).json({ message: error.message || "Failed to upload WhatsApp profile logo" });
  });

module.exports = {
  uploadWhatsAppProfileLogo,
};

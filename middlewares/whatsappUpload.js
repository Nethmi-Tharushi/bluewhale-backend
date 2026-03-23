const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const allowedMimeTypes = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/ogg; codecs=opus",
  "audio/aac",
  "audio/amr",
  "audio/mp4",
  "video/mp4",
  "video/3gpp",
];

const getResourceType = (file) => {
  if (file.mimetype.startsWith("image/")) return "image";
  if (file.mimetype.startsWith("video/")) return "video";
  if (file.mimetype.startsWith("audio/")) return "video";
  return "raw";
};

const storage = new CloudinaryStorage({
  cloudinary,
  params: (_req, file) => ({
    folder: "bluewhale/whatsapp",
    resource_type: getResourceType(file),
    public_id: `whatsapp_${Date.now()}_${Math.round(Math.random() * 1e9)}`,
  }),
});

const whatsappUpload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error("Unsupported WhatsApp media type"), false);
    }
    cb(null, true);
  },
});

module.exports = whatsappUpload;

const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

// Multer storage configuration for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    let folder;
    let resource_type = 'auto'; // Default to auto-detection
    let allowedFormats = ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx'];

    switch (file.fieldname) {
      case 'photo':
      case 'picture':
        folder = 'bluewhale/users/profile_photos';
        break;
      case 'passport':
        folder = 'bluewhale/users/passports';
        break;
      case 'drivingLicense':
        folder = 'bluewhale/users/licenses';
        break;
      case 'cv':
      case 'CV':
        folder = 'bluewhale/users/cvs';
        // Force resource_type to 'raw' for documents to preserve their format
        if (file.mimetype.includes('pdf') || file.mimetype.includes('document')) {
          resource_type = 'raw';
        }
        break;
      case 'attachment':
      case 'file':
      case 'document':
      case 'proof':
      case 'slip':
      case 'paymentSlip':
        folder = 'bluewhale/users/attachments';
        allowedFormats = [
          'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
          'pdf', 'doc', 'docx', 'txt', 'rtf',
          'xls', 'xlsx', 'csv',
          'ppt', 'pptx',
          'zip', 'rar', '7z',
          'json', 'xml'
        ];
        // Inquiry/support attachments can also be docs, so keep raw for non-images
        if (
          file.mimetype.includes('pdf') ||
          file.mimetype.includes('document') ||
          file.mimetype.includes('msword') ||
          file.mimetype.includes('sheet') ||
          file.mimetype.includes('excel') ||
          file.mimetype.includes('presentation') ||
          file.mimetype.includes('powerpoint') ||
          file.mimetype.includes('text') ||
          file.mimetype.includes('zip') ||
          file.mimetype.includes('rar') ||
          file.mimetype.includes('octet-stream')
        ) {
          resource_type = 'raw';
        }
        break;
      default:
        folder = 'bluewhale/user_uploads';
    }

    return {
      folder: folder,
      allowed_formats: allowedFormats,
      resource_type: resource_type, // Use the determined resource type
      public_id: `${file.fieldname}_${req.user ? req.user._id : 'guest'}_${Date.now()}`,
    };
  },
});

// Multer instance with the storage and limits
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 10 // Maximum 10 files per request
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'text/csv', 'application/rtf', 'application/json',
      'application/xml', 'text/xml',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip', 'application/x-zip-compressed',
      'application/x-rar-compressed', 'application/vnd.rar',
      'application/x-7z-compressed', 'application/octet-stream'
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'), false);
    }

    // Set 5MB limit only for CV files
    const isCV = file.fieldname === 'cv' || file.fieldname === 'CV';
    if (isCV && file.size > 5 * 1024 * 1024) {
      return cb(new Error('CV file size must be less than 5MB'), false);
    }

    cb(null, true);
  }
});

// Create a separate upload middleware for task files
const taskFilesStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    let resource_type = 'auto'; // auto-detect
    if (file.mimetype.startsWith('image/')) {
      resource_type = 'image';
    } else {
      resource_type = 'raw'; // for pdf, docs, txt
    }

    return {
      folder: 'bluewhale/tasks',
      allowed_formats: ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx', 'txt'],
      resource_type,
      public_id: `${file.originalname.split('.')[0]}_${Date.now()}`,
    };
  }

});

const uploadTaskFilesMulter = multer({
  storage: taskFilesStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg', 'image/jpg', 'image/png',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'), false);
    }
    cb(null, true);
  }
});

module.exports = upload;
module.exports.uploadTaskFilesMulter = uploadTaskFilesMulter;

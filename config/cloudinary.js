// config/cloudinary.js
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME || process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_KEY || process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_SECRET || process.env.CLOUDINARY_API_SECRET,
});

// Validate configuration
const cloudName = process.env.CLOUDINARY_NAME || process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_KEY || process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_SECRET || process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  console.error('❌ Cloudinary configuration is incomplete. Please check your environment variables:');
  console.error('   - CLOUDINARY_NAME (or CLOUDINARY_CLOUD_NAME)');
  console.error('   - CLOUDINARY_KEY (or CLOUDINARY_API_KEY)');
  console.error('   - CLOUDINARY_SECRET (or CLOUDINARY_API_SECRET)');
  process.exit(1);
}

console.log('✅ Cloudinary configured successfully');

module.exports = cloudinary;
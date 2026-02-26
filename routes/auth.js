const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');

const {
  loginUser,
  loginAdmin,
  signupUser,
  getUserProfile,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');

const { protect } = require('../middlewares/AdminAuth');

// Auth Routes
router.post('/login', loginUser);
router.post('/admin-login', loginAdmin);

router.post(
  '/signup',
  upload.fields([
    { name: 'picture', maxCount: 1 },
    { name: 'CV', maxCount: 1 },
    { name: 'companyLogo', maxCount: 1 },
  ]),
  signupUser
);

router.get('/profile', protect, getUserProfile);

// Password Reset Routes
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
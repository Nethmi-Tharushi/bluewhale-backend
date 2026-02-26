const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const AdminUser = require('../models/AdminUser');
const { sendPasswordResetEmail } = require('../services/emailService');

// Generate JWT Token with role
const generateToken = (id, role = 'user') => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d',
  });
};

// User/Agent Login
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find user (candidate or agent)
    const user = await User.findOne({ email });
    
    if (user && (await user.matchPassword(password))) {
      res.json({
        success: true,
        user: {
          _id: user._id,
          name: user.name,
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          userType: user.userType,
          companyName: user.companyName,
          companyAddress: user.companyAddress,
          contactPerson: user.contactPerson,
          isVerified: user.isVerified,
        },
        token: generateToken(user._id, 'user'),
      });
    } else {
      res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during login' 
    });
  }
};

// Admin Login
const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const admin = await AdminUser.findOne({ email });
    
    if (admin && (await admin.matchPassword(password))) {
      res.json({
        success: true,
        admin: {
          _id: admin._id,
          email: admin.email,
        },
        token: generateToken(admin._id, 'admin'),
      });
    } else {
      res.status(401).json({ 
        success: false, 
        message: 'Invalid admin credentials' 
      });
    }
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during admin login' 
    });
  }
};

// Forgot Password - Send Reset Email
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Find user in User collection (candidates and agents)
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with that email address'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Hash token and set to resetPasswordToken field
    user.resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Set expire time (1 hour)
    user.resetPasswordExpire = Date.now() + 60 * 60 * 1000;

    await user.save();

    try {
      await sendPasswordResetEmail(email, resetToken, user.userType);

      res.status(200).json({
        success: true,
        message: 'Password reset email sent successfully'
      });
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      
      // Reset the token fields if email fails
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save();

      return res.status(500).json({
        success: false,
        message: 'Email could not be sent. Please try again later.'
      });
    }

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset request'
    });
  }
};

// Reset Password
const resetPassword = async (req, res) => {
  try {
    const { token, password, userType } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Hash the token to compare with stored hashed token
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with matching token and check if token hasn't expired
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset token'
      });
    }

    // Set new password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successful',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        userType: user.userType,
      },
      token: generateToken(user._id, 'user')
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset'
    });
  }
};

// Combined Signup for Candidates and Agents
const signupUser = async (req, res) => {
  try {
    console.log('Signup request body:', req.body);
    console.log('Signup request files:', req.files);

    const { 
      name, 
      firstname, 
      lastname, 
      email, 
      password, 
      userType,
      // Candidate fields
      address, 
      country, 
      phoneNumber,
      // Agent fields
      companyName,
      companyAddress,
      contactPerson
    } = req.body;

    // Validate required fields
    if (!email || !password || !userType) {
      return res.status(400).json({ 
        success: false,
        message: 'Email, password, and user type are required' 
      });
    }

    // Validate user type
    if (!['candidate', 'agent'].includes(userType)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user type. Must be either candidate or agent' 
      });
    }

    // Type-specific validation
    if (userType === 'candidate' && (!name || !firstname || !lastname)) {
      return res.status(400).json({ 
        success: false,
        message: 'Name, first name, and last name are required for candidates' 
      });
    }

    if (userType === 'agent' && (!companyName || !companyAddress || !contactPerson)) {
      return res.status(400).json({ 
        success: false,
        message: 'Company name, address, and contact person are required for agents' 
      });
    }

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ 
        success: false,
        message: 'User with this email already exists' 
      });
    }

    // Prepare user data
    const userData = {
      email,
      password,
      userType,
      phoneNumber,
    };

    // Add type-specific fields
    if (userType === 'candidate') {
      userData.name = name;
      userData.firstname = firstname;
      userData.lastname = lastname;
      userData.address = address;
      userData.country = country;
      
      // Handle file uploads for candidates
      if (req.files?.picture) {
        userData.picture = req.files.picture[0].path;
      }
      if (req.files?.CV) {
        userData.CV = req.files.CV[0].path;
      }
    } else if (userType === 'agent') {
      userData.name = contactPerson; // Use contact person as name for agents
      userData.companyName = companyName;
      userData.companyAddress = companyAddress;
      userData.contactPerson = contactPerson;
      
      // Handle company logo upload for agents
      if (req.files?.companyLogo) {
        userData.companyLogo = req.files.companyLogo[0].path;
      }
    }

    // Create new user
    const user = await User.create(userData);

    // Respond with created user info and token
    if (user) {
      const responseData = {
        success: true,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          userType: user.userType,
        },
        token: generateToken(user._id, 'user'),
      };

      // Add type-specific response data
      if (userType === 'candidate') {
        responseData.user.firstname = user.firstname;
        responseData.user.lastname = user.lastname;
        responseData.user.address = user.address;
        responseData.user.country = user.country;
        responseData.user.phoneNumber = user.phoneNumber;
        responseData.user.picture = user.picture;
        responseData.user.CV = user.CV;
      } else if (userType === 'agent') {
        responseData.user.companyName = user.companyName;
        responseData.user.companyAddress = user.companyAddress;
        responseData.user.contactPerson = user.contactPerson;
        responseData.user.phoneNumber = user.phoneNumber;
        responseData.user.companyLogo = user.companyLogo;
        responseData.user.isVerified = user.isVerified;
      }

      res.status(201).json(responseData);
    } else {
      res.status(400).json({ 
        success: false,
        message: 'Invalid user data' 
      });
    }
  } catch (error) {
    console.error('Signup error:', error);
    
    // Handle mongoose validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ 
        success: false,
        message: messages.join('. ') 
      });
    }

    res.status(500).json({ 
      success: false,
      message: 'Server error during registration' 
    });
  }
};

// Get user profile
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    res.json({
      success: true,
      user: user,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while fetching profile' 
    });
  }
};

module.exports = {
  loginUser,
  loginAdmin,
  signupUser,
  getUserProfile,
  forgotPassword,
  resetPassword,
};
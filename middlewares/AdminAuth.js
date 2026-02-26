// middlewares/AdminAuth.js
const jwt = require("jsonwebtoken");
const AdminUser = require("../models/AdminUser");
const User = require("../models/User");

// Protect routes (JWT authentication)
exports.protectAdmin = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
    console.log("Admin token:", token);
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find admin by ID
    const admin = await AdminUser.findById(decoded.id).select("-password");
    if (!admin) {
      return res.status(401).json({ message: "Admin not found" });
    }
    console.log("Admin found:", admin?.role);
    req.admin = admin; // attach admin to request
    next();
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: "Not authorized, token failed" });
  }
};

// Authorize specific roles
// middlewares/AdminAuth.js

exports.authorizeAdmin = (...roles) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    // ✅ If no roles passed, allow any authenticated admin
    if (!roles || roles.length === 0) {
      return next();
    }

    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({
        message: `Access denied: requires role ${roles.join(" or ")}`,
      });
    }

    next();
  };
};


exports.protect = async (req, res, next) => {
  let token;

  // Check Authorization header
  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  try {
    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch user
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    user.role = 'user';
    req.user = user; // attach user to request
    next();
  } catch (error) {
    console.error('JWT Verification Error:', error.message);
    
    let errorMessage = 'Not authorized, token failed';
    if (error.name === 'TokenExpiredError') {
      errorMessage = 'Session expired, please login again';
    } else if (error.name === 'JsonWebTokenError') {
      errorMessage = 'Invalid token';
    }

    res.status(401).json({
      success: false,
      error: errorMessage
    });
  }
};

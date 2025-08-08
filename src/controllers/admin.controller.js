import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import mongoose from "mongoose";
import logger from "../utils/logger.utils.js";
import Admin from "../models/admin.models.js";
import jwt from "jsonwebtoken";
import {isPasswordStrong, isEmailValid, areRequiredFieldsProvided} from "../utils/validator.js";

const createSuperadmin = asyncHandler(async (req, res) => {
  const {fullName, email, password} = req.body;

  // Check if any superadmin already exists
  const existingSuperadmin = await Admin.findOne({role: "superadmin"});
  if (existingSuperadmin) {
    throw new ApiError(403, "Superadmin already exists");
  }

  // Create superadmin with all permissions
  const superadmin = await Admin.create({
    fullName,
    email,
    password,
    role: "superadmin",
    permissions: {
      // Menu & Product Management
      manageMenu: true,
      manageCategories: true,
      manageInventory: true,
      manageLiquorInventory: true,

      // Orders & Fulfillment
      manageOrders: true,
      updateOrderStatus: true,
      manageDeliverySettings: true,
      managePickupSettings: true,

      // Pricing & Offers
      managePricing: true,
      manageDiscounts: true,
      manageHappyHours: true,

      // Customer Engagement
      manageReviews: true,
      manageLoyaltyPrograms: true,
      sendPromotions: true,
      manageReservations: true,

      // Staff & Roles
      manageStaff: true,
      assignStaffRoles: true,
      viewStaffActivityLogs: true,

      // Finance & Reporting
      managePayments: true,
      viewSalesReports: true,
      manageTaxSettings: true,

      // Compliance & Licensing
      manageLicensingDocs: true,
      manageAgeVerification: true,

      // Platform & Settings
      manageStoreProfile: true,
      manageSiteSettings: true,
      manageSecuritySettings: true,
      accessActivityLogs: true
    }
  });

  res.status(201).json(new ApiResponse(201, superadmin, "Initial superadmin created"));
});

// Superadmin-only: Create new admin account
const createAdmin = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger.info("Starting createAdmin process");

    // 1. Authorization Check
    if (req.admin.role !== "superadmin") {
      logger.error("Unauthorized: Only superadmin can create admin accounts");
      throw new ApiError(403, "Unauthorized: Only superadmin can create admin accounts");
    }

    const {fullName, email, password, role} = req.body;

    // 2. Input Validation
    if (!areRequiredFieldsProvided([fullName, email, password, role])) {
      logger.error("Missing required fields");
      throw new ApiError(400, "All fields (fullName, email, password, role) are required");
    }

    if (!isEmailValid(email)) {
      logger.error("Invalid email format");
      throw new ApiError(400, "Invalid email format");
    }

    if (!isPasswordStrong(password)) {
      logger.error("Password does not meet strength requirements");
      throw new ApiError(400, "Password must be at least 8 characters with uppercase, lowercase, number, and special character");
    }

    // 3. Role Validation
    const validRoles = ["admin", "manager", "staff", "delivery"]; // Explicitly excluding superadmin
    if (!validRoles.includes(role)) {
      logger.error("Invalid admin role");
      throw new ApiError(400, `Role must be one of: ${validRoles.join(", ")}`);
    }

    // 4. Check for Existing Admin
    const existingAdmin = await Admin.findOne({email}).session(session);
    if (existingAdmin) {
      logger.error("Email already in use");
      throw new ApiError(409, "Email already in use by another admin");
    }

    // 5. Default permissions based on role
    let defaultPermissions = {};
    if (role === "admin") {
      defaultPermissions = {
        // Menu & Product Management
        manageMenu: true,
        manageCategories: true,
        manageInventory: true,
        manageLiquorInventory: true,

        // Orders & Fulfillment
        manageOrders: true,
        updateOrderStatus: true,
        manageDeliverySettings: true,
        managePickupSettings: true,

        // Pricing & Offers
        managePricing: true,
        manageDiscounts: true,
        manageHappyHours: true,

        // Customer Engagement
        manageReviews: true,
        manageLoyaltyPrograms: true,
        sendPromotions: true,
        manageReservations: true,

        // Staff & Roles
        manageStaff: true,
        assignStaffRoles: false, // Only superadmin can assign roles
        viewStaffActivityLogs: true,

        // Finance & Reporting
        managePayments: true,
        viewSalesReports: true,
        manageTaxSettings: true,

        // Platform & Settings
        manageStoreProfile: true,
        accessActivityLogs: true
      };
    } else if (role === "manager") {
      defaultPermissions = {
        // Menu & Product Management
        manageMenu: true,
        manageCategories: true,
        manageInventory: true,
        manageLiquorInventory: false,

        // Orders & Fulfillment
        manageOrders: true,
        updateOrderStatus: true,
        manageDeliverySettings: false,
        managePickupSettings: true,

        // Pricing & Offers
        managePricing: false,
        manageDiscounts: true,
        manageHappyHours: true,

        // Customer Engagement
        manageReviews: true,
        manageLoyaltyPrograms: true,
        sendPromotions: false,
        manageReservations: true,

        // Staff & Roles
        manageStaff: false,
        viewStaffActivityLogs: false,

        // Finance & Reporting
        managePayments: false,
        viewSalesReports: true,
        manageTaxSettings: false,

        // Platform & Settings
        manageStoreProfile: false,
        accessActivityLogs: false
      };
    } else if (role === "staff") {
      defaultPermissions = {
        // Limited to order management
        manageOrders: true,
        updateOrderStatus: true,

        // Basic menu viewing (no editing)
        manageMenu: false,
        manageCategories: false,

        // Customer interaction
        manageReviews: true,
        manageReservations: true
      };
    } else if (role === "delivery") {
      defaultPermissions = {
        // Only order status updates
        updateOrderStatus: true,

        // No other permissions
        manageOrders: false,
        viewSalesReports: false
      };
    }

    // 6. Create Admin with Default Permissions
    const admin = await Admin.create([
      {
        fullName,
        email,
        password,
        role,
        permissions: defaultPermissions
      }
    ], {session});

    // 7. Save and Commit Transaction
    await admin[0].save({session});
    await session.commitTransaction();

    // 8. Prepare Response (Exclude Sensitive Data)
    const createdAdmin = await Admin.findById(admin[0]._id).select("-password -refreshToken").session(session);

    if (!createdAdmin) {
      logger.error("Failed to create admin");
      throw new ApiError(500, "Failed to create admin account");
    }

    logger.info(`Admin account created successfully for ${email}`);

    res.status(201).json(new ApiResponse(201, createdAdmin, "Admin account created successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in createAdmin: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) {
      throw error;
    }
    if (error.name === "ValidationError") {
      throw new ApiError(400, error.message);
    }
    if (error.code === 11000) {
      throw new ApiError(409, "Admin with this email already exists");
    }
    throw new ApiError(500, error.message || "Failed to create admin account");
  } finally {
    session.endSession();
  }
});

// Admin Login Controller
const loginAdmin = asyncHandler(async (req, res) => {
  const {email, password} = req.body;

  try {
    logger.info("Starting admin login process");

    // 1. Input Validation
    if (!email || !password) {
      logger.error("Email and password are required");
      throw new ApiError(400, "Email and password are required");
    }

    if (!isEmailValid(email)) {
      logger.error("Invalid email format");
      throw new ApiError(400, "Invalid email format");
    }

    // 2. Find Admin (include refreshToken)
    const admin = await Admin.findOne({email}).select("+refreshToken");
    if (!admin) {
      logger.error("Admin not found with this email");
      throw new ApiError(404, "Admin not found");
    }

    // 3. Check if account is active
    if (!admin.isActive) {
      logger.error("Admin account is inactive");
      throw new ApiError(403, "Admin account is inactive. Please contact superadmin.");
    }

    // 4. Verify Password
    const isPasswordValid = await admin.comparePassword(password);
    if (!isPasswordValid) {
      logger.error("Invalid credentials");
      throw new ApiError(401, "Invalid credentials");
    }

    // 5. Generate Tokens
    const accessToken = admin.generateAccessToken();
    const refreshToken = admin.generateRefreshToken();

    // 6. Save refresh token to database
    admin.refreshToken = refreshToken;
    admin.lastLogin = new Date();
    admin.loginIP = req.ip;
    await admin.save({validateBeforeSave: false});

    // 7. Prepare response (exclude sensitive data)
    const loggedInAdmin = await Admin.findById(admin._id).select("-password -refreshToken");

    // 8. Set cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production"
        ? "none"
        : "lax"
    };

    res.status(200).cookie("adminAccessToken", accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000 // 15 minutes
    }).cookie("adminRefreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }).json(new ApiResponse(200, {
      admin: loggedInAdmin,
      accessToken,
      refreshToken
    }, "Admin logged in successfully"));

    logger.info(`Admin ${email} logged in successfully`);
  } catch (error) {
    logger.error(`Error in loginAdmin: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// Refresh token controller
const refreshAdminToken = asyncHandler(async (req, res) => {
  try {
    const incomingRefreshToken = req.cookies
      ?.adminRefreshToken || req.body
        ?.refreshToken;

    if (!incomingRefreshToken) {
      throw new ApiError(401, "Unauthorized request - No refresh token");
    }

    // Verify the refresh token
    const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

    // Find admin with refresh token
    const admin = await Admin.findById(decodedToken._id).select("+refreshToken");
    if (!admin) {
      throw new ApiError(401, "Invalid refresh token");
    }

    // Verify token matches stored token
    if (incomingRefreshToken !== admin.refreshToken) {
      throw new ApiError(401, "Refresh token is expired or used");
    }

    // Generate new tokens
    const newAccessToken = admin.generateAccessToken();
    const newRefreshToken = admin.generateRefreshToken();

    // Update refresh token in database
    admin.refreshToken = newRefreshToken;
    await admin.save({validateBeforeSave: false});

    // Set cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production"
        ? "none"
        : "lax"
    };

    res.status(200).cookie("adminAccessToken", newAccessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000 // 15 minutes
    }).cookie("adminRefreshToken", newRefreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }).json(new ApiResponse(200, {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    }, "Access token refreshed"));
  } catch (error) {
    throw new ApiError(
      401, error
      ?.message || "Invalid refresh token");
  }
});

// Admin Logout Controller
const logoutAdmin = asyncHandler(async (req, res) => {
  try {
    logger.info("Starting admin logout process");

    // Find admin and clear refresh token
    await Admin.findByIdAndUpdate(req.admin._id, {
      $unset: {
        refreshToken: 1
      }
    }, {new: true});

    // Clear the cookies
    res.clearCookie("adminAccessToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production"
        ? "none"
        : "lax"
    });

    res.clearCookie("adminRefreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production"
        ? "none"
        : "lax"
    });

    res.status(200).json(new ApiResponse(200, {}, "Admin logged out successfully"));
    logger.info(`Admin ${req.admin.email} logged out successfully`);
  } catch (error) {
    logger.error(`Error in logoutAdmin: ${error.message}`, {stack: error.stack});
    throw new ApiError(500, "Failed to logout admin");
  }
});

const deleteAdmin = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger.info("Starting deleteAdmin process");

    const {adminId} = req.params;

    // 1. Authorization Check
    if (req.admin.role !== "superadmin") {
      logger.error("Unauthorized: Only superadmin can delete admin accounts");
      throw new ApiError(403, "Unauthorized: Only superadmin can delete admin accounts");
    }

    // 2. Validate admin ID
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      logger.error("Invalid admin ID");
      throw new ApiError(400, "Invalid admin ID");
    }

    // 3. Prevent self-deletion
    if (adminId === req.admin._id.toString()) {
      logger.error("Superadmin cannot delete themselves");
      throw new ApiError(400, "Superadmin cannot delete themselves");
    }

    // 4. Find and delete admin
    const adminToDelete = await Admin.findByIdAndDelete(adminId).session(session);

    if (!adminToDelete) {
      logger.error("Admin not found");
      throw new ApiError(404, "Admin not found");
    }

    // 5. Commit transaction
    await session.commitTransaction();
    logger.info(`Admin ${adminToDelete.email} deleted successfully`);

    res.status(200).json(new ApiResponse(200, {}, "Admin account deleted successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in deleteAdmin: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) {
      throw error;
    }
    if (error.name === "CastError") {
      throw new ApiError(400, "Invalid admin ID");
    }
    throw new ApiError(500, error.message || "Failed to delete admin account");
  } finally {
    session.endSession();
  }
});

// Change Password Controller (for logged-in admins)
const changePassword = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger.info("Starting changePassword process");

    const {currentPassword, newPassword} = req.body;

    // 1. Input Validation
    if (!currentPassword || !newPassword) {
      logger.error("Current and new passwords are required");
      throw new ApiError(400, "Current and new passwords are required");
    }

    if (!isPasswordStrong(newPassword)) {
      logger.error("New password does not meet strength requirements");
      throw new ApiError(400, "Password must be at least 8 characters with uppercase, lowercase, number, and special character");
    }

    // 2. Get admin from request (added by auth middleware)
    const admin = await Admin.findById(req.admin._id).select("+password").session(session);
    if (!admin) {
      logger.error("Admin not found");
      throw new ApiError(404, "Admin not found");
    }

    // 3. Verify current password
    const isPasswordValid = await admin.comparePassword(currentPassword);
    if (!isPasswordValid) {
      logger.error("Current password is incorrect");
      throw new ApiError(401, "Current password is incorrect");
    }

    // 4. Check if new password is different
    if (currentPassword === newPassword) {
      logger.error("New password must be different from current password");
      throw new ApiError(400, "New password must be different from current password");
    }

    // 5. Update password
    admin.password = newPassword;
    await admin.save({session});

    // 6. Invalidate all sessions by clearing refresh token
    admin.refreshToken = undefined;
    await admin.save({session});

    await session.commitTransaction();
    logger.info(`Password changed successfully for admin ${admin.email}`);

    res.status(200).json(new ApiResponse(200, {}, "Password changed successfully. Please login again."));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in changePassword: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, error.message || "Failed to change password");
  } finally {
    session.endSession();
  }
});

// Get current admin
const getCurrentAdmin = asyncHandler(async (req, res) => {
  const admin = req.admin;
  if (!admin) {
    throw new ApiError(404, "Admin not found");
  }

  res.status(200).json(new ApiResponse(200, admin, "Current admin retrieved"));
});

// Request Password Reset Controller
const requestPasswordReset = asyncHandler(async (req, res) => {
  try {
    logger.info("Starting requestPasswordReset process");

    const {email} = req.body;

    // 1. Input Validation
    if (!email) {
      logger.error("Email is required");
      throw new ApiError(400, "Email is required");
    }

    if (!isEmailValid(email)) {
      logger.error("Invalid email format");
      throw new ApiError(400, "Invalid email format");
    }

    // Verify reset token secret is configured
    if (!process.env.RESET_TOKEN_SECRET) {
      logger.error("Reset token secret not configured");
      throw new ApiError(500, "Server configuration error");
    }

    // 2. Find admin
    const admin = await Admin.findOne({email});
    if (!admin) {
      logger.info("Admin not found with this email - returning generic response");
      return res.status(200).json(new ApiResponse(200, {}, "If an account exists with this email, a reset link has been sent"));
    }

    // 3. Generate reset token (expires in 1 hour)
    const resetToken = jwt.sign({
      _id: admin._id
    }, process.env.RESET_TOKEN_SECRET, {expiresIn: "1h"});

    // 4. Save reset token to admin document
    admin.resetToken = resetToken;
    admin.resetTokenExpires = Date.now() + 3600000; // 1 hour from now
    await admin.save();

    // 5. Send email with reset link
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    // In production, implement actual email sending here
    logger.info(`Password reset link generated for ${email}: ${resetLink}`);

    // 6. Return success response
    return res.status(200).json(new ApiResponse(200, {}, "If an account exists with this email, a reset link has been sent"));
  } catch (error) {
    logger.error(`Error in requestPasswordReset: ${error.message}`, {stack: error.stack});

    if (error instanceof jwt.JsonWebTokenError) {
      throw new ApiError(500, "Token generation error");
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, error.message || "Failed to process password reset request");
  }
});

// Reset Password Controller
const resetPassword = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger.info("Starting resetPassword process");

    const {token, newPassword} = req.body;

    // 1. Input Validation
    if (!token || !newPassword) {
      logger.error("Reset token and new password are required");
      throw new ApiError(400, "Reset token and new password are required");
    }

    if (!isPasswordStrong(newPassword)) {
      logger.error("New password does not meet strength requirements");
      throw new ApiError(400, "Password must be at least 8 characters with uppercase, lowercase, number, and special character");
    }

    // 2. Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.RESET_TOKEN_SECRET);
    } catch (tokenError) {
      logger.error("Invalid or expired reset token");
      throw new ApiError(401, "Invalid or expired reset token");
    }

    // 3. Find admin with matching reset token
    const admin = await Admin.findOne({
      _id: decoded._id,
      resetToken: token,
      resetTokenExpires: {
        $gt: Date.now()
      }
    }).select("+password").session(session);

    if (!admin) {
      logger.error("Invalid or expired reset token");
      throw new ApiError(401, "Invalid or expired reset token");
    }

    // 4. Check if new password is same as current password
    const isSamePassword = await admin.comparePassword(newPassword);
    if (isSamePassword) {
      logger.error("New password cannot be the same as current password");
      throw new ApiError(400, "New password cannot be the same as your current password");
    }

    // 5. Update password and clear reset token
    admin.password = newPassword;
    admin.resetToken = undefined;
    admin.resetTokenExpires = undefined;
    admin.refreshToken = undefined; // Invalidate all sessions
    await admin.save({session});

    await session.commitTransaction();
    logger.info(`Password reset successfully for admin ${admin.email}`);

    res.status(200).json(new ApiResponse(200, {}, "Password reset successfully. Please login with your new password."));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in resetPassword: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, error.message || "Failed to reset password");
  } finally {
    session.endSession();
  }
});

export {
  createSuperadmin,
  createAdmin,
  loginAdmin,
  refreshAdminToken,
  logoutAdmin,
  deleteAdmin,
  changePassword,
  requestPasswordReset,
  resetPassword,
  getCurrentAdmin
};
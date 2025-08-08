import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import User from "../models/users.models.js";
import jwt from "jsonwebtoken";
import {sendVerificationEmail, sendPasswordResetEmail} from "../utils/emailService.js";
import {isPasswordStrong, isEmailValid, isPhoneValid, areRequiredFieldsProvided, isStringEmpty} from "../utils/validator.js";
import mongoose from "mongoose";
import {uploadOnCloudinary, deleteFromCloudinary} from "../utils/cloudinary.js";
import logger from "../utils/logger.js";
import {sendVerificationSMS, generateVerificationCode, sendWhatsAppVerification, sendWhatsAppMessage} from "../utils/twilioService.js";
import {v4 as uuidv4} from "uuid";
// Generate access and refresh tokens
const generateAccessAndRefreshToken = async userId => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();
    user.refreshToken = refreshToken;
    await user.save({validateBeforeSave: false});
    logger.info(`Tokens generated successfully for user ${userId}`);
    return {accessToken, refreshToken};
  } catch (error) {
    logger.error(`Error in generateAccessAndRefreshToken: ${error.message}`, {stack: error.stack});
    throw new ApiError(500, "Failed to generate access and refresh tokens");
  }
};

// Normal User Registration
const registerUser = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger.info("Starting normal user registration process");

    const {fullName, email, password, phone, dob} = req.body;

    // Validate input fields
    if (!areRequiredFieldsProvided([fullName, email, password, phone])) {
      logger.error("Missing required fields");
      throw new ApiError(400, "Please provide all required fields: fullName, email, password, phone");
    }

    // Validate email format
    if (!isEmailValid(email)) {
      logger.error("Invalid email format");
      throw new ApiError(400, "Invalid email format");
    }

    // Validate phone number
    if (!isPhoneValid(phone)) {
      logger.error("Invalid phone number");
      throw new ApiError(400, "Invalid phone number");
    }

    // Validate password strength
    if (!isPasswordStrong(password)) {
      logger.error("Password is too weak");
      throw new ApiError(400, "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character.");
    }

    // Validate date of birth if provided
    if (dob) {
      const dobDate = new Date(dob);
      const minAgeDate = new Date();
      minAgeDate.setFullYear(minAgeDate.getFullYear() - 13);

      if (dobDate > minAgeDate) {
        logger.error("User under minimum age requirement");
        throw new ApiError(400, "You must be at least 13 years old to register");
      }
    }

    // Check if user email already exists
    const existingUser = await User.findOne({email}).session(session);
    if (existingUser) {
      logger.error("Email already exists");
      throw new ApiError(409, "Email already exists. Please log in or use a different email");
    }

    // Check if phone number already exists
    const existingPhoneNo = await User.findOne({phone}).session(session);
    if (existingPhoneNo) {
      logger.error("Phone number already exists");
      throw new ApiError(409, "Phone number already exists. Please use a different phone number");
    }

    // Create new user
    const user = await User.create([
      {
        fullName,
        email,
        password,
        phone,
        dob: dob
          ? new Date(dob)
          : undefined,
        role: "customer"
      }
    ], {session});

    // Generate verification token
    const verificationToken = user[0].generateAccessToken();
    user[0].verificationToken = verificationToken;
    await user[0].save({validateBeforeSave: false, session});

    // Send verification email
    await sendVerificationEmail(email, verificationToken);
    logger.info(`Verification email sent to ${email}`);

    // Commit transaction
    await session.commitTransaction();
    logger.info("User registration transaction committed successfully");

    // Get created user without sensitive fields
    const createdUser = await User.findById(user[0]._id).select("-password -refreshToken -verificationToken");

    if (!createdUser) {
      logger.error("Failed to create user");
      throw new ApiError(500, "Failed to create user");
    }

    logger.info(`User registered successfully with ID: ${createdUser._id}`);

    return res.status(201).json(new ApiResponse(201, createdUser, "User registered successfully. Please check your email to verify your account."));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in registerUser: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) {
      throw error;
    }
    if (error.name === "ValidationError") {
      throw new ApiError(400, error.message);
    }
    if (error.code === 11000) {
      throw new ApiError(400, "Duplicate field value entered");
    }
    throw new ApiError(500, error.message || "Failed to register user");
  } finally {
    session.endSession();
  }
});

const registerSocialUserByGoogle = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    console.log("Registering Google user with data:", req.body);

    // Extract ALL data from request body
    const {
      provider,
      providerId,
      email,
      name: fullName,
      picture,
      token,
      phone,
      dob
    } = req.body;

    // Validate required fields
    if (!provider || !providerId || !email || !fullName) {
      throw new ApiError(400, "Missing required fields: provider, providerId, email, and name are required");
    }

    // Validate provider is Google
    const normalizedProvider = provider.toLowerCase();
    if (normalizedProvider !== "google") {
      throw new ApiError(400, "Invalid social provider. Only Google is supported");
    }

    // Build query to find existing user
    const query = {
      $or: [
        {
          email
        }, {
          googleId: providerId
        }
      ]
    };

    // Find or create user
    let user = await User.findOne(query).session(session);

    if (user) {
      // Update existing user with new Google login info if needed
      if (!user.googleId) {
        user.googleId = providerId;
        user.isSocialUser = true;
        if (picture) 
          user.picture = picture;
        
        // Update dob if provided (now optional for existing users)
        if (dob) {
          // Age verification (minimum 16 years)
          const birthDate = new Date(dob);
          const today = new Date();
          let age = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();

          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }

          if (age < 16) {
            throw new ApiError(403, "You must be at least 16 years old to register");
          }

          user.dob = birthDate;
        }
        await user.save({session});
      }
    } else {
      // For new users, dob is required
      if (!dob) {
        throw new ApiError(400, "Date of birth is required for registration");
      }

      // Age verification for new users
      const birthDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }

      if (age < 16) {
        throw new ApiError(403, "You must be at least 16 years old to register");
      }

      // Create new social user
      const userData = {
        fullName,
        email,
        googleId: providerId,
        isSocialUser: true,
        isEmailVerified: true,
        status: "active",
        role: "customer",
        dob: birthDate // Required field for new users
      };

      if (picture) 
        userData.picture = picture;
      
      // Use UUID v4 for phone number placeholder
      userData.phone = phone || `Google-${uuidv4()}`;

      user = await User.create([userData], {session});
      user = user[0];
    }

    // Rest of the function remains the same...
    // Generate tokens
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    // Save refresh token to user
    user.refreshToken = refreshToken;
    await user.save({session});

    // Commit transaction
    await session.commitTransaction();

    // Set cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production"
        ? "none"
        : "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    };

    // Remove sensitive fields before sending user data
    const userResponse = user.toObject();
    delete userResponse.refreshToken;
    delete userResponse.__v;
    delete userResponse.password;

    return res.status(200).cookie("accessToken", accessToken, cookieOptions).cookie("refreshToken", refreshToken, cookieOptions).json(new ApiResponse(200, {
      user: userResponse,
      accessToken,
      refreshToken
    }, "Google login successful"));
  } catch (error) {
    await session.abortTransaction();
    console.error("Google registration error:", error);

    // Error handling remains the same...
    if (error.code === 11000) {
      if (error.keyPattern.email) {
        throw new ApiError(409, "User with this email already exists");
      }
      throw new ApiError(409, "Duplicate key error occurred");
    }

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map(err => err.message);
      throw new ApiError(400, `Validation failed: ${errors.join(", ")}`);
    }

    if (error instanceof TypeError && error.message.includes("Invalid date")) {
      throw new ApiError(400, "Invalid date format for date of birth");
    }

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(500, "Google login failed. Please try again later.");
  } finally {
    session.endSession();
  }
});

// Similarly modified Facebook registration function
const registerSocialUserByFacebook = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    console.log("Registering Facebook user with data:", req.body);

    // Extract data from both req.socialUser (from middleware) and req.body (from form)
    const socialData = req.socialUser || {};
    const formData = req.body || {};

    // Combine data with form data taking precedence
    const {
      provider,
      providerId,
      email: socialEmail,
      name: fullName = "Facebook User",
      picture,
      token,
      phone = "",
      dob,
      email: formEmail // From form if user entered it
    } = {
      ...socialData,
      ...formData
    };

    // Validate required fields (dob removed from required fields)
    if (!provider || !providerId || !fullName) {
      throw new ApiError(400, "Missing required fields: provider, providerId, and name are required");
    }

    // Validate provider is Facebook
    const normalizedProvider = provider.toLowerCase();
    if (normalizedProvider !== "facebook") {
      throw new ApiError(400, "Invalid social provider. Only Facebook is supported");
    }

    // Use email in this order: 1) Form email, 2) Facebook email, 3) Generated email
    const userEmail = formEmail || socialEmail || `${providerId}@facebook.none`;

    // Validate email if it came from form
    if (formEmail) {
      const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
      if (!emailRegex.test(formEmail)) {
        throw new ApiError(400, "Please provide a valid email address");
      }
    }

    // Build query to find existing user
    const query = {
      $or: [
        {
          email: userEmail
        }, {
          facebookId: providerId
        }, {
          googleId: providerId
        }
      ]
    };

    // Find or create user
    let user = await User.findOne(query).session(session);

    if (user) {
      // Update existing user with new Facebook login info if needed
      if (!user.facebookId) {
        user.facebookId = providerId;
        user.isSocialUser = true;
        if (picture) 
          user.picture = picture;
        
        // Update name if not already set
        if (fullName && !user.fullName) {
          user.fullName = fullName;
        }

        // Update email if it's better than what we have
        if (socialEmail && !user.email.includes("@facebook.none")) {
          user.email = socialEmail;
          user.isEmailVerified = true;
        }

        // Update dob if provided (now optional)
        if (dob) {
          // Age verification (minimum 16 years)
          const birthDate = new Date(dob);
          const today = new Date();
          let age = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();

          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }

          if (age < 16) {
            throw new ApiError(403, "You must be at least 16 years old to register");
          }

          user.dob = birthDate;
        }
        await user.save({session});
      }
    } else {
      // For new users, dob is required
      if (!dob) {
        throw new ApiError(400, "Date of birth is required for registration");
      }

      // Age verification for new users
      const birthDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }

      if (age < 16) {
        throw new ApiError(403, "You must be at least 16 years old to register");
      }

      // Create new Facebook user
      const userData = {
        fullName,
        email: userEmail,
        facebookId: providerId,
        isSocialUser: true,
        isEmailVerified: !!socialEmail,
        status: "active",
        role: "customer",
        dob: birthDate // Required field for new users
      };

      if (picture) 
        userData.picture = picture;
      
      // Use UUID v4 for phone number placeholder
      userData.phone = phone || `FB-${uuidv4()}`;

      user = await User.create([userData], {session});
      user = user[0];
    }

    // Rest of the function remains the same...
    // Generate tokens
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    // Save refresh token to user
    user.refreshToken = refreshToken;
    await user.save({session});

    // Commit transaction
    await session.commitTransaction();

    // Set cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production"
        ? "none"
        : "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    };

    // Remove sensitive fields before sending user data
    const userResponse = user.toObject();
    delete userResponse.refreshToken;
    delete userResponse.__v;
    delete userResponse.password;

    return res.status(200).cookie("accessToken", accessToken, cookieOptions).cookie("refreshToken", refreshToken, cookieOptions).json(new ApiResponse(200, {
      user: userResponse,
      accessToken,
      refreshToken
    }, "Facebook login successful"));
  } catch (error) {
    await session.abortTransaction();
    console.error("Facebook registration error:", error);

    // Error handling remains the same...
    if (error.code === 11000) {
      if (error.keyPattern.email) {
        throw new ApiError(409, "User with this email already exists");
      }
      if (error.keyPattern.facebookId) {
        throw new ApiError(409, "User with this Facebook ID already exists");
      }
      throw new ApiError(409, "Duplicate key error occurred");
    }

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map(err => err.message);
      throw new ApiError(400, `Validation failed: ${errors.join(", ")}`);
    }

    if (error instanceof TypeError && error.message.includes("Invalid date")) {
      throw new ApiError(400, "Invalid date format for date of birth");
    }

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(500, "Facebook login failed. Please try again later.");
  } finally {
    session.endSession();
  }
});

// Login User
const loginUser = asyncHandler(async (req, res) => {
  try {
    const {email, password} = req.body;

    if (!email || !password) {
      logger.error("Login attempt with missing credentials");
      throw new ApiError(400, "Email and password are required");
    }

    const user = await User.findOne({email});

    if (!user) {
      logger.error(`Login attempt for non-existent email: ${email}`);
      throw new ApiError(404, "User not found");
    }

    if (user.googleId || user.facebookId) {
      logger.error(`Social login attempt for email: ${email}`);
      throw new ApiError(400, "This account is associated with a social login. Please use the appropriate social login method.");
    }

    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      logger.error(`Invalid password attempt for user: ${user._id}`);
      throw new ApiError(401, "Invalid credentials");
    }

    if (user.status === "banned") {
      logger.error(`Banned user attempt to login: ${user._id}`);
      throw new ApiError(403, "Your account has been banned. Please contact support.");
    }

    if (user.status === "inactive") {
      logger.error(`Inactive user attempt to login: ${user._id}`);
      throw new ApiError(403, "Your account is inactive. Please contact support.");
    }

    if (!user.isEmailVerified) {
      logger.error(`Unverified email attempt to login: ${user._id}`);
      throw new ApiError(403, "Please verify your email before logging in");
    }

    const {accessToken, refreshToken} = await generateAccessAndRefreshToken(user._id);

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production"
    };

    logger.info(`User logged in successfully: ${user._id}`);

    return res.status(200).cookie("accessToken", accessToken, options).cookie("refreshToken", refreshToken, options).json(new ApiResponse(200, {
      user: loggedInUser,
      accessToken,
      refreshToken
    }, "User logged in successfully"));
  } catch (error) {
    logger.error(`Error in loginUser: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// Login social User by google and

const loginSocialUser = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    console.log("🔐 Social login initiated");

    const {provider, providerId} = req.socialUser;
    console.log("👤 Provider:", provider);
    console.log("🆔 Provider ID:", providerId);

    // Build query
    const query = {};
    if (provider === "google") 
      query.googleId = providerId;
    if (provider === "facebook") 
      query.facebookId = providerId;
    
    console.log("🔍 Querying user with:", query);

    const user = await User.findOne(query).session(session);

    if (!user) {
      console.log("❌ User not found in DB");
      throw new ApiError(404, `No account found with this ${provider} login. Please register first.`);
    }

    console.log("✅ User found:", user.email);

    // Generate tokens
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    // Save refresh token
    user.refreshToken = refreshToken;
    await user.save({session});

    await session.commitTransaction();

    // Prepare cookie options
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production"
        ? "none"
        : "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000
    };

    const userResponse = user.toObject();
    delete userResponse.refreshToken;
    delete userResponse.__v;
    delete userResponse.password;

    console.log("✅ Login successful for:", user.email);

    return res.status(200).cookie("accessToken", accessToken, cookieOptions).cookie("refreshToken", refreshToken, cookieOptions).json(new ApiResponse(200, {
      user: userResponse,
      accessToken,
      refreshToken
    }, `${provider} login successful`));
  } catch (error) {
    await session.abortTransaction();
    console.error("🔥 Social login failed:", error); // 👈 Catch and log any error
    return res.status(500).json({message: "Social login error", error: error.message});
  } finally {
    session.endSession();
    console.log("🧹 Session ended");
  }
});

// Logout User
const logoutUser = asyncHandler(async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $unset: {
        refreshToken: 1
      }
    }, {new: true});

    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production"
    };

    logger.info(`User logged out successfully: ${req.user._id}`);

    return res.status(200).clearCookie("accessToken", options).clearCookie("refreshToken", options).json(new ApiResponse(200, {}, "User logged out successfully"));
  } catch (error) {
    logger.error(`Error in logoutUser: ${error.message}`, {stack: error.stack});
    throw new ApiError(500, "Failed to logout user");
  }
});

// Refresh Access Token
const refreshAccessToken = asyncHandler(async (req, res) => {
  try {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken) {
      logger.error("Refresh token missing");
      throw new ApiError(401, "Unauthorized request");
    }

    const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

    const user = await User.findById(decodedToken._id);

    if (!user) {
      logger.error("Invalid refresh token - user not found");
      throw new ApiError(401, "Invalid refresh token");
    }

    if (incomingRefreshToken !== user.refreshToken) {
      logger.error("Refresh token mismatch");
      throw new ApiError(401, "Refresh token is expired or used");
    }

    const {accessToken, refreshToken: newRefreshToken} = await generateAccessAndRefreshToken(user._id);

    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production"
    };

    logger.info(`Access token refreshed for user: ${user._id}`);

    return res.status(200).cookie("accessToken", accessToken, options).cookie("refreshToken", newRefreshToken, options).json(new ApiResponse(200, {
      accessToken,
      refreshToken: newRefreshToken
    }, "Access token refreshed"));
  } catch (error) {
    logger.error(`Error in refreshAccessToken: ${error.message}`, {stack: error.stack});
    throw new ApiError(
      401, error
      ?.message || "Invalid refresh token");
  }
});

// Verify Email
const verifyEmail = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {token} = req.params;

    if (!token) {
      logger.error("Email verification token missing");
      throw new ApiError(400, "Verification token is required");
    }

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    const user = await User.findOne({_id: decoded._id, verificationToken: token}).session(session);

    if (!user) {
      logger.error("Invalid verification token or user not found");
      throw new ApiError(404, "Invalid verification token or user not found");
    }

    if (user.isEmailVerified) {
      await session.commitTransaction();
      logger.info(`Email already verified for user: ${user._id}`);
      return res.status(200).json(new ApiResponse(200, {}, "Email already verified"));
    }

    user.isEmailVerified = true;
    user.verificationToken = undefined;
    await user.save({session});

    await session.commitTransaction();
    logger.info(`Email verified successfully for user: ${user._id}`);

    return res.status(200).json(new ApiResponse(200, {}, "Email verified successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in verifyEmail: ${error.message}`, {stack: error.stack});

    if (error instanceof jwt.JsonWebTokenError) {
      throw new ApiError(401, "Invalid or expired verification token");
    }
    throw error;
  } finally {
    session.endSession();
  }
});

// Resend Verification Email
const resendVerificationEmail = asyncHandler(async (req, res) => {
  try {
    const {email} = req.body;

    if (!email) {
      logger.error("Resend verification email attempt with no email");
      throw new ApiError(400, "Email is required");
    }

    const user = await User.findOne({email});

    if (!user) {
      logger.error(`Resend verification attempt for non-existent email: ${email}`);
      throw new ApiError(404, "User not found");
    }

    if (user.isEmailVerified) {
      logger.info(`Email already verified for user: ${user._id}`);
      return res.status(200).json(new ApiResponse(200, {}, "Email is already verified"));
    }

    const verificationToken = user.generateAccessToken();
    user.verificationToken = verificationToken;
    await user.save({validateBeforeSave: false});

    await sendVerificationEmail(email, verificationToken);
    logger.info(`Verification email resent to: ${email}`);

    return res.status(200).json(new ApiResponse(200, {}, "Verification email sent successfully"));
  } catch (error) {
    logger.error(`Error in resendVerificationEmail: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// Forgot Password
const forgotPassword = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {email} = req.body;

    if (!email) {
      logger.error("Forgot password attempt with no email");
      throw new ApiError(400, "Email is required");
    }

    const user = await User.findOne({email}).session(session);

    if (!user) {
      logger.error(`Password reset attempt for non-existent email: ${email}`);
      throw new ApiError(404, "User not found");
    }

    const resetToken = user.generateAccessToken();
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save({session});

    await sendPasswordResetEmail(email, resetToken);
    logger.info(`Password reset email sent to: ${email}`);

    await session.commitTransaction();
    logger.info("Forgot password transaction committed successfully");

    return res.status(200).json(new ApiResponse(200, {}, "Password reset email sent successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in forgotPassword: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// Reset Password
const resetPassword = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {token} = req.params;
    const {password} = req.body;

    if (!token) {
      logger.error("Password reset attempt with no token");
      throw new ApiError(400, "Reset token is required");
    }

    if (!password) {
      logger.error("Password reset attempt with no new password");
      throw new ApiError(400, "Password is required");
    }

    if (!isPasswordStrong(password)) {
      logger.error("Weak password attempt during reset");
      throw new ApiError(400, "Password is too weak");
    }

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    const user = await User.findOne({
      _id: decoded._id,
      resetPasswordToken: token,
      resetPasswordExpires: {
        $gt: Date.now()
      }
    }).session(session);

    if (!user) {
      logger.error("Invalid or expired reset token");
      throw new ApiError(400, "Invalid or expired reset token");
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({session});

    await session.commitTransaction();
    logger.info(`Password reset successfully for user: ${user._id}`);

    return res.status(200).json(new ApiResponse(200, {}, "Password reset successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in resetPassword: ${error.message}`, {stack: error.stack});

    if (error instanceof jwt.JsonWebTokenError) {
      throw new ApiError(401, "Invalid or expired reset token");
    }
    throw error;
  } finally {
    session.endSession();
  }
});

// Get Current User
const getCurrentUser = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password -refreshToken");

    if (!user) {
      logger.error(`Current user not found: ${req.user._id}`);
      throw new ApiError(404, "User not found");
    }

    logger.info(`Current user fetched successfully: ${user._id}`);
    return res.status(200).json(new ApiResponse(200, user, "Current user fetched successfully"));
  } catch (error) {
    logger.error(`Error in getCurrentUser: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// Update Account Details
const updateAccountDetails = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {fullName, email, phone, dob} = req.body;

    if (!fullName && !email && !phone && !dob) {
      logger.error("Update attempt with no fields to update");
      throw new ApiError(400, "At least one field is required to update");
    }

    const updateFields = {};

    if (fullName) {
      if (isStringEmpty(fullName)) {
        logger.error("Empty full name update attempt");
        throw new ApiError(400, "Full name cannot be empty");
      }
      updateFields.fullName = fullName;
    }

    if (email) {
      if (!isEmailValid(email)) {
        logger.error("Invalid email format during update");
        throw new ApiError(400, "Invalid email format");
      }

      const existingEmail = await User.findOne({
        email,
        _id: {
          $ne: req.user._id
        }
      }).session(session);
      if (existingEmail) {
        logger.error("Email already in use during update");
        throw new ApiError(409, "Email is already in use");
      }

      updateFields.email = email;
      updateFields.isEmailVerified = false;
    }

    if (phone) {
      if (!isPhoneValid(phone)) {
        logger.error("Invalid phone format during update");
        throw new ApiError(400, "Invalid phone number");
      }

      const existingPhone = await User.findOne({
        phone,
        _id: {
          $ne: req.user._id
        }
      }).session(session);
      if (existingPhone) {
        logger.error("Phone already in use during update");
        throw new ApiError(409, "Phone number is already in use");
      }

      updateFields.phone = phone;
      updateFields.isPhoneVerified = false;
    }

    if (dob) {
      const dobDate = new Date(dob);
      const minAgeDate = new Date();
      minAgeDate.setFullYear(minAgeDate.getFullYear() - 13);

      if (dobDate > minAgeDate) {
        logger.error("Invalid DOB update - under 13 years");
        throw new ApiError(400, "You must be at least 13 years old");
      }

      updateFields.dob = dobDate;
    }

    const user = await User.findByIdAndUpdate(req.user._id, updateFields, {
      new: true,
      session
    }).select("-password -refreshToken");

    if (!user) {
      logger.error(`User not found during update: ${req.user._id}`);
      throw new ApiError(404, "User not found");
    }

    // If email was changed, send verification email
    if (email && email !== user.email) {
      const verificationToken = user.generateAccessToken();
      user.verificationToken = verificationToken;
      await user.save({session});
      await sendVerificationEmail(email, verificationToken);
      logger.info(`Verification email sent for updated email: ${email}`);
    }

    await session.commitTransaction();
    logger.info(`Account details updated successfully for user: ${user._id}`);

    return res.status(200).json(new ApiResponse(200, user, "Account details updated successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateAccountDetails: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// Update User Password
const updatePassword = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {currentPassword, newPassword} = req.body;

    if (!currentPassword || !newPassword) {
      logger.error("Password update attempt with missing fields");
      throw new ApiError(400, "Current password and new password are required");
    }

    if (!isPasswordStrong(newPassword)) {
      logger.error("Weak password attempt during update");
      throw new ApiError(400, "New password is too weak");
    }

    const user = await User.findById(req.user._id).session(session);

    if (!user) {
      logger.error(`User not found during password update: ${req.user._id}`);
      throw new ApiError(404, "User not found");
    }

    const isPasswordValid = await user.comparePassword(currentPassword);

    if (!isPasswordValid) {
      logger.error("Incorrect current password during update");
      throw new ApiError(401, "Current password is incorrect");
    }

    user.password = newPassword;
    await user.save({session});

    await session.commitTransaction();
    logger.info(`Password updated successfully for user: ${user._id}`);

    return res.status(200).json(new ApiResponse(200, {}, "Password updated successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updatePassword: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// Update Profile Image
const updateProfileImage = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const profileImageLocalPath = req.file
      ?.path;

    if (!profileImageLocalPath) {
      logger.error("Profile image update attempt with no file");
      throw new ApiError(400, "Profile image file is required");
    }

    const user = await User.findById(req.user._id).session(session);

    if (!user) {
      logger.error(`User not found during profile image update: ${req.user._id}`);
      throw new ApiError(404, "User not found");
    }

    // Delete old image if it's not the default
    if (user.profileImage && user.profileImage !== "default-profile.png") {
      await deleteFromCloudinary(user.profileImage);
      logger.info(`Old profile image deleted for user: ${user._id}`);
    }

    const profileImage = await uploadOnCloudinary(profileImageLocalPath);

    if (!profileImage.url) {
      logger.error("Failed to upload profile image to Cloudinary");
      throw new ApiError(400, "Failed to upload profile image");
    }

    user.profileImage = profileImage.url;
    await user.save({session});

    await session.commitTransaction();
    logger.info(`Profile image updated successfully for user: ${user._id}`);

    return res.status(200).json(new ApiResponse(200, user, "Profile image updated successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateProfileImage: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// Delete Profile Image
const deleteProfileImage = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(req.user._id).session(session);

    if (!user) {
      logger.error(`User not found during profile image deletion: ${req.user._id}`);
      throw new ApiError(404, "User not found");
    }

    if (!user.profileImage || user.profileImage === "default-profile.png") {
      logger.error(`No profile image to delete for user: ${user._id}`);
      throw new ApiError(400, "No profile image to delete");
    }

    await deleteFromCloudinary(user.profileImage);
    logger.info(`Profile image deleted from Cloudinary for user: ${user._id}`);

    user.profileImage = "default-profile.png";
    await user.save({session});

    await session.commitTransaction();
    logger.info(`Profile image reset to default for user: ${user._id}`);

    return res.status(200).json(new ApiResponse(200, user, "Profile image deleted successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in deleteProfileImage: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// Delete User Account
const deleteUserAccount = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {password} = req.body;

    if (!password) {
      logger.error("Account deletion attempt with no password");
      throw new ApiError(400, "Password is required for account deletion");
    }

    const user = await User.findById(req.user._id).session(session);

    if (!user) {
      logger.error(`User not found during account deletion: ${req.user._id}`);
      throw new ApiError(404, "User not found");
    }

    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      logger.error("Incorrect password during account deletion");
      throw new ApiError(401, "Password is incorrect");
    }

    // Delete profile image if it's not the default
    if (user.profileImage && user.profileImage !== "default-profile.png") {
      await deleteFromCloudinary(user.profileImage);
      logger.info(`Profile image deleted during account deletion: ${user._id}`);
    }

    await User.findByIdAndDelete(req.user._id, {session});

    await session.commitTransaction();
    logger.info(`Account deleted successfully: ${req.user._id}`);

    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production"
    };

    return res.status(200).clearCookie("accessToken", options).clearCookie("refreshToken", options).json(new ApiResponse(200, {}, "Account deleted successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in deleteUserAccount: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

export {
  registerUser,
  registerSocialUserByGoogle,
  registerSocialUserByFacebook,
  loginUser,
  loginSocialUser,
  logoutUser,
  refreshAccessToken,
  verifyEmail,
  resendVerificationEmail,
  forgotPassword,
  resetPassword,
  getCurrentUser,
  updateAccountDetails,
  updatePassword,
  updateProfileImage,
  deleteProfileImage,
  deleteUserAccount
};
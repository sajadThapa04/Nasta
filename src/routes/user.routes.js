import Router from "express";
import {
  registerUser,
  registerSocialUserByGoogle,
  registerSocialUserByFacebook,
  loginUser,
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
} from "../controllers/users.controller.js";
import {upload} from "../middlewares/multer.middlewares.js";
import {verifyJwt} from "../middlewares/userAuth.middlewares.js";
import {authRateLimiter, strictAuthRateLimiter} from "../middlewares/ratelimit.middlewares.js";
import {verifyFacebookToken} from "../middlewares/facebookAuth.middlewares.js";
import {verifyGoogleToken} from "../middlewares/googleAuth.middleware.js";
const router = Router();

// Public routes
router.route("/register").post(authRateLimiter, registerUser); // Normal registration
// router.route("/register/social").post(authRateLimiter, registerSocialUser); Social registration
router.route("/register/social/google").post(authRateLimiter, verifyGoogleToken, registerSocialUserByGoogle); // Social registration
router.route("/register/social/facebook").post(authRateLimiter, verifyFacebookToken, registerSocialUserByFacebook); // Social registration
router.route("/login").post(authRateLimiter, loginUser); // Login user
router.route("/verify-email/:token").get(authRateLimiter, verifyEmail); // Verify email with token
router.route("/resend-verification").post(strictAuthRateLimiter, resendVerificationEmail); // Resend verification email
router.route("/forgot-password").post(strictAuthRateLimiter, forgotPassword); // Request password reset
router.route("/reset-password/:token").post(strictAuthRateLimiter, resetPassword); // Reset password with token

// Protected routes (require JWT authentication)
router.route("/logout").post(verifyJwt, logoutUser); // Logout user
router.route("/refresh-token").post(authRateLimiter, refreshAccessToken); // Refresh access token

// User profile routes
router.route("/me").get(verifyJwt, getCurrentUser); // Get current user
router.route("/update-details").patch(verifyJwt, updateAccountDetails); // Update user details
router.route("/change-password").post(verifyJwt, updatePassword); // Change password

// Profile image routes
router.route("/upload-profile-image").patch(verifyJwt, upload.single("profileImage"), // Using multer middleware for single file upload
    updateProfileImage);
router.route("/delete-profile-image").delete(verifyJwt, deleteProfileImage); // Delete profile image

// Account management
router.route("/delete-account").delete(verifyJwt, deleteUserAccount); // Delete user account

export default router;
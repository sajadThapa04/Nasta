import {Router} from "express";
import {
  registerDriver,
  loginDriver,
  logoutDriver,
  refreshAccessToken,
  getCurrentDriver,
  updateDriverProfile,
  updateDriverPassword,
  updateDriverLocation,
  updateDriverStatus,
  deleteDriverAccount,
  uploadDriverDocument,
  deleteDriverDocument
} from "../controllers/deliveryDriver.controller.js";
import {upload} from "../middlewares/multer.middlewares.js";
import {verifyDriverJwt} from "../middlewares/deliveryDriver.auth.middlewares.js";
import { verifyAdminJwt } from "../middlewares/admin.auth.middlewares.js";
import {authRateLimiter, strictAuthRateLimiter} from "../middlewares/ratelimit.middlewares.js";

const router = Router();

// Public routes (no authentication required)
router.route("/register").post(authRateLimiter, registerDriver); // Driver registration
router.route("/login").post(authRateLimiter, loginDriver); // Driver login

// Token management
router.route("/refresh-token").post(authRateLimiter, refreshAccessToken); // Refresh access token

// Protected routes (require driver JWT authentication)
router.use(verifyDriverJwt);

router.route("/logout").post(logoutDriver); // Driver logout
router.route("/me").get(getCurrentDriver); // Get current driver profile

// Profile management
// router.route("/update-profile").patch(updateDriverProfile); // Update driver profile
router.route("/change-password").post(updateDriverPassword); // Change password

// Location and status
router.route("/update-location").patch(updateDriverLocation); // Update driver's current location
router.route("/update-status").patch(updateDriverStatus); // Update driver availability/on-duty status

// Document management
router.route("/upload-document").post(upload.single("document"), // Using multer middleware for single file upload
    uploadDriverDocument);
router.route("/delete-document/:documentType").delete(deleteDriverDocument); // Delete driver document

// Account management
router.route("/delete-account").delete(deleteDriverAccount); // Delete driver account

export default router;
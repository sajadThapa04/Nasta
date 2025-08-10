import {Router} from "express";
import {
  createBusinessOwner,
  getAllBusinessOwners,
  getBusinessOwnerById,
  getBusinessOwnerBySlug,
  updateBusinessOwner,
  updateBusinessOwnerStatus,
  verifyBusinessOwner,
  featureBusinessOwner,
  deleteBusinessOwner,
  getNearbyBusinessOwners,
  uploadBusinessDocument,
  deleteBusinessDocument,
  uploadBusinessLogo,
  deleteBusinessLogo,
  uploadBusinessCoverPhoto,
  deleteBusinessCoverPhoto
} from "../controllers/businessOwner.controller.js";
import {upload} from "../middlewares/multer.middlewares.js";
import {verifyAdminJwt} from "../middlewares/admin.auth.middlewares.js";
import {authRateLimiter} from "../middlewares/ratelimit.middlewares.js";

const router = Router();

router.use(verifyAdminJwt);

// Public routes (no authentication required)
router.route("/").get(getAllBusinessOwners). // Get all business owners with pagination and filtering
post(authRateLimiter, createBusinessOwner); // Create new business owner (admin only)

router.route("/nearby").get(getNearbyBusinessOwners); // Get nearby business owners

router.route("/:id").get(getBusinessOwnerById). // Get business by ID
put(authRateLimiter, updateBusinessOwner). // Update business details (admin only)
delete(authRateLimiter, deleteBusinessOwner); // Delete business (admin only)

router.route("/slug/:slug").get(getBusinessOwnerBySlug); // Get business by slug

// Business status management routes (admin only)
router.route("/:id/status").patch(authRateLimiter, updateBusinessOwnerStatus); // Update business status

router.route("/:id/verify").patch(authRateLimiter, verifyBusinessOwner); // Verify business

router.route("/:id/feature").patch(authRateLimiter, featureBusinessOwner); // Feature business

// Document management routes (admin only)
router.route("/:id/documents").post(authRateLimiter, upload.single("document"), uploadBusinessDocument); // Upload business document

router.route("/:id/documents/:documentType").delete(authRateLimiter, deleteBusinessDocument); // Delete business document

// Logo management routes (admin only)
router.route("/:id/logo").post(authRateLimiter, upload.single("logo"), uploadBusinessLogo). // Upload business logo
delete(authRateLimiter, deleteBusinessLogo); // Delete business logo

// Cover photo management routes (admin only)
router.route("/:id/cover-photo").post(authRateLimiter, upload.single("coverPhoto"), uploadBusinessCoverPhoto). // Upload business cover photo
delete(authRateLimiter, deleteBusinessCoverPhoto); // Delete business cover photo

export default router;
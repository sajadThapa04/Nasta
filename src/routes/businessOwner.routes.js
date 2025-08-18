import {Router} from "express";
import {
  createBusiness,
  getUserBusinesses,
  getBusinessById,
  updateBusiness,
  uploadBusinessDocument,
  uploadBusinessLogo,
  uploadBusinessCoverPhoto,
  getNearbyBusinesses,
  getBusinessBySlug
} from "../controllers/business.controller.js";
import {upload} from "../middlewares/multer.middlewares.js";
import {verifyJwt} from "../middlewares/userAuth.middlewares.js";
import {authRateLimiter} from "../middlewares/ratelimit.middlewares.js";

const router = Router();

// Public routes
router.route("/nearby").get(getNearbyBusinesses); // Get nearby businesses
router.route("/slug/:slug").get(getBusinessBySlug); // Get business by slug

// Protected routes (require authentication)
router.use(verifyJwt);

// Business management routes
router.route("/").post(authRateLimiter, createBusiness). // Create new business
get(authRateLimiter, getUserBusinesses); // Get user's businesses

router.route("/:id").get(authRateLimiter, getBusinessById). // Get business by ID
put(authRateLimiter, updateBusiness); // Update business details

// Document management routes
router.route("/:id/documents").post(authRateLimiter, upload.single("document"), uploadBusinessDocument); // Upload business document

// Logo management routes
router.route("/:id/logo").post(authRateLimiter, upload.single("logo"), uploadBusinessLogo); // Upload business logo

// Cover photo management routes
router.route("/:id/cover-photo").post(authRateLimiter, upload.single("coverPhoto"), uploadBusinessCoverPhoto); // Upload business cover photo

export default router;
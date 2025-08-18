import {Router} from "express";
import {
  getAllBusinessOwners,
  getBusinessOwnerById,
  updateBusinessOwnerStatus,
  verifyBusinessOwner,
  featureBusinessOwner,
  getAllFoodVenues,
  deleteBusinessOwner
} from "../controllers/AdminbusinessOwner.controller.js";
import {verifyAdminJwt} from "../middlewares/admin.auth.middlewares.js";
import {authRateLimiter} from "../middlewares/ratelimit.middlewares.js";

const router = Router();

router.use(verifyAdminJwt);

// Business listing and viewing routes (admin only)
router.route("/").get(getAllBusinessOwners); // Get all business owners with pagination and filtering
router.route("/getAllFoodVenue").get(getAllFoodVenues); // Get all food venues with pagination and filtering

router.route("/:id").get(getBusinessOwnerById). // Get business by ID
delete(authRateLimiter, deleteBusinessOwner); // Delete business (admin only)

// Business management routes (admin only)
router.route("/:id/status").patch(authRateLimiter, updateBusinessOwnerStatus); // Update business status

router.route("/:id/verify").patch(authRateLimiter, verifyBusinessOwner); // Verify business

router.route("/:id/feature").patch(authRateLimiter, featureBusinessOwner); // Feature business

export default router;
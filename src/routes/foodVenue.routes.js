import {Router} from "express";
import {
  createFoodVenue,
  getAllFoodVenues,
  getFoodVenueById,
  updateFoodVenue,
  updateFoodVenueAvailability,
  deleteFoodVenue,
  uploadVenueImages,
  deleteVenueImage,
  uploadMenuItemImages,
  deleteMenuItemImage
} from "../controllers/foodVenue.controller.js";
import {upload} from "../middlewares/multer.middlewares.js";
import {verifyAdminJwt} from "../middlewares/admin.auth.middlewares.js";
import {authRateLimiter} from "../middlewares/ratelimit.middlewares.js";

const router = Router();

router.use(verifyAdminJwt);

// Public routes (no authentication required)
router.route("/").get(getAllFoodVenues). // Get all food venues with pagination and filtering
post(authRateLimiter, createFoodVenue); // Create new food venue (admin or business owner)

router.route("/:id").get(getFoodVenueById). // Get food venue by ID
put(authRateLimiter, updateFoodVenue). // Update food venue details (admin or business owner)
delete(authRateLimiter, deleteFoodVenue); // Delete food venue (admin or business owner)

// Food venue availability management
router.route("/:id/availability").patch(authRateLimiter, updateFoodVenueAvailability); // Update food venue availability

// Venue image management routes
router.route("/:id/images").post(authRateLimiter, upload.array("images", 10), uploadVenueImages). // Upload venue images (max 10 at a time)
delete(authRateLimiter, deleteVenueImage); // Delete venue image

// Menu item image management routes
router.route("/:id/menu-items/:menuItemId/images").post(authRateLimiter, upload.array("images", 5), uploadMenuItemImages). // Upload menu item images (max 5 at a time)
delete(authRateLimiter, deleteMenuItemImage); // Delete menu item image

export default router;
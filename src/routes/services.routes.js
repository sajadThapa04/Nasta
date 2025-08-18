import {Router} from "express";
import {
  createService,
  getAllServices,
  getServiceById,
  updateService,
  updateServiceStatus,
  deleteService,
  uploadServiceImages,
  setPrimaryImage,
  updateImageCaption,
  deleteServiceImage
} from "../controllers/services.controller.js";
import {upload} from "../middlewares/multer.middlewares.js";
import {verifyJwt} from "../middlewares/userAuth.middlewares.js";
import {authRateLimiter} from "../middlewares/ratelimit.middlewares.js";
import {verifyAdminJwt} from "../middlewares/admin.auth.middlewares.js";
const router = Router();

// Public routes (no authentication required)
router.route("/").get(verifyJwt, getAllServices). // Get all services with pagination and filtering
post(authRateLimiter, verifyJwt, createService); // Create new service (admin or business owner)

router.route("/:id").get(verifyJwt, getServiceById). // Get service by ID
put(authRateLimiter, verifyJwt, updateService). // Update service details (admin or business owner)
delete(authRateLimiter, verifyJwt, deleteService); // Delete service (admin or business owner)

// Service status management routes (admin only)
router.route("/:id/status").patch(authRateLimiter, verifyAdminJwt, updateServiceStatus); // Update service status

// Image management routes (admin or business owner)
router.route("/:id/images").post(authRateLimiter, verifyJwt, upload.array("images", 10), uploadServiceImages); // Upload service images (max 10 at a time)

router.route("/:id/images/primary").patch(authRateLimiter, verifyJwt, setPrimaryImage); // Set primary image

router.route("/:id/images/caption").patch(authRateLimiter, verifyJwt, updateImageCaption); // Update image caption

router.route("/:id/images/:imageIndex").delete(authRateLimiter, verifyJwt, deleteServiceImage); // Delete specific image

export default router;
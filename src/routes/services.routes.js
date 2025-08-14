import {Router} from "express";
import {
  createService,
  getAllServices,
  getServiceById,
  getServiceBySlug,
  updateService,
  updateServiceStatus,
  deleteService,
  uploadServiceImages,
  setPrimaryImage,
  updateImageCaption,
  deleteServiceImage
} from "../controllers/services.controller.js";
import {upload} from "../middlewares/multer.middlewares.js";
import {verifyAdminJwt} from "../middlewares/admin.auth.middlewares.js";
import {authRateLimiter} from "../middlewares/ratelimit.middlewares.js";

const router = Router();

router.use(verifyAdminJwt);
// Public routes (no authentication required)
router.route("/").get(getAllServices). // Get all services with pagination and filtering
post(authRateLimiter, createService); // Create new service (admin or business owner)

router.route("/:id").get(getServiceById). // Get service by ID
put(authRateLimiter, updateService). // Update service details (admin or business owner)
delete(authRateLimiter, deleteService); // Delete service (admin or business owner)

router.route("/slug/:slug").get(getServiceBySlug); // Get service by slug

// Service status management routes (admin only)
router.route("/:id/status").patch(authRateLimiter, updateServiceStatus); // Update service status

// Image management routes (admin or business owner)
router.route("/:id/images").post(authRateLimiter, upload.array("images", 10), uploadServiceImages); // Upload service images (max 10 at a time)

router.route("/:id/images/primary").patch(authRateLimiter, setPrimaryImage); // Set primary image

router.route("/:id/images/caption").patch(authRateLimiter, updateImageCaption); // Update image caption

router.route("/:id/images/:imageIndex").delete(authRateLimiter, deleteServiceImage); // Delete specific image

export default router;
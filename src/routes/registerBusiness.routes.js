import {Router} from "express";
import {
  registerBusiness,
  getAllBusinessRegistrations,
  getBusinessRegistrationById,
  updateBusinessRegistration,
  updateBusinessRegistrationStatus,
  uploadBusinessDocuments,
  deleteBusinessDocument,
  getBusinessesNearby
} from "../controllers/registerBusiness.controller.js";
import {upload} from "../middlewares/multer.middlewares.js";
import {verifyAdminJwt} from "../middlewares/admin.auth.middlewares.js";
import {authRateLimiter} from "../middlewares/ratelimit.middlewares.js";

const router = Router();

// Business Owner Routes (require business owner authentication)
router.route("/register").post(authRateLimiter, registerBusiness); // Register a new business

router.route("/registrations/:id").get(verifyAdminJwt,getBusinessRegistrationById). // Get business registration by ID
put(authRateLimiter,verifyAdminJwt, updateBusinessRegistration); // Update business registration

// Document upload routes (business owner only)
router.route("/registrations/:id/documents").post(authRateLimiter, upload.array("documents", 5), // Max 5 documents at once
    uploadBusinessDocuments); // Upload business documents

router.route("/registrations/:id/documents/:docId").delete(authRateLimiter, verifyAdminJwt, deleteBusinessDocument); // Delete business document

// Admin Routes (require admin authentication)
router.route("/registrations").get(verifyAdminJwt, getAllBusinessRegistrations); // Get all business registrations (with pagination/filtering)

router.route("/registrations/:id/status").patch(authRateLimiter, verifyAdminJwt, updateBusinessRegistrationStatus); // Update registration status (admin only)

// Public Routes (no authentication required)
router.route("/nearby").get(verifyAdminJwt,getBusinessesNearby); // Get nearby approved businesses

export default router;
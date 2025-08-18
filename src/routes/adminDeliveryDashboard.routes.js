import express from "express";
import {
  getAllDeliveryDrivers,
  getDriverById,
  updateDriverStatus,
  updateDriver,
  deleteDriver,
  getNearbyDrivers,
  resetDriverPassword,
  getDriverStats,
  deleteDriverDocument
} from "../controllers/adminDeliveryDashboard.controller.js";
import {verifyAdminJwt} from "../middlewares/admin.auth.middlewares.js";
import {authRateLimiter} from "../middlewares/ratelimit.middlewares.js";

const router = express.Router();

// Apply admin authentication middleware to all routes
router.use(verifyAdminJwt);

// Delivery Driver Management Routes
router.route("/").get(authRateLimiter, getAllDeliveryDrivers); // GET /api/admin/delivery-drivers

router.route("/:id").get(authRateLimiter, getDriverById). // GET /api/admin/delivery-drivers/:id
patch(authRateLimiter, updateDriver). // PUT /api/admin/delivery-drivers/:id
delete(authRateLimiter, deleteDriver); // DELETE /api/admin/delivery-drivers/:id

router.route("/:id/status").patch(authRateLimiter, updateDriverStatus); // PATCH /api/admin/delivery-drivers/:id/status

router.route("/:id/reset-password").post(authRateLimiter, resetDriverPassword); // POST /api/admin/delivery-drivers/:id/reset-password

router.route("/nearby").get(authRateLimiter, getNearbyDrivers); // GET /api/admin/delivery-drivers/nearby

router.route("/stats").get(authRateLimiter, getDriverStats); // GET /api/admin/delivery-drivers/stats

router.route("/:id/delete-document/:documentType").delete(deleteDriverDocument); // Delete driver document

export default router;
import {Router} from "express";
import {
  handleFoodDeliveryStripeWebhook,
  createFoodDeliveryPayment,
  confirmFoodDeliveryPayment,
  updateFoodDeliveryPaymentStatus,
  getUserFoodDeliveryPayments,
  getFoodDeliveryPaymentById,
  handleFoodDeliveryPaymentRefund
} from "../controllers/foodDeliveryPayment.controller.js";
import {verifyJwt} from "../middlewares/userAuth.middlewares.js";
import {verifyAdminJwt} from "../middlewares/admin.auth.middlewares.js";
import {authRateLimiter} from "../middlewares/ratelimit.middlewares.js";

const router = Router();

// Webhook (no auth)
router.route("/payments/webhook").post(handleFoodDeliveryStripeWebhook);

// Customer routes
router.route("/payments").post(authRateLimiter, verifyJwt, createFoodDeliveryPayment);
router.route("/payments/confirm").post(authRateLimiter, verifyJwt, confirmFoodDeliveryPayment);
router.route("/payments").get(authRateLimiter, verifyJwt, getUserFoodDeliveryPayments);
router.route("/payments/:id").get(authRateLimiter, verifyJwt, getFoodDeliveryPaymentById);

// Admin routes
router.route("/payments/:id/status").patch(authRateLimiter, verifyAdminJwt, updateFoodDeliveryPaymentStatus);
router.route("/payments/:id/refund").post(authRateLimiter, verifyAdminJwt, handleFoodDeliveryPaymentRefund);

export default router;
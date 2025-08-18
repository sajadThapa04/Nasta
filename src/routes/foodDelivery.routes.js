import {Router} from "express";
import {
  createFoodDeliveryOrder,
  getCustomerOrders,
  getVenueOrders,
  updateOrderStatus,
  assignDriverToOrder,
  getOrderDetailsForCustomers,
  getNearbyDrivers,
  getVenueStats,
  updateDeliveryLocation,
  submitOrderRating,
  getOrderDetailsForBusinessOwners,
  getOrderDetailsForDrivers,
  getAllCustomerOrders
} from "../controllers/foodDelivery.controller.js";
import {verifyJwt} from "../middlewares/userAuth.middlewares.js";
import {verifyDriverJwt} from "../middlewares/deliveryDriver.auth.middlewares.js";
// import {verifyVenueOwnerJwt} from "../middlewares/venueOwner.auth.middlewares.js";
import {verifyAdminJwt} from "../middlewares/admin.auth.middlewares.js";
import {authRateLimiter} from "../middlewares/ratelimit.middlewares.js";

const router = Router();

// Customer routes (require customer JWT authentication)

// In your routes file:
router.route("/customer").post(authRateLimiter, verifyJwt, (req, res, next) => {
  if (req.user.role !== "customer") {
    return res.status(403).json({success: false, message: "Only customers can place orders"});
  }
  next();
}, createFoodDeliveryOrder);
router.route("/customer/:id/rating").post(authRateLimiter, submitOrderRating); // Submit rating
router.route("/:id/customer/orders").get(authRateLimiter, verifyJwt, getCustomerOrders); // Get customer's orders

// Venue owner routes (require venue owner JWT authentication)
// router.use("/venue", verifyJwt);

router.route("/venue/orders").get(authRateLimiter, verifyJwt, getVenueOrders); // Get venue's orders
router.route("/customer/orders").get(authRateLimiter, verifyJwt, getAllCustomerOrders); // Get all customers orders
router.route("/customer/:id").get(authRateLimiter, verifyJwt, getOrderDetailsForCustomers); // Get order details
router.route("/business/:id").get(authRateLimiter, verifyJwt, getOrderDetailsForBusinessOwners); // Get order details

router.route("/venue/stats").get(authRateLimiter, verifyJwt, getVenueStats); // Get venue statistics

router.route("/venue/:id/status").patch(authRateLimiter, verifyJwt, updateOrderStatus); // Update order status

router.route("/venue/:id/assign-driver").post(authRateLimiter, verifyJwt, assignDriverToOrder); // Assign driver to order

router.route("/venue/:id/nearby-drivers").get(authRateLimiter, verifyJwt, getNearbyDrivers); // Get nearby drivers

// Driver routes (require driver JWT authentication)
router.use("/driver", verifyDriverJwt);

router.route("/driver/:id").get(authRateLimiter, getOrderDetailsForDrivers); // Get order details

router.route("/driver/:id/status").patch(authRateLimiter, updateOrderStatus); // Update order status

router.route("/driver/:id/location").patch(authRateLimiter, updateDeliveryLocation); // Update delivery location

export default router;
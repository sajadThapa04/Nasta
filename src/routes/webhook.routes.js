// webhook.routes.js
import express from "express";

import {handleFoodDeliveryStripeWebhook} from "../controllers/foodDeliveryPayment.controller.js";
const router = express.Router();

// Apply express.raw() middleware ONLY to the webhook route

router.route("/foodOrder").post(express.raw({type: "application/json"}), // Raw body middleware
    handleFoodDeliveryStripeWebhook);

export default router;
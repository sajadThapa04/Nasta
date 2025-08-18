import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import FoodDelivery from "../models/foodDelivery.models.js";
import FoodDeliveryPayment from "../models/foodDeliveryPayment.models.js";
import User from "../models/users.models.js";
import {createStripePaymentIntent, refundStripePayment, handleStripeWebhook, confirmStripePaymentIntent} from "../utils/payment_gateways/stripe.js";
import logger from "../utils/logger.js";
import mongoose from "mongoose";

/**
 * @desc    Handle Stripe webhook events for food delivery payments
 * @route   POST /api/food-delivery/payments/webhook
 * @access  Public (Stripe)
 */
const handleFoodDeliveryStripeWebhook = asyncHandler(async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const payload = req.body;

  try {
    const event = await handleStripeWebhook(payload, sig, process.env.STRIPE_FOOD_DELIVERY_WEBHOOK_SECRET);
    logger.info(`Stripe webhook event received: ${event.type}`);

    switch (event.type) {
      case "payment_intent.created":
        const createdPaymentIntent = event.data.object;
        const order = await FoodDelivery.findById(createdPaymentIntent.metadata.order);
        const user = await User.findById(createdPaymentIntent.metadata.user);

        if (!order || !user) {
          logger.error(`Order or User not found for payment intent: ${createdPaymentIntent.id}`);
          return res.status(404).json({error: "Order or User not found"});
        }

        if (order.customer._id.toString() !== createdPaymentIntent.metadata.user) {
          logger.error(`User ${createdPaymentIntent.metadata.user} is not the owner of order ${createdPaymentIntent.metadata.order}`);
          return res.status(403).json({error: "Unauthorized access to order"});
        }

        await FoodDeliveryPayment.create({
          user: user._id,
          order: order._id,
          paymentMethod: "stripe",
          amount: createdPaymentIntent.amount / 100,
          transactionId: createdPaymentIntent.id,
          paymentStatus: createdPaymentIntent.status,
          paymentMetadata: {
            gateway: "stripe",
            gatewayResponse: createdPaymentIntent,
            gatewayId: createdPaymentIntent.id
          }
        });
        break;

      case "payment_intent.succeeded":
        const succeededPaymentIntent = event.data.object;
        await FoodDeliveryPayment.findOneAndUpdate({
          transactionId: succeededPaymentIntent.id
        }, {paymentStatus: "succeeded"});

        // Update food delivery order payment status
        await FoodDelivery.findOneAndUpdate({
          _id: succeededPaymentIntent.metadata.order
        }, {
          paymentStatus: "paid",
          deliveryStatus: "preparing" // Move to next status
        });
        break;

      case "payment_intent.payment_failed":
        const failedPaymentIntent = event.data.object;
        await FoodDeliveryPayment.findOneAndUpdate({
          transactionId: failedPaymentIntent.id
        }, {paymentStatus: "failed"});

        // Update food delivery order status
        await FoodDelivery.findOneAndUpdate({
          _id: failedPaymentIntent.metadata.order
        }, {
          paymentStatus: "failed",
          deliveryStatus: "failed"
        });
        break;

      case "charge.refunded":
        const refundedCharge = event.data.object;
        await FoodDeliveryPayment.findOneAndUpdate({
          transactionId: refundedCharge.payment_intent
        }, {
          paymentStatus: "refunded",
          refundStatus: "fully_refunded"
        });

        // Update food delivery order status if refunded
        await FoodDelivery.findOneAndUpdate({
          _id: refundedCharge.metadata.order
        }, {
          paymentStatus: "refunded",
          deliveryStatus: "failed"
        });
        break;

      default:
        logger.info(`Unhandled event type: ${event.type}`);
    }

    res.json({received: true});
  } catch (error) {
    logger.error(`Webhook Error: ${error.message}`);
    throw new ApiError(400, `Webhook Error: ${error.message}`);
  }
});

/**
 * @desc    Create a new payment for food delivery order
 * @route   POST /api/food-delivery/payments
 * @access  Private (Customer)
 */
const createFoodDeliveryPayment = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {orderId, paymentMethod, amount, transactionId, paymentMetadata} = req.body;
    const userId = req.user._id;

    logger.info(`Starting createFoodDeliveryPayment for order: ${orderId} by user: ${userId}`);

    // Step 1: Validate input fields
    if (!orderId || !paymentMethod || !amount) {
      logger.error("Missing required fields");
      throw new ApiError(400, "All required fields must be provided");
    }

    if (isNaN(amount) || amount <= 0) {
      throw new ApiError(400, "Invalid payment amount");
    }

    const validPaymentMethods = [
      "stripe",
      "paypal",
      "razorpay",
      "esewa",
      "credit_card",
      "cash_on_delivery"
    ];
    if (!validPaymentMethods.includes(paymentMethod)) {
      throw new ApiError(400, "Invalid payment method");
    }

    // Verify order exists and belongs to user
    const order = await FoodDelivery.findById(orderId).session(session);
    if (!order) {
      throw new ApiError(404, "Food delivery order not found");
    }

    if (order.customer._id.toString() !== userId.toString()) {
      throw new ApiError(403, "Not authorized to pay for this order");
    }

    // Verify order amount matches
    if (Math.abs(amount - order.totalAmount) > 0.01) {
      // Allow small floating point differences
      throw new ApiError(400, "Payment amount doesn't match order total");
    }

    // Handle Stripe payment
    if (paymentMethod === "stripe") {
      try {
        const paymentIntent = await createStripePaymentIntent(amount, "usd", {
          order: orderId,
          user: userId,
          ...paymentMetadata
        });

        const newPayment = await FoodDeliveryPayment.create([
          {
            user: userId,
            order: orderId,
            paymentMethod,
            amount,
            transactionId: paymentIntent.id,
            paymentMetadata: {
              gateway: "stripe",
              gatewayResponse: paymentIntent,
              gatewayId: paymentIntent.id
            },
            paymentStatus: paymentIntent.status
          }
        ], {session});

        // Update order with payment info
        await FoodDelivery.findByIdAndUpdate(orderId, {
          paymentMethod,
          paymentStatus: "pending"
        }, {session});

        await session.commitTransaction();
        return res.status(201).json(new ApiResponse(201, newPayment[0], "Payment created successfully"));
      } catch (error) {
        logger.error(`Stripe Error: ${error.message}`);
        throw new ApiError(500, `Payment processing failed: ${error.message}`);
      }
    }

    // Handle cash on delivery
    if (paymentMethod === "cash_on_delivery") {
      const newPayment = await FoodDeliveryPayment.create([
        {
          user: userId,
          order: orderId,
          paymentMethod,
          amount,
          paymentStatus: "pending",
          paymentMetadata: {
            gateway: "cash",
            gatewayResponse: {}
          }
        }
      ], {session});

      // Update order with payment info
      await FoodDelivery.findByIdAndUpdate(orderId, {
        paymentMethod,
        paymentStatus: "pending"
      }, {session});

      await session.commitTransaction();
      return res.status(201).json(new ApiResponse(201, newPayment[0], "Payment created successfully"));
    }

    // Handle other payment methods
    if (!transactionId) {
      throw new ApiError(400, "Transaction ID is required for non-Stripe payments");
    }

    try {
      const newPayment = await FoodDeliveryPayment.create([
        {
          user: userId,
          order: orderId,
          paymentMethod,
          amount,
          transactionId,
          paymentMetadata: paymentMetadata || {
            gateway: paymentMethod,
            gatewayResponse: {}
          },
          paymentStatus: "pending"
        }
      ], {session});

      // Update order with payment info
      await FoodDelivery.findByIdAndUpdate(orderId, {
        paymentMethod,
        paymentStatus: "pending"
      }, {session});

      await session.commitTransaction();
      return res.status(201).json(new ApiResponse(201, newPayment[0], "Payment created successfully"));
    } catch (error) {
      logger.error(`Payment creation error: ${error.message}`);
      throw new ApiError(500, "Payment creation failed");
    }
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Confirm a Stripe PaymentIntent for food delivery
 * @route   POST /api/food-delivery/payments/confirm
 * @access  Private (Customer)
 */
const confirmFoodDeliveryPayment = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {paymentIntentId, paymentMethodId} = req.body;
    const userId = req.user._id;

    if (!paymentIntentId || !paymentMethodId) {
      throw new ApiError(400, "paymentIntentId and paymentMethodId are required");
    }

    const confirmedPaymentIntent = await confirmStripePaymentIntent(paymentIntentId, paymentMethodId);
    const updatedPayment = await FoodDeliveryPayment.findOneAndUpdate({
      transactionId: paymentIntentId,
      user: userId
    }, {
      paymentStatus: confirmedPaymentIntent.status
    }, {
      new: true,
      session
    });

    if (!updatedPayment) {
      throw new ApiError(404, "Payment not found");
    }

    // Update food delivery order payment status if succeeded
    if (confirmedPaymentIntent.status === "succeeded") {
      await FoodDelivery.findByIdAndUpdate(updatedPayment.order, {
        paymentStatus: "paid",
        deliveryStatus: "preparing" // Move to next status
      }, {session});
    }

    await session.commitTransaction();
    return res.status(200).json(new ApiResponse(200, updatedPayment, "Payment confirmed successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Stripe Error: ${error.message}`);
    throw new ApiError(500, `Payment confirmation failed: ${error.message}`);
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Update food delivery payment status
 * @route   PATCH /api/food-delivery/payments/:id/status
 * @access  Private (Customer or Admin)
 */
const updateFoodDeliveryPaymentStatus = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {paymentStatus} = req.body;
    const userId = req.user._id;
    const isAdmin = req.user.role === "admin";

    logger.info(`Updating payment status for payment ID: ${id}`);

    if (!paymentStatus) {
      throw new ApiError(400, "Payment status is required");
    }

    const validStatuses = [
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
      "processing",
      "requires_capture",
      "succeeded",
      "canceled",
      "failed",
      "pending",
      "paid",
      "refunded"
    ];

    if (!validStatuses.includes(paymentStatus)) {
      throw new ApiError(400, "Invalid payment status");
    }

    const payment = await FoodDeliveryPayment.findById(id).session(session);
    if (!payment) {
      throw new ApiError(404, "Payment not found");
    }

    // Verify user has permission to update this payment
    if (payment.user.toString() !== userId.toString() && !isAdmin) {
      throw new ApiError(403, "Not authorized to update this payment");
    }

    payment.paymentStatus = paymentStatus;
    const updatedPayment = await payment.save({session});

    // Update food delivery order if payment succeeded or failed
    if (paymentStatus === "succeeded" || paymentStatus === "paid") {
      await FoodDelivery.findByIdAndUpdate(payment.order, {
        paymentStatus: "paid",
        deliveryStatus: "preparing" // Move to next status
      }, {session});
    } else if (paymentStatus === "failed") {
      await FoodDelivery.findByIdAndUpdate(payment.order, {
        paymentStatus: "failed",
        deliveryStatus: "failed"
      }, {session});
    } else if (paymentStatus === "refunded") {
      await FoodDelivery.findByIdAndUpdate(payment.order, {
        paymentStatus: "refunded",
        deliveryStatus: "failed"
      }, {session});
    }

    await session.commitTransaction();
    return res.status(200).json(new ApiResponse(200, updatedPayment, "Payment status updated successfully"));
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Get all payments for a user's food delivery orders
 * @route   GET /api/food-delivery/payments
 * @access  Private (Customer)
 */
const getUserFoodDeliveryPayments = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const {
    limit = 10,
    page = 1,
    status
  } = req.query;

  const options = {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 10,
    sort: {
      createdAt: -1
    },
    populate: {
      path: "order",
      select: "deliveryStatus totalAmount createdAt",
      populate: {
        path: "venue",
        select: "name"
      }
    }
  };

  const query = {
    user: userId
  };
  if (status) {
    query.paymentStatus = status;
  }

  const payments = await FoodDeliveryPayment.paginate(query, options);

  return res.status(200).json(new ApiResponse(200, payments, "Payments fetched successfully"));
});

/**
 * @desc    Get payment details by ID for food delivery
 * @route   GET /api/food-delivery/payments/:id
 * @access  Private (Customer or Admin)
 */
const getFoodDeliveryPaymentById = asyncHandler(async (req, res) => {
  const {id} = req.params;
  const userId = req.user._id;
  const isAdmin = req.user.role === "admin";

  const payment = await FoodDeliveryPayment.findById(id).populate({
    path: "order",
    select: "deliveryStatus totalAmount createdAt deliveryAddress",
    populate: [
      {
        path: "venue",
        select: "name address"
      }, {
        path: "deliveryDriver",
        select: "fullName phone"
      }
    ]
  });

  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  // Verify user has permission to access this payment
  if (payment.user.toString() !== userId.toString() && !isAdmin) {
    throw new ApiError(403, "Not authorized to access this payment");
  }

  return res.status(200).json(new ApiResponse(200, payment, "Payment details fetched successfully"));
});

/**
 * @desc    Handle refund for food delivery payment
 * @route   POST /api/food-delivery/payments/:id/refund
 * @access  Private (Admin)
 */
const handleFoodDeliveryPaymentRefund = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {amount, reason} = req.body;

    if (req.user.role !== "admin") {
      throw new ApiError(403, "Only admins can process refunds");
    }

    const payment = await FoodDeliveryPayment.findById(id).session(session);
    if (!payment) {
      throw new ApiError(404, "Payment not found");
    }

    // Check if payment can be refunded
    if (!["paid", "succeeded"].includes(payment.paymentStatus)) {
      throw new ApiError(400, "Only paid payments can be refunded");
    }

    const refundAmount = amount || payment.amount;
    if (refundAmount > payment.amount) {
      throw new ApiError(400, "Refund amount cannot exceed payment amount");
    }

    // Handle Stripe refund
    if (payment.paymentMethod === "stripe") {
      try {
        await refundStripePayment(payment.transactionId, refundAmount);

        // Update payment status based on refund amount
        if (refundAmount === payment.amount) {
          payment.paymentStatus = "refunded";
          payment.refundStatus = "fully_refunded";
        } else {
          payment.paymentStatus = "partially_refunded";
          payment.refundStatus = "partially_refunded";
        }

        payment.refundAmount = refundAmount;
        payment.refundDate = new Date();

        // Add refund details to paymentMetadata
        payment.paymentMetadata.refunds = payment.paymentMetadata.refunds || [];
        payment.paymentMetadata.refunds.push({
          amount: refundAmount,
          date: new Date(),
          reason: reason || "",
          status: refundAmount === payment.amount
            ? "full"
            : "partial"
        });

        await payment.save({session});

        // Update food delivery order status
        await FoodDelivery.findByIdAndUpdate(payment.order, {
          paymentStatus: payment.paymentStatus,
          deliveryStatus: "failed"
        }, {session});

        await session.commitTransaction();
        return res.status(200).json(new ApiResponse(200, payment, "Refund processed successfully"));
      } catch (error) {
        logger.error(`Stripe Refund Error: ${error.message}`);
        throw new ApiError(500, "Refund processing failed");
      }
    }

    // Handle non-Stripe refunds
    if (refundAmount === payment.amount) {
      payment.paymentStatus = "refunded";
      payment.refundStatus = "fully_refunded";
    } else {
      payment.paymentStatus = "partially_refunded";
      payment.refundStatus = "partially_refunded";
    }

    payment.refundAmount = refundAmount;
    payment.refundDate = new Date();

    // Add refund details to paymentMetadata
    payment.paymentMetadata.refunds = payment.paymentMetadata.refunds || [];
    payment.paymentMetadata.refunds.push({
      amount: refundAmount,
      date: new Date(),
      reason: reason || "",
      status: refundAmount === payment.amount
        ? "full"
        : "partial"
    });

    await payment.save({session});

    // Update food delivery order status
    await FoodDelivery.findByIdAndUpdate(payment.order, {
      paymentStatus: payment.paymentStatus,
      deliveryStatus: "failed"
    }, {session});

    await session.commitTransaction();
    return res.status(200).json(new ApiResponse(200, payment, "Refund processed successfully"));
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

export {
  handleFoodDeliveryStripeWebhook,
  createFoodDeliveryPayment,
  confirmFoodDeliveryPayment,
  updateFoodDeliveryPaymentStatus,
  getUserFoodDeliveryPayments,
  getFoodDeliveryPaymentById,
  handleFoodDeliveryPaymentRefund
};
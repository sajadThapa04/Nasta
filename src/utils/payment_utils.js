import {Payment} from "../models/payment.models.js";
import logger from "./logger.js";

/**
 * Utility functions related to payments
 */

// Check if the payment is successful
export const isPaymentSuccessful = (paymentStatus, gateway) => {
  logger.info(`Checking payment status for gateway: ${gateway}, status: ${paymentStatus}`);

  switch (gateway) {
    case "stripe":
      return paymentStatus === "succeeded";
    case "paypal":
      return paymentStatus === "COMPLETED";
    case "razorpay":
      return paymentStatus === "captured";
    default:
      return paymentStatus === "paid"; // Fallback for generic payments
  }
};

// Process the refund based on status
export const processRefund = async (payment, gateway) => {
  logger.info(`Processing refund for payment ID: ${payment._id}, gateway: ${gateway}`);

  if (payment.paymentStatus !== "paid" || payment.refundStatus !== "not_refunded") {
    logger.error(`Cannot process refund for payment ID: ${payment._id}. Status: ${payment.paymentStatus}, Refund Status: ${payment.refundStatus}`);
    throw new Error("Cannot process refund for this payment");
  }

  switch (gateway) {
    case "stripe":
      logger.info(`Initiating Stripe refund for transaction ID: ${payment.transactionId}`);
      await refundStripePayment(payment.transactionId, payment.amount);
      break;
    case "paypal":
      logger.info(`Initiating PayPal refund for transaction ID: ${payment.transactionId}`);
      await refundPaypalPayment(payment.transactionId, payment.amount);
      break;
    case "razorpay":
      logger.info(`Initiating Razorpay refund for transaction ID: ${payment.transactionId}`);
      await refundRazorpayPayment(payment.transactionId, payment.amount);
      break;
    default:
      logger.error(`Unsupported payment gateway: ${gateway}`);
      throw new Error("Unsupported payment gateway");
  }

  payment.refundStatus = "fully_refunded";
  payment.paymentStatus = "refunded";
  await payment.save();

  logger.info(`Refund processed successfully for payment ID: ${payment._id}`);
  return payment;
};

// Validate payment fields
export const validatePaymentFields = payment => {
  logger.info(`Validating payment fields for payment: ${JSON.stringify(payment)}`);

  if (!payment.amount || payment.amount <= 0) {
    logger.error("Invalid amount provided");
    throw new Error("Invalid amount");
  }

  // Only validate transactionId for non-Stripe payments
  if (payment.paymentMethod !== "stripe" && !payment.transactionId) {
    logger.error("Transaction ID is missing for non-Stripe payment");
    throw new Error("Transaction ID is required for non-Stripe payments");
  }

  if (!payment.paymentMethod) {
    logger.error("Payment method is missing");
    throw new Error("Payment method is required");
  }

  logger.info("Payment fields validated successfully");
  return true;
};

// Format metadata for different payment gateways
export const formatPaymentMetadata = (gateway, metadata) => {
  logger.info(`Formatting metadata for gateway: ${gateway}`);

  switch (gateway) {
    case "stripe":
      return {
        ...metadata,
        paymentIntentId: metadata.id
      };
    case "paypal":
      return {
        ...metadata,
        orderId: metadata.id
      };
    case "razorpay":
      return {
        ...metadata,
        paymentId: metadata.id
      };
    default:
      logger.warn(`Unsupported gateway: ${gateway}. Returning metadata as-is.`);
      return metadata;
  }
};

// Find a payment by its transaction ID
export const findPaymentByTransactionId = async transactionId => {
  logger.info(`Finding payment by transaction ID: ${transactionId}`);

  const payment = await Payment.findOne({transactionId});
  if (!payment) {
    logger.error(`Payment not found for transaction ID: ${transactionId}`);
    throw new Error("Payment not found");
  }

  logger.info(`Payment found: ${payment._id}`);
  return payment;
};

// Handle payment refund
export const handleRefund = async (paymentId, gateway) => {
  logger.info(`Handling refund for payment ID: ${paymentId}, gateway: ${gateway}`);

  const payment = await Payment.findById(paymentId);
  if (!payment) {
    logger.error(`Payment not found for ID: ${paymentId}`);
    throw new Error("Payment not found");
  }

  switch (gateway) {
    case "stripe":
      logger.info(`Initiating Stripe refund for transaction ID: ${payment.transactionId}`);
      await refundStripePayment(payment.transactionId, payment.amount);
      break;
    case "paypal":
      logger.info(`Initiating PayPal refund for transaction ID: ${payment.transactionId}`);
      await refundPaypalPayment(payment.transactionId, payment.amount);
      break;
    case "razorpay":
      logger.info(`Initiating Razorpay refund for transaction ID: ${payment.transactionId}`);
      await refundRazorpayPayment(payment.transactionId, payment.amount);
      break;
    default:
      logger.error(`Unsupported payment gateway: ${gateway}`);
      throw new Error("Unsupported payment gateway");
  }

  payment.refundStatus = "fully_refunded";
  payment.paymentStatus = "refunded";
  await payment.save();

  logger.info(`Refund processed successfully for payment ID: ${payment._id}`);
  return payment;
};
import Stripe from "stripe";
import dotenv from "dotenv";
import logger from "../logger.js"; // Assuming you have a logger utility

dotenv.config({path: "./.env"});

// Initialize Stripe with your secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Create a payment intent using Stripe
 */
export const createStripePaymentIntent = async (amount, currency = "usd", options = {}) => {
  const {
    booking,
    user,
    guestEmail,
    ...paymentMetadata
  } = options;

  if (isNaN(amount)) {
    throw new Error("Amount must be a number");
  }
  if (amount <= 0) {
    throw new Error("Amount must be greater than 0");
  }

  try {
    logger.info(`Creating Stripe payment intent for amount: ${amount} ${currency}`);

    // Prepare metadata - handle both user and guest cases
    const metadata = {
      booking: booking
        ?.toString(), // Safe toString() call
      ...(
        user
        ? {
          user: user.toString()
        }
        : {}), // Only include user if it exists
      ...(
        guestEmail
        ? {
          guestEmail
        }
        : {}), // Include guest email if it exists
      ...paymentMetadata
    };

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      metadata,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never"
      }
    });

    logger.info(`Stripe payment intent created: ${paymentIntent.id}`);
    return paymentIntent;
  } catch (error) {
    logger.error(`Stripe Error: ${error.message}`);
    throw new Error(`Stripe Error: ${error.message}`);
  }
};

/**
 * Refund a payment using Stripe
 */

export const refundStripePayment = async (paymentIntentId, amount = null) => {
  try {
    logger.info(`Refunding Stripe payment intent: ${paymentIntentId}`);
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount
        ? amount * 100
        : undefined // Convert to cents if amount is provided
    });
    logger.info(`Stripe refund created: ${refund.id}`);
    return refund;
  } catch (error) {
    logger.error(`Stripe Refund Error: ${error.message}`);
    throw new Error(`Stripe Refund Error: ${error.message}`);
  }
};

/**
 * Handle Stripe webhook events
 */
export const handleStripeWebhook = async (payload, signature, webhookSecret) => {
  try {
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    logger.info(`Stripe webhook event received: ${event.type}`);
    return event;
  } catch (error) {
    logger.error(`Webhook Error: ${error.message}`);
    throw new Error(`Webhook Error: ${error.message}`);
  }
};

export const confirmStripePaymentIntent = async (paymentIntentId, paymentMethodId) => {
  try {
    // Confirm the PaymentIntent
    const confirmedPaymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {payment_method: paymentMethodId});

    logger.info(`PaymentIntent confirmed: ${confirmedPaymentIntent.id}`);
    return confirmedPaymentIntent;
  } catch (error) {
    logger.error(`Stripe Error: ${error.message}`);
    throw new Error(`Stripe Error: ${error.message}`);
  }
};
// console.log("Stripe instance:", stripe);
import Razorpay from "razorpay";
import dotenv from "dotenv";

dotenv.config();

const razorpay = new Razorpay({key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET});

/**
 * Create a Razorpay order
 */
export const createRazorpayOrder = async (amount, currency = "INR") => {
  try {
    const order = await razorpay.orders.create({
      amount: amount * 100, // Convert to paise
      currency
    });
    return order;
  } catch (error) {
    throw new Error(`Razorpay Error: ${error.message}`);
  }
};

/**
 * Refund a Razorpay payment
 */
export const refundRazorpayPayment = async (paymentId, amount) => {
  try {
    const refund = await razorpay.payments.refund(paymentId, {
      amount: amount * 100 // Convert to paise
    });
    return refund;
  } catch (error) {
    throw new Error(`Razorpay Refund Error: ${error.message}`);
  }
};
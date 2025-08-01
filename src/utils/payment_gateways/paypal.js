import paypal from "@paypal/checkout-server-sdk";
import logger from "./logger.js"; // Import your logger utility

// Initialize PayPal client
const paypalClient = new paypal.core.PayPalHttpClient(new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET));

/**
 * Create a PayPal order
 */
export const createPaypalOrder = async (amount, currency = "USD") => {
  logger.info(`Creating PayPal order for amount: ${amount} ${currency}`);

  const request = new paypal.orders.OrdersCreateRequest();
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: currency,
          value: amount.toString()
        }
      }
    ]
  });

  try {
    const response = await paypalClient.execute(request);
    logger.info(`PayPal order created successfully. Order ID: ${response.result.id}`);
    return response.result;
  } catch (error) {
    logger.error(`Error creating PayPal order: ${error.message}`);
    throw new Error(`PayPal Error: ${error.message}`);
  }
};

/**
 * Refund a PayPal payment
 */
export const refundPaypalPayment = async (orderId, amount) => {
  logger.info(`Refunding PayPal payment for order ID: ${orderId}, amount: ${amount}`);

  const request = new paypal.payments.CapturesRefundRequest(orderId);
  request.requestBody({
    amount: {
      currency_code: "USD",
      value: amount.toString()
    }
  });

  try {
    const response = await paypalClient.execute(request);
    logger.info(`PayPal refund processed successfully. Refund ID: ${response.result.id}`);
    return response.result;
  } catch (error) {
    logger.error(`Error refunding PayPal payment: ${error.message}`);
    throw new Error(`PayPal Refund Error: ${error.message}`);
  }
};
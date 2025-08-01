/**
 * Simulate a credit card payment (for testing purposes)
 */
export const processCreditCardPayment = async (amount, cardDetails) => {
  try {
    // Simulate a successful payment
    return {success: true, transactionId: `cc_${Math.random().toString(36).substring(7)}`, amount};
  } catch (error) {
    throw new Error(`Credit Card Error: ${error.message}`);
  }
};

/**
 * Simulate a credit card refund (for testing purposes)
 */
export const refundCreditCardPayment = async transactionId => {
  try {
    // Simulate a successful refund
    return {success: true, transactionId, refunded: true};
  } catch (error) {
    throw new Error(`Credit Card Refund Error: ${error.message}`);
  }
};

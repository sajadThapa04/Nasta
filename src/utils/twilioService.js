// utils/twilioService.js
import twilio from 'twilio';
import logger from './logger.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({path: "./.env", quiet:true});
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// Initialize Twilio client
const client = twilio(accountSid, authToken);

// Existing SMS verification method (unchanged)
export const sendVerificationSMS = async (phoneNumber, verificationCode) => {
    try {
        const message = await client.messages.create({
            body: `Your verification code is: ${verificationCode}`,
            from: twilioPhoneNumber,
            to: phoneNumber
        });
        logger.info(`SMS sent to ${phoneNumber}: ${message.sid}`);
        return true;
    } catch (error) {
        logger.error(`Failed to send SMS to ${phoneNumber}: ${error.message}`);
        throw new Error('Failed to send verification SMS');
    }
};

/**
 * New WhatsApp verification method using content templates
 * @param {string} whatsappNumber - Recipient's WhatsApp number in E.164 format
 * @param {string} verificationCode - 6-digit verification code
 * @param {string} [contentSid] - Optional template SID (falls back to env var)
 * @returns {Promise<boolean>} - Returns true if message was sent successfully
 */
export const sendWhatsAppVerification = async (whatsappNumber, verificationCode, contentSid) => {
    try {
        // const message = await client.messages.create({
        //     body: `Your verification code: ${code}`,
        //     from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        //     to: `whatsapp:${whatsappNumber}`
        // });

        // logger.info(`Message ${message.sid} status: ${message.status}`);
        // return true;

        const message = await client.messages.create({
            from: `whatsapp:${twilioPhoneNumber}`,
            contentSid: contentSid || 'HXb5b62575e6e4ff6129ad7c8efe1f983e', // Default template SID
            contentVariables: JSON.stringify({
                "1": verificationCode,  // Verification code
                "2": "10 minutes"       // Expiration time
            }),
            to: `whatsapp:${whatsappNumber}`
        });

        logger.info(`WhatsApp message sent to ${whatsappNumber}: ${message.sid}`);
        return true;
    } catch (error) {
        logger.error(`Failed to send WhatsApp to ${whatsappNumber}:`, {
            code: error.code,
            message: error.message,
            moreInfo: error.moreInfo
        });

        // Enhanced error handling
        if (error.code === 21211) {
            throw new Error('Invalid WhatsApp number format');
        }
        if (error.code === 21608) {
            throw new Error('Recipient not on WhatsApp');
        }

        throw new Error('Failed to send WhatsApp verification');
    }
};

// Add to your existing twilioService.js
export const sendWhatsAppMessage = async (whatsappNumber, message) => {
    try {
        const response = await client.messages.create({
            body: message,
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
            to: `whatsapp:${whatsappNumber}`
        });
        logger.info(`WhatsApp message sent to ${whatsappNumber}: ${response.sid}`);
        return true;
    } catch (error) {
        logger.error(`WhatsApp message failed: ${error.message}`);
        throw error;
    }
};
// Existing code generation method (unchanged)
export const generateVerificationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
};
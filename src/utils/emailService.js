import nodemailer from "nodemailer";
import dotenv from "dotenv";

// please make sure to add this file it is very
// important took me 1 and half hour to just debug it thanks

dotenv.config({path: "./.env", quiet: true}); // Create a transporter object using the default SMTP transport

// const transporter = nodemailer.createTransport({
//   host: process.env.SMTP_HOST,  SMTP server address (e.g., smtp.gmail.com)
//   port: process.env.SMTP_PORT,  SMTP port (e.g., 465 for SSL, 587 for TLS)
//   secure: false,  Use SSL/TLS
//   auth: {
//     user: process.env.SMTP_USER,  Your email address
//     pass: process.env.SMTP_PASS  Your email password or app-specific password
//   }
// });

// Create reusable transporter object
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: {
    rejectUnauthorized: false // Only for development!
  }
});

// console.log(transporter.options);

// transporter.verify((error, success) => {
//   if (error) {
//     console.error("SMTP connection error: ", error);
//   } else {
//     console.log("SMTP connection successful: ", success);
//   }
// });

/**
 * Send an email using Nodemailer
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - HTML content of the email
 * @returns {Promise<void>}
 */
const sendEmail = async (to, subject, html) => {
  try {
    // Define email options
    const mailOptions = {
      from: `"Nasta" <${process.env.SMTP_USER}>`, // Sender address
      to, // Recipient address
      subject, // Subject line
      html // HTML body
    };

    // Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent: ", info.messageId);
  } catch (error) {
    console.error("Error sending email: ", error);
    throw new Error("Failed to send email");
  }
};

/**
 * Send an email verification link to the user
 * @param {string} email - User's email address
 * @param {string} verificationToken - Email verification token
 * @returns {Promise<void>}
 */
const sendVerificationEmail = async (email, verificationToken) => {
  const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
  const subject = "Verify Your Email Address";
  const html = `
    <p>Hello,</p>
    <p>Please verify your email address by clicking the link below:</p>
    <p><a href="${verificationUrl}">Verify Email</a></p>
    <p>If you did not request this, please ignore this email.</p>
  `;

  await sendEmail(email, subject, html);
};

/**
 * Send a password reset link to the user
 * @param {string} email - User's email address
 * @param {string} resetToken - Password reset token
 * @returns {Promise<void>}
 */
const sendPasswordResetEmail = async (email, resetToken) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  const subject = "Reset Your Password";
  const html = `
    <p>Hello,</p>
    <p>You have requested to reset your password. Click the link below to proceed:</p>
    <p><a href="${resetUrl}">Reset Password</a></p>
    <p>If you did not request this, please ignore this email.</p>
  `;

  await sendEmail(email, subject, html);
};

export {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail
};

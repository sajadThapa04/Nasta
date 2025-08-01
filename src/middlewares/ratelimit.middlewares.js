import rateLimit from "express-rate-limit";

// General rate limiter for auth routes
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again after 15 minutes",
  standardHeaders: true,
  legacyHeaders: false
});

// Strict rate limiter for sensitive endpoints
export const strictAuthRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // limit each IP to 5 requests per windowMs
  message: "Too many attempts, please try again after an hour",
  standardHeaders: true,
  legacyHeaders: false
});
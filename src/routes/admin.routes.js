import express from "express";
import {
  createSuperadmin,
  createAdmin,
  loginAdmin,
  logoutAdmin,
  refreshAdminToken,
  deleteAdmin,
  changePassword,
  requestPasswordReset,
  resetPassword,
  getCurrentAdmin
} from "../controllers/admin.controller.js";
import {verifyAdminJwt, verifyAdminRefreshToken} from "../middlewares/admin.auth.middlewares.js";
import {authRateLimiter, strictAuthRateLimiter} from "../middlewares/ratelimit.middlewares.js";
const router = express.Router();

// Public routes
router.route("/init-superadmin").post(createSuperadmin); // Should be protected in production
router.route("/login").post(authRateLimiter, loginAdmin);
router.route("/refresh-token").post(verifyAdminRefreshToken, authRateLimiter, refreshAdminToken);

// Password reset routes (public)
router.route("/request-password-reset").post(authRateLimiter, requestPasswordReset); // POST /api/v1/admin/request-password-reset
router.route("/reset-password").post(authRateLimiter, resetPassword); // POST /api/v1/admin/reset-password

// Protected routes (require valid admin access token)
router.use(verifyAdminJwt);

router.route("/me").get(getCurrentAdmin);
router.route("/create-admin").post(createAdmin);
router.route("/:adminId").delete(deleteAdmin); // DELETE /api/v1/admin/:adminId
router.route("/logout").post(logoutAdmin);
router.route("/change-password").post(strictAuthRateLimiter, changePassword); // POST /api/v1/admin/change-password

export default router;
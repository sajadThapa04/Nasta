import {asyncHandler} from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import Admin from "../models/admin.models.js";
import {ApiError} from "../utils/ApiError.js";

export const verifyAdminJwt = asyncHandler(async (req, res, next) => {
  try {
    // 1. Get token from cookies or Authorization header
    const token = req.cookies
      ?.adminAccessToken || req.header("Authorization")
        ?.replace("Bearer ", "");

    if (!token) {
      throw new ApiError(401, "Unauthorized request - No token provided");
    }

    // 2. Verify token
    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // 3. Find admin (including refreshToken for verification)
    const admin = await Admin.findById(decodedToken._id).select("+refreshToken");

    if (!admin || !admin.isActive) {
      throw new ApiError(401, "Invalid admin token or account inactive");
    }

    // 4. Verify token hasn't been invalidated
    if (admin.refreshToken === null) {
      throw new ApiError(401, "Token invalidated - please login again");
    }

    // 5. Attach admin to request (without sensitive fields)
    req.admin = await Admin.findById(admin._id).select("-password -refreshToken");
    next();
  } catch (error) {
    throw new ApiError(
      401, error
      ?.message || "Invalid admin access token");
  }
});

// NEW: Refresh token verification middleware
export const verifyAdminRefreshToken = asyncHandler(async (req, res, next) => {
  try {
    const incomingRefreshToken = req.cookies
      ?.adminRefreshToken || req.body
        ?.refreshToken;

    if (!incomingRefreshToken) {
      throw new ApiError(401, "Unauthorized request - No refresh token");
    }

    const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

    const admin = await Admin.findById(decodedToken._id).select("+refreshToken");

    if (!admin) {
      throw new ApiError(401, "Invalid refresh token");
    }

    if (incomingRefreshToken !== admin.refreshToken) {
      throw new ApiError(401, "Refresh token is expired or used");
    }

    req.admin = admin;
    next();
  } catch (error) {
    throw new ApiError(
      401, error
      ?.message || "Invalid refresh token");
  }
});
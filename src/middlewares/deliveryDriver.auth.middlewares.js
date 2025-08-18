import {asyncHandler} from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import DeliveryDriver from "../models/deliveryDriver.models.js";
import {ApiError} from "../utils/ApiError.js";
import dotenv from "dotenv";

dotenv.config({path: "./.env"});

export const verifyDriverJwt = asyncHandler(async (req, _, next) => {
  try {
    // Grab token from cookie or Authorization header
    const token = req.cookies
      ?.accessToken || req.header("Authorization")
        ?.replace("Bearer ", "");

    if (!token) {
      throw new ApiError(401, "Unauthorized request: No token provided");
    }

    // Verify JWT
    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // Find the driver in the DB, exclude sensitive fields
    const driver = await DeliveryDriver.findById(
      decodedToken
      ?._id).select("-password -refreshToken -deviceToken -fcmToken");

    if (!driver) {
      throw new ApiError(403, "Invalid access token: Driver not found");
    }

    // Attach driver to request object for downstream middleware/routes
    req.driver = driver;

    next();
  } catch (error) {
    throw new ApiError(
      401, error
      ?.message || "Invalid access token");
  }
});

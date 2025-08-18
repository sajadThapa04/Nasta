// import {asyncHandler} from "../utils/asyncHandler.js";
// import jwt from "jsonwebtoken";
// import BusinessOwner from "../models/AdminBusinessOwner.models.js";
// import {ApiError} from "../utils/ApiError.js";
// import dotenv from "dotenv";

// dotenv.config({path: "./.env"});

// export const verifyBusinessOwnerJwt = asyncHandler(async (req, _, next) => {
//   try {
//     // Get token from cookies or Authorization header
//     const token = req.cookies?.accessToken || 
//                  req.header("Authorization")?.replace("Bearer ", "");

//     if (!token) {
//       throw new ApiError(401, "Unauthorized request");
//     }

//     // Verify token
//     const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    
//     // Find business owner and exclude sensitive fields
//     const businessOwner = await BusinessOwner.findById(decodedToken?._id)
//       .select("-password -refreshToken");

//     if (!businessOwner) {
//       throw new ApiError(403, "Invalid access token");
//     }

//     // Additional checks for business owner status
//     if (businessOwner.status === "banned") {
//       throw new ApiError(403, "Account banned. Please contact support.");
//     }

//     if (businessOwner.status === "inactive") {
//       throw new ApiError(403, "Account inactive. Please contact support.");
//     }

//     if (!businessOwner.isEmailVerified) {
//       throw new ApiError(403, "Please verify your email first");
//     }

//     // Attach business owner to request object
//     req.businessOwner = businessOwner;
//     next();
//   } catch (error) {
//     throw new ApiError(
//       401, 
//       error?.message || "Invalid access token",
//       error
//     );
//   }
// });
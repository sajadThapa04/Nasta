import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import DeliveryDriver from "../models/deliveryDriver.models.js";
import mongoose from "mongoose";
import {isPasswordStrong, isEmailValid, isPhoneValid, areRequiredFieldsProvided} from "../utils/validator.js";
import {sendWhatsAppMessage} from "../utils/twilioService.js";
import {uploadOnCloudinary, deleteFromCloudinary} from "../utils/cloudinary.js";
import logger from "../utils/logger.js";
import jwt from "jsonwebtoken";
import geocodeCoordinates from "../utils/geoCordinates.js";
// Helper functions
const generateDriverTokens = async driverId => {
  try {
    const driver = await DeliveryDriver.findById(driverId);
    const accessToken = driver.generateAccessToken();
    const refreshToken = driver.generateRefreshToken();
    driver.refreshToken = refreshToken;
    await driver.save({validateBeforeSave: false});
    return {accessToken, refreshToken};
  } catch (error) {
    throw new ApiError(500, "Failed to generate tokens");
  }
};

const validateDriverId = id => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid driver ID");
  }
};

const validateDriverData = data => {
  const requiredFields = [
    "fullName",
    "email",
    "password",
    "phone",
    "licenseNumber",
    "licenseExpiry",
    "vehicleType",
    "vehiclePlateNumber",
    "emergencyContactName",
    "emergencyContactPhone",
    "emergencyContactRelation",
    "bankAccount.accountHolderName",
    "bankAccount.accountNumber",
    "bankAccount.bankName",
    "address.country",
    "address.city",
    "address.street",
    "address.coordinates"
  ];

  if (!areRequiredFieldsProvided(requiredFields, data)) {
    throw new ApiError(400, "All required fields must be provided");
  }

  if (!isEmailValid(data.email)) {
    throw new ApiError(400, "Invalid email format");
  }

  if (!isPhoneValid(data.phone)) {
    throw new ApiError(400, "Invalid phone number");
  }

  if (!isPasswordStrong(data.password)) {
    throw new ApiError(400, "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character.");
  }

  if (new Date(data.licenseExpiry) < new Date()) {
    throw new ApiError(400, "Driver license has expired");
  }

  if (data.insuranceExpiry && new Date(data.insuranceExpiry) < new Date()) {
    throw new ApiError(400, "Insurance has expired");
  }

  // Validate address coordinates structure
  if (!Array.isArray(data.address.coordinates) || data.address.coordinates.length !== 2 || !data.address.coordinates.every(c => typeof c === "number")) {
    throw new ApiError(400, "Address coordinates must be an array of two numbers [longitude, latitude]");
  }
};

// Driver Registration
const registerDriver = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Destructure required fields from request body
    const {
      email,
      phone,
      licenseNumber,
      licenseExpiry,
      vehiclePlateNumber,
      coordinates,
      fullName,
      password,
      dob,
      vehicleType,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      insuranceProvider,
      insurancePolicyNumber,
      insuranceExpiry,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelation,
      bankAccount
    } = req.body;

    // Check required fields
    if (!email || !phone || !licenseNumber || !vehiclePlateNumber || !coordinates) {
      throw new ApiError(400, "Email, phone, license number, vehicle plate number, and coordinates are required");
    }

    // Validate coordinates
    if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(coord => typeof coord === "number")) {
      throw new ApiError(400, "Coordinates must be an array of two numbers [longitude, latitude]");
    }

    const [longitude, latitude] = coordinates;
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      throw new ApiError(400, "Invalid coordinates. Longitude must be between -180 and 180, and latitude must be between -90 and 90");
    }

    // Geocode coordinates to get address details
    const geocodedAddress = await geocodeCoordinates(coordinates);
    if (!geocodedAddress) {
      throw new ApiError(500, "Failed to determine address from coordinates");
    }

    // Check for existing driver
    const existingDriver = await DeliveryDriver.findOne({
      $or: [{
          email
        }, {
          phone
        }, {
          licenseNumber
        }, {
          vehiclePlateNumber
        }]
    }).session(session);

    if (existingDriver) {
      let conflictField = "";
      if (existingDriver.email === email) 
        conflictField = "email";
      else if (existingDriver.phone === phone) 
        conflictField = "phone";
      else if (existingDriver.licenseNumber === licenseNumber) 
        conflictField = "license number";
      else if (existingDriver.vehiclePlateNumber === vehiclePlateNumber) 
        conflictField = "vehicle plate number";
      
      throw new ApiError(409, `Driver with this ${conflictField} already exists`);
    }

    // Create new driver with geocoded address
    const driver = new DeliveryDriver({
      fullName,
      email,
      password,
      phone,
      dob: dob
        ? new Date(dob)
        : undefined,
      licenseNumber,
      licenseExpiry: new Date(licenseExpiry),
      vehicleType,
      vehiclePlateNumber,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      insuranceProvider,
      insurancePolicyNumber,
      insuranceExpiry: insuranceExpiry
        ? new Date(insuranceExpiry)
        : undefined,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelation,
      bankAccount,
      address: {
        country: geocodedAddress.country || "Unknown",
        city: geocodedAddress.city || "Unknown",
        street: geocodedAddress.street || "Unknown",
        zipCode: geocodedAddress.zipCode || "Unknown",
        coordinates: {
          type: "Point",
          coordinates
        }
      },
      currentLocation: {
        type: "Point",
        coordinates
      },
      currentAddress: {
        country: geocodedAddress.country || "Unknown",
        city: geocodedAddress.city || "Unknown",
        street: geocodedAddress.street || "Unknown",
        zipCode: geocodedAddress.zipCode || "Unknown"
      },
      status: "pending_approval"
    });

    await driver.save({session});
    await session.commitTransaction();

    // Get created driver without sensitive fields
    const createdDriver = await DeliveryDriver.findById(driver._id).select("-password -refreshToken -__v -deviceToken -fcmToken");

    // Send welcome message
    try {
      await sendWhatsAppMessage(phone, `Hi ${fullName}, your driver account has been created and is pending approval. We'll notify you once approved.`);
    } catch (whatsAppError) {
      logger.error(`Failed to send WhatsApp message: ${whatsAppError.message}`);
    }

    return res.status(201).json(new ApiResponse(201, createdDriver, "Driver registered successfully. Pending approval."));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Driver registration failed: ${error.message}`, {stack: error.stack});

    if (error instanceof mongoose.Error.ValidationError) {
      const messages = Object.values(error.errors).map(err => err.message);
      throw new ApiError(400, `Validation error: ${messages.join(", ")}`);
    }
    if (error.code === 11000) {
      throw new ApiError(409, "Duplicate field value entered");
    }
    throw error;
  } finally {
    session.endSession();
  }
});
// Driver Login
const loginDriver = asyncHandler(async (req, res) => {
  const {email, password} = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  const driver = await DeliveryDriver.findOne({email});

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const isPasswordValid = await driver.comparePassword(password);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid credentials");
  }

  if (driver.status !== "active") {
    throw new ApiError(403, `Driver account is ${driver.status}. Please contact support.`);
  }

  const {accessToken, refreshToken} = await generateDriverTokens(driver._id);

  const loggedInDriver = await DeliveryDriver.findById(driver._id).select("-password -refreshToken -__v -deviceToken -fcmToken");

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production"
      ? "none"
      : "lax"
  };

  return res.status(200).cookie("accessToken", accessToken, options).cookie("refreshToken", refreshToken, options).json(new ApiResponse(200, {
    driver: loggedInDriver,
    accessToken,
    refreshToken
  }, "Driver logged in successfully"));
});

// Logout Driver
const logoutDriver = asyncHandler(async (req, res) => {
  await DeliveryDriver.findByIdAndUpdate(req.driver._id, {
    $unset: {
      refreshToken: 1
    }
  }, {new: true});

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production"
  };

  return res.status(200).clearCookie("accessToken", options).clearCookie("refreshToken", options).json(new ApiResponse(200, {}, "Driver logged out successfully"));
});

// Refresh Access Token
const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized request");
  }

  try {
    const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

    const driver = await DeliveryDriver.findById(decodedToken._id);

    if (!driver || incomingRefreshToken !== driver.refreshToken) {
      throw new ApiError(401, "Invalid refresh token");
    }

    const {accessToken, refreshToken: newRefreshToken} = await generateDriverTokens(driver._id);

    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production"
    };

    return res.status(200).cookie("accessToken", accessToken, options).cookie("refreshToken", newRefreshToken, options).json(new ApiResponse(200, {
      accessToken,
      refreshToken: newRefreshToken
    }, "Access token refreshed"));
  } catch (error) {
    throw new ApiError(
      401, error
      ?.message || "Invalid refresh token");
  }
});

// Get Current Driver
const getCurrentDriver = asyncHandler(async (req, res) => {
  const driver = await DeliveryDriver.findById(req.driver._id).select("-password -refreshToken -__v -deviceToken -fcmToken");

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  return res.status(200).json(new ApiResponse(200, driver, "Current driver fetched successfully"));
});

// Update Driver Profile
const updateDriverProfile = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const updates = {};
    const {fullName, phone, emergencyContactName, emergencyContactPhone, emergencyContactRelation} = req.body;

    if (fullName) {
      if (isStringEmpty(fullName)) {
        throw new ApiError(400, "Full name cannot be empty");
      }
      updates.fullName = fullName;
    }

    if (phone) {
      if (!isPhoneValid(phone)) {
        throw new ApiError(400, "Invalid phone number");
      }

      const existingPhone = await DeliveryDriver.findOne({
        phone,
        _id: {
          $ne: req.driver._id
        }
      }).session(session);
      if (existingPhone) 
        throw new ApiError(409, "Phone number already in use");
      updates.phone = phone;
    }

    if (emergencyContactName) 
      updates.emergencyContactName = emergencyContactName;
    if (emergencyContactPhone) 
      updates.emergencyContactPhone = emergencyContactPhone;
    if (emergencyContactRelation) 
      updates.emergencyContactRelation = emergencyContactRelation;
    
    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, "At least one field is required to update");
    }

    const updatedDriver = await DeliveryDriver.findByIdAndUpdate(req.driver._id, updates, {
      new: true,
      session
    }).select("-password -refreshToken -__v -deviceToken -fcmToken");

    if (!updatedDriver) {
      throw new ApiError(404, "Driver not found");
    }

    await session.commitTransaction();
    return res.status(200).json(new ApiResponse(200, updatedDriver, "Driver profile updated successfully"));
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// Update Driver Password
const updateDriverPassword = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {currentPassword, newPassword} = req.body;

    if (!currentPassword || !newPassword) {
      throw new ApiError(400, "Current and new password are required");
    }

    if (!isPasswordStrong(newPassword)) {
      throw new ApiError(400, "New password is too weak");
    }

    const driver = await DeliveryDriver.findById(req.driver._id).session(session);

    if (!driver) {
      throw new ApiError(404, "Driver not found");
    }

    const isPasswordValid = await driver.comparePassword(currentPassword);
    if (!isPasswordValid) {
      throw new ApiError(401, "Current password is incorrect");
    }

    driver.password = newPassword;
    await driver.save({session});

    await session.commitTransaction();
    return res.status(200).json(new ApiResponse(200, {}, "Password updated successfully"));
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// Update Driver Location
const updateDriverLocation = asyncHandler(async (req, res) => {
  const {longitude, latitude} = req.body;

  if (!longitude || !latitude) {
    throw new ApiError(400, "Longitude and latitude are required");
  }

  const long = parseFloat(longitude);
  const lat = parseFloat(latitude);

  if (isNaN(long) || isNaN(lat)) {
    throw new ApiError(400, "Coordinates must be valid numbers");
  }

  try {
    // Geocode coordinates first
    const geocodedAddress = await geocodeCoordinates([long, lat]);

    const updateData = {
      currentLocation: {
        type: "Point",
        coordinates: [long, lat]
      },
      lastActive: new Date()
    };

    // Add address details if geocoding succeeded
    if (geocodedAddress) {
      updateData.currentAddress = {
        country: geocodedAddress.country || "Unknown",
        city: geocodedAddress.city || "Unknown",
        street: geocodedAddress.street || "Unknown",
        zipCode: geocodedAddress.zipCode || "Unknown"
      };
    }

    const driver = await DeliveryDriver.findByIdAndUpdate(req.driver._id, updateData, {new: true}).select("-password -refreshToken -__v -deviceToken -fcmToken");

    if (!driver) {
      throw new ApiError(404, "Driver not found");
    }

    return res.status(200).json(new ApiResponse(200, driver, "Location and address updated successfully"));
  } catch (error) {
    logger.error(`Location update failed: ${error.message}`, {stack: error.stack});

    // Fallback to just updating coordinates if geocoding fails
    try {
      const driver = await DeliveryDriver.findByIdAndUpdate(req.driver._id, {
        currentLocation: {
          type: "Point",
          coordinates: [long, lat]
        },
        lastActive: new Date()
      }, {new: true}).select("-password -refreshToken -__v -deviceToken -fcmToken");

      return res.status(200).json(new ApiResponse(200, driver, "Location updated (address update failed)"));
    } catch (fallbackError) {
      throw new ApiError(500, "Failed to update location");
    }
  }
});

// Update Driver Status (Available/On Duty)
const updateDriverStatus = asyncHandler(async (req, res) => {
  const {isAvailable, isOnDuty} = req.body;

  if (typeof isAvailable !== "boolean" && typeof isOnDuty !== "boolean") {
    throw new ApiError(400, "At least one status field is required");
  }

  const updates = {};
  if (typeof isAvailable === "boolean") 
    updates.isAvailable = isAvailable;
  if (typeof isOnDuty === "boolean") 
    updates.isOnDuty = isOnDuty;
  
  const driver = await DeliveryDriver.findByIdAndUpdate(req.driver._id, updates, {new: true}).select("-password -refreshToken -__v -deviceToken -fcmToken");

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  return res.status(200).json(new ApiResponse(200, driver, "Driver status updated successfully"));
});

// Delete Driver Account
const deleteDriverAccount = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {password} = req.body;

    if (!password) {
      throw new ApiError(400, "Password is required for account deletion");
    }

    const driver = await DeliveryDriver.findById(req.driver._id).session(session);

    if (!driver) {
      throw new ApiError(404, "Driver not found");
    }

    const isPasswordValid = await driver.comparePassword(password);
    if (!isPasswordValid) {
      throw new ApiError(401, "Password is incorrect");
    }

    await DeliveryDriver.findByIdAndDelete(req.driver._id, {session});

    await session.commitTransaction();

    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production"
    };

    return res.status(200).clearCookie("accessToken", options).clearCookie("refreshToken", options).json(new ApiResponse(200, {}, "Account deleted successfully"));
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// Upload Driver Document
const uploadDriverDocument = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {documentType} = req.body;
    const documentFile = req.file
      ?.path;

    if (!["licensePhoto", "vehiclePhoto", "insurancePhoto", "profileImage"].includes(documentType)) {
      throw new ApiError(400, "Invalid document type");
    }

    if (!documentFile) {
      throw new ApiError(400, "Document file is required");
    }

    const driver = await DeliveryDriver.findById(req.driver._id).session(session);
    if (!driver) {
      throw new ApiError(404, "Driver not found");
    }

    // Upload document to Cloudinary
    const folderMap = {
      licensePhoto: "driver_documents",
      vehiclePhoto: "driver_vehicles",
      insurancePhoto: "driver_documents",
      profileImage: "driver_profiles"
    };

    const document = await uploadOnCloudinary(documentFile, folderMap[documentType]);
    if (
      !document
      ?.url) {
      throw new ApiError(500, "Failed to upload document");
    }

    // Delete old document if exists
    if (driver[documentType] && driver[documentType] !== "default-driver.png") {
      await deleteFromCloudinary(driver[documentType]);
    }

    // Update driver document
    driver[documentType] = document.url;
    await driver.save({session});

    await session.commitTransaction();

    return res.status(200).json(new ApiResponse(200, driver, `${documentType} uploaded successfully`));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in uploadDriverDocument: ${error.message}`);
    throw error;
  } finally {
    session.endSession();
  }
});

// Delete Driver Document
const deleteDriverDocument = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id, documentType } = req.params;

    // Validate document type
    if (!["licensePhoto", "vehiclePhoto", "insurancePhoto", "profileImage"].includes(documentType)) {
      throw new ApiError(400, "Invalid document type");
    }

    const driver = await DeliveryDriver.findById(req.driver._id).session(session);
    if (!driver) {
      throw new ApiError(404, "Driver not found");
    }

    // Get current document value
    const docValue = driver[documentType];
    
    // Check if document exists and isn't default profile image
    if (!docValue || (documentType === "profileImage" && docValue === "default-driver.png")) {
      throw new ApiError(404, `No ${documentType} to delete`);
    }

    // Prepare array of deletion promises
    const deletionPromises = [];

    if (typeof docValue === "string" && docValue.startsWith("http")) {
      // Extract public_id from URL
      const parts = docValue.split("/");
      const filename = parts[parts.length - 1];
      const publicId = filename.split(".")[0];

      deletionPromises.push(deleteFromCloudinary(publicId).then(result => {
        if (result?.result !== "ok") {
          logger.warn(
            `Document ${documentType} deletion result: ${result?.result} for driver ${req.driver._id}`
          );
        }
      }));
    } else if (typeof docValue === "string" && docValue.trim()) {
      // Assume it's already a public ID
      deletionPromises.push(deleteFromCloudinary(docValue).then(result => {
        if (result?.result !== "ok") {
          logger.warn(
            `Document ${documentType} deletion result: ${result?.result} for driver ${req.driver._id}`
          );
        }
      }));
    } else {
      // docValue is not a string or not in expected format
      logger.warn(`Document ${documentType} for driver ${req.driver._id} has unexpected format`);
    }

    // Await deletion(s)
    await Promise.all(deletionPromises);

    // Remove the document reference and save
    driver[documentType] = documentType === "profileImage" 
      ? "default-driver.png" 
      : undefined;
    await driver.save({ session });

    await session.commitTransaction();

    const response = new ApiResponse(200, driver, `${documentType} deleted successfully`);
    logger.info(`Document deleted for driver - ID: ${req.driver._id}, Type: ${documentType}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in deleteDriverDocument: ${error.message}`, { stack: error.stack });
    
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Failed to delete document");
  } finally {
    session.endSession();
  }
});
export {
  registerDriver,
  loginDriver,
  logoutDriver,
  refreshAccessToken,
  getCurrentDriver,
  updateDriverProfile,
  updateDriverPassword,
  updateDriverLocation,
  updateDriverStatus,
  deleteDriverAccount,
  uploadDriverDocument,
  deleteDriverDocument
};
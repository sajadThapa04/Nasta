import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import mongoose from "mongoose";
import DeliveryDriver from "../models/deliveryDriver.models.js";
import Admin from "../models/admin.models.js";
import {isEmailValid, isPhoneValid, isPasswordStrong} from "../utils/validator.js";
import {uploadOnCloudinary, deleteFromCloudinary} from "../utils/cloudinary.js";
import logger from "../utils/logger.utils.js";

// Helper function to validate admin permissions
const checkAdminPermissions = (admin, requiredPermission) => {
  if (!admin || !admin.permissions[requiredPermission]) {
    logger.error(
      `Permission denied for ${admin
      ?._id} - required: ${requiredPermission}`);
    throw new ApiError(403, "You don't have permission to perform this action");
  }
};

// @desc    Get all delivery drivers (with pagination, filtering, and sorting)
// @route   GET /api/admin/delivery-drivers
// @access  Private/Admin
const getAllDeliveryDrivers = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger.info(`Admin ${req.admin._id} fetching delivery drivers`);
    checkAdminPermissions(req.admin, "manageStaff");

    const {
      page = 1,
      limit = 10,
      status,
      sortBy,
      sortOrder = "asc"
    } = req.query;

    // Build query
    const query = {};
    if (status) 
      query.status = status;
    
    // Build sort
    const sortOptions = {};
    if (sortBy) 
      sortOptions[sortBy] = sortOrder === "asc"
        ? 1
        : -1;
    
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: sortOptions,
      select: "-password -refreshToken -__v -deviceToken -fcmToken"
    };

    const drivers = await DeliveryDriver.paginate(query, options, {session});

    logger.info(`Successfully retrieved ${drivers.docs.length} drivers for admin ${req.admin._id}`);
    await session.commitTransaction();

    return res.status(200).json(new ApiResponse(200, drivers, "Delivery drivers retrieved successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in getAllDeliveryDrivers: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) 
      throw error;
    throw new ApiError(500, "Failed to retrieve delivery drivers");
  } finally {
    session.endSession();
  }
});

// @desc    Get driver by ID
// @route   GET /api/admin/delivery-drivers/:id
// @access  Private/Admin
const getDriverById = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    logger.info(`Admin ${req.admin._id} fetching driver ${id}`);

    checkAdminPermissions(req.admin, "manageStaff");

    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.error(`Invalid driver ID format: ${id}`);
      throw new ApiError(400, "Invalid driver ID");
    }

    const driver = await DeliveryDriver.findById(id).select("-password -refreshToken -__v -deviceToken -fcmToken").session(session);

    if (!driver) {
      logger.error(`Driver not found: ${id}`);
      throw new ApiError(404, "Driver not found");
    }

    logger.info(`Successfully retrieved driver ${id} for admin ${req.admin._id}`);
    await session.commitTransaction();

    return res.status(200).json(new ApiResponse(200, driver, "Driver retrieved successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in getDriverById: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) 
      throw error;
    throw new ApiError(500, "Failed to retrieve driver");
  } finally {
    session.endSession();
  }
});

// @desc    Update driver status (approve/reject/suspend)
// @route   PATCH /api/admin/delivery-drivers/:id/status
// @access  Private/Admin
const updateDriverStatus = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {status, suspensionReason} = req.body;
    logger.info(`Admin ${req.admin._id} updating status for driver ${id} to ${status}`);

    checkAdminPermissions(req.admin, "manageStaff");

    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.error(`Invalid driver ID format: ${id}`);
      throw new ApiError(400, "Invalid driver ID");
    }

    if (!["active", "suspended", "rejected"].includes(status)) {
      logger.error(`Invalid status value: ${status}`);
      throw new ApiError(400, "Invalid status value");
    }

    if (status === "suspended" && !suspensionReason) {
      logger.error("Suspension reason required but not provided");
      throw new ApiError(400, "Suspension reason is required");
    }

    const updateData = {
      status
    };
    if (suspensionReason) 
      updateData.suspensionReason = suspensionReason;
    
    const driver = await DeliveryDriver.findByIdAndUpdate(id, updateData, {
      new: true,
      session
    }).select("-password -refreshToken -__v -deviceToken -fcmToken");

    if (!driver) {
      logger.error(`Driver not found: ${id}`);
      throw new ApiError(404, "Driver not found");
    }

    logger.info(`Successfully updated status for driver ${id} to ${status}`);
    await session.commitTransaction();

    // TODO: Send notification to driver about status change
    logger.info(`Notification should be sent to driver ${id} about status change`);

    return res.status(200).json(new ApiResponse(200, driver, "Driver status updated successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateDriverStatus: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) 
      throw error;
    throw new ApiError(500, "Failed to update driver status");
  } finally {
    session.endSession();
  }
});

// @desc    Update driver information
// @route   PUT /api/admin/delivery-drivers/:id
// @access  Private/Admin
const updateDriver = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const updateData = req.body;
    logger.info(`Admin ${req.admin._id} updating driver ${id} with data`, updateData);

    checkAdminPermissions(req.admin, "manageStaff");

    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.error(`Invalid driver ID format: ${id}`);
      throw new ApiError(400, "Invalid driver ID");
    }

    // Validate email if being updated
    if (updateData.email && !isEmailValid(updateData.email)) {
      logger.error(`Invalid email format: ${updateData.email}`);
      throw new ApiError(400, "Invalid email format");
    }

    // Validate phone if being updated
    if (updateData.phone && !isPhoneValid(updateData.phone)) {
      logger.error(`Invalid phone number: ${updateData.phone}`);
      throw new ApiError(400, "Invalid phone number");
    }

    const driver = await DeliveryDriver.findByIdAndUpdate(id, updateData, {
      new: true,
      session
    }).select("-password -refreshToken -__v -deviceToken -fcmToken");

    if (!driver) {
      logger.error(`Driver not found: ${id}`);
      throw new ApiError(404, "Driver not found");
    }

    logger.info(`Successfully updated driver ${id}`);
    await session.commitTransaction();

    return res.status(200).json(new ApiResponse(200, driver, "Driver updated successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateDriver: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) 
      throw error;
    if (error.code === 11000) {
      logger.error("Duplicate field value in driver update");
      throw new ApiError(409, "Duplicate field value entered");
    }
    throw new ApiError(500, "Failed to update driver");
  } finally {
    session.endSession();
  }
});

// @desc    Delete a driver
// @route   DELETE /api/admin/delivery-drivers/:id
// @access  Private/Admin
const deleteDriver = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    logger.info(`Admin ${req.admin._id} deleting driver ${id}`);

    checkAdminPermissions(req.admin, "manageStaff");

    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.error(`Invalid driver ID format: ${id}`);
      throw new ApiError(400, "Invalid driver ID");
    }

    const driver = await DeliveryDriver.findByIdAndDelete(id, {session});

    if (!driver) {
      logger.error(`Driver not found: ${id}`);
      throw new ApiError(404, "Driver not found");
    }

    logger.info(`Successfully deleted driver ${id}`);
    await session.commitTransaction();

    return res.status(200).json(new ApiResponse(200, null, "Driver deleted successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in deleteDriver: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) 
      throw error;
    throw new ApiError(500, "Failed to delete driver");
  } finally {
    session.endSession();
  }
});

// @desc    Get nearby available drivers
// @route   GET /api/admin/delivery-drivers/nearby
// @access  Private/Admin
const getNearbyDrivers = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      longitude,
      latitude,
      maxDistance = 5000
    } = req.query;
    logger.info(`Admin ${req.admin._id} fetching nearby drivers at ${longitude},${latitude}`);

    checkAdminPermissions(req.admin, "manageDeliverySettings");

    if (!longitude || !latitude) {
      logger.error("Missing coordinates in nearby drivers request");
      throw new ApiError(400, "Longitude and latitude are required");
    }

    const drivers = await DeliveryDriver.find({
      status: "active",
      isAvailable: true,
      currentLocation: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          $maxDistance: parseInt(maxDistance)
        }
      }
    }, null, {session}).select("-password -refreshToken -__v -deviceToken -fcmToken");

    logger.info(`Found ${drivers.length} nearby drivers for admin ${req.admin._id}`);
    await session.commitTransaction();

    return res.status(200).json(new ApiResponse(200, drivers, "Nearby drivers retrieved successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in getNearbyDrivers: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) 
      throw error;
    throw new ApiError(500, "Failed to find nearby drivers");
  } finally {
    session.endSession();
  }
});

// @desc    Reset driver password
// @route   POST /api/admin/delivery-drivers/:id/reset-password
// @access  Private/Admin
const resetDriverPassword = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {newPassword} = req.body;
    logger.info(`Admin ${req.admin._id} resetting password for driver ${id}`);

    checkAdminPermissions(req.admin, "manageStaff");

    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.error(`Invalid driver ID format: ${id}`);
      throw new ApiError(400, "Invalid driver ID");
    }

    if (!isPasswordStrong(newPassword)) {
      logger.error("Password does not meet strength requirements");
      throw new ApiError(400, "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character.");
    }

    const driver = await DeliveryDriver.findById(id).session(session);

    if (!driver) {
      logger.error(`Driver not found: ${id}`);
      throw new ApiError(404, "Driver not found");
    }

    driver.password = newPassword;
    await driver.save({session});

    logger.info(`Successfully reset password for driver ${id}`);
    await session.commitTransaction();

    return res.status(200).json(new ApiResponse(200, null, "Driver password reset successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in resetDriverPassword: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) 
      throw error;
    throw new ApiError(500, "Failed to reset driver password");
  } finally {
    session.endSession();
  }
});

// @desc    Get driver statistics
// @route   GET /api/admin/delivery-drivers/stats
// @access  Private/Admin
const getDriverStats = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger.info(`Admin ${req.admin._id} fetching driver statistics`);

    checkAdminPermissions(req.admin, "viewSalesReports");

    const stats = await DeliveryDriver.aggregate([
      {
        $group: {
          _id: "$status",
          count: {
            $sum: 1
          },
          averageRating: {
            $avg: "$averageRating"
          },
          totalDeliveries: {
            $sum: "$totalDeliveries"
          }
        }
      }, {
        $project: {
          status: "$_id",
          count: 1,
          averageRating: {
            $round: ["$averageRating", 2]
          },
          totalDeliveries: 1,
          _id: 0
        }
      }
    ], {session});

    const totalDrivers = await DeliveryDriver.countDocuments({}, {session});
    const activeDrivers = await DeliveryDriver.countDocuments({
      status: "active",
      isAvailable: true
    }, {session});

    logger.info(`Successfully retrieved statistics for ${totalDrivers} drivers`);
    await session.commitTransaction();

    return res.status(200).json(new ApiResponse(200, {
      stats,
      totalDrivers,
      activeDrivers
    }, "Driver statistics retrieved successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in getDriverStats: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) 
      throw error;
    throw new ApiError(500, "Failed to retrieve driver statistics");
  } finally {
    session.endSession();
  }
});

// Delete Driver Document
const deleteDriverDocument = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id, documentType} = req.params;

    // Validate document type
    if (!["licensePhoto", "vehiclePhoto", "insurancePhoto", "profileImage"].includes(documentType)) {
      throw new ApiError(400, "Invalid document type");
    }

    const driver = await DeliveryDriver.findById(id).session(session);
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
        if (
          result
          ?.result !== "ok") {
          logger.warn(
            `Document ${documentType} deletion result: ${result
            ?.result} for driver ${id}`);
        }
      }));
    } else if (typeof docValue === "string" && docValue.trim()) {
      // Assume it's already a public ID
      deletionPromises.push(deleteFromCloudinary(docValue).then(result => {
        if (
          result
          ?.result !== "ok") {
          logger.warn(
            `Document ${documentType} deletion result: ${result
            ?.result} for driver ${id}`);
        }
      }));
    } else {
      // docValue is not a string or not in expected format
      logger.warn(`Document ${documentType} for driver ${id} has unexpected format`);
    }

    // Await deletion(s)
    await Promise.all(deletionPromises);

    // Remove the document reference and save
    driver[documentType] = documentType === "profileImage"
      ? "default-driver.png"
      : undefined;
    await driver.save({session});

    await session.commitTransaction();

    const response = new ApiResponse(200, driver, `${documentType} deleted successfully`);
    logger.info(`Document deleted for driver - ID: ${id}, Type: ${documentType}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in deleteDriverDocument: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Failed to delete document");
  } finally {
    session.endSession();
  }
});

export {
  getAllDeliveryDrivers,
  getDriverById,
  updateDriverStatus,
  updateDriver,
  deleteDriver,
  getNearbyDrivers,
  resetDriverPassword,
  getDriverStats,
  deleteDriverDocument
};
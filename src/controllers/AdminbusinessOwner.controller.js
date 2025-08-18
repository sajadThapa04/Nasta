import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import FoodVenue from "../models/foodVenue.models.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import BusinessOwner from "../models/businessOwner.models.js";
import {uploadOnCloudinary, deleteFromCloudinary} from "../utils/cloudinary.js";
import logger from "../utils/logger.js";
import mongoose from "mongoose";

// Helper function to validate business owner ID
const validateBusinessOwnerId = id => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid business owner ID");
  }
};

// @desc    Get all business owners (admin view)
// @route   GET /api/business-owners
// @access  Private/Admin
const getAllBusinessOwners = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      businessType,
      search,
      sortBy = "createdAt",
      sortOrder = "desc"
    } = req.query;

    const query = {};

    // Filter by status if provided
    if (status) {
      if (!["active", "inactive", "pending", "suspended", "rejected"].includes(status)) {
        throw new ApiError(400, "Invalid status value");
      }
      query.status = status;
    }

    // Filter by business type if provided
    if (businessType) {
      query.businessType = businessType;
    }

    // Search by business name if search query is provided
    if (search) {
      query.businessName = {
        $regex: search,
        $options: "i"
      };
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc"
      ? -1
      : 1;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: sortOptions,
      populate: "services"
    };

    const result = await BusinessOwner.paginate(query, options);

    const response = new ApiResponse(200, result, "Business owners retrieved successfully");
    logger.info(`Retrieved ${result.docs.length} business owners out of ${result.totalDocs}`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getAllBusinessOwners: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// @desc    Get a single business owner by ID (admin view)
// @route   GET /api/business-owners/:id
// @access  Private/Admin
const getBusinessOwnerById = asyncHandler(async (req, res) => {
  try {
    const {id} = req.params;
    validateBusinessOwnerId(id);

    const businessOwner = await BusinessOwner.findById(id).populate("services");

    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    const response = new ApiResponse(200, businessOwner, "Business owner retrieved successfully");
    logger.info(`Business owner retrieved - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getBusinessOwnerById: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// @desc    Update business owner status (admin only)
// @route   PATCH /api/business-owners/:id/status
// @access  Private/Admin
const updateBusinessOwnerStatus = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {status} = req.body;
    validateBusinessOwnerId(id);

    if (!["active", "inactive", "pending", "suspended", "rejected"].includes(status)) {
      throw new ApiError(400, "Invalid status value");
    }

    const businessOwner = await BusinessOwner.findByIdAndUpdate(id, {
      status
    }, {
      new: true,
      session
    });

    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    await session.commitTransaction();

    const response = new ApiResponse(200, businessOwner, "Business owner status updated successfully");
    logger.info(`Business owner status updated - ID: ${id}, New Status: ${status}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateBusinessOwnerStatus: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Verify a business owner (admin only)
// @route   PATCH /api/business-owners/:id/verify
// @access  Private/Admin
const verifyBusinessOwner = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    validateBusinessOwnerId(id);

    const businessOwner = await BusinessOwner.findByIdAndUpdate(id, {
      isVerified: true,
      verificationDate: new Date(),
      status: "active"
    }, {
      new: true,
      session
    });

    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    await session.commitTransaction();

    const response = new ApiResponse(200, businessOwner, "Business owner verified successfully");
    logger.info(`Business owner verified - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in verifyBusinessOwner: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Feature a business owner (admin only)
// @route   PATCH /api/business-owners/:id/feature
// @access  Private/Admin
const featureBusinessOwner = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {featuredUntil} = req.body;
    validateBusinessOwnerId(id);

    if (!featuredUntil || isNaN(new Date(featuredUntil))) {
      throw new ApiError(400, "Valid featuredUntil date is required");
    }

    const businessOwner = await BusinessOwner.findByIdAndUpdate(id, {
      isFeatured: true,
      featuredUntil: new Date(featuredUntil)
    }, {
      new: true,
      session
    });

    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    await session.commitTransaction();

    const response = new ApiResponse(200, businessOwner, "Business owner featured successfully");
    logger.info(`Business owner featured - ID: ${id}, Featured Until: ${featuredUntil}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in featureBusinessOwner: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Delete a business owner (admin only)
// @route   DELETE /api/business-owners/:id
// @access  Private/Admin
const deleteBusinessOwner = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    validateBusinessOwnerId(id);

    const businessOwner = await BusinessOwner.findById(id).session(session);
    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    // Delete associated files from Cloudinary
    const deletionPromises = [];

    if (businessOwner.logo) {
      deletionPromises.push(deleteFromCloudinary(businessOwner.logo).then(result => {
        if (result.result !== "ok") {
          logger.warn(`Logo deletion result: ${result.result} for business ${id}`);
        }
      }));
    }

    if (businessOwner.coverPhoto) {
      deletionPromises.push(deleteFromCloudinary(businessOwner.coverPhoto).then(result => {
        if (result.result !== "ok") {
          logger.warn(`Cover photo deletion result: ${result.result} for business ${id}`);
        }
      }));
    }

    for (const docType in businessOwner.documents) {
      const docValue = businessOwner.documents[docType];
      if (typeof docValue === "string" && docValue.startsWith("http")) {
        const parts = docValue.split("/");
        const filename = parts[parts.length - 1];
        const publicId = filename.split(".")[0];

        deletionPromises.push(deleteFromCloudinary(publicId).then(result => {
          if (
            result
            ?.result !== "ok") {
            logger.warn(
              `Document ${docType} deletion result: ${result
              ?.result} for business ${id}`);
          }
        }));
      } else if (typeof docValue === "string" && docValue.trim()) {
        deletionPromises.push(deleteFromCloudinary(docValue).then(result => {
          if (
            result
            ?.result !== "ok") {
            logger.warn(
              `Document ${docType} deletion result: ${result
              ?.result} for business ${id}`);
          }
        }));
      }
    }

    await Promise.all(deletionPromises);
    await BusinessOwner.findByIdAndDelete(id).session(session);
    await session.commitTransaction();

    const response = new ApiResponse(200, null, "Business owner deleted successfully");
    logger.info(`Business owner deleted - ID: ${id}, Name: ${businessOwner.businessName}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in deleteBusinessOwner: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

const getAllFoodVenues = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      service,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      longitude,
      latitude,
      maxDistance = 10000
    } = req.query;

    const query = {};

    if (service) {
      validateIds.serviceId(service);
      query.service = service;
      logger.debug(`Filtering by service ID: ${service}`);
    }

    if (search) {
      query.name = {
        $regex: search,
        $options: "i"
      };
      logger.debug(`Searching for venues with name containing: ${search}`);
    }

    if (longitude && latitude) {
      query["address.coordinates"] = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          $maxDistance: parseInt(maxDistance)
        }
      };
      logger.debug(`Geospatial query around coordinates: ${longitude}, ${latitude} with max distance ${maxDistance}m`);
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc"
      ? -1
      : 1;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: sortOptions,
      populate: "service"
    };

    const result = await FoodVenue.paginate(query, options);

    const response = new ApiResponse(200, result, "Food venues retrieved successfully");
    logger.info(`Successfully retrieved ${result.docs.length} food venues out of ${result.totalDocs} total`);
    logger.debug(`Pagination details - Page: ${page}, Limit: ${limit}, Total Pages: ${result.totalPages}`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getAllFoodVenues: ${error.message}`, {stack: error.stack});
    throw error;
  }
});
export {
  getAllBusinessOwners,
  getBusinessOwnerById,
  updateBusinessOwnerStatus,
  verifyBusinessOwner,
  featureBusinessOwner,
  deleteBusinessOwner,
  getAllFoodVenues
};
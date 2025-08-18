import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import BusinessOwner from "../models/businessOwner.models.js";
import User from "../models/users.models.js";
import {Service} from "../models/services.models.js";
import {uploadOnCloudinary, deleteFromCloudinary} from "../utils/cloudinary.js";
import logger from "../utils/logger.js";
import mongoose from "mongoose";
import geocodeCoordinates from "../utils/geoCordinates.js";

// Helper function to validate business owner ID
const validateBusinessOwnerId = id => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid business ID");
  }
};

// @desc    Create a new business (for authenticated users)
// @route   POST /api/business
// @access  Private
const createBusiness = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const allowedBusinessTypes = [
    "restaurant",
    "cafe",
    "bar",
    "bistro",
    "liquor-store",
    "hotel",
    "lodge",
    "home_stay",
    "luxury_villa",
    "other"
  ];

  try {
    const {
      businessName,
      businessType,
      description,
      contactEmail,
      phoneNumbers,
      coordinates,
      socialMedia,
      businessHours,
      paymentMethods
    } = req.body;

    // Get user ID from authenticated request
    const userId = req.user._id;

    if (!userId) {
      throw new ApiError(401, "Please log in to create a business");
    }

    // Check if user already has a business
    const existingBusiness = await BusinessOwner.findOne({user: userId}).session(session);
    if (existingBusiness) {
      throw new ApiError(403, `You already have a business (${existingBusiness.businessName}). 
        Each user can only create one business, but you can add multiple services under it. 
        Please go to your business dashboard to add new services.`);
    }

    // Check required fields
    if (!businessName || !businessType || !contactEmail || !coordinates) {
      throw new ApiError(400, "Business name, type, contact email and coordinates are required");
    }

    // Validate business type
    if (!allowedBusinessTypes.includes(businessType)) {
      throw new ApiError(400, `Invalid business type. Allowed types are: ${allowedBusinessTypes.join(", ")}`);
    }

    // Validate coordinates
    if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(coord => typeof coord === "number")) {
      throw new ApiError(400, "Coordinates must be an array of [longitude, latitude]");
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

    // Check if business with same name already exists globally
    const existingBusinessName = await BusinessOwner.findOne({businessName}).session(session);
    if (existingBusinessName) {
      throw new ApiError(409, "This business name is already taken. Please choose a different name");
    }

    // Create new business
    const business = new BusinessOwner({
      user: userId,
      businessName,
      businessType,
      description,
      contactEmail,
      phoneNumbers: phoneNumbers || [],
      address: {
        country: geocodedAddress.country,
        city: geocodedAddress.city,
        street: geocodedAddress.street,
        zipCode: geocodedAddress.zipCode,
        coordinates: {
          type: "Point",
          coordinates: coordinates
        }
      },
      documents: {},
      socialMedia: socialMedia || {},
      businessHours: businessHours || [],
      paymentMethods: paymentMethods || [],
      status: "pending"
    });

    await business.save({session});

    // Update user's role to business_owner and add business reference
    await User.findByIdAndUpdate(userId, {
      $set: {
        role: "business_owner"
      },
      $addToSet: {
        ownedBusinesses: business._id
      }
    }, {session, new: true});

    await session.commitTransaction();

    const response = new ApiResponse(201, business, `Your business "${businessName}" has been created successfully and is pending approval. 
      Your account has been upgraded to business owner status. You can now add multiple services under this business.`);

    logger.info(`Business created - User: ${userId}, Business: ${business._id}, Role updated to business_owner`);
    return res.status(201).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in createBusiness: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) {
      throw error;
    }
    if (error.name === "ValidationError") {
      throw new ApiError(400, "Please check your business information and try again");
    }
    if (error.code === 11000) {
      throw new ApiError(409, "This business name is already taken. Please choose a different name");
    }
    throw new ApiError(500, "We encountered an issue while creating your business. Please try again.");
  } finally {
    session.endSession();
  }
});
// @desc    Get user's businesses
// @route   GET /api/business/my-businesses
// @access  Private
const getUserBusinesses = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;

    const businesses = await BusinessOwner.find({user: userId}).populate("services").sort({createdAt: -1});

    const response = new ApiResponse(200, businesses, "User businesses retrieved successfully");
    logger.info(`Retrieved ${businesses.length} businesses for user ${userId}`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getUserBusinesses: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// @desc    Get a single business by ID (user must own it)
// @route   GET /api/business/:id
// @access  Private
const getBusinessById = asyncHandler(async (req, res) => {
  try {
    const {id} = req.params;
    validateBusinessOwnerId(id);

    const business = await BusinessOwner.findOne({_id: id, user: req.user._id}).populate("services");

    if (!business) {
      throw new ApiError(404, "Business not found or you don't have permission");
    }

    const response = new ApiResponse(200, business, "Business retrieved successfully");
    logger.info(`Business retrieved - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getBusinessById: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// @desc    Update a business (user must own it)
// @route   PUT /api/business/:id
// @access  Private
const updateBusiness = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const updateData = req.body;
    validateBusinessOwnerId(id);

    // Get the business and verify ownership
    const business = await BusinessOwner.findOne({_id: id, user: req.user._id}).session(session);

    if (!business) {
      throw new ApiError(404, "Business not found or you don't have permission");
    }

    // Prevent changing restricted fields
    const restrictedFields = [
      "status",
      "isVerified",
      "verificationDate",
      "isFeatured",
      "featuredUntil",
      "documents",
      "logo",
      "coverPhoto",
      "user"
    ];

    restrictedFields.forEach(field => delete updateData[field]);

    // If coordinates are being updated, geocode them
    if (updateData.coordinates) {
      if (!Array.isArray(updateData.coordinates) || updateData.coordinates.length !== 2) {
        throw new ApiError(400, "Coordinates must be an array of [longitude, latitude]");
      }

      const geocodedAddress = await geocodeCoordinates(updateData.coordinates);
      if (!geocodedAddress) {
        throw new ApiError(500, "Failed to determine address from coordinates");
      }

      updateData.address = {
        country: geocodedAddress.country,
        city: geocodedAddress.city,
        street: geocodedAddress.street,
        zipCode: geocodedAddress.zipCode,
        coordinates: {
          type: "Point",
          coordinates: updateData.coordinates
        }
      };

      delete updateData.coordinates;
    }

    // Update business
    Object.assign(business, updateData);
    await business.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(200, business, "Business updated successfully");
    logger.info(`Business updated - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateBusiness: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Upload business document
// @route   POST /api/business/:id/documents
// @access  Private
const uploadBusinessDocument = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {documentType} = req.body;
    const documentFile = req.file
      ?.path;

    validateBusinessOwnerId(id);

    if (!documentType || !["businessLicense", "taxId", "healthCertificate"].includes(documentType)) {
      throw new ApiError(400, "Valid document type is required (businessLicense, taxId, or healthCertificate)");
    }

    if (!documentFile) {
      throw new ApiError(400, "Document file is required");
    }

    // Verify business ownership
    const business = await BusinessOwner.findOne({_id: id, user: req.user._id}).session(session);

    if (!business) {
      throw new ApiError(404, "Business not found or you don't have permission");
    }

    // Upload document to Cloudinary
    const document = await uploadOnCloudinary(documentFile, "business_documents");
    if (
      !document
      ?.url) {
      throw new ApiError(500, "Failed to upload document");
    }

    // Delete old document if exists
    if (business.documents[documentType]) {
      await deleteFromCloudinary(business.documents[documentType]);
    }

    // Update business document
    business.documents[documentType] = document.url;
    await business.save({session});

    await session.commitTransaction();

    const response = new ApiResponse(200, business, `${documentType} uploaded successfully`);
    logger.info(`Document uploaded for business - ID: ${id}, Type: ${documentType}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in uploadBusinessDocument: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Upload business logo
// @route   POST /api/business/:id/logo
// @access  Private
const uploadBusinessLogo = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const logoFile = req.file
      ?.path;

    validateBusinessOwnerId(id);

    if (!logoFile) {
      throw new ApiError(400, "Logo file is required");
    }

    // Verify business ownership
    const business = await BusinessOwner.findOne({_id: id, user: req.user._id}).session(session);

    if (!business) {
      throw new ApiError(404, "Business not found or you don't have permission");
    }

    // Upload logo to Cloudinary
    const logo = await uploadOnCloudinary(logoFile, "business_logos");
    if (
      !logo
      ?.url) {
      throw new ApiError(500, "Failed to upload logo");
    }

    // Delete old logo if exists
    if (business.logo) {
      await deleteFromCloudinary(business.logo);
    }

    // Update business logo
    business.logo = logo.url;
    await business.save({session});

    await session.commitTransaction();

    const response = new ApiResponse(200, business, "Logo uploaded successfully");
    logger.info(`Logo uploaded for business - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in uploadBusinessLogo: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Upload business cover photo
// @route   POST /api/business/:id/cover-photo
// @access  Private
const uploadBusinessCoverPhoto = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const coverPhotoFile = req.file
      ?.path;

    validateBusinessOwnerId(id);

    if (!coverPhotoFile) {
      throw new ApiError(400, "Cover photo file is required");
    }

    // Verify business ownership
    const business = await BusinessOwner.findOne({_id: id, user: req.user._id}).session(session);

    if (!business) {
      throw new ApiError(404, "Business not found or you don't have permission");
    }

    // Upload cover photo to Cloudinary
    const coverPhoto = await uploadOnCloudinary(coverPhotoFile, "business_cover_photos");
    if (
      !coverPhoto
      ?.url) {
      throw new ApiError(500, "Failed to upload cover photo");
    }

    // Delete old cover photo if exists
    if (business.coverPhoto) {
      await deleteFromCloudinary(business.coverPhoto);
    }

    // Update business cover photo
    business.coverPhoto = coverPhoto.url;
    await business.save({session});

    await session.commitTransaction();

    const response = new ApiResponse(200, business, "Cover photo uploaded successfully");
    logger.info(`Cover photo uploaded for business - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in uploadBusinessCoverPhoto: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Get nearby businesses (public)
// @route   GET /api/business/nearby
// @access  Public
const getNearbyBusinesses = asyncHandler(async (req, res) => {
  try {
    const {
      longitude,
      latitude,
      maxDistance = 10000, // default 10km
      businessType
    } = req.query;

    if (!longitude || !latitude) {
      throw new ApiError(400, "Longitude and latitude are required");
    }

    const query = {
      "address.coordinates": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          $maxDistance: parseInt(maxDistance)
        }
      },
      status: "active" // Only show active businesses
    };

    if (businessType) {
      query.businessType = businessType;
    }

    const businesses = await BusinessOwner.find(query).limit(50).populate("services").select("-documents"); // Exclude sensitive documents

    const response = new ApiResponse(200, businesses, "Nearby businesses retrieved successfully");
    logger.info(`Retrieved ${businesses.length} nearby businesses`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getNearbyBusinesses: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// @desc    Get business by slug (public)
// @route   GET /api/business/slug/:slug
// @access  Public
const getBusinessBySlug = asyncHandler(async (req, res) => {
  try {
    const {slug} = req.params;

    const business = await BusinessOwner.findOne({businessSlug: slug, status: "active"}).populate("services");

    if (!business) {
      throw new ApiError(404, "Business not found or not active");
    }

    const response = new ApiResponse(200, business, "Business retrieved successfully");
    logger.info(`Business retrieved by slug - Slug: ${slug}, ID: ${business._id}`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getBusinessBySlug: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

export {
  createBusiness,
  getUserBusinesses,
  getBusinessById,
  updateBusiness,
  uploadBusinessDocument,
  uploadBusinessLogo,
  uploadBusinessCoverPhoto,
  getNearbyBusinesses,
  getBusinessBySlug
};
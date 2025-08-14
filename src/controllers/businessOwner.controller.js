import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import BusinessOwner from "../models/BusinessOwner.models.js";
import {Service} from "../models/services.models.js";
import {uploadOnCloudinary, deleteFromCloudinary} from "../utils/cloudinary.js";
import logger from "../utils/logger.js";
import mongoose from "mongoose";

// Helper function to validate business owner ID
const validateBusinessOwnerId = id => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid business owner ID");
  }
};

// @desc    Create a new business owner (without file uploads)
// @route   POST /api/business-owners
// @access  Private/Admin
const createBusinessOwner = asyncHandler(async (req, res) => {
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
      address,
      socialMedia,
      businessHours,
      paymentMethods
    } = req.body;

    // Get admin ID from authenticated request
    const adminId = req.admin
      ?._id;

    if (!adminId) {
      throw new ApiError(401, "Admin authentication required");
    }

    // Check required fields
    if (!businessName || !businessType || !contactEmail) {
      throw new ApiError(400, "Business name, type, and contact email are required");
    }

    // Validate business type
    if (!allowedBusinessTypes.includes(businessType)) {
      throw new ApiError(400, `Invalid business type. Allowed types are: ${allowedBusinessTypes.join(", ")}`);
    }

    // Check if business with same name already exists
    const existingBusiness = await BusinessOwner.findOne({businessName}).session(session);
    if (existingBusiness) {
      throw new ApiError(409, "Business with this name already exists");
    }

    // Create new business owner with admin reference
    const businessOwner = new BusinessOwner({
      admin: adminId,
      businessName,
      businessType,
      description,
      contactEmail,
      phoneNumbers: phoneNumbers || [],
      address: address || {},
      documents: {},
      socialMedia: socialMedia || {},
      businessHours: businessHours || [],
      paymentMethods: paymentMethods || []
    });

    await businessOwner.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(201, businessOwner, "Business owner created successfully");
    logger.info(`Business owner created successfully - ID: ${businessOwner._id}, Name: ${businessOwner.businessName}`);
    return res.status(201).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in createBusinessOwner: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});


// @desc    Get all business owners
// @route   GET /api/business-owners
// @access  Public
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

// @desc    Get a single business owner by ID
// @route   GET /api/business-owners/:id
// @access  Public
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

// @desc    Get a business owner by slug
// @route   GET /api/business-owners/slug/:slug
// @access  Public
const getBusinessOwnerBySlug = asyncHandler(async (req, res) => {
  try {
    const {slug} = req.params;

    const businessOwner = await BusinessOwner.findOne({businessSlug: slug}).populate("services");

    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    const response = new ApiResponse(200, businessOwner, "Business owner retrieved successfully");
    logger.info(`Business owner retrieved by slug - Slug: ${slug}, ID: ${businessOwner._id}`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getBusinessOwnerBySlug: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// @desc    Update a business owner
// @route   PUT /api/business-owners/:id
// @access  Private/Admin
const updateBusinessOwner = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const updateData = req.body;
    validateBusinessOwnerId(id);

    // Get the business owner
    const businessOwner = await BusinessOwner.findById(id).session(session);
    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    // Prevent changing these fields through this endpoint
    const restrictedFields = [
      "status",
      "isVerified",
      "verificationDate",
      "isFeatured",
      "featuredUntil",
      "documents",
      "logo",
      "coverPhoto"
    ];

    restrictedFields.forEach(field => delete updateData[field]);

    // Update business owner
    Object.assign(businessOwner, updateData);
    await businessOwner.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(200, businessOwner, "Business owner updated successfully");
    logger.info(`Business owner updated - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateBusinessOwner: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
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

// @desc    Delete a business owner
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
        // Extract public_id from URL inline
        const parts = docValue.split("/");
        const filename = parts[parts.length - 1]; // e.g. image123.jpg
        const publicId = filename.split(".")[0]; // remove extension

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
        // Assume this is a public ID already
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

    // Wait for all deletions to complete (regardless of success)
    await Promise.all(deletionPromises);

    // Delete the business owner
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

// @desc    Get nearby business owners
// @route   GET /api/business-owners/nearby
// @access  Public
const getNearbyBusinessOwners = asyncHandler(async (req, res) => {
  try {
    const {
      longitude,
      latitude,
      maxDistance = 10000,
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

    const businessOwners = await BusinessOwner.find(query).limit(50).populate("services");

    const response = new ApiResponse(200, businessOwners, "Nearby business owners retrieved successfully");
    logger.info(`Retrieved ${businessOwners.length} nearby business owners`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getNearbyBusinessOwners: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// @desc    Upload business document
// @route   POST /api/business-owners/:id/documents
// @access  Private/Admin
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

    const businessOwner = await BusinessOwner.findById(id).session(session);
    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    // Upload document to Cloudinary
    const document = await uploadOnCloudinary(documentFile, "business_documents");
    if (
      !document
      ?.url) {
      throw new ApiError(500, "Failed to upload document");
    }

    // Delete old document if exists
    if (businessOwner.documents[documentType]) {
      await deleteFromCloudinary(businessOwner.documents[documentType]);
    }

    // Update business document
    businessOwner.documents[documentType] = document.url;
    await businessOwner.save({session});

    await session.commitTransaction();

    const response = new ApiResponse(200, businessOwner, `${documentType} uploaded successfully`);
    logger.info(`Document uploaded for business owner - ID: ${id}, Type: ${documentType}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in uploadBusinessDocument: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Delete business document
// @route   DELETE /api/business-owners/:id/documents/:documentType
// @access  Private/Admin
const deleteBusinessDocument = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id, documentType} = req.params;

    validateBusinessOwnerId(id);

    if (!["businessLicense", "taxId", "healthCertificate"].includes(documentType)) {
      throw new ApiError(400, "Invalid document type");
    }

    const businessOwner = await BusinessOwner.findById(id).session(session);
    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    const docValue = businessOwner.documents[documentType];
    if (!docValue) {
      throw new ApiError(404, `${documentType} not found`);
    }

    // Prepare array of deletion promises (just one here, but consistent with your style)
    const deletionPromises = [];

    if (typeof docValue === "string" && docValue.startsWith("http")) {
      // Extract public_id from URL
      const parts = docValue.split("/");
      const filename = parts[parts.length - 1]; // e.g. image123.jpg
      const publicId = filename.split(".")[0]; // remove extension

      deletionPromises.push(deleteFromCloudinary(publicId).then(result => {
        if (
          result
          ?.result !== "ok") {
          logger.warn(
            `Document ${documentType} deletion result: ${result
            ?.result} for business ${id}`);
        }
      }));
    } else if (typeof docValue === "string" && docValue.trim()) {
      // Assume it is already a public ID
      deletionPromises.push(deleteFromCloudinary(docValue).then(result => {
        if (
          result
          ?.result !== "ok") {
          logger.warn(
            `Document ${documentType} deletion result: ${result
            ?.result} for business ${id}`);
        }
      }));
    } else {
      // docValue is not a string or not in expected format
      logger.warn(`Document ${documentType} for business ${id} has unexpected format`);
    }

    // Await deletion(s)
    await Promise.all(deletionPromises);

    // Remove the document reference and save
    businessOwner.documents[documentType] = undefined;
    await businessOwner.save({session});

    await session.commitTransaction();

    const response = new ApiResponse(200, businessOwner, `${documentType} deleted successfully`);
    logger.info(`Document deleted for business owner - ID: ${id}, Type: ${documentType}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in deleteBusinessDocument: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Upload business logo
// @route   POST /api/business-owners/:id/logo
// @access  Private/Admin
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

    const businessOwner = await BusinessOwner.findById(id).session(session);
    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    // Upload logo to Cloudinary
    const logo = await uploadOnCloudinary(logoFile, "business_logos");
    if (
      !logo
      ?.url) {
      throw new ApiError(500, "Failed to upload logo");
    }

    // Delete old logo if exists
    if (businessOwner.logo) {
      await deleteFromCloudinary(businessOwner.logo);
    }

    // Update business logo
    businessOwner.logo = logo.url;
    await businessOwner.save({session});

    await session.commitTransaction();

    const response = new ApiResponse(200, businessOwner, "Logo uploaded successfully");
    logger.info(`Logo uploaded for business owner - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in uploadBusinessLogo: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Delete business logo
// @route   DELETE /api/business-owners/:id/logo
// @access  Private/Admin
const deleteBusinessLogo = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;

    validateBusinessOwnerId(id);

    const businessOwner = await BusinessOwner.findById(id).session(session);
    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    // Check if logo exists
    if (!businessOwner.logo) {
      throw new ApiError(404, "Logo not found");
    }

    // Delete logo from Cloudinary
    let publicId = businessOwner.logo;
    if (publicId.startsWith("http")) {
      const parts = publicId.split("/");
      const filename = parts[parts.length - 1]; // e.g. image123.jpg
      publicId = filename.split(".")[0]; // remove extension
    }

    // Delete logo from Cloudinary
    // Delete cover photo from Cloudinary
    const result = await deleteFromCloudinary(publicId);
    if (
      result
      ?.result !== "ok") {
      logger.warn(
        `logo deletion result: ${result
        ?.result} for business ${id}`);
    }
    // Remove logo reference
    businessOwner.logo = undefined;
    await businessOwner.save({session});

    await session.commitTransaction();

    const response = new ApiResponse(200, businessOwner, "Logo deleted successfully");
    logger.info(`Logo deleted for business owner - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in deleteBusinessLogo: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Upload business cover photo
// @route   POST /api/business-owners/:id/cover-photo
// @access  Private/Admin
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

    const businessOwner = await BusinessOwner.findById(id).session(session);
    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    // Upload cover photo to Cloudinary
    const coverPhoto = await uploadOnCloudinary(coverPhotoFile, "business_cover_photos");
    if (
      !coverPhoto
      ?.url) {
      throw new ApiError(500, "Failed to upload cover photo");
    }

    // Delete old cover photo if exists
    if (businessOwner.coverPhoto) {
      await deleteFromCloudinary(businessOwner.coverPhoto);
    }

    // Update business cover photo
    businessOwner.coverPhoto = coverPhoto.url;
    await businessOwner.save({session});

    await session.commitTransaction();

    const response = new ApiResponse(200, businessOwner, "Cover photo uploaded successfully");
    logger.info(`Cover photo uploaded for business owner - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in uploadBusinessCoverPhoto: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Delete business cover photo
// @route   DELETE /api/business-owners/:id/cover-photo
// @access  Private/Admin
const deleteBusinessCoverPhoto = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;

    validateBusinessOwnerId(id);

    const businessOwner = await BusinessOwner.findById(id).session(session);
    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    // Check if cover photo exists
    if (!businessOwner.coverPhoto) {
      throw new ApiError(404, "Cover photo not found");
    }

    // Extract public_id if it's a URL
    let publicId = businessOwner.coverPhoto;
    if (typeof publicId === "string" && publicId.startsWith("http")) {
      const parts = publicId.split("/");
      const filename = parts[parts.length - 1]; // e.g. image123.jpg
      publicId = filename.split(".")[0]; // remove extension
    }

    // Delete cover photo from Cloudinary
    const result = await deleteFromCloudinary(publicId);
    if (
      result
      ?.result !== "ok") {
      logger.warn(
        `Cover photo deletion result: ${result
        ?.result} for business ${id}`);
    }
    // Remove cover photo reference
    businessOwner.coverPhoto = undefined;
    await businessOwner.save({session});

    await session.commitTransaction();

    const response = new ApiResponse(200, businessOwner, "Cover photo deleted successfully");
    logger.info(`Cover photo deleted for business owner - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in deleteBusinessCoverPhoto: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

export {
  createBusinessOwner,
  getAllBusinessOwners,
  getBusinessOwnerById,
  getBusinessOwnerBySlug,
  updateBusinessOwner,
  updateBusinessOwnerStatus,
  verifyBusinessOwner,
  featureBusinessOwner,
  deleteBusinessOwner,
  getNearbyBusinessOwners,
  uploadBusinessDocument,
  deleteBusinessDocument,
  uploadBusinessLogo,
  deleteBusinessLogo,
  uploadBusinessCoverPhoto,
  deleteBusinessCoverPhoto
};
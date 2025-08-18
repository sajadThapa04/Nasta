import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import RegisterBusiness from "../models/RegisterBusiness.models.js";
import logger from "../utils/logger.js";
import {uploadOnCloudinary, deleteFromCloudinary} from "../utils/cloudinary.js";
import {isPhoneValid, isEmailValid} from "../utils/validator.js";
import mongoose from "mongoose";
import geocodeCoordinates from "../utils/geoCordinates.js";

// Helper function to validate IDs
const validateId = id => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid ID format");
  }
};

// @desc    Register a new business
// @route   POST /api/businesses/register
// @access  Private/BusinessOwner
const registerBusiness = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      businessName,
      businessType,
      description,
      contactEmail,
      phoneNumber,
      coordinates,
      documents
    } = req.body;

    // Validate required fields
    if (!businessName || !businessType || !contactEmail || !phoneNumber || !coordinates) {
      throw new ApiError(400, "Missing required fields");
    }

    // Validate email format
    if (!isEmailValid(contactEmail)) {
      throw new ApiError(400, "Invalid email format");
    }

    // Validate phone number
    if (!isPhoneValid(phoneNumber)) {
      throw new ApiError(400, "Invalid phone number");
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

    // Check for existing business with same name
    const existingBusiness = await RegisterBusiness.findOne({businessName}).session(session);
    if (existingBusiness) {
      throw new ApiError(409, "Business with this name already exists");
    }

    // Create new business registration with structured address
    const business = new RegisterBusiness({
      businessName,
      businessType,
      description,
      contactEmail,
      phoneNumber,
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
      documents: documents || []
    });

    await business.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(201, business, "Business registration submitted successfully");
    logger.info(`Business registration created - ID: ${business._id}, Name: ${business.businessName}`);
    return res.status(201).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in registerBusiness: ${error.message}`, {stack: error.stack});

    if (error instanceof ApiError) 
      throw error;
    if (error.name === "ValidationError") 
      throw new ApiError(400, error.message);
    if (error.code === 11000) 
      throw new ApiError(409, "Duplicate field value entered");
    throw new ApiError(500, error.message || "Failed to register business");
  } finally {
    session.endSession();
  }
});

// @desc    Get all business registrations
// @route   GET /api/businesses/registrations
// @access  Private/Admin
const getAllBusinessRegistrations = asyncHandler(async (req, res) => {
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
      if (!["submitted", "under_review", "approved", "rejected"].includes(status)) {
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
      query.$or = [
        {
          businessName: {
            $regex: search,
            $options: "i"
          }
        }, {
          "address.city": {
            $regex: search,
            $options: "i"
          }
        }, {
          contactEmail: {
            $regex: search,
            $options: "i"
          }
        }
      ];
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc"
      ? -1
      : 1;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: sortOptions
    };

    const result = await RegisterBusiness.paginate(query, options);

    const response = new ApiResponse(200, result, "Business registrations retrieved successfully");
    logger.info(`Retrieved ${result.docs.length} business registrations out of ${result.totalDocs}`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getAllBusinessRegistrations: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// @desc    Get business registration by ID
// @route   GET /api/businesses/registrations/:id
// @access  Private/Admin or BusinessOwner
const getBusinessRegistrationById = asyncHandler(async (req, res) => {
  try {
    const {id} = req.params;
    validateId(id);

    const business = await RegisterBusiness.findById(id);

    if (!business) {
      throw new ApiError(404, "Business registration not found");
    }

    // Check if the requester is authorized (admin or the business owner)
    // You would need to implement your own authorization logic here
    // For example:
    // if (!req.user.isAdmin && business.owner.toString() !== req.user._id.toString()) {
    //   throw new ApiError(403, "Not authorized to access this resource");
    // }

    const response = new ApiResponse(200, business, "Business registration retrieved successfully");
    logger.info(`Business registration retrieved - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getBusinessRegistrationById: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// @desc    Update business registration
// @route   PUT /api/businesses/registrations/:id
// @access  Private/BusinessOwner
const updateBusinessRegistration = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const updateData = req.body;
    validateId(id);

    // Get the business registration
    const business = await RegisterBusiness.findById(id).session(session);
    if (!business) {
      throw new ApiError(404, "Business registration not found");
    }

    // Prevent changing status through this endpoint
    if (updateData.status) {
      throw new ApiError(400, "Cannot update status directly. Use the status update endpoint.");
    }

    // Prevent changing certain fields if already approved
    if (business.status === "approved") {
      const restrictedFields = ["businessName", "businessType", "documents"];
      restrictedFields.forEach(field => {
        if (updateData[field]) {
          throw new ApiError(400, `Cannot update ${field} after approval`);
        }
      });
    }

    // Update business registration
    Object.assign(business, updateData);
    await business.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(200, business, "Business registration updated successfully");
    logger.info(`Business registration updated - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateBusinessRegistration: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Update business registration status
// @route   PATCH /api/businesses/registrations/:id/status
// @access  Private/Admin
const updateBusinessRegistrationStatus = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {status, notes} = req.body;
    validateId(id);

    if (!["submitted", "under_review", "approved", "rejected"].includes(status)) {
      throw new ApiError(400, "Invalid status value");
    }

    const business = await RegisterBusiness.findById(id).session(session);
    if (!business) {
      throw new ApiError(404, "Business registration not found");
    }

    // The status change validation will be handled by the schema middleware

    // Update status and notes
    business.status = status;
    if (notes) {
      business.notes = notes;
    }

    await business.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(200, business, "Business registration status updated successfully");
    logger.info(`Business registration status updated - ID: ${id}, New Status: ${status}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateBusinessRegistrationStatus: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Upload business documents
// @route   POST /api/businesses/registrations/:id/documents
// @access  Private/BusinessOwner
const uploadBusinessDocuments = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const files = req.files || [];
    const {documentType} = req.body;

    validateId(id);

    if (!files || files.length === 0) {
      throw new ApiError(400, "At least one document file is required");
    }

    if (!documentType) {
      throw new ApiError(400, "Document type is required");
    }

    const business = await RegisterBusiness.findById(id).session(session);
    if (!business) {
      throw new ApiError(404, "Business registration not found");
    }

    // Prevent document uploads after approval
    // if (business.status === "approved") {
    //   throw new ApiError(400, "Cannot upload documents after approval");
    // }

    // Upload documents to Cloudinary
    const uploadPromises = files.map(file => {
      return uploadOnCloudinary(file.path, "business_documents").then(result => {
        if (
          !result
          ?.url) {
          throw new ApiError(500, `Failed to upload document ${file.originalname}`);
        }
        return {type: documentType, url: result.url};
      });
    });

    const uploadedDocuments = await Promise.all(uploadPromises);

    // Add new documents to the business registration
    business.documents.push(...uploadedDocuments);
    await business.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(200, business, "Documents uploaded successfully");
    logger.info(`Documents uploaded for business registration - ID: ${id}, Count: ${uploadedDocuments.length}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in uploadBusinessDocuments: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Delete a business document
// @route   DELETE /api/businesses/registrations/:id/documents/:docId
// @access  Private/BusinessOwner
const deleteBusinessDocument = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id, docId} = req.params;
    validateId(id);

    const business = await RegisterBusiness.findById(id).session(session);
    if (!business) {
      throw new ApiError(404, "Business registration not found");
    }

    // Prevent document deletion after approval
    // if (business.status === "approved") {
    //   throw new ApiError(400, "Cannot delete documents after approval");
    // }

    // Find the document index
    const docIndex = business.documents.findIndex(doc => doc._id.toString() === docId);
    if (docIndex === -1) {
      throw new ApiError(404, "Document not found");
    }

    const documentToDelete = business.documents[docIndex];

    // Delete document from Cloudinary
    if (documentToDelete.url.startsWith("http")) {
      const parts = documentToDelete.url.split("/");
      const filename = parts[parts.length - 1];
      const publicId = filename.split(".")[0];
      await deleteFromCloudinary(publicId).catch(error => {
        logger.warn(`Failed to delete document from Cloudinary: ${error.message}`);
      });
    }

    // Remove the document from the array
    business.documents.splice(docIndex, 1);

    await business.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(200, business, "Document deleted successfully");
    logger.info(`Document deleted from business registration - ID: ${id}, DocID: ${docId}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in deleteBusinessDocument: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Get businesses near a location
// @route   GET /api/businesses/nearby
// @access  Public
const getBusinessesNearby = asyncHandler(async (req, res) => {
  try {
    const {
      longitude,
      latitude,
      maxDistance = 10000,
      businessType
    } = req.query;

    // Validate required parameters
    if (!longitude || !latitude) {
      throw new ApiError(400, "Longitude and latitude are required");
    }

    // Parse and validate numerical values
    const parsedLng = parseFloat(longitude);
    const parsedLat = parseFloat(latitude);
    const parsedDistance = parseInt(maxDistance);

    if (isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      throw new ApiError(400, "Invalid longitude value. Must be between -180 and 180");
    }
    if (isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      throw new ApiError(400, "Invalid latitude value. Must be between -90 and 90");
    }
    if (isNaN(parsedDistance) || parsedDistance <= 0) {
      throw new ApiError(400, "Invalid maxDistance value. Must be a positive number");
    }

    // Build query
    const query = {
      "address.coordinates": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parsedLng, parsedLat]
          },
          $maxDistance: parsedDistance
        }
      },
      status: "approved" // Only show approved businesses
    };

    // Add business type filter if provided
    if (businessType) {
      if (![
        "restaurant",
        "cafe",
        "bar",
        "hotel",
        "lodge",
        "home_stay",
        "luxury_villa",
        "other"
      ].includes(businessType)) {
        throw new ApiError(400, "Invalid business type");
      }
      query.businessType = businessType;
    }

    // Execute query
    const businesses = await RegisterBusiness.find(query).limit(50).select("-documents -notes"). // Exclude sensitive/unnecessary fields
    lean();

    // Format response
    const response = new ApiResponse(200, businesses, "Nearby businesses retrieved successfully");
    logger.info(`Retrieved ${businesses.length} nearby businesses`, {
      location: [
        parsedLng, parsedLat
      ],
      distance: parsedDistance,
      businessTypeFilter: businessType || "none"
    });

    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getBusinessesNearby`, {
      error: error.message,
      stack: error.stack,
      queryParams: req.query
    });

    if (error instanceof ApiError) 
      throw error;
    if (error.name === "CastError") 
      throw new ApiError(400, "Invalid parameter format");
    throw new ApiError(500, "Failed to retrieve nearby businesses");
  }
});

export {
  registerBusiness,
  getAllBusinessRegistrations,
  getBusinessRegistrationById,
  updateBusinessRegistration,
  updateBusinessRegistrationStatus,
  uploadBusinessDocuments,
  deleteBusinessDocument,
  getBusinessesNearby
};
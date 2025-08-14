import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import {Service} from "../models/services.models.js";
import BusinessOwner from "../models/BusinessOwner.models.js";
import logger from "../utils/logger.js";
import {uploadOnCloudinary, deleteFromCloudinary} from "../utils/cloudinary.js";
import mongoose from "mongoose";

// Helper function to validate IDs
const validateIds = {
  serviceId: id => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(400, "Invalid service ID");
    }
  },
  ownerId: id => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(400, "Invalid business owner ID");
    }
  }
};

// @desc    Create a new service
// @route   POST /api/services
// @access  Private/Admin or BusinessOwner
const createService = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const allowedTypes = [
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
    const {owner, name, type, description, isAvailable} = req.body;

    // Validate required fields
    if (!owner || !name || !type) {
      throw new ApiError(400, "Owner, name, and type are required fields");
    }

    // Validate service type
    if (!allowedTypes.includes(type)) {
      throw new ApiError(400, `Invalid service type. Allowed types are: ${allowedTypes.join(", ")}`);
    }

    validateIds.ownerId(owner);

    // Check if business owner exists
    const businessOwner = await BusinessOwner.findById(owner).session(session);
    if (!businessOwner) {
      throw new ApiError(404, "Business owner not found");
    }

    // Check if service with same name already exists for this owner
    const existingService = await Service.findOne({owner, name}).session(session);
    if (existingService) {
      throw new ApiError(409, "Service with this name already exists for this business");
    }

    // Create new service
    const service = new Service({
      owner,
      name,
      type,
      description: description || "",
      isAvailable: isAvailable !== false // Default to true if not specified
    });

    await service.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(201, service, "Service created successfully");
    logger.info(`Service created successfully - ID: ${service._id}, Name: ${service.name}`);
    return res.status(201).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in createService: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});
// @desc    Get all services
// @route   GET /api/services
// @access  Public
const getAllServices = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      type,
      owner,
      search,
      sortBy = "createdAt",
      sortOrder = "desc"
    } = req.query;

    const query = {};

    // Filter by status if provided
    if (status) {
      if (!["active", "inactive", "pending", "rejected"].includes(status)) {
        throw new ApiError(400, "Invalid status value");
      }
      query.status = status;
    }

    // Filter by type if provided
    if (type) {
      query.type = type;
    }

    // Filter by owner if provided
    if (owner) {
      validateIds.ownerId(owner);
      query.owner = owner;
    }

    // Search by name if search query is provided
    if (search) {
      query.name = {
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
      populate: "owner"
    };

    const result = await Service.paginate(query, options);

    const response = new ApiResponse(200, result, "Services retrieved successfully");
    logger.info(`Retrieved ${result.docs.length} services out of ${result.totalDocs}`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getAllServices: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// @desc    Get a single service by ID
// @route   GET /api/services/:id
// @access  Public
const getServiceById = asyncHandler(async (req, res) => {
  try {
    const {id} = req.params;
    validateIds.serviceId(id);

    const service = await Service.findById(id).populate("owner");

    if (!service) {
      throw new ApiError(404, "Service not found");
    }

    const response = new ApiResponse(200, service, "Service retrieved successfully");
    logger.info(`Service retrieved - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getServiceById: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// @desc    Get a service by slug
// @route   GET /api/services/slug/:slug
// @access  Public
const getServiceBySlug = asyncHandler(async (req, res) => {
  try {
    const {slug} = req.params;

    const service = await Service.findOne({slug}).populate("owner");

    if (!service) {
      throw new ApiError(404, "Service not found");
    }

    const response = new ApiResponse(200, service, "Service retrieved successfully");
    logger.info(`Service retrieved by slug - Slug: ${slug}, ID: ${service._id}`);
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in getServiceBySlug: ${error.message}`, {stack: error.stack});
    throw error;
  }
});

// @desc    Update a service
// @route   PUT /api/services/:id
// @access  Private/Admin or BusinessOwner
const updateService = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const updateData = req.body;
    validateIds.serviceId(id);

    // Get the service
    const service = await Service.findById(id).session(session);
    if (!service) {
      throw new ApiError(404, "Service not found");
    }

    // Prevent changing these fields through this endpoint
    const restrictedFields = ["status", "slug", "images"];
    restrictedFields.forEach(field => delete updateData[field]);

    // Update service
    Object.assign(service, updateData);
    await service.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(200, service, "Service updated successfully");
    logger.info(`Service updated - ID: ${id}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateService: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Update service status
// @route   PATCH /api/services/:id/status
// @access  Private/Admin
const updateServiceStatus = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {status} = req.body;
    validateIds.serviceId(id);

    if (!["active", "inactive", "pending", "rejected"].includes(status)) {
      throw new ApiError(400, "Invalid status value");
    }

    const service = await Service.findByIdAndUpdate(id, {
      status
    }, {
      new: true,
      session
    });

    if (!service) {
      throw new ApiError(404, "Service not found");
    }

    await session.commitTransaction();

    const response = new ApiResponse(200, service, "Service status updated successfully");
    logger.info(`Service status updated - ID: ${id}, New Status: ${status}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateServiceStatus: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Delete a service
// @route   DELETE /api/services/:id
// @access  Private/Admin or BusinessOwner
const deleteService = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    validateIds.serviceId(id);

    const service = await Service.findById(id).session(session);
    if (!service) {
      throw new ApiError(404, "Service not found");
    }

    // Delete associated images from Cloudinary
    const deletionPromises = service.images.map(image => {
      if (image.url.startsWith("http")) {
        const parts = image.url.split("/");
        const filename = parts[parts.length - 1];
        const publicId = filename.split(".")[0];
        return deleteFromCloudinary(publicId).catch(error => {
          logger.warn(`Failed to delete image ${image.url}: ${error.message}`);
        });
      }
      return Promise.resolve();
    });

    await Promise.all(deletionPromises);
    await Service.findByIdAndDelete(id).session(session);
    await session.commitTransaction();

    const response = new ApiResponse(200, null, "Service deleted successfully");
    logger.info(`Service deleted - ID: ${id}, Name: ${service.name}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in deleteService: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// Helper function to validate service ID
const validateServiceId = id => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid service ID");
  }
};

// @desc    Upload service images
// @route   POST /api/services/:id/images
// @access  Private/Admin or BusinessOwner
const uploadServiceImages = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const files = req.files || [];
    const {
      captions = []
    } = req.body;

    validateServiceId(id);

    if (!files || files.length === 0) {
      throw new ApiError(400, "At least one image file is required");
    }

    const service = await Service.findById(id).session(session);
    if (!service) {
      throw new ApiError(404, "Service not found");
    }

    // Check if we're exceeding the maximum number of images
    if (service.images.length + files.length > 20) {
      throw new ApiError(400, "Cannot upload more than 20 images per service");
    }

    // Upload images to Cloudinary
    const uploadPromises = files.map((file, index) => {
      return uploadOnCloudinary(file.path, "service_images").then(result => {
        if (
          !result
          ?.url) {
          throw new ApiError(500, `Failed to upload image ${file.originalname}`);
        }
        return {
          url: result.url,
          caption: captions[index] || "",
          isPrimary: false,
          uploadedAt: new Date()
        };
      });
    });

    const uploadedImages = await Promise.all(uploadPromises);

    // If this is the first image being uploaded, mark it as primary
    if (service.images.length === 0 && uploadedImages.length > 0) {
      uploadedImages[0].isPrimary = true;
    }

    // Add new images to the service
    service.images.push(...uploadedImages);
    await service.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(200, service, "Images uploaded successfully");
    logger.info(`Images uploaded for service - ID: ${id}, Count: ${uploadedImages.length}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in uploadServiceImages: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Set primary image for a service
// @route   PATCH /api/services/:id/images/primary
// @access  Private/Admin or BusinessOwner
const setPrimaryImage = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {imageIndex} = req.body;

    validateServiceId(id);

    if (imageIndex === undefined || isNaN(imageIndex)) {
      throw new ApiError(400, "Valid imageIndex is required");
    }

    const service = await Service.findById(id).session(session);
    if (!service) {
      throw new ApiError(404, "Service not found");
    }

    if (imageIndex < 0 || imageIndex >= service.images.length) {
      throw new ApiError(400, "Invalid image index");
    }

    // Reset all images to non-primary
    service.images.forEach(image => {
      image.isPrimary = false;
    });

    // Set the selected image as primary
    service.images[imageIndex].isPrimary = true;
    await service.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(200, service, "Primary image set successfully");
    logger.info(`Primary image set for service - ID: ${id}, ImageIndex: ${imageIndex}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in setPrimaryImage: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Update image caption
// @route   PATCH /api/services/:id/images/caption
// @access  Private/Admin or BusinessOwner
const updateImageCaption = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {imageIndex, caption} = req.body;

    validateServiceId(id);

    if (imageIndex === undefined || isNaN(imageIndex)) {
      throw new ApiError(400, "Valid imageIndex is required");
    }

    if (!caption || typeof caption !== "string") {
      throw new ApiError(400, "Valid caption is required");
    }

    if (caption.length > 200) {
      throw new ApiError(400, "Caption cannot exceed 200 characters");
    }

    const service = await Service.findById(id).session(session);
    if (!service) {
      throw new ApiError(404, "Service not found");
    }

    if (imageIndex < 0 || imageIndex >= service.images.length) {
      throw new ApiError(400, "Invalid image index");
    }

    // Update the caption
    service.images[imageIndex].caption = caption;
    await service.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(200, service, "Image caption updated successfully");
    logger.info(`Image caption updated for service - ID: ${id}, ImageIndex: ${imageIndex}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateImageCaption: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

// @desc    Delete a service image
// @route   DELETE /api/services/:id/images/:imageIndex
// @access  Private/Admin or BusinessOwner
const deleteServiceImage = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id, imageIndex} = req.params;
    const parsedIndex = parseInt(imageIndex);

    validateServiceId(id);

    if (isNaN(parsedIndex)) {
      throw new ApiError(400, "Valid image index is required");
    }

    const service = await Service.findById(id).session(session);
    if (!service) {
      throw new ApiError(404, "Service not found");
    }

    if (parsedIndex < 0 || parsedIndex >= service.images.length) {
      throw new ApiError(400, "Invalid image index");
    }

    const imageToDelete = service.images[parsedIndex];
    const wasPrimary = imageToDelete.isPrimary;

    // Delete image from Cloudinary
    if (imageToDelete.url.startsWith("http")) {
      const parts = imageToDelete.url.split("/");
      const filename = parts[parts.length - 1];
      const publicId = filename.split(".")[0];
      await deleteFromCloudinary(publicId).catch(error => {
        logger.warn(`Failed to delete image from Cloudinary: ${error.message}`);
      });
    }

    // Remove the image from the array
    service.images.splice(parsedIndex, 1);

    // If we deleted the primary image and there are other images, set the first one as primary
    if (wasPrimary && service.images.length > 0) {
      service.images[0].isPrimary = true;
    }

    await service.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(200, service, "Image deleted successfully");
    logger.info(`Image deleted from service - ID: ${id}, ImageIndex: ${parsedIndex}`);
    return res.status(200).json(response);
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in deleteServiceImage: ${error.message}`, {stack: error.stack});
    throw error;
  } finally {
    session.endSession();
  }
});

export {
  createService,
  getAllServices,
  getServiceById,
  getServiceBySlug,
  updateService,
  updateServiceStatus,
  deleteService,
  uploadServiceImages,
  setPrimaryImage,
  updateImageCaption,
  deleteServiceImage
};
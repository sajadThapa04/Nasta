import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import FoodVenue from "../models/foodVenue.models.js";
import {uploadOnCloudinary, deleteFromCloudinary} from "../utils/cloudinary.js";
import {Service} from "../models/services.models.js";
import BusinessOwner from "../models/businessOwner.models.js";
import logger from "../utils/logger.js";
import mongoose from "mongoose";
import geocodeCoordinates from "../utils/geoCordinates.js";

// Helper functions to validate IDs
const validateIds = {
  venueId: id => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(400, "Invalid food venue ID");
    }
  },
  serviceId: id => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(400, "Invalid service ID");
    }
  }
};

// Helper function to verify ownership
const verifyOwnership = async (venueId, userId, session = null) => {
  const query = FoodVenue.findById(venueId).populate({
    path: "service",
    populate: {
      path: "owner",
      model: "BusinessOwner"
    }
  });

  if (session) {
    query.session(session);
  }

  const foodVenue = await query;

  if (!foodVenue) {
    throw new ApiError(404, "Food venue not found");
  }

  if (
    !foodVenue.service
    ?.owner || foodVenue.service.owner.user.toString() !== userId.toString()) {
    throw new ApiError(403, "You don't have permission to access this food venue");
  }

  return foodVenue;
};

// Helper function to validate delivery fee configuration
const validateDeliveryFee = deliveryFee => {
  if (!deliveryFee) 
    return null;
  
  const errors = [];

  // Validate base fee
  if (deliveryFee.base === undefined || typeof deliveryFee.base !== "number" || deliveryFee.base < 0) {
    errors.push("Base delivery fee must be a non-negative number");
  }

  // Validate distance rates
  if (deliveryFee.distanceRates && Array.isArray(deliveryFee.distanceRates)) {
    deliveryFee.distanceRates.forEach((rate, index) => {
      console.log(`Validating distance rate at index ${index}:`, JSON.stringify(rate));
      if (rate.minDistance === undefined || rate.maxDistance === undefined || rate.rate === undefined) {
        errors.push(`Distance rate at index ${index} is missing required fields`);
      } else if (typeof rate.minDistance !== "number" || typeof rate.maxDistance !== "number" || typeof rate.rate !== "number") {
        errors.push(`Distance rate at index ${index} has invalid field types`);
      } else if (rate.minDistance < 0) {
        errors.push(`Distance rate at index ${index} has negative minDistance`);
      } else if (rate.maxDistance <= rate.minDistance) {
        errors.push(`Distance rate at index ${index} has maxDistance not greater than minDistance`);
      } else if (rate.rate < 0) {
        errors.push(`Distance rate at index ${index} has negative rate`);
      }
    });
  }

  // Validate surge multipliers
  if (deliveryFee.surgeMultipliers && Array.isArray(deliveryFee.surgeMultipliers)) {
    deliveryFee.surgeMultipliers.forEach((surge, index) => {
      if (!surge.startTime || !surge.endTime || !surge.multiplier || surge.multiplier < 1) {
        errors.push(`Surge multiplier at index ${index} is invalid`);
      }
    });
  }

  // Validate small order configuration
  if (deliveryFee.smallOrderThreshold !== undefined && (typeof deliveryFee.smallOrderThreshold !== "number" || deliveryFee.smallOrderThreshold < 0)) {
    errors.push("Small order threshold must be a non-negative number");
  }

  if (deliveryFee.smallOrderFee !== undefined && (typeof deliveryFee.smallOrderFee !== "number" || deliveryFee.smallOrderFee < 0)) {
    errors.push("Small order fee must be a non-negative number");
  }

  // Validate service fee
  if (deliveryFee.serviceFeePercentage !== undefined && (typeof deliveryFee.serviceFeePercentage !== "number" || deliveryFee.serviceFeePercentage < 0 || deliveryFee.serviceFeePercentage > 100)) {
    errors.push("Service fee percentage must be between 0 and 100");
  }

  // Validate handling fee
  if (deliveryFee.handlingFee !== undefined && (typeof deliveryFee.handlingFee !== "number" || deliveryFee.handlingFee < 0)) {
    errors.push("Handling fee must be a non-negative number");
  }

  // Validate zone fees
  if (deliveryFee.zoneFees && Array.isArray(deliveryFee.zoneFees)) {
    deliveryFee.zoneFees.forEach((zone, index) => {
      if (!zone.zoneName || zone.fee === undefined || zone.fee < 0) {
        errors.push(`Zone fee at index ${index} is invalid`);
      }
    });
  }

  // Validate currency
  if (deliveryFee.currency && !/^[A-Z]{3}$/.test(deliveryFee.currency)) {
    errors.push("Currency must be a valid 3-letter ISO code");
  }

  if (errors.length > 0) {
    throw new ApiError(400, `Invalid delivery fee configuration: ${errors.join(", ")}`);
  }

  return true;
};

// @desc    Create a new food venue
// @route   POST /api/food-venues
// @access  Private/BusinessOwner
const createFoodVenue = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      service,
      name,
      description,
      coordinates,
      seatingCapacity,
      amenities,
      openingHours,
      menuItems,
      isAvailable,
      deliveryFee,
      deliveryRadius
    } = req.body;

    const userId = req.user._id;

    // Check required fields
    if (!service || !name || !coordinates || seatingCapacity === undefined) {
      throw new ApiError(400, "Service reference, name, coordinates, and seating capacity are required");
    }

    // Validate service ID and check ownership
    validateIds.serviceId(service);
    const serviceRecord = await Service.findById(service).session(session);

    if (!serviceRecord) {
      throw new ApiError(404, "Service not found");
    }

    if (serviceRecord.status !== "active") {
      throw new ApiError(403, `Cannot create food venue - Service status is ${serviceRecord.status}. Only active services can have food venues.`);
    }

    // Verify the user owns the service through the business owner
    const businessOwner = await BusinessOwner.findOne({_id: serviceRecord.owner, user: userId}).session(session);

    if (!businessOwner) {
      throw new ApiError(403, "You don't have permission to create venues for this service");
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

    // Check for duplicate venue name under the same service
    const existingVenueName = await FoodVenue.findOne({
      service,
      name: {
        $regex: new RegExp(`^${name}$`, "i")
      }
    }).session(session);

    if (existingVenueName) {
      throw new ApiError(409, `A food venue with the name "${name}" already exists for this service. Please choose a different name.`);
    }

    // Check for existing venue at the same address (using coordinates)
    const existingVenueAtAddress = await FoodVenue.findOne({"address.coordinates.coordinates": coordinates}).session(session);

    if (existingVenueAtAddress) {
      throw new ApiError(409, `A food venue already exists at this address (${geocodedAddress.street}, ${geocodedAddress.city}).`);
    }

    // Validate seating capacity
    if (seatingCapacity < 1) {
      throw new ApiError(400, "Seating capacity must be at least 1");
    }

    // Validate delivery radius
    if (deliveryRadius !== undefined && (typeof deliveryRadius !== "number" || deliveryRadius <= 0)) {
      throw new ApiError(400, "Delivery radius must be a positive number");
    }

    // Validate delivery fee configuration if provided
    if (deliveryFee) {
      // Ensure distance rates are numbers
      if (deliveryFee.distanceRates && Array.isArray(deliveryFee.distanceRates)) {
        deliveryFee.distanceRates = deliveryFee.distanceRates.map(rate => ({
          minDistance: Number(rate.minDistance),
          maxDistance: Number(rate.maxDistance),
          rate: Number(rate.rate)
        }));
      }
      validateDeliveryFee(deliveryFee);
    }
    // Validate opening hours if provided
    if (openingHours && Array.isArray(openingHours)) {
      for (const daySchedule of openingHours) {
        if (!daySchedule.day || !daySchedule.timeSlots) {
          throw new ApiError(400, "Each day in opening hours must have a day and timeSlots");
        }

        for (const timeSlot of daySchedule.timeSlots) {
          if (!timeSlot.openingTime || !timeSlot.closingTime) {
            throw new ApiError(400, "Each time slot must have both opening and closing times");
          }

          // Validate time format (HH:mm)
          const timeRegex = /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/;
          if (!timeRegex.test(timeSlot.openingTime) || !timeRegex.test(timeSlot.closingTime)) {
            throw new ApiError(400, "Times must be in HH:mm format");
          }

          // Validate opening time is before closing time (unless overnight)
          if (timeSlot.openingTime >= timeSlot.closingTime && !(timeSlot.closingTime.split(":")[0] < timeSlot.openingTime.split(":")[0])) {
            throw new ApiError(400, "Opening time must be before closing time (except for overnight hours)");
          }
        }
      }
    }

    // Validate menu items if provided
    if (menuItems && Array.isArray(menuItems)) {
      for (const item of menuItems) {
        if (!item.name || item.price === undefined) {
          throw new ApiError(400, "Each menu item must have a name and price");
        }

        if (item.name.length < 2) {
          throw new ApiError(400, "Menu item name must have at least 2 characters");
        }

        if (item.price < 0) {
          throw new ApiError(400, "Price cannot be negative");
        }

        // Validate images if provided
        if (item.images && Array.isArray(item.images)) {
          const imageRegex = /^(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))$/i;
          for (const image of item.images) {
            if (!imageRegex.test(image)) {
              throw new ApiError(400, "Image URLs must be valid and end with png, jpg, jpeg, gif, or webp");
            }
          }
        }
      }
    }

    // Create default delivery fee configuration if not provided
    const defaultDeliveryFee = {
      base: 5,
      distanceRates: [],
      surgeMultipliers: [],
      smallOrderThreshold: 15,
      smallOrderFee: 2,
      serviceFeePercentage: 10,
      handlingFee: 1,
      zoneFees: [],
      currency: "USD"
    };

    // Create new food venue with all fields
    const foodVenue = new FoodVenue({
      service,
      name,
      description: description || "",
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
      seatingCapacity,
      amenities: amenities || [],
      openingHours: openingHours || [],
      menuItems: menuItems || [],
      deliveryFee: deliveryFee || defaultDeliveryFee,
      deliveryRadius: deliveryRadius !== undefined
        ? deliveryRadius
        : 10,
      isAvailable: isAvailable !== undefined
        ? isAvailable
        : true
    });

    await foodVenue.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(201, foodVenue, "Food venue created successfully");
    logger.info(`Food venue created successfully - ID: ${foodVenue._id}, Name: ${foodVenue.name}, Service: ${foodVenue.service}`);
    logger.debug(`Food venue details: ${JSON.stringify({seatingCapacity: foodVenue.seatingCapacity, amenities: foodVenue.amenities.length, menuItems: foodVenue.menuItems.length, deliveryRadius: foodVenue.deliveryRadius, deliveryFee: foodVenue.deliveryFee})}`);

      return res.status(201).json(response);
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Error in createFoodVenue: ${error.message}`, {stack: error.stack});

      if (
        error.code === 11000 && error.keyPattern
        ?.name) {
        throw new ApiError(409, `A food venue with the name "${req.body.name}" already exists. Please choose a different name.`);
      }

      if (error instanceof mongoose.Error.ValidationError) {
        const messages = Object.values(error.errors).map(err => err.message);
        throw new ApiError(400, `Validation error: ${messages.join(", ")}`);
      }

      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "Failed to create food venue due to an unexpected error");
    } finally {
      session.endSession();
    }
  });

  // @desc    Get all food venues (filtered by ownership if not admin)
  // @route   GET /api/food-venues
  // @access  Public/Private
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

      // If user is logged in but not admin, only show their venues
      if (req.user && !req.user.isAdmin) {
        // Find all services owned by this user
        const businessOwners = await BusinessOwner.find({user: req.user._id}).select("_id");
        const services = await Service.find({
          owner: {
            $in: businessOwners.map(bo => bo._id)
          }
        }).select("_id");
        query.service = {
          $in: services.map(s => s._id)
        };
      }

      // Filter by specific service if provided (and user has access)
      if (service) {
        validateIds.serviceId(service);

        // For non-admin users, verify they own this service
        if (req.user && !req.user.isAdmin) {
          const serviceRecord = await Service.findById(service);
          if (!serviceRecord) {
            throw new ApiError(404, "Service not found");
          }

          const businessOwner = await BusinessOwner.findOne({_id: serviceRecord.owner, user: req.user._id});

          if (!businessOwner) {
            throw new ApiError(403, "You don't have permission to access venues for this service");
          }
        }

        query.service = service;
        logger.debug(`Filtering by service ID: ${service}`);
      }

      // Search by name if search query is provided
      if (search) {
        query.name = {
          $regex: search,
          $options: "i"
        };
        logger.debug(`Searching for venues with name containing: ${search}`);
      }

      // Geospatial query if coordinates are provided
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

  // @desc    Get a single food venue by ID
  // @route   GET /api/food-venues/:id
  // @access  Public/Private
  const getFoodVenueById = asyncHandler(async (req, res) => {
    try {
      const {id} = req.params;
      validateIds.venueId(id);

      // For non-admin users, verify ownership
      if (req.user && !req.user.isAdmin) {
        await verifyOwnership(id, req.user._id);
      }

      const foodVenue = await FoodVenue.findById(id).populate({
        path: "service",
        populate: {
          path: "owner",
          model: "BusinessOwner"
        }
      });

      if (!foodVenue) {
        throw new ApiError(404, "Food venue not found");
      }

      const response = new ApiResponse(200, foodVenue, "Food venue retrieved successfully");
      logger.info(`Successfully retrieved food venue - ID: ${id}, Name: ${foodVenue.name}`);
      logger.debug(`Venue details: ${JSON.stringify({service: foodVenue.service, seatingCapacity: foodVenue.seatingCapacity, isAvailable: foodVenue.isAvailable})}`);
        return res.status(200).json(response);
      } catch (error) {
        logger.error(`Error in getFoodVenueById: ${error.message}`, {stack: error.stack});
        throw error;
      }
    });

    // @desc    Update a food venue
    // @route   PATCH /api/food-venues/:id
    // @access  Private/BusinessOwner
    const updateFoodVenue = asyncHandler(async (req, res) => {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const {id} = req.params;
        const updateData = req.body;
        validateIds.venueId(id);

        // Verify ownership and get the food venue
        const foodVenue = await verifyOwnership(id, req.user._id, session);

        // Prevent changing certain fields
        const restrictedFields = ["service", "address.coordinates"];
        restrictedFields.forEach(field => {
          if (updateData[field]) {
            throw new ApiError(400, `Cannot modify ${field} through this endpoint`);
          }
        });

        if (
          updateData.address
          ?.coordinates) {
          if (!Array.isArray(updateData.address.coordinates) || updateData.address.coordinates.length !== 2) {
            throw new ApiError(400, "Coordinates must be an array of two numbers [longitude, latitude]");
          }
        }

        // Validate delivery radius if being updated
        if (updateData.deliveryRadius !== undefined) {
          if (typeof updateData.deliveryRadius !== "number" || updateData.deliveryRadius <= 0) {
            throw new ApiError(400, "Delivery radius must be a positive number");
          }
        }

        // Validate delivery fee configuration if being updated
        if (updateData.deliveryFee) {
          validateDeliveryFee(updateData.deliveryFee);
        }

        // Keep track of original values for logging
        const originalValues = {
          name: foodVenue.name,
          seatingCapacity: foodVenue.seatingCapacity,
          isAvailable: foodVenue.isAvailable,
          deliveryRadius: foodVenue.deliveryRadius,
          deliveryFee: foodVenue.deliveryFee
        };

        // Apply updates
        Object.assign(foodVenue, updateData);

        await foodVenue.save({session});
        await session.commitTransaction();

        const response = new ApiResponse(200, foodVenue, "Food venue updated successfully");
        logger.info(`Successfully updated food venue - ID: ${id}`);
        logger.debug(`Updated fields: ${JSON.stringify({
          before: originalValues,
          after: {
            name: foodVenue.name,
            seatingCapacity: foodVenue.seatingCapacity,
            isAvailable: foodVenue.isAvailable,
            deliveryRadius: foodVenue.deliveryRadius,
            deliveryFee: foodVenue.deliveryFee}
      })}`);

            return res.status(200).json(response);
          } catch (error) {
            await session.abortTransaction();
            logger.error(`Error in updateFoodVenue: ${error.message}`, {stack: error.stack});

            if (error instanceof mongoose.Error.ValidationError) {
              const messages = Object.values(error.errors).map(err => err.message);
              throw new ApiError(400, `Validation error: ${messages.join(", ")}`);
            }

            if (error instanceof ApiError) {
              throw error;
            }

            throw new ApiError(500, "Failed to update food venue due to an unexpected error");
          } finally {
            session.endSession();
          }
        });

        // @desc    Update food venue availability
        // @route   PATCH /api/food-venues/:id/availability
        // @access  Private/BusinessOwner
        const updateFoodVenueAvailability = asyncHandler(async (req, res) => {
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            const {id} = req.params;
            const {isAvailable} = req.body;
            validateIds.venueId(id);

            if (typeof isAvailable !== "boolean") {
              throw new ApiError(400, "isAvailable must be a boolean");
            }

            // Verify ownership
            await verifyOwnership(id, req.user._id, session);

            const foodVenue = await FoodVenue.findByIdAndUpdate(id, {
              isAvailable
            }, {
              new: true,
              session
            });

            if (!foodVenue) {
              throw new ApiError(404, "Food venue not found");
            }

            await session.commitTransaction();

            const response = new ApiResponse(200, foodVenue, "Food venue availability updated successfully");
            logger.info(`Successfully updated availability for food venue - ID: ${id}, New status: ${isAvailable}`);
            return res.status(200).json(response);
          } catch (error) {
            await session.abortTransaction();
            logger.error(`Error in updateFoodVenueAvailability: ${error.message}`, {stack: error.stack});
            throw error;
          } finally {
            session.endSession();
          }
        });

        // @desc    Delete a food venue
        // @route   DELETE /api/food-venues/:id
        // @access  Private/BusinessOwner
        const deleteFoodVenue = asyncHandler(async (req, res) => {
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            const {id} = req.params;
            validateIds.venueId(id);

            // Verify ownership and get the food venue
            const foodVenue = await verifyOwnership(id, req.user._id, session);

            const deletionPromises = [];

            foodVenue.images.forEach(imageUrl => {
              if (imageUrl.startsWith("http")) {
                const parts = imageUrl.split("/");
                const filename = parts[parts.length - 1];
                const publicId = filename.split(".")[0];
                deletionPromises.push(deleteFromCloudinary(publicId).catch(error => {
                  logger.warn(`Failed to delete venue image ${imageUrl}: ${error.message}`);
                }));
              }
            });

            foodVenue.menuItems.forEach(menuItem => {
              menuItem.images.forEach(imageUrl => {
                if (imageUrl.startsWith("http")) {
                  const parts = imageUrl.split("/");
                  const filename = parts[parts.length - 1];
                  const publicId = filename.split(".")[0];
                  deletionPromises.push(deleteFromCloudinary(publicId).catch(error => {
                    logger.warn(`Failed to delete menu item image ${imageUrl}: ${error.message}`);
                  }));
                }
              });
            });

            await Promise.all(deletionPromises);
            await FoodVenue.findByIdAndDelete(id).session(session);
            await session.commitTransaction();

            const response = new ApiResponse(200, null, "Food venue deleted successfully");
            logger.info(`Successfully deleted food venue - ID: ${id}, Name: ${foodVenue.name}`);
            logger.debug(`Deleted ${foodVenue.images.length} venue images and ${foodVenue.menuItems.reduce((acc, item) => acc + item.images.length, 0)} menu item images`);
            return res.status(200).json(response);
          } catch (error) {
            await session.abortTransaction();
            logger.error(`Error in deleteFoodVenue: ${error.message}`, {stack: error.stack});
            throw error;
          } finally {
            session.endSession();
          }
        });

        // @desc    Upload venue images
        // @route   POST /api/food-venues/:id/images
        // @access  Private/BusinessOwner
        const uploadVenueImages = asyncHandler(async (req, res) => {
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            const {id} = req.params;
            const files = req.files || [];
            const {
              captions = []
            } = req.body;

            validateIds.venueId(id);

            if (!files || files.length === 0) {
              throw new ApiError(400, "At least one image file is required");
            }

            // Verify ownership and get the food venue
            const foodVenue = await verifyOwnership(id, req.user._id, session);

            const uploadPromises = files.map((file, index) => {
              return uploadOnCloudinary(file.path, "venue_images").then(result => {
                if (
                  !result
                  ?.url) {
                  throw new ApiError(500, `Failed to upload image ${file.originalname}`);
                }
                return result.url;
              });
            });

            const uploadedImages = await Promise.all(uploadPromises);
            foodVenue.images.push(...uploadedImages);
            await foodVenue.save({session});
            await session.commitTransaction();

            const response = new ApiResponse(200, foodVenue, "Venue images uploaded successfully");
            logger.info(`Successfully uploaded ${uploadedImages.length} images for food venue - ID: ${id}`);
            logger.debug(`Uploaded image URLs: ${JSON.stringify(uploadedImages)}`);
            return res.status(200).json(response);
          } catch (error) {
            await session.abortTransaction();
            logger.error(`Error in uploadVenueImages: ${error.message}`, {stack: error.stack});
            throw error;
          } finally {
            session.endSession();
          }
        });

        // @desc    Delete a venue image
        // @route   DELETE /api/food-venues/:id/images/:imageUrl
        // @access  Private/BusinessOwner
        const deleteVenueImage = asyncHandler(async (req, res) => {
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            const {id, imageUrl} = req.params;
            validateIds.venueId(id);

            if (!imageUrl) {
              throw new ApiError(400, "Image URL is required");
            }

            // Verify ownership and get the food venue
            const foodVenue = await verifyOwnership(id, req.user._id, session);

            const imageIndex = foodVenue.images.findIndex(img => img === imageUrl);
            if (imageIndex === -1) {
              throw new ApiError(404, "Image not found in this venue");
            }

            if (imageUrl.startsWith("http")) {
              const parts = imageUrl.split("/");
              const filename = parts[parts.length - 1];
              const publicId = filename.split(".")[0];
              await deleteFromCloudinary(publicId).catch(error => {
                logger.warn(`Failed to delete image from Cloudinary: ${error.message}`);
              });
            }

            const deletedImage = foodVenue.images[imageIndex];
            foodVenue.images.splice(imageIndex, 1);
            await foodVenue.save({session});
            await session.commitTransaction();

            const response = new ApiResponse(200, foodVenue, "Venue image deleted successfully");
            logger.info(`Successfully deleted image from food venue - ID: ${id}, ImageURL: ${deletedImage}`);
            return res.status(200).json(response);
          } catch (error) {
            await session.abortTransaction();
            logger.error(`Error in deleteVenueImage: ${error.message}`, {stack: error.stack});
            throw error;
          } finally {
            session.endSession();
          }
        });

        // @desc    Add menu item images
        // @route   POST /api/food-venues/:id/menu-items/:menuItemId/images
        // @access  Private/BusinessOwner
        const uploadMenuItemImages = asyncHandler(async (req, res) => {
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            const {id, menuItemId} = req.params;
            const files = req.files || [];
            validateIds.venueId(id);

            if (!mongoose.Types.ObjectId.isValid(menuItemId)) {
              throw new ApiError(400, "Invalid menu item ID");
            }

            if (!files || files.length === 0) {
              throw new ApiError(400, "At least one image file is required");
            }

            // Verify ownership and get the food venue
            const foodVenue = await verifyOwnership(id, req.user._id, session);

            const menuItem = foodVenue.menuItems.id(menuItemId);
            if (!menuItem) {
              throw new ApiError(404, "Menu item not found");
            }

            const uploadPromises = files.map(file => {
              return uploadOnCloudinary(file.path, "menu_item_images").then(result => {
                if (
                  !result
                  ?.url) {
                  throw new ApiError(500, `Failed to upload image ${file.originalname}`);
                }
                return result.url;
              });
            });

            const uploadedImages = await Promise.all(uploadPromises);
            menuItem.images.push(...uploadedImages);
            await foodVenue.save({session});
            await session.commitTransaction();

            const response = new ApiResponse(200, foodVenue, "Menu item images uploaded successfully");
            logger.info(`Successfully uploaded ${uploadedImages.length} images for menu item - Venue ID: ${id}, MenuItem ID: ${menuItemId}`);
            logger.debug(`Uploaded menu item image URLs: ${JSON.stringify(uploadedImages)}`);
            return res.status(200).json(response);
          } catch (error) {
            await session.abortTransaction();
            logger.error(`Error in uploadMenuItemImages: ${error.message}`, {stack: error.stack});
            throw error;
          } finally {
            session.endSession();
          }
        });

        // @desc    Delete a menu item image
        // @route   DELETE /api/food-venues/:id/menu-items/:menuItemId/images/:imageUrl
        // @access  Private/BusinessOwner
        const deleteMenuItemImage = asyncHandler(async (req, res) => {
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            const {id, menuItemId} = req.params;
            const {imageUrl} = req.body;

            validateIds.venueId(id);

            if (!mongoose.Types.ObjectId.isValid(menuItemId)) {
              throw new ApiError(400, "Invalid menu item ID");
            }

            if (!imageUrl) {
              throw new ApiError(400, "Image URL is required in request body");
            }

            // Verify ownership and get the food venue
            const foodVenue = await verifyOwnership(id, req.user._id, session);

            const menuItem = foodVenue.menuItems.id(menuItemId);
            if (!menuItem) {
              throw new ApiError(404, "Menu item not found");
            }

            const imageIndex = menuItem.images.findIndex(img => img === imageUrl);
            if (imageIndex === -1) {
              throw new ApiError(404, "Image not found in this menu item");
            }

            // Delete from cloudinary if URL starts with http
            if (imageUrl.startsWith("http")) {
              const parts = imageUrl.split("/");
              const filename = parts[parts.length - 1];
              const publicId = filename.split(".")[0];
              await deleteFromCloudinary(publicId).catch(error => {
                logger.warn(`Failed to delete image from Cloudinary: ${error.message}`);
              });
            }

            menuItem.images.splice(imageIndex, 1);
            await foodVenue.save({session});
            await session.commitTransaction();

            const response = new ApiResponse(200, foodVenue, "Menu item image deleted successfully");
            logger.info(`Successfully deleted image from menu item - Venue ID: ${id}, MenuItem ID: ${menuItemId}, ImageURL: ${imageUrl}`);
            return res.status(200).json(response);
          } catch (error) {
            await session.abortTransaction();
            logger.error(`Error in deleteMenuItemImage: ${error.message}`, {stack: error.stack});
            throw error;
          } finally {
            session.endSession();
          }
        });

        export {
          createFoodVenue,
          getAllFoodVenues,
          getFoodVenueById,
          updateFoodVenue,
          updateFoodVenueAvailability,
          deleteFoodVenue,
          uploadVenueImages,
          deleteVenueImage,
          uploadMenuItemImages,
          deleteMenuItemImage
        };

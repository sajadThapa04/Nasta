import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import FoodVenue from "../models/foodVenue.models.js";
import {uploadOnCloudinary, deleteFromCloudinary} from "../utils/cloudinary.js";
import {Service} from "../models/services.models.js";
import logger from "../utils/logger.js";
import mongoose from "mongoose";

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

// @desc    Create a new food venue
// @route   POST /api/food-venues
// @access  Private/Admin or Private/BusinessOwner
const createFoodVenue = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      service,
      name,
      description,
      address,
      seatingCapacity,
      amenities,
      openingHours,
      menuItems,
      isAvailable
    } = req.body;

    // Check required fields
    if (!service || !name || !address || seatingCapacity === undefined) {
      throw new ApiError(400, "Service reference, name, address, and seating capacity are required");
    }

    // Validate address structure
    if (!address.country || !address.city || !address.street || !address.coordinates) {
      throw new ApiError(400, "Address must include country, city, street, and coordinates");
    }

    // Validate coordinates
    if (!Array.isArray(address.coordinates.coordinates) || address.coordinates.coordinates.length !== 2 || typeof address.coordinates.coordinates[0] !== "number" || typeof address.coordinates.coordinates[1] !== "number") {
      throw new ApiError(400, "Coordinates must be an array of two numbers [longitude, latitude]");
    }

    // Validate seating capacity
    if (seatingCapacity < 1) {
      throw new ApiError(400, "Seating capacity must be at least 1");
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

    // Create new food venue
    const foodVenue = new FoodVenue({
      service,
      name,
      description: description || "",
      address,
      seatingCapacity,
      amenities: amenities || [],
      openingHours: openingHours || [],
      menuItems: menuItems || [],
      isAvailable: isAvailable !== undefined
        ? isAvailable
        : true
    });

    await foodVenue.save({session});
    await session.commitTransaction();

    const response = new ApiResponse(201, foodVenue, "Food venue created successfully");
    logger.info(`Food venue created successfully - ID: ${foodVenue._id}, Name: ${foodVenue.name}, Service: ${foodVenue.service}`);
    logger.debug(`Food venue details: ${JSON.stringify({seatingCapacity: foodVenue.seatingCapacity, amenities: foodVenue.amenities.length, menuItems: foodVenue.menuItems.length})}`);
      return res.status(201).json(response);
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Error in createFoodVenue: ${error.message}`, {stack: error.stack});

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

  // @desc    Get all food venues
  // @route   GET /api/food-venues
  // @access  Public
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

  // @desc    Get a single food venue by ID
  // @route   GET /api/food-venues/:id
  // @access  Public
  const getFoodVenueById = asyncHandler(async (req, res) => {
    try {
      const {id} = req.params;
      validateIds.venueId(id);

      const foodVenue = await FoodVenue.findById(id).populate("service");

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
    // @route   PUT /api/food-venues/:id
    // @access  Private/Admin or BusinessOwner
    const updateFoodVenue = asyncHandler(async (req, res) => {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const {id} = req.params;
        const updateData = req.body;
        validateIds.venueId(id);

        const foodVenue = await FoodVenue.findById(id).session(session);
        if (!foodVenue) {
          throw new ApiError(404, "Food venue not found");
        }

        const restrictedFields = ["service", "images", "menuItems"];
        restrictedFields.forEach(field => delete updateData[field]);

        if (
          updateData.address
          ?.coordinates) {
          if (!Array.isArray(updateData.address.coordinates) || updateData.address.coordinates.length !== 2) {
            throw new ApiError(400, "Coordinates must be an array of two numbers [longitude, latitude]");
          }
        }

        const originalValues = {
          name: foodVenue.name,
          seatingCapacity: foodVenue.seatingCapacity,
          isAvailable: foodVenue.isAvailable
        };

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
            isAvailable: foodVenue.isAvailable}
      })}`);
            return res.status(200).json(response);
          } catch (error) {
            await session.abortTransaction();
            logger.error(`Error in updateFoodVenue: ${error.message}`, {stack: error.stack});
            throw error;
          } finally {
            session.endSession();
          }
        });

        // @desc    Update food venue availability
        // @route   PATCH /api/food-venues/:id/availability
        // @access  Private/Admin or BusinessOwner
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
        // @access  Private/Admin or BusinessOwner
        const deleteFoodVenue = asyncHandler(async (req, res) => {
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            const {id} = req.params;
            validateIds.venueId(id);

            const foodVenue = await FoodVenue.findById(id).session(session);
            if (!foodVenue) {
              throw new ApiError(404, "Food venue not found");
            }

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

        // Helper function to validate venue ID
        const validateVenueId = id => {
          if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new ApiError(400, "Invalid food venue ID");
          }
        };

        // @desc    Upload venue images
        // @route   POST /api/food-venues/:id/images
        // @access  Private/Admin or BusinessOwner
        const uploadVenueImages = asyncHandler(async (req, res) => {
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            const {id} = req.params;
            const files = req.files || [];
            const {
              captions = []
            } = req.body;

            validateVenueId(id);

            if (!files || files.length === 0) {
              throw new ApiError(400, "At least one image file is required");
            }

            const foodVenue = await FoodVenue.findById(id).session(session);
            if (!foodVenue) {
              throw new ApiError(404, "Food venue not found");
            }

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
        // @access  Private/Admin or BusinessOwner
        const deleteVenueImage = asyncHandler(async (req, res) => {
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            const {id, imageUrl} = req.params;
            validateVenueId(id);

            if (!imageUrl) {
              throw new ApiError(400, "Image URL is required");
            }

            const foodVenue = await FoodVenue.findById(id).session(session);
            if (!foodVenue) {
              throw new ApiError(404, "Food venue not found");
            }

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
        // @access  Private/Admin or BusinessOwner
        const uploadMenuItemImages = asyncHandler(async (req, res) => {
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            const {id, menuItemId} = req.params;
            const files = req.files || [];
            validateVenueId(id);

            if (!mongoose.Types.ObjectId.isValid(menuItemId)) {
              throw new ApiError(400, "Invalid menu item ID");
            }

            if (!files || files.length === 0) {
              throw new ApiError(400, "At least one image file is required");
            }

            const foodVenue = await FoodVenue.findById(id).session(session);
            if (!foodVenue) {
              throw new ApiError(404, "Food venue not found");
            }

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
        // @access  Private/Admin or BusinessOwner
        const deleteMenuItemImage = asyncHandler(async (req, res) => {
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            const {id, menuItemId} = req.params;
            const {imageUrl} = req.body;

            validateVenueId(id);

            if (!mongoose.Types.ObjectId.isValid(menuItemId)) {
              throw new ApiError(400, "Invalid menu item ID");
            }

            if (!imageUrl) {
              throw new ApiError(400, "Image URL is required in request body");
            }

            const foodVenue = await FoodVenue.findById(id).session(session);
            if (!foodVenue) {
              throw new ApiError(404, "Food venue not found");
            }

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

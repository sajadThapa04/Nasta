import {asyncHandler} from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import FoodDelivery from "../models/foodDelivery.models.js";
import BusinessOwner from "../models/businessOwner.models.js";
import {Service} from "../models/services.models.js";
import User from "../models/users.models.js";
import FoodVenue from "../models/foodVenue.models.js";
import DeliveryDriver from "../models/deliveryDriver.models.js";
// import {createStripePaymentIntent, refundStripePayment, handleStripeWebhook, confirmStripePaymentIntent} from "../utils/payment_gateways/stripe.js";
import geocodeCoordinates from "../utils/geoCordinates.js";
import logger from "../utils/logger.js";
import mongoose from "mongoose";

/**
 * @desc    Create a new food delivery order with payment
 * @route   POST /api/food-delivery
 * @access  Private (Customer)
 */

// Helper function to calculate distance in km using Haversine formula
function calculateDistance(venueCoords, deliveryCoords) {
  const [lon1, lat1] = venueCoords;
  const [lon2, lat2] = deliveryCoords;

  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2)); // Distance in km with 2 decimal places
}

const createFoodDeliveryOrder = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Ensure the user is a customer
    if (req.user.role !== "customer") {
      throw new ApiError(403, "Only customers can place orders");
    }

    const {
      venue,
      items,
      customerNotes,
      tip = 0,
      coordinates,
      paymentMethod,
      deliveryAddress = {}
    } = req.body;

    // Extract unitNumber from either deliveryAddress object or root of request body
    const unitNumber = deliveryAddress.unitNumber || req.body.unitNumber || "";

    // Validate required fields
    if (!venue || !coordinates || !items || items.length === 0 || !paymentMethod) {
      throw new ApiError(400, "Venue, coordinates, items, and payment method are required");
    }

    // Validate coordinates format
    if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(c => typeof c === "number")) {
      throw new ApiError(400, "Coordinates must be an array of [longitude, latitude]");
    }

    // Validate items structure
    for (const item of items) {
      if (!item.menuItemId || !item.quantity || !item.price) {
        throw new ApiError(400, "Each item must have menuItemId, quantity, and price");
      }
      if (item.quantity < 1) 
        throw new ApiError(400, "Quantity must be at least 1");
      if (item.price < 0) 
        throw new ApiError(400, "Price cannot be negative");
      }
    
    // Validate payment method
    const validPaymentMethods = [
      "credit_card",
      "debit_card",
      "paypal",
      "stripe",
      "cash_on_delivery",
      "wallet",
      "razorpay"
    ];
    if (!validPaymentMethods.includes(paymentMethod)) {
      throw new ApiError(400, "Invalid payment method");
    }

    // Get customer details
    const customer = await User.findById(req.user._id).select("fullName email phone").session(session);
    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    logger.info(`Creating food delivery order for venue: ${venue} by user: ${customer._id}`);

    // Get venue with delivery fee configuration
    const venueDetails = await FoodVenue.findById(venue).session(session);
    if (!venueDetails) 
      throw new ApiError(404, "Venue not found");
    if (!venueDetails.isAvailable) 
      throw new ApiError(400, "Venue is currently unavailable for delivery");
    
    // Calculate distance between venue and delivery location
    const distance = calculateDistance(venueDetails.address.coordinates.coordinates, coordinates);

    // Check if within delivery radius
    if (distance > venueDetails.deliveryRadius) {
      throw new ApiError(400, `Delivery location is outside the venue's ${venueDetails.deliveryRadius}km delivery radius`);
    }

    // Calculate subtotal
    const subtotal = items.reduce((sum, item) => {
      const optionsCost = item.options
        ?.reduce((optSum, opt) => optSum + (opt.additionalCost || 0), 0) || 0;
      return sum + item.price * item.quantity + optionsCost;
    }, 0);

    // Calculate tax (10% of subtotal)
    const tax = parseFloat((subtotal * 0.1).toFixed(2));

    // Get current time for surge pricing
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

    // Calculate dynamic delivery fee
    const deliveryFee = calculateDynamicDeliveryFee({venueConfig: venueDetails.deliveryFee, distance, currentTime, subtotal});

    // Calculate total amount
    const totalAmount = parseFloat((subtotal + deliveryFee.total + tax + (tip || 0)).toFixed(2));

    // Geocode coordinates using your actual utility
    let geocodedAddress;
    try {
      geocodedAddress = await geocodeCoordinates(coordinates);
    } catch (err) {
      logger.warn("Geocoding failed, using default values", {error: err.message});
      geocodedAddress = {
        country: "Unknown",
        city: "Unknown",
        street: "Unknown",
        zipCode: "Unknown"
      };
    }

    // Create order with all address details including unitNumber
    const [createdOrder] = await FoodDelivery.create([
      {
        customer: {
          _id: customer._id,
          name: customer.fullName,
          email: customer.email,
          phone: customer.phone
        },
        venue,
        deliveryAddress: {
          country: geocodedAddress.country || deliveryAddress.country || "Unknown",
          city: geocodedAddress.city || deliveryAddress.city || "Unknown",
          street: geocodedAddress.street || deliveryAddress.street || "Unknown",
          zipCode: geocodedAddress.zipCode || deliveryAddress.zipCode || "Unknown",
          unitNumber: unitNumber || undefined, // Include unitNumber here
          coordinates: {
            type: "Point",
            coordinates
          },
          additionalInfo: deliveryAddress.additionalInfo || ""
        },
        items: items.map(item => ({
          menuItemId: item.menuItemId,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          specialInstructions: item.specialInstructions || "",
          options: item.options || []
        })),
        subtotal: parseFloat(subtotal.toFixed(2)),
        deliveryFee,
        tax: parseFloat(tax),
        tip: parseFloat(tip),
        totalAmount: parseFloat(totalAmount),
        customerNotes: customerNotes || "",
        paymentMethod,
        deliveryStatus: "pending"
      }
    ], {session});

    // Update venue's order count
    await FoodVenue.findByIdAndUpdate(venue, {
      $inc: {
        totalOrders: 1
      }
    }, {session});

    await session.commitTransaction();
    session.endSession();

    logger.info(`Order created successfully: ${createdOrder._id}`);
    return res.status(201).json(new ApiResponse(201, createdOrder, "Food delivery order created successfully"));
  } catch (error) {
    // Only abort if transaction hasn't been committed
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    logger.error(`Order creation failed: ${error.message}`, {error});

    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Failed to create food delivery order");
  }
});

// Helper function to calculate dynamic delivery fee
function calculateDynamicDeliveryFee({venueConfig, distance, currentTime, subtotal}) {
  // Calculate distance fee
  let distanceFee = 0;
  for (const rate of venueConfig.distanceRates) {
    if (distance >= rate.minDistance && distance <= rate.maxDistance) {
      distanceFee = rate.rate * distance;
      break;
    }
  }

  // Check for surge pricing
  let surgeMultiplier = 1;
  for (const surge of venueConfig.surgeMultipliers) {
    if (currentTime >= surge.startTime && currentTime <= surge.endTime) {
      surgeMultiplier = surge.multiplier;
      break;
    }
  }

  // Calculate small order fee
  const smallOrderFee = subtotal < venueConfig.smallOrderThreshold
    ? venueConfig.smallOrderFee
    : 0;

  // Calculate service fee (percentage of subtotal)
  const serviceFee = subtotal * (venueConfig.serviceFeePercentage / 100);

  // Calculate total fee components
  const baseFee = venueConfig.base * surgeMultiplier;
  const distanceFeeWithSurge = distanceFee * surgeMultiplier;

  const total = baseFee + distanceFeeWithSurge + smallOrderFee + serviceFee + venueConfig.handlingFee;

  return {
    base: parseFloat(venueConfig.base.toFixed(2)),
    distanceFee: parseFloat(distanceFeeWithSurge.toFixed(2)),
    surgeFee: parseFloat((baseFee * (surgeMultiplier - 1)).toFixed(2)), // only the surge portion
    smallOrderFee: parseFloat(smallOrderFee.toFixed(2)),
    serviceFee: parseFloat(serviceFee.toFixed(2)),
    handlingFee: parseFloat(venueConfig.handlingFee.toFixed(2)),
    zoneFee: 0, // Can be implemented based on zones if needed
    currency: venueConfig.currency,
    discount: 0, // Can be applied from promotions
    isFree: false, // Can be set based on promotions
    breakdown: new Map([
      [
        "baseFee",
        parseFloat(baseFee.toFixed(2))
      ],
      [
        "distanceFee",
        parseFloat(distanceFeeWithSurge.toFixed(2))
      ],
      [
        "surgeMultiplier", surgeMultiplier
      ],
      [
        "smallOrderFee",
        parseFloat(smallOrderFee.toFixed(2))
      ],
      [
        "serviceFee",
        parseFloat(serviceFee.toFixed(2))
      ],
      [
        "handlingFee",
        parseFloat(venueConfig.handlingFee.toFixed(2))
      ]
    ]),
    total: parseFloat(total.toFixed(2))
  };
}

/**

/**
 * @desc    Get order details by ID
 * @route   GET /api/food-delivery/:id
 * @access  Private (Customer, Venue Owner, or Driver)
 */
const getOrderDetailsForCustomers = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.startTransaction();
    const {id} = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    // Find the order with full details
    const order = await FoodDelivery.findById(id).populate("venue", "name address phone").populate("deliveryDriver", "fullName phone vehicleType").session(session);

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // Verify access rights - ONLY ALLOW CUSTOMERS WHO PLACED THE ORDER
    if (userRole === "customer") {
      if (order.customer._id.toString() !== userId.toString()) {
        throw new ApiError(403, "You can only view your own orders"); // Block all other roles (business owners, drivers, etc.);
      }
    } else {
      throw new ApiError(403, "Only customers can view order details through this endpoint");
    }

    await session.commitTransaction();
    return res.status(200).json(new ApiResponse(200, order, "Order details retrieved successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in getOrderDetailsForCustomers: ${error.message}`);

    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Failed to retrieve order details");
  } finally {
    session.endSession();
  }
});

const getOrderDetailsForBusinessOwners = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.startTransaction();
    const {id} = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    // Find the order with full details
    const order = await FoodDelivery.findById(id).populate("venue", "name address phone").populate("deliveryDriver", "fullName phone vehicleType").populate("customer", "fullName phone").session(session);

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // Verify access rights - ONLY ALLOW BUSINESS OWNERS WHO OWN THE VENUE
    if (userRole === "business_owner") {
      // Find the business owner's venues
      const businessOwner = await BusinessOwner.findOne({user: userId}).session(session);

      if (!businessOwner) {
        throw new ApiError(403, "Business owner profile not found");
      }

      // Check if the order's venue belongs to this business owner
      const venue = await FoodVenue.findById(order.venue).session(session);
      if (!venue) {
        throw new ApiError(404, "Venue not found");
      }

      const service = await Service.findById(venue.service).session(session);
      if (!service || service.owner.toString() !== businessOwner._id.toString()) {
        throw new ApiError(403, "You can only view orders for your own venues");
      }
    } else {
      throw new ApiError(403, "Only business owners can view order details through this endpoint");
    }

    await session.commitTransaction();
    return res.status(200).json(new ApiResponse(200, order, "Order details retrieved successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in getOrderDetailsForBusinessOwners: ${error.message}`);

    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Failed to retrieve order details");
  } finally {
    session.endSession();
  }
});

const getOrderDetailsForDrivers = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.startTransaction();
    const {id} = req.params;
    const driverId = req.driver._id; // Using the driver from verifyDriverJwt middleware

    // Find the order with full details
    const order = await FoodDelivery.findById(id).populate("venue", "name address phone").populate("customer", "fullName phone").session(session);

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // Verify access rights - ONLY ALLOW DRIVERS ASSIGNED TO THE ORDER
    if (order.deliveryDriver.toString() !== driverId.toString()) {
      throw new ApiError(403, "You can only view orders assigned to you");
    }

    await session.commitTransaction();
    return res.status(200).json(new ApiResponse(200, order, "Order details retrieved successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in getOrderDetailsForDrivers: ${error.message}`);

    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Failed to retrieve order details");
  } finally {
    session.endSession();
  }
});
/**
 * @desc    Get all food delivery orders for a customer
 * @route   GET /api/food-delivery/customer
 * @access  Private (Customer)
 */

const getCustomerOrders = asyncHandler(async (req, res) => {
  try {
    // Get the customer ID from the route parameter
    const requestedCustomerId = req.params.id;
    const authenticatedUserId = req.user._id;

    // Verify the user is a business owner
    if (req.user.role !== "business_owner") {
      throw new ApiError(403, "Only business owners can view customer orders");
    }

    // Find the business owner associated with this user
    const businessOwner = await BusinessOwner.findOne({user: authenticatedUserId});
    if (!businessOwner) {
      throw new ApiError(403, "User is not a registered business owner");
    }

    // Find the service associated with this business owner
    const service = await Service.findOne({owner: businessOwner._id});
    if (!service) {
      throw new ApiError(403, "Business owner doesn't have any associated service");
    }

    // Find the food venue associated with this service
    const foodVenue = await FoodVenue.findOne({service: service._id});
    if (!foodVenue) {
      throw new ApiError(403, "No food venue found for this business");
    }

    const {
      status,
      limit = 10,
      page = 1
    } = req.query;

    const options = {
      page: Math.max(parseInt(page, 10) || 1, 1),
      limit: Math.min(Math.max(parseInt(limit, 10) || 10, 100)),
      sort: {
        createdAt: -1
      },
      populate: [
        {
          path: "venue",
          select: "name image address",
          match: {
            _id: foodVenue._id
          } // Ensure only orders from this venue are populated
        }, {
          path: "deliveryDriver",
          select: "name phone"
        }
      ]
    };

    // Validate pagination parameters
    if (isNaN(options.page) || options.page < 1) {
      throw new ApiError(400, "Invalid page number");
    }
    if (isNaN(options.limit) || options.limit < 1 || options.limit > 100) {
      throw new ApiError(400, "Limit must be between 1 and 100");
    }

    const query = {
      "customer._id": new mongoose.Types.ObjectId(requestedCustomerId),
      venue: foodVenue._id, // Only show orders from this business's venue
      isDeleted: false
    };

    if (status) {
      query.deliveryStatus = status;
    }

    const orders = await FoodDelivery.paginate(query, options);

    return res.status(200).json(new ApiResponse(200, orders, "Customer orders retrieved successfully"));
  } catch (error) {
    logger.error(`Error in getCustomerOrders: ${error.message}`);

    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof mongoose.Error.CastError) {
      throw new ApiError(400, "Invalid customer ID format");
    }
    throw new ApiError(500, "Failed to retrieve customer orders");
  }
});

/**
 * @desc    Get all food delivery orders for a venue
 * @route   GET /api/food-delivery/venue
 * @access  Private (Venue Owner)
 */
const getVenueOrders = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Find the business owner associated with this user
    const businessOwner = await BusinessOwner.findOne({user: req.user._id});
    if (!businessOwner) {
      throw new ApiError(403, "User is not a registered business owner");
    }

    // 2. Find the service associated with this business owner
    const service = await Service.findOne({owner: businessOwner._id});
    if (!service) {
      throw new ApiError(403, "Business owner doesn't have any associated service");
    }

    // 3. Find the food venue associated with this service
    const foodVenue = await FoodVenue.findOne({service: service._id});
    if (!foodVenue) {
      throw new ApiError(403, "No food venue found for this business");
    }

    // 4. Parse query parameters
    const {
      status,
      limit = 10,
      page = 1
    } = req.query;

    const options = {
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 10,
      sort: {
        createdAt: -1
      },
      // Remove customer population since we're storing it directly
      populate: [
        {
          path: "venue",
          select: "name"
        }, {
          path: "deliveryDriver",
          select: "name phone"
        }
      ]
    };

    // 5. Build the query
    const query = {
      venue: foodVenue._id,
      isDeleted: false
    };

    if (status) {
      query.deliveryStatus = status;
    }

    // 6. Fetch orders
    const orders = await FoodDelivery.paginate(query, options);

    return res.status(200).json(new ApiResponse(200, orders, "Venue orders retrieved successfully"));
  } catch (error) {
    logger.error(`Error in getVenueOrders: ${error.message}`);

    if (error instanceof mongoose.Error.CastError) {
      throw new ApiError(400, "Invalid ID format");
    }

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(500, "Failed to retrieve venue orders");
  }
});

/**
 * @desc    Update order status (for venue/driver)
 * @route   PATCH /api/food-delivery/:id/status
 * @access  Private (Venue Owner or Driver)
 */
const updateOrderStatus = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {status, notes, location} = req.body;

    // Check authentication source (business owner from user auth or driver from driver auth)
    const isBusinessOwner = req.user
      ?.role === "business_owner";
    const isDriver = req.driver; // From verifyDriverJwt middleware
    const authSource = isBusinessOwner
      ? "business_owner"
      : isDriver
        ? "driver"
        : null;

    if (!authSource) {
      throw new ApiError(403, "Unauthorized - Invalid authentication");
    }

    // Validate status
    const validStatuses = [
      "preparing",
      "ready",
      "dispatched",
      "in_transit",
      "delivered",
      "failed"
    ];
    if (!validStatuses.includes(status)) {
      throw new ApiError(400, "Invalid status value");
    }

    // Find the order
    const order = await FoodDelivery.findById(id).session(session);
    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // Check if payment is completed (except for failed status)
    if (status !== "failed" && order.paymentStatus !== "paid") {
      throw new ApiError(400, "Order status cannot be updated until payment is completed");
    }

    // Verify authorization based on request source
    if (isBusinessOwner) {
      // Business owner verification
      const businessOwner = await BusinessOwner.findOne({user: req.user._id}).session(session);
      if (!businessOwner) {
        throw new ApiError(403, "User is not a registered business owner");
      }

      const service = await Service.findOne({owner: businessOwner._id}).session(session);
      if (!service) {
        throw new ApiError(403, "Business owner doesn't have any associated service");
      }

      const foodVenue = await FoodVenue.findOne({service: service._id}).session(session);
      if (!foodVenue || order.venue.toString() !== foodVenue._id.toString()) {
        throw new ApiError(403, "Not authorized to update this order");
      }

      // Business owners can update:
      // - from pending to preparing
      // - from preparing to ready
      // - or to failed at any time
      if (!((order.deliveryStatus === "pending" && status === "preparing") || (order.deliveryStatus === "preparing" && status === "ready") || status === "failed")) {
        throw new ApiError(403, "Business owners can only: 1) Start preparing pending orders, 2) Mark prepared orders as ready, or 3) Mark any order as failed");
      }
    } else if (isDriver) {
      // Driver verification
      if (!order.deliveryDriver || order.deliveryDriver.toString() !== req.driver._id.toString()) {
        throw new ApiError(403, "Not authorized to update this order");
      }

      // Drivers can only update status:
      // - from ready to dispatched (if they're being assigned)
      // - from dispatched to in_transit
      // - from in_transit to delivered
      // - to failed at any time
      const validDriverTransitions = {
        ready: [
          "dispatched", "failed"
        ],
        dispatched: [
          "in_transit", "failed"
        ],
        in_transit: ["delivered", "failed"]
      };

      if (
        !validDriverTransitions[order.deliveryStatus]
        ?.includes(status)) {
        throw new ApiError(
          403, `Drivers can only update from ${order.deliveryStatus} to ${validDriverTransitions[order.deliveryStatus]
          ?.join(" or ")}`);
      }

      // Update driver's current location if provided
      if (location) {
        await DeliveryDriver.findByIdAndUpdate(req.driver._id, {
          currentLocation: {
            type: "Point",
            coordinates: location
          },
          lastActive: new Date()
        }, {session});
      }
    }

    // Validate status transition
    const validTransitions = {
      pending: [
        "preparing", "failed"
      ],
      preparing: [
        "ready", "failed"
      ],
      ready: [
        "dispatched", "failed"
      ],
      dispatched: [
        "in_transit", "failed"
      ],
      in_transit: [
        "delivered", "failed"
      ],
      delivered: [],
      failed: []
    };

    if (
      !validTransitions[order.deliveryStatus]
      ?.includes(status)) {
      throw new ApiError(400, `Invalid status transition from ${order.deliveryStatus} to ${status}`);
    }

    // Update status
    order.deliveryStatus = status;
    order.trackingUpdates.push({
      status,
      notes: notes || "",
      updatedBy: isBusinessOwner
        ? "venue"
        : "driver",
      ...(location && {
        location: {
          type: "Point",
          coordinates: location
        }
      })
    });

    // Handle delivered status
    if (status === "delivered") {
      order.actualDeliveryTime = new Date();
      if (order.deliveryDriver) {
        await DeliveryDriver.findByIdAndUpdate(order.deliveryDriver, {
          isAvailable: true,
          $inc: {
            completedDeliveries: 1
          },
          lastActive: new Date()
        }, {session});
      }
    }

    await order.save({session});
    await session.commitTransaction();

    return res.status(200).json(new ApiResponse(200, order, "Order status updated successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateOrderStatus: ${error.message}`);

    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Failed to update order status");
  } finally {
    session.endSession();
  }
});
/**
 * @desc    Get all food delivery orders for the authenticated customer
 * @route   GET /api/food-delivery/customer/orders
 * @access  Private (Customer)
 */
const getAllCustomerOrders = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.startTransaction();
    const userId = req.user._id;
    const userRole = req.user.role;

    // Verify the user is a customer
    if (userRole !== "customer") {
      throw new ApiError(403, "Only customers can access their orders");
    }

    // Parse query parameters
    const {
      status,
      limit = 10,
      page = 1,
      sortBy = "createdAt",
      sortOrder = "desc"
    } = req.query;

    // Validate pagination parameters
    const options = {
      page: Math.max(parseInt(page, 10) || 1),
      limit: Math.min(Math.max(parseInt(limit, 10) || 10, 100)),
      sort: {
        [sortBy]: sortOrder === "desc"
          ? -1
          : 1
      },
      populate: [
        {
          path: "venue",
          select: "name address phone"
        }, {
          path: "deliveryDriver",
          select: "fullName phone vehicleType"
        }
      ],
      session
    };

    // Build the query
    const query = {
      "customer._id": userId,
      isDeleted: false
    };

    if (status) {
      query.deliveryStatus = status;
    }

    // Fetch orders with pagination
    const orders = await FoodDelivery.paginate(query, options);

    await session.commitTransaction();
    return res.status(200).json(new ApiResponse(200, orders, "Customer orders retrieved successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in getAllCustomerOrders: ${error.message}`);

    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Failed to retrieve customer orders");
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Assign driver to order
 * @route   POST /api/food-delivery/:id/assign-driver
 * @access  Private (Venue Owner)
 */
const assignDriverToOrder = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {driverId} = req.body;
    const userId = req.user._id;

    // Verify business owner access
    const businessOwner = await BusinessOwner.findOne({user: userId});
    if (!businessOwner) {
      throw new ApiError(403, "User is not a registered business owner");
    }

    const service = await Service.findOne({owner: businessOwner._id});
    if (!service) {
      throw new ApiError(403, "Business owner doesn't have any associated service");
    }

    const foodVenue = await FoodVenue.findOne({service: service._id});
    if (!foodVenue) {
      throw new ApiError(403, "No food venue found for this business");
    }

    // Find the order
    const order = await FoodDelivery.findById(id).session(session);
    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // Verify the order belongs to the business owner's venue
    if (order.venue.toString() !== foodVenue._id.toString()) {
      throw new ApiError(403, "Not authorized to assign driver for this order");
    }

    if (order.deliveryStatus !== "ready") {
      throw new ApiError(400, "Order must be in 'ready' status to assign driver");
    }

    // Find and verify driver
    const driver = await DeliveryDriver.findById(driverId).session(session);
    if (!driver) {
      throw new ApiError(404, "Driver not found");
    }
    if (!driver.isAvailable || !driver.isOnDuty) {
      throw new ApiError(400, "Driver is not available or not on duty");
    }

    // Assign driver
    order.deliveryDriver = driverId;
    order.deliveryStatus = "dispatched";
    await order.save({session});

    // Update driver status
    driver.isAvailable = false;
    await driver.save({session});

    await session.commitTransaction();

    return res.status(200).json(new ApiResponse(200, order, "Driver assigned successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in assignDriverToOrder: ${error.message}`);

    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Failed to assign driver");
  } finally {
    session.endSession();
  }
});
/**
 * @desc    Cancel food delivery order
 * @route   POST /api/food-delivery/:id/cancel
 * @access  Private (Customer)
 */
const cancelOrder = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {reason} = req.body;
    const customerId = req.user._id;

    // Find the order
    const order = await FoodDelivery.findById(id).session(session);
    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // Verify customer owns the order
    if (order.customer.toString() !== customerId.toString()) {
      throw new ApiError(403, "Not authorized to cancel this order");
    }

    // Check if order can be cancelled
    if (!order.isCancellable) {
      throw new ApiError(400, "Order cannot be cancelled at this stage");
    }

    //  Process refund if payment was made and succeeded
    // if (order.payment && order.payment.status === "succeeded") {
    //   try {
    //     await refundStripePayment(order.payment.transactionId, order.totalAmount);
    //     order.payment.status = "refunded";
    //   } catch (error) {
    //     logger.error(`Refund failed: ${error.message}`);
    //     throw new ApiError(500, "Refund processing failed");
    //   }
    // }

    // Update order status
    order.deliveryStatus = "failed";
    order.cancellationReason = reason;
    order.cancelledBy = "customer";
    order.cancellationTime = new Date();

    // Mark driver as available if assigned
    if (order.deliveryDriver) {
      await DeliveryDriver.findByIdAndUpdate(order.deliveryDriver, {
        isAvailable: true
      }, {session});
    }

    await order.save({session});
    await session.commitTransaction();

    return res.status(200).json(new ApiResponse(200, order, "Order cancelled successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in cancelOrder: ${error.message}`);

    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Failed to cancel order");
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Get nearby drivers for an order
 * @route   GET /api/food-delivery/:id/nearby-drivers
 * @access  Private (Venue Owner)
 */
const getNearbyDrivers = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const userId = req.user._id;

    // 1. Find the business owner associated with this user
    const businessOwner = await BusinessOwner.findOne({user: userId}).session(session);
    if (!businessOwner) {
      throw new ApiError(403, "User is not a registered business owner");
    }

    // 2. Find the service associated with this business owner
    const service = await Service.findOne({owner: businessOwner._id}).session(session);
    if (!service) {
      throw new ApiError(403, "Business owner doesn't have any associated service");
    }

    // 3. Find the food venue associated with this service
    const foodVenue = await FoodVenue.findOne({service: service._id}).session(session);
    if (!foodVenue) {
      throw new ApiError(403, "No food venue found for this business");
    }

    // 4. Find the order and verify it belongs to this venue
    const order = await FoodDelivery.findById(id).session(session);
    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    if (order.venue.toString() !== foodVenue._id.toString()) {
      throw new ApiError(403, "Not authorized to view drivers for this order");
    }

    // 5. Check if order has valid coordinates
    if (
      !order.deliveryAddress
      ?.coordinates
        ?.coordinates) {
      throw new ApiError(400, "Order does not have valid delivery coordinates");
    }

    // 6. Find nearby drivers (15km radius)
    const maxDistance = 15000; // 15km in meters
    const drivers = await DeliveryDriver.find({
      isAvailable: true,
      isOnDuty: true,
      status: "active",
      currentLocation: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: order.deliveryAddress.coordinates.coordinates
          },
          $maxDistance: maxDistance
        }
      }
    }).session(session);

    await session.commitTransaction();
    return res.status(200).json(new ApiResponse(200, drivers, "Nearby drivers retrieved successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in getNearbyDrivers: ${error.message}`);

    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof mongoose.Error.CastError) {
      throw new ApiError(400, "Invalid ID format");
    }
    throw new ApiError(500, "Failed to find nearby drivers");
  } finally {
    session.endSession();
  }
});
/**
 * @desc    Get venue statistics
 * @route   GET /api/food-delivery/venue/stats
 * @access  Private (Venue Owner)
 */
const getVenueStats = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;

    // 1. Find the business owner associated with this user
    const businessOwner = await BusinessOwner.findOne({user: userId}).session(session);
    if (!businessOwner) {
      throw new ApiError(403, "User is not a registered business owner");
    }

    // 2. Find the service associated with this business owner
    const service = await Service.findOne({owner: businessOwner._id}).session(session);
    if (!service) {
      throw new ApiError(403, "Business owner doesn't have any associated service");
    }

    // 3. Find the food venue associated with this service
    const foodVenue = await FoodVenue.findOne({service: service._id}).session(session);
    if (!foodVenue) {
      throw new ApiError(403, "No food venue found for this business");
    }

    // 4. Calculate statistics for this venue
    const stats = await FoodDelivery.aggregate([
      {
        $match: {
          venue: new mongoose.Types.ObjectId(foodVenue._id),
          isDeleted: false
        }
      }, {
        $group: {
          _id: null,
          totalOrders: {
            $sum: 1
          },
          completedOrders: {
            $sum: {
              $cond: [
                {
                  $eq: ["$deliveryStatus", "delivered"]
                },
                1,
                0
              ]
            }
          },
          cancelledOrders: {
            $sum: {
              $cond: [
                {
                  $ne: ["$cancelledBy", null]
                },
                1,
                0
              ]
            }
          },
          totalRevenue: {
            $sum: "$totalAmount"
          },
          avgPreparationTime: {
            $avg: {
              $divide: [
                {
                  $subtract: ["$actualDeliveryTime", "$createdAt"]
                },
                60000 // Convert to minutes
              ]
            }
          }
        }
      }
    ]).session(session);

    const result = stats[0] || {
      totalOrders: 0,
      completedOrders: 0,
      cancelledOrders: 0,
      totalRevenue: 0,
      avgPreparationTime: null
    };

    await session.commitTransaction();
    return res.status(200).json(new ApiResponse(200, result, "Venue statistics retrieved successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in getVenueStats: ${error.message}`);

    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof mongoose.Error.CastError) {
      throw new ApiError(400, "Invalid ID format");
    }
    throw new ApiError(500, "Failed to calculate venue statistics");
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Update delivery location
 * @route   PATCH /api/food-delivery/:id/location
 * @access  Private (Driver)
 */
const updateDeliveryLocation = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {coordinates} = req.body;
    const driverId = req.user._id;

    // Validate coordinates
    if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(c => typeof c === "number")) {
      throw new ApiError(400, "Coordinates must be an array of [longitude, latitude]");
    }

    // Find the order
    const order = await FoodDelivery.findById(id).session(session);
    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // Verify driver is assigned to this order
    if (!order.deliveryDriver || order.deliveryDriver.toString() !== driverId.toString()) {
      throw new ApiError(403, "Not authorized to update this order");
    }

    // Geocode new coordinates
    let geocodedAddress;
    try {
      geocodedAddress = await geocodeCoordinates(coordinates);
      if (!geocodedAddress) {
        throw new ApiError(400, "Could not determine address from coordinates");
      }
    } catch (error) {
      logger.error(`Geocoding error: ${error.message}`);
      throw new ApiError(400, "Invalid coordinates");
    }

    // Update delivery address
    order.deliveryAddress = {
      country: geocodedAddress.country,
      city: geocodedAddress.city,
      street: geocodedAddress.street,
      zipCode: geocodedAddress.zipCode,
      coordinates: {
        type: "Point",
        coordinates: coordinates
      },
      additionalInfo: order.deliveryAddress.additionalInfo
    };

    // Add tracking update with location
    order.trackingUpdates.push({
      status: order.deliveryStatus,
      notes: "Location updated",
      updatedBy: "driver",
      location: {
        type: "Point",
        coordinates: coordinates
      }
    });

    await order.save({session});
    await session.commitTransaction();

    return res.status(200).json(new ApiResponse(200, order, "Delivery location updated successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in updateDeliveryLocation: ${error.message}`);

    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Failed to update delivery location");
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Submit order rating and feedback
 * @route   POST /api/food-delivery/:id/rating
 * @access  Private (Customer)
 */
const submitOrderRating = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {id} = req.params;
    const {rating, feedback, driverRating, venueRating} = req.body;
    const customerId = req.user._id;

    // Validate ratings
    if (rating && (rating < 1 || rating > 5)) {
      throw new ApiError(400, "Order rating must be between 1 and 5");
    }
    if (driverRating && (driverRating < 1 || driverRating > 5)) {
      throw new ApiError(400, "Driver rating must be between 1 and 5");
    }
    if (venueRating && (venueRating < 1 || venueRating > 5)) {
      throw new ApiError(400, "Venue rating must be between 1 and 5");
    }

    // Find the order
    const order = await FoodDelivery.findById(id).session(session);
    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // Verify customer owns the order
    if (order.customer.toString() !== customerId.toString()) {
      throw new ApiError(403, "Not authorized to rate this order");
    }

    // Check if order is delivered
    if (order.deliveryStatus !== "delivered") {
      throw new ApiError(400, "Order must be delivered before rating");
    }

    // Check if already rated
    if (order.rating) {
      throw new ApiError(400, "Order has already been rated");
    }

    // Update ratings
    if (rating) 
      order.rating = rating;
    if (feedback) 
      order.feedback = feedback;
    if (driverRating) 
      order.driverRating = driverRating;
    if (venueRating) 
      order.venueRating = venueRating;
    
    await order.save({session});

    // Update venue and driver average ratings if provided
    if (venueRating && order.venue) {
      await updateVenueRating(order.venue, session);
    }
    if (driverRating && order.deliveryDriver) {
      await updateDriverRating(order.deliveryDriver, session);
    }

    await session.commitTransaction();

    return res.status(200).json(new ApiResponse(200, order, "Rating submitted successfully"));
  } catch (error) {
    await session.abortTransaction();
    logger.error(`Error in submitOrderRating: ${error.message}`);

    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Failed to submit rating");
  } finally {
    session.endSession();
  }
});

// Helper function to update venue average rating
const updateVenueRating = async (venueId, session) => {
  const stats = await FoodDelivery.aggregate([
    {
      $match: {
        venue: mongoose.Types.ObjectId(venueId),
        venueRating: {
          $exists: true
        }
      }
    }, {
      $group: {
        _id: null,
        avgRating: {
          $avg: "$venueRating"
        },
        ratingCount: {
          $sum: 1
        }
      }
    }
  ]).session(session);

  if (stats.length > 0) {
    await FoodVenue.findByIdAndUpdate(venueId, {
      averageRating: stats[0].avgRating,
      ratingCount: stats[0].ratingCount
    }, {session});
  }
};

// Helper function to update driver average rating
const updateDriverRating = async (driverId, session) => {
  const stats = await FoodDelivery.aggregate([
    {
      $match: {
        deliveryDriver: mongoose.Types.ObjectId(driverId),
        driverRating: {
          $exists: true
        }
      }
    }, {
      $group: {
        _id: null,
        avgRating: {
          $avg: "$driverRating"
        },
        ratingCount: {
          $sum: 1
        }
      }
    }
  ]).session(session);

  if (stats.length > 0) {
    await DeliveryDriver.findByIdAndUpdate(driverId, {
      averageRating: stats[0].avgRating,
      ratingCount: stats[0].ratingCount
    }, {session});
  }
};

export {
  createFoodDeliveryOrder,
  getCustomerOrders,
  getVenueOrders,
  getAllCustomerOrders,
  updateOrderStatus,
  assignDriverToOrder,
  cancelOrder,
  getOrderDetailsForCustomers,
  getOrderDetailsForBusinessOwners,
  getOrderDetailsForDrivers,
  getNearbyDrivers,
  getVenueStats,
  updateDeliveryLocation,
  submitOrderRating
};

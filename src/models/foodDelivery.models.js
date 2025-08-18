import mongoose, {Schema} from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const foodDeliverySchema = new Schema({
  //  Reference to the customer placing the order
  // customer: {
  //   type: Schema.Types.ObjectId,
  //   ref: "User",
  //   required: true,
  //   index: true,
  //   validate: {
  //     validator: async function (userId) {
  //       const user = await mongoose.model("User").findById(userId);
  //       return user && user.role === "customer";
  //     },
  //     message: "Customer must be a valid user with customer role"
  //   }
  // },
  // Reference to the customer placing the order
  customer: {
    type: new Schema({
      _id: {
        type: Schema.Types.ObjectId,
        required: true
      },
      name: {
        type: String,
        required: true
      },
      email: {
        type: String,
        required: true
      },
      phone: {
        type: String
      }
    }),
    required: true
  },
  // Reference to the food venue
  venue: {
    type: Schema.Types.ObjectId,
    ref: "FoodVenue",
    required: true,
    index: true,
    validate: {
      validator: async function (venueId) {
        const venue = await mongoose.model("FoodVenue").findById(venueId);
        return venue && venue.isAvailable;
      },
      message: "Venue must be valid and available"
    }
  },

  // Delivery address (can be different from user's default address)
  deliveryAddress: {
    type: {
      country: {
        type: String,
        trim: true,
        required: true
      },
      city: {
        type: String,
        trim: true,
        required: true
      },
      street: {
        type: String,
        trim: true,
        required: true
      },
      zipCode: {
        type: String,
        trim: true
      },
      unitNumber: {
        type: String,
        trim: true
      }, // New field for apartments

      coordinates: {
        type: {
          type: String,
          enum: ["Point"],
          default: "Point"
        },
        coordinates: {
          type: [Number],
          required: true,
          validate: {
            validator: coords => Array.isArray(coords) && coords.length === 2 && coords.every(c => typeof c === "number"),
            message: "Coordinates must be an array of two numbers [longitude, latitude]"
          }
        }
      },
      additionalInfo: {
        type: String,
        trim: true,
        maxlength: 200
      }
    },
    required: true
  },

  // Order items with detailed information
  items: [
    {
      menuItemId: {
        type: Schema.Types.ObjectId,
        required: true,
        validate: {
          validator: async function (menuItemId) {
            const venue = await mongoose.model("FoodVenue").findOne({"menuItems._id": menuItemId});
            return !!venue;
          },
          message: "Menu item must exist in the venue's menu"
        }
      },
      name: {
        type: String,
        required: true,
        trim: true
      },
      quantity: {
        type: Number,
        required: true,
        min: [1, "Quantity must be at least 1"]
      },
      price: {
        type: Number,
        required: true,
        min: [0, "Price cannot be negative"]
      },
      specialInstructions: {
        type: String,
        trim: true,
        maxlength: 200
      },
      options: [
        {
          name: {
            type: String,
            trim: true,
            required: true
          },
          choice: {
            type: String,
            trim: true,
            required: true
          },
          additionalCost: {
            type: Number,
            default: 0,
            min: 0
          }
        }
      ]
    }
  ],

  // Order summary
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  deliveryFee: {
    type: {
      base: {
        type: Number,
        default: 0
      }, // flat starting fee
      distanceFee: {
        type: Number,
        default: 0
      }, // fee based on distance (per km/mi)
      surgeFee: {
        type: Number,
        default: 0
      }, // extra fee during peak hours
      smallOrderFee: {
        type: Number,
        default: 0
      }, // fee if order below threshold
      serviceFee: {
        type: Number,
        default: 0
      }, // % or flat fee charged by platform
      handlingFee: {
        type: Number,
        default: 0
      }, // e.g., packaging/restaurant handling
      zoneFee: {
        type: Number,
        default: 0
      }, // city-zone based surcharge (NYC congestion fee, SG CBD fee, etc.)
      currency: {
        type: String,
        default: "USD",
        uppercase: true,
        validate: {
          validator: v => /^[A-Z]{3}$/.test(v), // ISO 4217 currency code
          message: props => `${props.value} is not a valid ISO currency code`
        }
      },
      discount: {
        type: Number,
        default: 0
      }, // promo/free delivery applied
      total: {
        type: Number,
        default: 0
      }, // final fee after calculation
      isFree: {
        type: Boolean,
        default: false
      }, // promo flag
      breakdown: {
        type: Map,
        of: Number, // store raw breakdown for debugging/audits
        default: {}
      }
    },
    required: true
  },
  tax: {
    type: Number,
    required: true,
    min: 0
  },
  tip: {
    type: Number,
    default: 0,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  discount: {
    type: {
      code: {
        type: String,
        trim: true
      },
      amount: {
        type: Number,
        min: 0
      },
      type: {
        type: String,
        enum: ["percentage", "fixed"]
      }
    }
  },

  // Payment reference
  payment: {
    type: Schema.Types.ObjectId,
    ref: "FoodDeliveryPayment",
    index: true
  },
  paymentMethod: {
    type: String,
    enum: [
      "credit_card",
      "paypal",
      "stripe",
      "razorpay",
      "esewa",
      "cash-on-delivery"
    ],
    required: true
  },

  paymentStatus: {
    type: String,
    enum: [
      "pending", "paid", "failed", "refunded"
    ],
    default: "pending"
  },

  // Delivery information
  deliveryStatus: {
    type: String,
    enum: [
      "pending",
      "preparing",
      "ready",
      "dispatched",
      "in_transit",
      "delivered",
      "failed"
    ],
    default: "pending"
  },
  estimatedDeliveryTime: {
    type: Date,
    validate: {
      validator: function (value) {
        return !this.actualDeliveryTime || value >= new Date();
      },
      message: "Estimated delivery time must be in the future"
    }
  },
  actualDeliveryTime: {
    type: Date,
    validate: {
      validator: function (value) {
        return !this.estimatedDeliveryTime || value >= this.createdAt;
      },
      message: "Actual delivery time cannot be before order creation"
    }
  },
  deliveryDriver: {
    type: Schema.Types.ObjectId,
    ref: "DeliveryDriver",
    validate: {
      validator: async function (driverId) {
        if (!driverId) 
          return true;
        const driver = await mongoose.model("DeliveryDriver").findById(driverId);
        return driver && driver.isAvailable && driver.isOnDuty;
      },
      message: "Driver must be available and on duty"
    }
  },

  // Tracking information
  trackingUpdates: [
    {
      status: {
        type: String,
        required: true
      },
      timestamp: {
        type: Date,
        default: Date.now
      },
      location: {
        type: {
          type: String,
          enum: ["Point"],
          default: "Point"
        },
        coordinates: {
          type: [Number]
        }
      },
      notes: {
        type: String,
        trim: true,
        maxlength: 200
      },
      updatedBy: {
        type: String,
        enum: [
          "system", "venue", "driver", "customer"
        ],
        required: true
      }
    }
  ],

  // Customer communication
  customerNotes: {
    type: String,
    trim: true,
    maxlength: 500
  },
  venueNotes: {
    type: String,
    trim: true,
    maxlength: 500
  },
  driverNotes: {
    type: String,
    trim: true,
    maxlength: 500
  },

  // Rating and feedback
  rating: {
    type: Number,
    min: 1,
    max: 5,
    validate: {
      validator: function (value) {
        return this.deliveryStatus === "delivered";
      },
      message: "Rating can only be provided after delivery"
    }
  },
  feedback: {
    type: String,
    trim: true,
    maxlength: 1000,
    validate: {
      validator: function (value) {
        return !value || this.deliveryStatus === "delivered";
      },
      message: "Feedback can only be provided after delivery"
    }
  },
  driverRating: {
    type: Number,
    min: 1,
    max: 5
  },
  venueRating: {
    type: Number,
    min: 1,
    max: 5
  },

  // Cancellation information
  cancellationReason: {
    type: String,
    trim: true,
    maxlength: 200
  },
  cancelledBy: {
    type: String,
    enum: ["customer", "venue", "driver", "system"]
  },
  cancellationTime: {
    type: Date,
    validate: {
      validator: function (value) {
        return !value || value >= this.createdAt;
      },
      message: "Cancellation time cannot be before order creation"
    }
  },

  // Technical fields
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  deletedAt: {
    type: Date
  },
  version: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true,
  optimisticConcurrency: true,
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      delete ret.__v;
      return ret;
    }
  },
  toObject: {
    virtuals: true
  }
});

// Indexes
foodDeliverySchema.index({customer: 1, createdAt: -1});
foodDeliverySchema.index({venue: 1, createdAt: -1});
foodDeliverySchema.index({deliveryDriver: 1, deliveryStatus: 1});
foodDeliverySchema.index({deliveryStatus: 1, createdAt: 1});
foodDeliverySchema.index({"deliveryAddress.coordinates": "2dsphere"});
foodDeliverySchema.index({createdAt: -1});
foodDeliverySchema.index({totalAmount: 1});
foodDeliverySchema.index({"trackingUpdates.timestamp": 1});

// Pre-save hooks
foodDeliverySchema.pre("save", function (next) {
  if (this.isModified("items")) {
    this.calculateTotals();
  }

  if (this.isModified("deliveryStatus") && this.deliveryStatus === "delivered") {
    this.actualDeliveryTime = new Date();
  }

  if (this.isModified("isDeleted") && this.isDeleted) {
    this.deletedAt = new Date();
  }

  next();
});

// Methods
foodDeliverySchema.methods.calculateTotals = function () {
  this.subtotal = this.items.reduce((sum, item) => {
    const optionsCost = item.options
      ?.reduce((optSum, opt) => optSum + (opt.additionalCost || 0), 0) || 0;
    return sum + item.price * item.quantity + optionsCost;
  }, 0);

  // Apply discount if exists
  let discountAmount = 0;
  if (this.discount) {
    discountAmount = this.discount.type === "percentage"
      ? this.subtotal * (this.discount.amount / 100)
      : this.discount.amount;
  }

  this.totalAmount = this.subtotal + this.deliveryFee + this.tax + this.tip - discountAmount;
};

foodDeliverySchema.methods.cancelOrder = async function (reason, cancelledBy, refundAmount = 0) {
  if (this.deliveryStatus === "delivered") {
    throw new Error("Cannot cancel an already delivered order");
  }

  if (this.payment && refundAmount > this.totalAmount) {
    throw new Error("Refund amount cannot exceed order total");
  }

  this.deliveryStatus = "failed";
  this.cancellationReason = reason;
  this.cancelledBy = cancelledBy;
  this.cancellationTime = new Date();
  this.refundAmount = refundAmount;

  await this.save();
};

foodDeliverySchema.methods.updateStatus = async function (newStatus, updatedBy, notes = "", location = null) {
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
    !validTransitions[this.deliveryStatus]
    ?.includes(newStatus)) {
    throw new Error(`Invalid status transition from ${this.deliveryStatus} to ${newStatus}`);
  }

  this.deliveryStatus = newStatus;
  this.trackingUpdates.push({
    status: newStatus,
    notes,
    location: location
      ? {
        type: "Point",
        coordinates: location
      }
      : undefined,
    updatedBy
  });

  // If driver is assigned and status is in_transit, update driver's location
  if (newStatus === "in_transit" && this.deliveryDriver && location) {
    await mongoose.model("DeliveryDriver").findByIdAndUpdate(this.deliveryDriver, {
      currentLocation: {
        type: "Point",
        coordinates: location
      }
    });
  }

  await this.save();
};

foodDeliverySchema.methods.assignDriver = async function (driverId) {
  if (this.deliveryStatus !== "ready" && this.deliveryStatus !== "preparing") {
    throw new Error("Order must be in ready or preparing status to assign driver");
  }

  const driver = await mongoose.model("DeliveryDriver").findById(driverId);
  if (!driver || !driver.isAvailable || !driver.isOnDuty) {
    throw new Error("Driver must be available and on duty");
  }

  this.deliveryDriver = driverId;
  this.deliveryStatus = "dispatched";
  await this.save();

  // Update driver's active deliveries count
  await mongoose.model("DeliveryDriver").findByIdAndUpdate(driverId, {
    $inc: {
      totalDeliveries: 1
    }
  });
};

// Virtuals
foodDeliverySchema.virtual("estimatedPrepTime").get(function () {
  // Base time + 2 minutes per item
  return 15 + (
    this.items
    ?.length * 2 || 0);
});

foodDeliverySchema.virtual("deliveryDuration").get(function () {
  if (
    !this.deliveryAddress
    ?.coordinates || !this.venue
      ?.address
        ?.coordinates) {
    return 30; // Default estimate
  }
  // In a real app, use proper distance calculation
  return 30; // Placeholder
});

foodDeliverySchema.virtual("isCancellable").get(function () {
  return (!this.isDeleted && this.deliveryStatus !== "delivered" && this.deliveryStatus !== "failed" && (!this.cancelledBy || this.cancellationTime === undefined));
});

foodDeliverySchema.virtual("venueDetails", {
  ref: "FoodVenue",
  localField: "venue",
  foreignField: "_id",
  justOne: true
});

foodDeliverySchema.virtual("customerDetails", {
  ref: "User",
  localField: "customer",
  foreignField: "_id",
  justOne: true
});

foodDeliverySchema.virtual("driverDetails", {
  ref: "DeliveryDriver",
  localField: "deliveryDriver",
  foreignField: "_id",
  justOne: true
});

foodDeliverySchema.virtual("paymentDetails", {
  ref: "FoodDeliveryPayment",
  localField: "payment",
  foreignField: "_id",
  justOne: true
});

// Query helpers
foodDeliverySchema.query.active = function () {
  return this.where({isDeleted: false});
};

foodDeliverySchema.query.deleted = function () {
  return this.where({isDeleted: true});
};

foodDeliverySchema.query.byCustomer = function (customerId) {
  return this.where({customer: customerId});
};

foodDeliverySchema.query.byVenue = function (venueId) {
  return this.where({venue: venueId});
};

foodDeliverySchema.query.byDriver = function (driverId) {
  return this.where({deliveryDriver: driverId});
};

foodDeliverySchema.query.byStatus = function (status) {
  return this.where({deliveryStatus: status});
};

foodDeliverySchema.query.recent = function (days = 7) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return this.where({
    createdAt: {
      $gte: date
    }
  });
};

// Static methods
foodDeliverySchema.statics.findNearbyDrivers = async function (orderId, maxDistance = 5000) {
  const order = await this.findById(orderId);
  if (!order) 
    throw new Error("Order not found");
  
  return mongoose.model("DeliveryDriver").find({
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
  });
};

foodDeliverySchema.statics.calculateStats = async function (venueId) {
  return this.aggregate([
    {
      $match: {
        venue: mongoose.Types.ObjectId(venueId),
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
  ]);
};

// Plugins
foodDeliverySchema.plugin(mongoosePaginate);

const FoodDelivery = mongoose.model("FoodDelivery", foodDeliverySchema);

export default FoodDelivery;
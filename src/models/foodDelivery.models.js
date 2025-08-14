import mongoose, {Schema} from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const foodDeliverySchema = new Schema({
  // Reference to the customer placing the order
  customer: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },

  // Reference to the food venue
  venue: {
    type: Schema.Types.ObjectId,
    ref: "FoodVenue",
    required: true,
    index: true
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
            message: "Coordinates must be an array of two numbers [longitude, latitude]."
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
        ref: "FoodVenue.menuItems",
        required: true
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
    type: Number,
    required: true,
    min: 0
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

  // Payment information
  paymentMethod: {
    type: String,
    enum: [
      "credit_card", "debit_card", "paypal", "cash_on_delivery", "wallet"
    ],
    required: true
  },
  paymentStatus: {
    type: String,
    enum: [
      "pending", "paid", "failed", "refunded", "partially_refunded"
    ],
    default: "pending"
  },
  paymentDetails: {
    type: Schema.Types.Mixed // For storing payment gateway responses
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
    type: Date
  },
  actualDeliveryTime: {
    type: Date
  },
  deliveryDriver: {
    type: Schema.Types.ObjectId,
    ref: "DeliveryDriver" // Assuming you have a driver model or user type
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
    max: 5
  },
  feedback: {
    type: String,
    trim: true,
    maxlength: 1000
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
    type: Date
  },

  // Technical fields
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  deletedAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true
  },
  toObject: {
    virtuals: true
  }
});

// Pre-save hook to calculate totals
foodDeliverySchema.pre("save", function (next) {
  if (this.isModified("items")) {
    this.subtotal = this.items.reduce((sum, item) => {
      const optionsCost = item.options
        ?.reduce((optSum, opt) => optSum + (opt.additionalCost || 0), 0) || 0;
      return sum + item.price * item.quantity + optionsCost;
    }, 0);

    this.totalAmount = this.subtotal + this.deliveryFee + this.tax + this.tip;
  }
  next();
});

// Virtual for estimated preparation time (minutes)
foodDeliverySchema.virtual("estimatedPrepTime").get(function () {
  // Base time + 2 minutes per item
  return 15 + this.items
    ?.length * 2 || 0;
});

// Virtual for delivery duration (minutes)
foodDeliverySchema.virtual("deliveryDuration").get(function () {
  // Calculate based on distance (simplified)
  if (
    !this.deliveryAddress
    ?.coordinates || !this.venue
      ?.address
        ?.coordinates) {
    return 30; // Default estimate
  }
  // In a real app, you'd use a proper distance calculation
  return 30; // Placeholder
});

// Virtual for populated venue details
foodDeliverySchema.virtual("venueDetails", {
  ref: "FoodVenue",
  localField: "venue",
  foreignField: "_id",
  justOne: true
});

// Virtual for populated customer details
foodDeliverySchema.virtual("customerDetails", {
  ref: "User",
  localField: "customer",
  foreignField: "_id",
  justOne: true
});

// Virtual for populated driver details
foodDeliverySchema.virtual("driverDetails", {
  ref: "User",
  localField: "deliveryDriver",
  foreignField: "_id",
  justOne: true
});

// Method to cancel an order
foodDeliverySchema.methods.cancelOrder = async function (reason, cancelledBy) {
  if (this.deliveryStatus === "delivered") {
    throw new Error("Cannot cancel an already delivered order");
  }

  this.deliveryStatus = "failed";
  this.cancellationReason = reason;
  this.cancelledBy = cancelledBy;
  this.cancellationTime = new Date();

  await this.save();
};

// Method to update delivery status
foodDeliverySchema.methods.updateStatus = async function (newStatus, notes = "", location = null) {
  const validTransitions = {
    pending: ["preparing"],
    preparing: ["ready"],
    ready: ["dispatched"],
    dispatched: ["in_transit"],
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
      : undefined
  });

  if (newStatus === "delivered") {
    this.actualDeliveryTime = new Date();
  }

  await this.save();
};

// Query helper for active orders
foodDeliverySchema.query.active = function () {
  return this.where({isDeleted: false});
};

// Query helper for deleted orders
foodDeliverySchema.query.deleted = function () {
  return this.where({isDeleted: true});
};

// Indexes
foodDeliverySchema.index({customer: 1, createdAt: -1});
foodDeliverySchema.index({venue: 1, createdAt: -1});
foodDeliverySchema.index({deliveryStatus: 1, createdAt: 1});
foodDeliverySchema.index({"deliveryAddress.coordinates": "2dsphere"});
foodDeliverySchema.index({createdAt: -1});

foodDeliverySchema.plugin(mongoosePaginate);

const FoodDelivery = mongoose.model("FoodDelivery", foodDeliverySchema);

export default FoodDelivery;
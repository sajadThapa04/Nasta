import mongoose, {Schema} from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const foodDeliveryPaymentSchema = new Schema({
  // Reference to the order
  order: {
    type: Schema.Types.ObjectId,
    ref: "FoodDelivery",
    required: true,
    index: true,
    unique: true,
    validate: {
      validator: async function (orderId) {
        const order = await mongoose.model("FoodDelivery").findById(orderId);
        return !!order;
      },
      message: "Order must exist"
    }
  },

  // Reference to the user who made the payment
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },

  // Payment information
  paymentMethod: {
    type: String,
    enum: [
      "credit_card",
      "debit_card",
      "paypal",
      "esewa",
      "stripe",
      "cash_on_delivery",
      "wallet",
      "razorpay"
    ],
    required: true
  },
  paymentStatus: {
    type: String,
    enum: [
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
      "processing",
      "requires_capture",
      "succeeded",
      "canceled",
      "failed",
      "pending",
      "paid",
      "refunded",
      "partially_refunded"
    ],
    required: true,
    default: "requires_payment_method"
  },

  // Transaction ID for tracking the payment
  transactionId: {
    type: String,
    required: function () {
      return this.paymentMethod !== "stripe"; // Required only for non-Stripe payments
    },
    trim: true,
    unique: true,
    sparse: true
  },

  // Payment metadata (expanded based on gateway response)
  paymentMetadata: {
    type: {
      gateway: {
        type: String,
        required: true
      }, // e.g., "stripe", "paypal"
      gatewayResponse: {
        type: Schema.Types.Mixed
      }, // Raw response from the payment gateway
      gatewayId: {
        type: String
      }, // e.g., paymentIntent.id for Stripe
      receiptUrl: {
        type: String,
        trim: true
      }, // URL to payment receipt
      currency: {
        type: String,
        default: "USD",
        uppercase: true
      }
    },
    required: true
  },

  // Original payment details (kept for backward compatibility)
  paymentDetails: {
    type: Schema.Types.Mixed // For backward compatibility
  },
  paymentIntentId: {
    type: String,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentDate: {
    type: Date
  },
  refundAmount: {
    type: Number,
    min: 0
  },
  refundDate: {
    type: Date
  },

  // Refund status if the payment is refunded
  refundStatus: {
    type: String,
    enum: [
      "not_refunded", "partially_refunded", "fully_refunded"
    ],
    default: "not_refunded"
  },

  // Transaction details
  gatewayName: {
    type: String,
    trim: true
  },
  feeAmount: {
    type: Number,
    min: 0
  },
  taxOnFee: {
    type: Number,
    min: 0
  },

  // Security information
  ipAddress: {
    type: String,
    trim: true
  },
  deviceInfo: {
    type: Schema.Types.Mixed
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
// foodDeliveryPaymentSchema.index({order: 1});
// foodDeliveryPaymentSchema.index({user: 1});
// foodDeliveryPaymentSchema.index({paymentStatus: 1});
// foodDeliveryPaymentSchema.index({paymentMethod: 1});
// foodDeliveryPaymentSchema.index({paymentDate: -1});
// foodDeliveryPaymentSchema.index({
//   transactionId: 1
// }, {
//   unique: true,
//   sparse: true
// });
foodDeliveryPaymentSchema.index({"paymentMetadata.gatewayId": 1});

// Pre-save hooks
foodDeliveryPaymentSchema.pre("save", function (next) {
  // Auto-set payment date when status changes to paid/succeeded
  if (this.isModified("paymentStatus") && (this.paymentStatus === "paid" || this.paymentStatus === "succeeded")) {
    this.paymentDate = new Date();
  }

  // Auto-set refund date and status when payment is refunded
  if (this.isModified("paymentStatus") && (this.paymentStatus === "refunded" || this.paymentStatus === "partially_refunded") && !this.refundDate) {
    this.refundDate = new Date();

    if (this.paymentStatus === "refunded") {
      this.refundStatus = "fully_refunded";
    } else if (this.paymentStatus === "partially_refunded") {
      this.refundStatus = "partially_refunded";
    }
  }

  // Ensure paymentStatus is valid
  const validStatuses = [
    "requires_payment_method",
    "requires_confirmation",
    "requires_action",
    "processing",
    "requires_capture",
    "succeeded",
    "canceled",
    "failed",
    "pending",
    "paid",
    "refunded",
    "partially_refunded"
  ];

  if (!validStatuses.includes(this.paymentStatus)) {
    throw new Error(`Invalid paymentStatus: ${this.paymentStatus}`);
  }

  if (this.isModified("isDeleted") && this.isDeleted) {
    this.deletedAt = new Date();
  }

  next();
});

// Methods
foodDeliveryPaymentSchema.methods.processRefund = async function (refundAmount, reason = "") {
  if (!["paid", "succeeded"].includes(this.paymentStatus)) {
    throw new Error("Only paid payments can be refunded");
  }

  if (refundAmount > this.amount) {
    throw new Error("Refund amount cannot exceed payment amount");
  }

  // Update payment status based on refund amount
  if (refundAmount === this.amount) {
    this.paymentStatus = "refunded";
    this.refundStatus = "fully_refunded";
  } else {
    this.paymentStatus = "partially_refunded";
    this.refundStatus = "partially_refunded";
  }

  this.refundDate = new Date();

  // Add refund details to paymentMetadata
  this.paymentMetadata.refunds = this.paymentMetadata.refunds || [];
  this.paymentMetadata.refunds.push({
    amount: refundAmount,
    date: new Date(),
    reason: reason,
    status: refundAmount === this.amount
      ? "full"
      : "partial"
  });

  await this.save();
};

// Virtuals
foodDeliveryPaymentSchema.virtual("orderDetails", {
  ref: "FoodDelivery",
  localField: "order",
  foreignField: "_id",
  justOne: true
});

foodDeliveryPaymentSchema.virtual("userDetails", {
  ref: "User",
  localField: "user",
  foreignField: "_id",
  justOne: true
});

foodDeliveryPaymentSchema.virtual("isPaymentSuccessful").get(function () {
  return ["paid", "succeeded"].includes(this.paymentStatus);
});

// Query helpers
foodDeliveryPaymentSchema.query.active = function () {
  return this.where({isDeleted: false});
};

foodDeliveryPaymentSchema.query.deleted = function () {
  return this.where({isDeleted: true});
};

foodDeliveryPaymentSchema.query.byStatus = function (status) {
  return this.where({paymentStatus: status});
};

foodDeliveryPaymentSchema.query.byMethod = function (method) {
  return this.where({paymentMethod: method});
};

foodDeliveryPaymentSchema.query.byUser = function (userId) {
  return this.where({user: userId});
};

foodDeliveryPaymentSchema.query.recent = function (days = 7) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return this.where({
    createdAt: {
      $gte: date
    }
  });
};

foodDeliveryPaymentSchema.query.successful = function () {
  return this.where({
    paymentStatus: {
      $in: ["paid", "succeeded"]
    }
  });
};

// Static methods
foodDeliveryPaymentSchema.statics.getTotalRevenue = async function (venueId = null) {
  const matchStage = venueId
    ? {
      venue: mongoose.Types.ObjectId(venueId)
    }
    : {};

  const result = await this.aggregate([
    {
      $lookup: {
        from: "fooddeliveries",
        localField: "order",
        foreignField: "_id",
        as: "order"
      }
    }, {
      $unwind: "$order"
    }, {
      $match: {
        ...matchStage,
        paymentStatus: {
          $in: ["paid", "succeeded"]
        },
        isDeleted: false
      }
    }, {
      $group: {
        _id: null,
        totalRevenue: {
          $sum: "$amount"
        },
        totalOrders: {
          $sum: 1
        },
        totalFees: {
          $sum: "$feeAmount"
        }
      }
    }
  ]);

  return (result[0] || {
    totalRevenue: 0,
    totalOrders: 0,
    totalFees: 0
  });
};

// Plugins
foodDeliveryPaymentSchema.plugin(mongoosePaginate);

const FoodDeliveryPayment = mongoose.model("FoodDeliveryPayment", foodDeliveryPaymentSchema);

export default FoodDeliveryPayment;
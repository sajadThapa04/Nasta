import mongoose, {Schema} from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoosePaginate from "mongoose-paginate-v2";

const deliveryDriverSchema = new Schema({
  // Basic user information

  fullName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      message: "Invalid email address"
    }
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  dob: {
    type: Date,
    validate: {
      validator: function (dob) {
        const minAgeDate = new Date();
        minAgeDate.setFullYear(minAgeDate.getFullYear() - 18);
        return dob <= minAgeDate;
      },
      message: "Driver must be at least 18 years old"
    }
  },
  profileImage: {
    type: String,
    default: "default-driver.png"
  },
  refreshToken: {
    type: String
  },

  // Driver-specific information
  driverId: {
    type: String,
    unique: true,
    trim: true
  },
  licenseNumber: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  licenseExpiry: {
    type: Date,
    required: true
  },
  vehicleType: {
    type: String,
    enum: [
      "bicycle", "motorcycle", "car", "scooter", "walking"
    ],
    required: true
  },
  vehicleMake: {
    type: String,
    trim: true
  },
  vehicleModel: {
    type: String,
    trim: true
  },
  vehicleYear: {
    type: Number,
    min: 1990,
    max: new Date().getFullYear() + 1
  },
  vehiclePlateNumber: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  vehicleColor: {
    type: String,
    trim: true
  },
  insuranceProvider: {
    type: String,
    trim: true
  },
  insurancePolicyNumber: {
    type: String,
    trim: true
  },
  insuranceExpiry: {
    type: Date
  },

  // Contact information
  emergencyContactName: {
    type: String,
    trim: true,
    required: true
  },
  emergencyContactPhone: {
    type: String,
    trim: true,
    required: true
  },
  emergencyContactRelation: {
    type: String,
    trim: true,
    required: true
  },

  // Location Information
  address: {
    country: {
      type: String,
      required: true,
      trim: true
    },
    city: {
      type: String,
      required: true,
      trim: true
    },
    street: {
      type: String,
      required: true,
      trim: true
    },
    zipCode: {
      type: String,
      trim: true
    },
    coordinates: {
      type: {
        type: String,
        default: "Point"
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: function (coords) {
            return (Array.isArray(coords) && coords.length === 2 && typeof coords[0] === "number" && typeof coords[1] === "number");
          },
          message: "Coordinates must be an array of [longitude, latitude]"
        }
      }
    }
  },

  // Work information
  currentLocation: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  currentAddress: {
    country: String,
    city: String,
    street: String,
    zipCode: String
  },

  isAvailable: {
    type: Boolean,
    default: true,
    index: true
  },
  isOnDuty: {
    type: Boolean,
    default: false,
    index: true
  },
  maxDeliveryRadius: {
    type: Number,
    default: 10,
    min: 1,
    max: 50
  },
  averageRating: {
    type: Number,
    min: 1,
    max: 5,
    default: null
  },
  totalDeliveries: {
    type: Number,
    default: 0,
    min: 0
  },
  completedDeliveries: {
    type: Number,
    default: 0,
    min: 0
  },
  cancellationRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  onTimePercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },

  // Documents
  licensePhoto: {
    type: String,
    trim: true
  },
  vehiclePhoto: {
    type: String,
    trim: true
  },
  insurancePhoto: {
    type: String,
    trim: true
  },

  // Bank details for payments
  bankAccount: {
    accountHolderName: {
      type: String,
      trim: true,
      required: true
    },
    accountNumber: {
      type: String,
      trim: true,
      required: true
    },
    bankName: {
      type: String,
      trim: true,
      required: true
    },
    branchCode: {
      type: String,
      trim: true
    }
  },

  // Status
  status: {
    type: String,
    enum: [
      "pending_approval", "active", "suspended", "inactive", "rejected"
    ],
    default: "pending_approval",
    index: true
  },
  suspensionReason: {
    type: String,
    trim: true,
    maxlength: 500
  },
  lastActive: {
    type: Date
  },

  // Authentication
  deviceToken: {
    type: String,
    trim: true
  },
  fcmToken: {
    type: String,
    trim: true
  },
  lastLogin: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      delete ret.password;
      delete ret.refreshToken;
      delete ret.__v;
      delete ret.deviceToken;
      delete ret.fcmToken;
      return ret;
    }
  }
});

// Indexes
// deliveryDriverSchema.index({
//   email: 1
// }, {unique: true});
// deliveryDriverSchema.index({
//   phone: 1
// }, {unique: true});
deliveryDriverSchema.index({currentLocation: "2dsphere"});
deliveryDriverSchema.index({status: 1, isAvailable: 1, isOnDuty: 1});

deliveryDriverSchema.virtual("activeDeliveries", {
  ref: "FoodDelivery",
  localField: "_id",
  foreignField: "deliveryDriver",
  match: {
    deliveryStatus: {
      $in: ["dispatched", "in_transit"]
    }
  }
});

deliveryDriverSchema.virtual("deliveryHistory", {
  ref: "FoodDelivery",
  localField: "_id",
  foreignField: "deliveryDriver",
  match: {
    deliveryStatus: "delivered"
  }
});

// Password hashing
deliveryDriverSchema.pre("save", async function (next) {
  if (!this.isModified("password")) 
    return next();
  
  try {
    this.password = await bcrypt.hash(this.password, 10);
    next();
  } catch (err) {
    next(err);
  }
});

// Password comparison
deliveryDriverSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// Token generation
deliveryDriverSchema.methods.generateAccessToken = function () {
  return jwt.sign({
    _id: this._id,
    email: this.email,
    fullName: this.fullName,
    role: "driver"
  }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || "1d"
  });
};

deliveryDriverSchema.methods.generateRefreshToken = function () {
  return jwt.sign({
    _id: this._id
  }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d"
  });
};

// Location update
deliveryDriverSchema.methods.updateLocation = async function (coordinates) {
  this.currentLocation = {
    type: "Point",
    coordinates: coordinates
  };
  this.lastActive = new Date();
  await this.save();
};

// Duty status
deliveryDriverSchema.methods.setDutyStatus = async function (onDuty) {
  this.isOnDuty = onDuty;
  this.isAvailable = onDuty;
  await this.save();
};

// Stats calculation
deliveryDriverSchema.methods.calculateStats = async function () {
  const stats = await this.model("FoodDelivery").aggregate([
    {
      $match: {
        deliveryDriver: this._id,
        deliveryStatus: {
          $in: ["delivered", "failed"]
        }
      }
    }, {
      $group: {
        _id: null,
        total: {
          $sum: 1
        },
        completed: {
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
        cancelled: {
          $sum: {
            $cond: [
              {
                $eq: ["$cancelledBy", "driver"]
              },
              1,
              0
            ]
          }
        },
        onTime: {
          $sum: {
            $cond: [
              {
                $lte: ["$actualDeliveryTime", "$estimatedDeliveryTime"]
              },
              1,
              0
            ]
          }
        }
      }
    }
  ]);

  if (stats.length > 0) {
    this.totalDeliveries = stats[0].total;
    this.completedDeliveries = stats[0].completed;
    this.cancellationRate = stats[0].total > 0
      ? (stats[0].cancelled / stats[0].total) * 100
      : 0;
    this.onTimePercentage = stats[0].completed > 0
      ? (stats[0].onTime / stats[0].completed) * 100
      : 100;
    await this.save();
  }
};

// Driver ID generation
deliveryDriverSchema.pre("save", function (next) {
  if (!this.driverId) {
    this.driverId = `DRV-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString().slice(-4)}`;
  }
  next();
});

deliveryDriverSchema.plugin(mongoosePaginate);

const DeliveryDriver = mongoose.model("DeliveryDriver", deliveryDriverSchema);
export default DeliveryDriver;
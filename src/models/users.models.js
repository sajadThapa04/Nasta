import mongoose, {Schema} from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const userSchema = new Schema({
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
    lowercase: true
  },
  facebookId: {
    type: String,
    unique: true,
    sparse: true
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },
  picture: {
    type: String,
    trim: true
  },
  password: {
    type: String,
    required: function () {
      return !(this.googleId || this.facebookId); // Only required for non-social users
    },
    minlength: 6
  },
  phone: {
    type: String,
    required: function () {
      return !(this.googleId || this.facebookId);
    },
    unique: true,
    sparse: true,
    validate: {
      validator: function (v) {
        // Only validate if this is not a social user
        if (this.isSocialUser) 
          return true;
        return !v.startsWith("SOCIAL-");
      },
      message: "Cannot use social placeholder phone numbers"
    }
  },
  isSocialUser: {
    type: Boolean,
    default: false
  },
  dob: {
    type: Date,
    validate: {
      validator: function (dob) {
        // Validate that the user is at least 13 years old
        const minAgeDate = new Date();
        minAgeDate.setFullYear(minAgeDate.getFullYear() - 16);
        return dob <= minAgeDate;
      },
      message: "You must be at least 13 years old to register"
    }
  },
  role: {
    type: String,
    enum: [
      "customer", "restaurant_owner", "admin"
    ],
    default: "customer"
  },
  profileImage: {
    type: String,
    default: "default-profile.png"
  },
  address: {
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
        type: [Number], // [longitude, latitude]
        required: true,
        validate: {
          validator: coords => Array.isArray(coords) && coords.length === 2 && coords.every(c => typeof c === "number"),
          message: "Coordinates must be an array of two numbers [longitude, latitude]."
        }
      }
    }
  },
  status: {
    type: String,
    enum: [
      "active", "inactive", "banned", "pending"
    ],
    default: "active"
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerificationToken: {
    type: String
  },
  phoneVerificationExpires: {
    type: Date
  },
  phoneVerificationAttempts: {
    type: Number,
    default: 0
  },
  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: {
    type: String
  },
  resetPasswordToken: {
    type: String
  },
  resetPasswordExpires: {
    type: Date
  },
  savedListings: [
    {
      type: Schema.Types.ObjectId,
      ref: "Restaurant"
    }
  ],
  restaurantProfile: {
    type: Schema.Types.ObjectId,
    ref: "Restaurant"
  },
  twoFactorAuth: {
    isEnabled: {
      type: Boolean,
      default: false
    },
    secret: String
  },
  restaurantBooking: [
    {
      type: Schema.Types.ObjectId,
      ref: "RestaurantBooking"
    }
  ],
  refreshToken: {
    type: String
  }
}, {timestamps: true});

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) 
    return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// Generate access token
userSchema.methods.generateAccessToken = function () {
  return jwt.sign({
    _id: this._id,
    email: this.email,
    fullName: this.fullName,
    role: this.role
  }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || "1d"
  });
};

// Generate refresh token
userSchema.methods.generateRefreshToken = function () {
  return jwt.sign({
    _id: this._id
  }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d"
  });
};

// Remove sensitive data when converting to JSON
userSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.refreshToken;
    delete ret.verificationToken;
    delete ret.resetPasswordToken;
    delete ret.resetPasswordExpires;
    delete ret.phoneVerificationToken;
    delete ret.phoneVerificationExpires;
    delete ret.twoFactorAuth
      ?.secret;
    return ret;
  }
});

// Add 2dsphere index for geospatial queries
userSchema.index({"address.coordinates": "2dsphere"});

const User = mongoose.model("User", userSchema);

export default User;
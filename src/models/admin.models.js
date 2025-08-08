import mongoose, {Schema} from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const adminSchema = new Schema({
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
  password: {
    type: String,
    required: true,
    minlength: 8
  },
  refreshToken: {
    type: String,
    select: false // Never returned in queries unless explicitly requested
  },
  resetToken: String,
  resetTokenExpires: Date,
  role: {
    type: String,
    enum: [
      "superadmin", "admin", "manager", "staff", "delivery"
    ],
    default: "manager"
  },
  permissions: {
    // Menu & Product Management
    manageMenu: {
      type: Boolean,
      default: false
    },
    manageCategories: {
      type: Boolean,
      default: false
    },
    manageInventory: {
      type: Boolean,
      default: false
    },
    manageLiquorInventory: {
      type: Boolean,
      default: false
    },

    // Orders & Fulfillment
    manageOrders: {
      type: Boolean,
      default: false
    },
    updateOrderStatus: {
      type: Boolean,
      default: false
    },
    manageDeliverySettings: {
      type: Boolean,
      default: false
    },
    managePickupSettings: {
      type: Boolean,
      default: false
    },

    // Pricing & Offers
    managePricing: {
      type: Boolean,
      default: false
    },
    manageDiscounts: {
      type: Boolean,
      default: false
    },
    manageHappyHours: {
      type: Boolean,
      default: false
    },

    // Customer Engagement
    manageReviews: {
      type: Boolean,
      default: false
    },
    manageLoyaltyPrograms: {
      type: Boolean,
      default: false
    },
    sendPromotions: {
      type: Boolean,
      default: false
    },
    manageReservations: {
      type: Boolean,
      default: false
    },

    // Staff & Roles
    manageStaff: {
      type: Boolean,
      default: false
    },
    assignStaffRoles: {
      type: Boolean,
      default: false
    },
    viewStaffActivityLogs: {
      type: Boolean,
      default: false
    },

    // Finance & Reporting
    managePayments: {
      type: Boolean,
      default: false
    },
    viewSalesReports: {
      type: Boolean,
      default: false
    },
    manageTaxSettings: {
      type: Boolean,
      default: false
    },

    // Compliance & Licensing
    manageLicensingDocs: {
      type: Boolean,
      default: false
    },
    manageAgeVerification: {
      type: Boolean,
      default: false
    },

    // Platform & Settings
    manageStoreProfile: {
      type: Boolean,
      default: false
    },
    manageSiteSettings: {
      type: Boolean,
      default: false
    },
    manageSecuritySettings: {
      type: Boolean,
      default: false
    },
    accessActivityLogs: {
      type: Boolean,
      default: false
    }
  },
  lastLogin: Date,
  loginIP: String,
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  strict: true
});

// Password hashing middleware
adminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) 
    return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password
adminSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// Generate access token method
adminSchema.methods.generateAccessToken = function () {
  return jwt.sign({
    _id: this._id,
    role: this.role,
    email: this.email
  }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || "15m"
  });
};

// Generate refresh token method
adminSchema.methods.generateRefreshToken = function () {
  return jwt.sign({
    _id: this._id
  }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d"
  });
};

const Admin = mongoose.model("Admin", adminSchema);

export default Admin;
import mongoose, {Schema} from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const BusinessOwnerSchema = new Schema({
  // Reference to the User model (assuming you have one)
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true
  },

  admin: {
    type: Schema.Types.ObjectId,
    ref: "Admin"
    // required: true
  },
  // Business Information
  businessName: {
    type: String,
    required: [
      true, "Business name is required"
    ],
    trim: true,
    maxlength: [
      100, "Business name cannot exceed 100 characters"
    ],
    unique: true
  },

  businessSlug: {
    type: String,
    trim: true,
    lowercase: true,
    unique: true,
    sparse: true
  },

  businessType: {
    type: String,
    required: true,
    enum: [
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
    ],
    index: true
  },

  description: {
    type: String,
    trim: true,
    maxlength: [5000, "Description cannot exceed 5000 characters"]
  },

  // Contact Information
  contactEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: function (email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      },
      message: "Invalid email address"
    }
  },

  phoneNumbers: [
    {
      type: String,
      trim: true,
      validate: {
        validator: function (phone) {
          return /^\+?[0-9]{10,15}$/.test(phone);
        },
        message: "Invalid phone number"
      }
    }
  ],

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

  // Business Documents
  documents: {
    businessLicense: {
      type: String,
      trim: true
    },
    taxId: {
      type: String,
      trim: true
    },
    healthCertificate: {
      type: String,
      trim: true
    }
  },

  // Images
  logo: {
    type: String,
    trim: true,
    match: [/^(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))$/i, "Logo URL must be a valid image URL"]
  },

  coverPhoto: {
    type: String,
    trim: true,
    match: [/^(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))$/i, "Cover photo URL must be a valid image URL"]
  },

  // Social Media Links
  socialMedia: {
    facebook: {
      type: String,
      trim: true
    },
    instagram: {
      type: String,
      trim: true
    },
    twitter: {
      type: String,
      trim: true
    }
  },

  // Business Hours
  businessHours: [
    {
      day: {
        type: String,
        enum: [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday"
        ],
        required: true
      },
      openingTime: {
        type: String,
        required: true
      },
      closingTime: {
        type: String,
        required: true
      },
      isClosed: {
        type: Boolean,
        default: false
      }
    }
  ],

  // Status and Verification
  status: {
    type: String,
    enum: [
      "active", "inactive", "pending", "suspended", "rejected"
    ],
    default: "pending",
    index: true
  },

  isVerified: {
    type: Boolean,
    default: false
  },

  verificationDate: {
    type: Date
  },

  // Financial Information
  paymentMethods: [
    {
      type: String,
      enum: ["credit_card", "debit_card", "bank_transfer", "mobile_money", "cash"]
    }
  ],

  // Relationships
  services: [
    {
      type: Schema.Types.ObjectId,
      ref: "Service"
    }
  ],

  // Metadata
  isFeatured: {
    type: Boolean,
    default: false
  },

  featuredUntil: {
    type: Date
  },

  notes: {
    type: String,
    trim: true,
    maxlength: [1000, "Notes cannot exceed 1000 characters"]
  }
}, {timestamps: true});

// Indexes
BusinessOwnerSchema.index({"address.coordinates": "2dsphere"});
// BusinessOwnerSchema.index({businessSlug: 1});
// BusinessOwnerSchema.index({status: 1});
// BusinessOwnerSchema.index({businessType: 1});

// Pre-save hook to generate slug
BusinessOwnerSchema.pre("save", function (next) {
  if (this.businessName && !this.businessSlug) {
    this.businessSlug = this.businessName.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w\-]+/g, "");
  }
  next();
});

// Add pagination plugin
BusinessOwnerSchema.plugin(mongoosePaginate);

const BusinessOwner = mongoose.model("BusinessOwner", BusinessOwnerSchema);

export default BusinessOwner;

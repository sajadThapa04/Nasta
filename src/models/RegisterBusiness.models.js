import mongoose, {Schema} from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const registerBusinessSchema = new Schema({
  // Basic Business Info
  businessName: {
    type: String,
    required: true,
    trim: true,
    maxlength: [
      100, "Business name cannot exceed 100 characters"
    ],
    unique: true
  },
  businessType: {
    type: String,
    enum: [
      "restaurant",
      "cafe",
      "bar",
      "hotel",
      "lodge",
      "home_stay",
      "luxury_villa",
      "other"
    ],
    required: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: [2000, "Description cannot exceed 2000 characters"]
  },

  // Contact Info
  contactEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    validate: {
      validator: email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      message: "Invalid email address"
    }
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: phone => /^\+?[\d\s\-()]{10,20}$/.test(phone),
      message: "Invalid phone number format. Use +, digits, spaces, hyphens, or parentheses."
    }
  },

  // Location
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
            return (Array.isArray(coords) && coords.length === 2 && typeof coords[0] === "number" && typeof coords[1] === "number" && coords[0] >= -180 && coords[0] <= 180 && coords[1] >= -90 && coords[1] <= 90);
          },
          message: "Coordinates must be valid [longitude, latitude] values"
        }
      }
    }
  },

  // Uploaded Documents (now flexible array structure)
  documents: [
    {
      type: {
        type: String,
        required: true,
        trim: true,
        enum: ["license", "tax_id", "health_cert", "other"]
      },
      url: {
        type: String,
        required: true,
        trim: true
      }
    }
  ],

  // Registration Status
  status: {
    type: String,
    enum: [
      "submitted", "under_review", "approved", "rejected"
    ],
    default: "submitted",
    index: true
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 1000
  },

  // Admin Verification
  reviewedAt: {
    type: Date
  },
  approvedAt: {
    type: Date
  },
  rejectedAt: {
    type: Date
  }
}, {timestamps: true});

// Create 2dsphere index for geospatial queries
registerBusinessSchema.index({"address.coordinates": "2dsphere"});

// Status change validation middleware
registerBusinessSchema.pre("save", async function (next) {
  if (!this.isModified("status")) 
    return next();
  
  const statusFlow = {
    submitted: ["under_review"],
    under_review: [
      "approved", "rejected"
    ],
    approved: [],
    rejected: []
  };

  if (!this.isNew) {
    const prevDoc = await this.constructor.findById(this._id).lean();
    if (!statusFlow[prevDoc.status].includes(this.status)) {
      return next(new Error(`Invalid status change from ${prevDoc.status} to ${this.status}`));
    }
  }

  // Set timestamps
  const now = new Date();
  if (this.status === "approved") 
    this.approvedAt = now;
  else if (this.status === "rejected") 
    this.rejectedAt = now;
  else if (this.status === "under_review") 
    this.reviewedAt = now;
  
  next();
});

// Global trim middleware for all string fields
registerBusinessSchema.pre("save", function (next) {
  const stringPaths = Object.keys(registerBusinessSchema.paths).filter(path => registerBusinessSchema.paths[path].instance === "String");
  stringPaths.forEach(path => {
    if (this[path]) {
      this[path] = this[path].trim();
    }
  });
  next();
});

// Handle duplicate key errors (for businessName uniqueness)
registerBusinessSchema.post("save", function (error, doc, next) {
  if (error.name === "MongoServerError" && error.code === 11000) {
    next(new Error("Business name already exists"));
  } else {
    next(error);
  }
});
registerBusinessSchema.plugin(mongoosePaginate);

const RegisterBusiness = mongoose.model("RegisterBusiness", registerBusinessSchema);
export default RegisterBusiness;
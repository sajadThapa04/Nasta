import mongoose, {Schema} from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";
const liquorStoreSchema = new Schema({
  // Reference to the Service (parent service/brand)
  service: {
    type: Schema.Types.ObjectId,
    ref: "Service",
    required: true,
    index: true
  },

  // Store-specific name
  name: {
    type: String,
    trim: true,
    maxlength: [
      100, "Store name cannot exceed 100 characters."
    ],
    required: [true, "Store name is required."]
  },

  // Description about the store
  description: {
    type: String,
    trim: true,
    default: ""
  },

  // Detailed address with geolocation
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

  // Store capacity (optional for liquor stores)
  capacity: {
    type: Number,
    min: [
      1, "Capacity must be at least 1."
    ],
    default: null
  },

  // Amenities such as parking, tasting area, etc.
  amenities: {
    type: [
      {
        type: String,
        trim: true,
        lowercase: true,
        enum: [
          "parking",
          "tasting_area",
          "delivery",
          "pickup",
          "wheelchair_access",
          "air_conditioning",
          "wifi",
          "restroom"
        ]
      }
    ],
    default: []
  },

  // Opening hours with support for multiple time slots
  openingHours: [
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
      timeSlots: [
        {
          openingTime: {
            type: String,
            required: true,
            match: [
              /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, "Opening time must be in HH:mm format."
            ],
            validate: {
              validator: function (value) {
                if (!this.closingTime) 
                  return true;
                
                // Handle overnight cases
                if (value > this.closingTime) 
                  return true;
                return value < this.closingTime;
              },
              message: "Opening time must be before closing time (except for overnight hours)."
            }
          },
          closingTime: {
            type: String,
            required: true,
            match: [/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, "Closing time must be in HH:mm format."]
          }
        }
      ]
    }
  ],

  // Inventory/Products available at the store
  products: [
    {
      name: {
        type: String,
        trim: true,
        required: [
          true, "Product name is required."
        ],
        minlength: [2, "Product name must have at least 2 characters."]
      },
      category: {
        type: String,
        trim: true,
        required: true,
        enum: [
          "whiskey",
          "vodka",
          "rum",
          "gin",
          "tequila",
          "wine",
          "beer",
          "liqueur",
          "other"
        ]
      },
      brand: {
        type: String,
        trim: true,
        required: true
      },
      price: {
        type: Number,
        required: [
          true, "Price is required for each product."
        ],
        min: [0, "Price cannot be negative."]
      },
      volume: {
        type: Number,
        required: true,
        min: [0, "Volume cannot be negative."]
      },
      unit: {
        type: String,
        required: true,
        enum: ["ml", "cl", "l", "oz"]
      },
      alcoholContent: {
        type: Number,
        min: [
          0, "Alcohol content cannot be negative."
        ],
        max: [100, "Alcohol content cannot exceed 100%."]
      },
      images: {
        type: [
          {
            type: String,
            trim: true,
            match: [/^(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))$/i, "Image URL must be valid and end with png, jpg, jpeg, gif, or webp."]
          }
        ],
        default: []
      },
      isAvailable: {
        type: Boolean,
        default: true
      }
    }
  ],

  // Store images (exterior, interior, etc.)
  images: {
    type: [
      {
        url: {
          type: String,
          trim: true,
          required: true,
          match: [/^(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))$/i, "Image URL must be valid."]
        },
        caption: {
          type: String,
          trim: true,
          default: "",
          maxlength: [200, "Caption cannot exceed 200 characters."]
        },
        isPrimary: {
          type: Boolean,
          default: false
        }
      }
    ],
    default: [],
    validate: {
      validator: function (array) {
        return array.length <= 20;
      },
      message: "Cannot upload more than 20 images per store."
    }
  },

  // License information
  license: {
    number: {
      type: String,
      trim: true,
      required: true
    },
    expiryDate: {
      type: Date,
      required: true
    },
    image: {
      type: String,
      trim: true,
      match: [/^(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))$/i, "License image URL must be valid."]
    }
  },

  // Availability status
  isAvailable: {
    type: Boolean,
    default: true,
    index: true
  },

  // Additional store status
  status: {
    type: String,
    enum: [
      "active", "maintenance", "closed", "temporarily_closed"
    ],
    default: "active",
    index: true
  }
}, {timestamps: true});

// Create 2dsphere index for geospatial queries
liquorStoreSchema.index({"address.coordinates": "2dsphere"});

// Virtual for service details (populate from Service model)
liquorStoreSchema.virtual("serviceDetails", {
  ref: "Service",
  localField: "service",
  foreignField: "_id",
  justOne: true
});

// Pre-save hook to ensure only one primary image
liquorStoreSchema.pre("save", function (next) {
  if (this.images && this.images.length > 0) {
    const primaryImages = this.images.filter(img => img.isPrimary);
    if (primaryImages.length > 1) {
      // Ensure only one primary image
      this.images.forEach((img, index) => {
        img.isPrimary = index === 0;
      });
    }
  }
  next();
});

liquorStoreSchema.plugin(mongoosePaginate);

const LiquorStore = mongoose.model("LiquorStore", liquorStoreSchema);

export default LiquorStore;
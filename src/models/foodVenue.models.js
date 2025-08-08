import mongoose, {Schema} from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const foodVenueSchema = new Schema({
  // Reference to the Service (like the brand or owner service)
  service: {
    type: Schema.Types.ObjectId,
    ref: "Service",
    required: true,
    index: true
  },

  // Venue-specific name
  name: {
    type: String,
    trim: true,
    maxlength: [
      100, "Venue name cannot exceed 100 characters."
    ],
    required: [true, "Venue name is required."]
  },

  // Description about the venue
  description: {
    type: String,
    trim: true,
    default: ""
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

  // Seating capacity
  seatingCapacity: {
    type: Number,
    required: [
      true, "Seating capacity is required."
    ],
    min: [1, "Seating capacity must be at least 1."]
  },

  // Amenities such as WiFi, AC, Parking, etc.
  amenities: {
    type: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    default: []
  },

  // Opening hours - supports multiple time slots per day
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
            match: [/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, "Opening time must be in HH:mm format."],
            validate: {
              validator: function(value) {
                if (!this.closingTime) return true;
                // Handle overnight cases (e.g., 22:00 to 02:00)
                if (value > this.closingTime) {
                  return true; // Considered valid (overnight)
                }
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

  // Menu items with prices and images
  menuItems: [
    {
      name: {
        type: String,
        trim: true,
        required: [
          true, "Menu item name is required."
        ],
        minlength: [
          2, "Menu item name must have at least 2 characters."
        ]
        // Removed lowercase to preserve original casing
      },
      price: {
        type: Number,
        required: [
          true, "Price is required for each menu item."
        ],
        min: [0, "Price cannot be negative."]
      },
      images: { // Changed from single image to array
        type: [{
          type: String,
          trim: true,
          match: [/^(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))$/i, "Image URL must be valid and end with png, jpg, jpeg, gif, or webp."]
        }],
        default: []
      }
    }
  ],

  // Venue images (exterior, interior, etc.)
  images: {
    type: [{
      type: String,
      trim: true,
      match: [/^(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))$/i, "Image URL must be valid and end with png, jpg, jpeg, gif, or webp."]
    }],
    default: []
  },

  // Availability status (open for bookings/orders)
  isAvailable: {
    type: Boolean,
    default: true,
    index: true
  }
}, {timestamps: true});

// Create 2dsphere index for geospatial queries
foodVenueSchema.index({"address.coordinates": "2dsphere"});

// Virtual for service name (populate from Service model)
foodVenueSchema.virtual("serviceDetails", {
  ref: "Service",
  localField: "service",
  foreignField: "_id",
  justOne: true
});


// Add pagination plugin
foodVenueSchema.plugin(mongoosePaginate);

const FoodVenue = mongoose.model("FoodVenue", foodVenueSchema);

export default FoodVenue;
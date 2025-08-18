// models/Service.js
import mongoose, {Schema} from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const serviceSchema = new Schema({
  owner: {
    type: Schema.Types.ObjectId,
    ref: "BusinessOwner",
    required: true,
    index: true
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    index: true
  },

  name: {
    type: String,
    required: [
      true, "Service name is required."
    ],
    trim: true,
    maxlength: [
      100, "Service name cannot exceed 100 characters."
    ],
    unique: true // Optional: enforce unique brand names across platform, remove if duplicates allowed
  },

  slug: {
    type: String,
    trim: true,
    lowercase: true,
    unique: true,
    sparse: true
  },

  type: {
    type: String,
    required: [
      true, "Service type is required."
    ],
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
    default: ""
  },

  icon: {
    type: String,
    trim: true,
    default: ""
  },

  // Replaced single image field with images array
  images: {
    type: [
      {
        url: {
          type: String,
          trim: true,
          required: true,
          match: [/^(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))$/i, "Image URL must be a valid URL ending with png, jpg, jpeg, gif, or webp."]
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
        },
        uploadedAt: {
          type: Date,
          default: Date.now
        }
      }
    ],
    default: [],
    validate: {
      validator: function (array) {
        // Limit to 20 images max per service
        return array.length <= 20;
      },
      message: "Cannot upload more than 20 images per service."
    }
  },

  isAvailable: {
    type: Boolean,
    default: true,
    index: true
  },

  status: {
    type: String,
    enum: [
      "active", "inactive", "pending", "rejected"
    ],
    default: "pending",
    index: true
  }
}, {timestamps: true});

// Optional: Pre-save middleware to auto-generate slug from name
serviceSchema.pre("save", function (next) {
  if (this.name && !this.slug) {
    this.slug = this.name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w\-]+/g, ""); // simple slugify
  }
  next();
});

// Indexes to improve querying performance
// serviceSchema.index({owner: 1});
// serviceSchema.index({type: 1});
// serviceSchema.index({slug: 1});

serviceSchema.plugin(mongoosePaginate);

const Service = mongoose.model("Service", serviceSchema);
export {
  Service
};
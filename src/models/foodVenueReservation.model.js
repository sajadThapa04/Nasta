import mongoose, {Schema} from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const foodVenueReservationSchema = new Schema({
  customer: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  venue: {
    type: Schema.Types.ObjectId,
    ref: "FoodVenue",
    required: true,
    index: true
  },
  reservationDate: {
    type: Date,
    required: true,
    index: true
  },
  reservationTime: {
    type: String,
    required: true,
    match: [
      /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Time must be in HH:MM format"
    ],
    set: time => {
      // Normalize time format to HH:MM (24-hour)
      const [hours, minutes] = time.split(":");
      return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
    }
  },
  minutesPastMidnight: {
    type: Number,
    min: 0,
    max: 1439, // 23:59 in minutes
    required: true
  },
  numberOfGuests: {
    type: Number,
    required: true,
    min: [
      1, "Must have at least 1 guest"
    ],
    max: [100, "Maximum 100 guests per reservation"]
  },
  occasion: {
    type: String,
    maxlength: [100, "Occasion cannot exceed 100 characters"]
  },
  specialInstructions: {
    type: String,
    maxlength: [500, "Special instructions cannot exceed 500 characters"]
  },
  notes: {
    type: String,
    maxlength: [500, "Notes cannot exceed 500 characters"]
  },
  status: {
    type: String,
    enum: [
      "pending",
      "confirmed",
      "seated",
      "completed",
      "cancelled",
      "no_show"
    ],
    default: "pending",
    index: true
  },
  paymentStatus: {
    type: String,
    enum: [
      "pending", "paid", "failed", "refunded", "partially_refunded"
    ],
    default: "pending",
    index: true
  },
  paymentMethod: {
    type: String,
    enum: ["cash", "card", "online", "wallet", "voucher"]
  },
  paymentDetails: {
    type: Schema.Types.Mixed // For storing payment gateway responses or other details
  },
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  cancelledAt: {
    type: Date
  },
  cancellationReason: {
    type: String,
    maxlength: [200, "Cancellation reason cannot exceed 200 characters"]
  },
  tableAssignment: {
    type: String,
    maxlength: [50, "Table assignment cannot exceed 50 characters"]
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

// Pre-save hook to calculate minutesPastMidnight and normalize data
foodVenueReservationSchema.pre("save", function (next) {
  if (this.isModified("reservationTime")) {
    const [hours, minutes] = this.reservationTime.split(":");
    this.minutesPastMidnight = parseInt(hours) * 60 + parseInt(minutes);
  }

  if (this.status === "cancelled" && !this.cancelledAt) {
    this.cancelledAt = new Date();
  }

  next();
});

// Virtual for formatted reservation time (e.g., "07:30 PM")
foodVenueReservationSchema.virtual("formattedTime").get(function () {
  const [hours, minutes] = this.reservationTime.split(":");
  const hourNum = parseInt(hours);
  const ampm = hourNum >= 12
    ? "PM"
    : "AM";
  const displayHour = hourNum % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
});

// Virtual for combined datetime (useful for sorting/calculations)
foodVenueReservationSchema.virtual("reservationDateTime").get(function () {
  const date = new Date(this.reservationDate);
  const [hours, minutes] = this.reservationTime.split(":");
  date.setHours(hours, minutes);
  return date;
});

// Virtuals for related data
foodVenueReservationSchema.virtual("venueDetails", {
  ref: "FoodVenue",
  localField: "venue",
  foreignField: "_id",
  justOne: true
});

foodVenueReservationSchema.virtual("customerDetails", {
  ref: "User",
  localField: "customer",
  foreignField: "_id",
  justOne: true
});

// Static method for checking booking conflicts
foodVenueReservationSchema.statics.checkAvailability = async function (venueId, date, time, durationMinutes = 120) {
  const [hours, minutes] = time.split(":");
  const queryTime = parseInt(hours) * 60 + parseInt(minutes);
  const endTime = queryTime + durationMinutes;

  return !(await this.exists({
    venue: venueId,
    reservationDate: date,
    minutesPastMidnight: {
      $lt: endTime
    },
    $expr: {
      $gt: [
        {
          $add: ["$minutesPastMidnight", 120]
        },
        queryTime
      ]
    }, // Assuming 2hr reservations
    status: {
      $nin: ["cancelled", "no_show"]
    },
    isDeleted: false
  }));
};

// Soft delete method
foodVenueReservationSchema.methods.cancelReservation = function (reason = "") {
  this.status = "cancelled";
  this.isDeleted = true;
  this.cancelledAt = new Date();
  this.cancellationReason = reason;
  return this.save();
};

// Restore method
foodVenueReservationSchema.methods.restoreReservation = function () {
  this.isDeleted = false;
  this.cancelledAt = undefined;
  this.cancellationReason = undefined;
  this.status = "pending";
  return this.save();
};

// Query helpers
foodVenueReservationSchema.query.active = function () {
  return this.where({isDeleted: false});
};

foodVenueReservationSchema.query.deleted = function () {
  return this.where({isDeleted: true});
};

// Indexes
foodVenueReservationSchema.index({venue: 1, reservationDate: 1, minutesPastMidnight: 1});
foodVenueReservationSchema.index({customer: 1, reservationDate: -1});
foodVenueReservationSchema.index({status: 1, reservationDate: 1});

foodVenueReservationSchema.plugin(mongoosePaginate);

export default mongoose.model("FoodVenueReservation", foodVenueReservationSchema);
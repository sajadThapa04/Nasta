// app.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

// Load environment variables
dotenv.config({path: "./.env", quiet: true});

const app = express();

// CORS setup
app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:8000",
  credentials: true
}));

// Middlewares
app.use(cookieParser());
app.use(express.json({limit: "104kb"}));
app.use(express.urlencoded({extended: true, limit: "104kb"}));
app.use(express.static("public"));

//importing router
import userRouter from "./routes/user.routes.js";
import adminRouter from "./routes/admin.routes.js";
import businessOwnerRoutes from "./routes/businessOwner.routes.js";
import servicesRoutes from "./routes/services.routes.js";
import foodVenueRoutes from "./routes/foodVenue.routes.js";

//initialising router
app.use("/api/v1/users", userRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/business-owner", businessOwnerRoutes);
app.use("/api/v1/services", servicesRoutes);
app.use("/api/v1/foodVenues", foodVenueRoutes);


// ✅ Global error handler
import errorHandler from "./middlewares/error.middleware.js";
app.use(errorHandler);

export default app;

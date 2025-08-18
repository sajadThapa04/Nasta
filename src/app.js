// app.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

// Load environment variables
dotenv.config({path: "./.env", quiet: true});

//web hook importing
import webHookRouter from "./routes/webhook.routes.js";

const app = express();

//webhook router
app.use("/api/v1/webhook", webHookRouter); //webhook router

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
import businessOwnerRouter from "./routes/businessOwner.routes.js";
import adminRouter from "./routes/admin.routes.js";
import adminDeliveryDashboardRouter from "./routes/adminDeliveryDashboard.routes.js";
import adminBusinessOwnerRoutes from "./routes/adminBusinessOwner.routes.js";
import servicesRoutes from "./routes/services.routes.js";
import foodVenueRoutes from "./routes/foodVenue.routes.js";
import deliveryDriverRoutes from "./routes/deliveryDriver.routes.js";
import foodDeliveryRoutes from "./routes/foodDelivery.routes.js";
import FoodDeliveryPaymentRoutes from "./routes/foodDeliveryPayment.routes.js";
import registerBusinessRoutes from "./routes/registerBusiness.routes.js";

//initialising router
app.use("/api/v1/users", userRouter);
app.use("/api/v1/businessOwner", businessOwnerRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/adminDeliveryDashboard", adminDeliveryDashboardRouter);
app.use("/api/v1/business-owner", adminBusinessOwnerRoutes);
app.use("/api/v1/services", servicesRoutes);
app.use("/api/v1/foodVenues", foodVenueRoutes);
app.use("/api/v1/deliveryDriver", deliveryDriverRoutes);
app.use("/api/v1/foodDelivery", foodDeliveryRoutes);
app.use("/api/v1/foodDeliveryPayments", FoodDeliveryPaymentRoutes);
app.use("/api/v1/register-business", registerBusinessRoutes);

// ✅ Global error handler
import errorHandler from "./middlewares/error.middleware.js";
app.use(errorHandler);

export default app;

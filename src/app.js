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
//initialising router
app.use("/api/v1/users", userRouter);
app.use("/api/v1/admin", adminRouter);


// ✅ Global error handler
import errorHandler from "./middlewares/error.middleware.js";
app.use(errorHandler);

export default app;

import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import fs from "fs"; // Import the fs module
import path from "path"; // Import the path module
import env from "../config/env.js";

// Define the logs directory path
const logsDir = path.join(process.cwd(), "logs");

// Create the logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, {recursive: true}); // Create the directory recursively
}

// Create the error.log and combined.log files if they don't exist
const errorLogPath = path.join(logsDir, "error.log");
const combinedLogPath = path.join(logsDir, "combined.log");

if (!fs.existsSync(errorLogPath)) {
  fs.writeFileSync(errorLogPath, ""); // Create an empty error.log file
}

if (!fs.existsSync(combinedLogPath)) {
  fs.writeFileSync(combinedLogPath, ""); // Create an empty combined.log file
}

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Define log colors (for console output)
const logColors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "white"
};

// Add colors to Winston
winston.addColors(logColors);

// Define log format
const logFormat = winston.format.combine(winston.format.timestamp({format: "YYYY-MM-DD HH:mm:ss"}), // Add timestamp
    winston.format.errors({stack: true}), // Log the full error stack trace
    winston.format.splat(), // Enable string interpolation
    winston.format.json()); // Log in JSON format);

// Create a logger instance
const logger = winston.createLogger({
  levels: logLevels, // Use custom log levels
  format: logFormat, // Use the defined log format
  transports: [
    // Log to console (only in development)
    new winston.transports.Console({
      level: "debug", // Log everything in development
      format: winston.format.combine(winston.format.colorize(), // Add colors to console output
          winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`))
    }),

    // Log errors to a file
    new winston.transports.File({
      filename: errorLogPath, // Log errors to this file
      level: "error" // Only log errors
    }),

    // Log all messages to a combined file
    new winston.transports.File({
      filename: combinedLogPath // Log everything to this file
    }),

    // Rotate logs daily
    new DailyRotateFile({
      filename: path.join(logsDir, "application-%DATE%.log"), // Log file name pattern
      datePattern: "YYYY-MM-DD", // Rotate logs daily
      zippedArchive: true, // Compress old logs
      maxSize: "20m", // Rotate logs when file size exceeds 20MB
      maxFiles: "14d", // Keep logs for 14 days
      level: "info" // Log level for rotated files
    })
  ]
});

// If we're not in production, log to the console with the format:
// `${info.timestamp} ${info.level}: ${info.message}`
if (env.NODE_ENV !== "production") {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(winston.format.colorize(), // Add colors to console output
        winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`))
  }));
}

export default logger;
import logger from "../utils/logger.js";

const errorHandler = (err, req, res, next) => {
  logger.error(`Error: ${err.message}`); // Log the error
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
    errors: err.errors || []
  });
};

export default errorHandler;

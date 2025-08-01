import multer from "multer";
import fs from "fs";
import path from "path";
import {v4 as uuidv4} from "uuid";
import sharp from "sharp";

// Ensure the upload directory exists
const tempDir = "./public/temp";

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, {recursive: true});
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = uuidv4(); // Generate a unique ID
    const ext = path.extname(file.originalname); // Get the file extension
    const filename = `${uniqueSuffix}${ext}`; // Use the unique ID and original extension
    cb(null, filename);
  }
});

// File filter to allow only specific file types
const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "image/heic", "image/webp"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only JPEG, PNG, HEIC, and WEBP are allowed!"), false);
  }
};

// Initialize Multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB file size limit
  }
});

// Function to process images using sharp
const processImage = async filePath => {
  try {
    await sharp(filePath).rotate(). // Automatically corrects orientation based on EXIF data
    toFile(filePath + "-processed.jpg"); // Save the processed image
    console.log("Image processed successfully:", filePath);
  } catch (error) {
    console.error("Error processing image:", error);
  }
};

// Export the upload middleware and processImage function
export {
  upload,
  processImage
};

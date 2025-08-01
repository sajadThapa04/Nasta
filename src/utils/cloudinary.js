import {v2 as cloudinary} from "cloudinary";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config({path: "./.env", quiet: true});
cloudinary.config({cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET});

export const uploadOnCloudinary = async LocalFilePath => {
  try {
    if (!LocalFilePath) 
      return `not able to upload on cloudinary`;
    
    const response = await cloudinary.uploader.upload(LocalFilePath, {
      resource_type: "image",
      format: "jpg", // Force JPG output
      quality: "auto", // Automatic quality adjustment
      fetch_format: "auto", // Best format conversion
      transformation: [
        {
          width: 1000,
          height: 1000,
          crop: "fill",
          gravity: "face"
        } // Standardize dimensions
      ]
    });

    fs.unlinkSync(LocalFilePath);
    return response;
  } catch (error) {
    fs.unlinkSync(LocalFilePath);
    console.error("Cloudinary Upload Error:", error);
    throw error; // Re-throw to handle in calling function
  }
};

export const deleteFromCloudinary = async public_id => {
  try {
    const result = await cloudinary.uploader.destroy(public_id);
    console.log(result);
    return result;
  } catch (error) {
    console.error("Cloudinary Deletion Error:", error);
    return null;
  }
};

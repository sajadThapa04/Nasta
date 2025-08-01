import db_name from "../constants.js";
import mongoose from "mongoose";
import dotenv from "dotenv"


dotenv.config({
    path:"./.env"
})
const db_connection = async () => {
  try {
    const connection = await mongoose.connect(`${process.env.DB_CONNECTION}/${db_name}`);
    console.log(`monggose is connected on ${connection.connection.host}`);
  } catch (error) {
    console.log("something went wrong");
  }
};

export default db_connection;

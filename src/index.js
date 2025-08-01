import db_connection from "./db/index.js";
import dotenv from "dotenv";
import app from "./app.js";
// import geocodeCoordinates from "./utils/geoCordinates.js";

// import {createStripePaymentIntent} from "./utils/payment_gateways/stripe.js";

dotenv.config({path: "./.env" , quiet:true});

db_connection().then(() => {
  const port = process.env.PORT || 8000;
  app.on("err", err => {
    console.log(err);
  });

  app.listen(port, () => {
    console.log("server is listening on port:", port);
  });
}).catch(err => {
  console.log("something went wrong: \n", err);
});

import axios from "axios";

const geocodeCoordinates = async coordinates => {
  const [longitude, latitude] = coordinates; // Destructure coordinates array
  const apiKey = process.env.MAPBOX_API_KEY; // Your Mapbox API key

  // Construct the URL (coordinates are automatically converted to strings)
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${apiKey}`;

  try {
    const response = await axios.get(url);
    const {features} = response.data;

    if (features.length > 0) {
      // Extract address components from the first feature
      const address = features[0];
      const context = address.context;

      // Extract country, city, street, and zip code from the context
      const country = context.find(c => c.id.startsWith("country"))
        ?.text;
      const city = context.find(c => c.id.startsWith("place"))
        ?.text;
      const street = address.text; // Street name
      const zipCode = context.find(c => c.id.startsWith("postcode"))
        ?.text;

      return {
        country: country || "Unknown",
        city: city || "Unknown",
        street: street || "Unknown",
        zipCode: zipCode || "Unknown"
      };
    } else {
      throw new Error("No results found for the given coordinates");
    }
  } catch (error) {
    console.error("Geocoding error:", error);
    throw new Error("Failed to geocode coordinates");
  }
};

export default geocodeCoordinates;
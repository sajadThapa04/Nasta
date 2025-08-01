import axios from "axios";

export async function verifyFacebookToken(req, res, next) {
  const {token} = req.body;
  if (!token) {
    return res.status(400).json({message: "Facebook token required"});
  }

  try {
    const response = await axios.get(`https://graph.facebook.com/me`, {
      params: {
        fields: "id,name,email,picture",
        access_token: token
      }
    });

    const data = response.data;

    if (!data || data.error) {
      console.error("Facebook token error:", data.error);
      return res.status(401).json({message: "Invalid Facebook token"});
    }

    req.socialUser = {
      provider: "facebook",
      providerId: data.id,
      email: data.email || null, // Explicit null if not provided
      name: data.name,
      picture: data.picture
        ?.data
          ?.url,
      token: token // Make sure to include the token
    };

    next();
  } catch (error) {
    console.error(
      "Facebook token verification error:", error.response
      ?.data || error.message);
    return res.status(500).json({message: "Failed to verify Facebook token"});
  }
}
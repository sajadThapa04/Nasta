import {OAuth2Client} from "google-auth-library";

export async function verifyGoogleToken(req, res, next) {
  const {token} = req.body;

  if (!token) {
    return res.status(400).json({message: "Google token required"});
  }

  try {
    // First check if it's an ID token (JWT format)
    if (token.split(".").length === 3) {
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({idToken: token, audience: process.env.GOOGLE_CLIENT_ID});
      const payload = ticket.getPayload();

      req.socialUser = {
        provider: "google",
        providerId: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        token: token
        // Handle access token
      };
    } else {
      const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const userInfo = await response.json();

      req.socialUser = {
        provider: "google",
        providerId: userInfo.sub,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        token: token
      };
    }

    next();
  } catch (error) {
    console.error("Google verification error:", error);
    return res.status(401).json({message: "Invalid Google token"});
  }
}
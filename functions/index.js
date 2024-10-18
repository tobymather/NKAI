/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
/* eslint-disable camelcase */
const functions = require("firebase-functions");
const axios = require("axios");
const admin = require("firebase-admin");

// Initialize Firebase Admin
admin.initializeApp();

// Initialize Firebase Storage
const bucket = admin.storage().bucket();

// Securely access your API key
const api_key = "YzYxZWQwZDI2MmEzNDEyYTgxOWQxN2RmMzhkMjhhNzgtMTcyNzk1MzgzOQ==";

// Helper function to create a personalized video
async function createPersonalizedVideoHelper(first_name, email, language) {
  console.log("Creating personalized video for:", {first_name, email, language});

  // Map language to the appropriate Heygen project ID
  const projectIds = {
    english: "d083109364e646a3b44730974cb077e1",
    russian: "945b3d7ed486403c9b1558210ad7964f",
    turkish: "a3f71b47014e440ab863635cc52dd811",
  };

  const project_id = projectIds[language.toLowerCase()];
  if (!project_id) {
    console.error("Unsupported language provided:", language);
    throw new Error("Unsupported language provided.");
  }

  const variables_list = [{first_name, email}];

  try {
    const response = await axios.post(
        "https://api.heygen.com/v1/personalized_video/add_contact",
        {project_id, variables_list},
        {headers: {"x-api-key": api_key, "content-type": "application/json"}},
    );

    const audienceId = response.data.data.id;
    console.log("Generated audience ID:", audienceId);

    return {audienceId, email, language};
  } catch (error) {
    console.error("Error during Heygen API call:", error.response ? error.response.data : error.message);
    throw new Error("Error creating video.");
  }
}

// Cloud Function callable from frontend
exports.createPersonalizedVideo = functions.https.onCall(async (data, context) => {
  const {first_name, email, language} = data.data;

  console.log("Received data from frontend:", {first_name, email, language});

  if (!first_name || !email || !language) {
    console.error("Missing required data:", {first_name, email, language});
    throw new functions.https.HttpsError("invalid-argument", "Missing required data.");
  }

  try {
    const result = await createPersonalizedVideoHelper(first_name, email, language);
    return result;
  } catch (error) {
    console.error("Error creating personalized video:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

// Function to check video status
exports.checkVideoStatus = functions.https.onCall(async (data, context) => {
  const {audienceId, email, language} = data.data;

  console.log("Checking video status for audience ID:", audienceId);

  if (!audienceId || !email || !language) {
    console.error("Missing required data.");
    throw new functions.https.HttpsError("invalid-argument", "Audience ID, email, and language are required.");
  }

  try {
    const videoResponse = await axios.get(
        `https://api.heygen.com/v1/personalized_video/audience/detail?id=${audienceId}`,
        {
          headers: {
            "x-api-key": api_key,
            "accept": "application/json",
          },
        },
    );

    const videoStatus = videoResponse.data.data.status;
    const videoUrl = videoResponse.data.data.video_url;

    console.log("Video status:", videoStatus);

    if (videoStatus === "ready") {
      console.log("Video is ready, URL:", videoUrl);

      // Download the video from Heygen
      const response = await axios.get(videoUrl, {responseType: "stream"});

      // Generate a unique filename
      const fileName = `videos/${audienceId}.mp4`;
      const file = bucket.file(fileName);

      // Upload the video to Firebase Storage
      await new Promise((resolve, reject) => {
        const writeStream = file.createWriteStream({
          metadata: {
            contentType: "video/mp4",
          },
        });

        response.data.pipe(writeStream);

        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });

      // Get the download URL
      const [videoDownloadUrl] = await file.getSignedUrl({
        action: "read",
        expires: "03-17-2025",
      });

      console.log("Video uploaded and available at:", videoDownloadUrl);

      // Determine generic video URL based on language
      const genericVideoUrls = {
        english: "https://yourdomain.com/videos/generic_english.mp4",
        russian: "https://yourdomain.com/videos/generic_russian.mp4",
        turkish: "https://yourdomain.com/videos/generic_turkish.mp4",
      };

      const genericVideoUrl = genericVideoUrls[language.toLowerCase()] || "https://yourdomain.com/videos/generic_default.mp4";

      // Log the event data that would be sent to Bloomreach
      const eventData = {
        email: email,
        video_url: videoDownloadUrl,
        timestamp: new Date().toISOString(),
      };

      console.log("Event data that would be sent to Bloomreach:", eventData);

      return {status: "ready", video_url: videoDownloadUrl, generic_video_url: genericVideoUrl};
    } else {
      return {status: videoStatus};
    }
  } catch (error) {
    console.error("Error while checking video status:", error.response ? error.response.data : error.message);
    throw new functions.https.HttpsError("internal", "Error checking video status.");
  }
});

// HTTP function to receive webhook (keep as onRequest if necessary)
exports.receiveSignupWebhook = functions.https.onRequest(async (req, res) => {
  // Handle CORS if necessary
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const {child_name, language, parent_email} = req.body;

  console.log("Received data from webhook:", {child_name, language, parent_email});

  if (!child_name || !language || !parent_email) {
    return res.status(400).send("Missing required fields.");
  }

  try {
    const result = await createPersonalizedVideoHelper(child_name, parent_email, language);
    const {audienceId} = result;

    if (!audienceId) {
      throw new Error("Failed to create video.");
    }

    // Optionally, you can immediately start checking the video status or send a response back
    res.status(200).send({message: "Video creation initiated.", audienceId});
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).send("Internal Server Error.");
  }
});

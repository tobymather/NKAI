/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
/* eslint-disable camelcase */
const functions = require("firebase-functions");
const axios = require("axios");
const admin = require("firebase-admin");
const cors = require("cors")({origin: true});
require("dotenv").config();

// Initialize Firebase Admin
admin.initializeApp();

// Securely access your API key
const api_key = process.env.HEYGEN_API_KEY;

async function createPersonalizedVideoHelper(first_name, email, language) {
  console.log("Creating personalized video for:", {first_name, email, language});

  const projectIds = {
    ja: "239eca26120d48d6944abaefaa014464",
    he: "cefb14dcf0c04e0cb6749c63d75965aa",
    pl: "9772e74e6dd347ed8ec5a683485a15b0",
    ar: "63151497494746abb74c7dae4db4646b",
  };

  const project_id = projectIds[language.toLowerCase()];
  if (!project_id) {
    throw new Error("Unsupported language provided.");
  }

  const variables_list = [{first_name, email}];
  try {
    // Step 1: Create the audience ID
    const response = await axios.post(
        "https://api.heygen.com/v1/personalized_video/add_contact",
        {project_id, variables_list},
        {headers: {"x-api-key": api_key, "content-type": "application/json"}},
    );

    const audienceId = response.data.data.id;
    console.log("Generated audience ID:", audienceId);

    // Step 2: Make a follow-up request to get video and gif URLs if available
    const detailResponse = await axios.get(
        `https://api.heygen.com/v1/personalized_video/audience/detail?id=${audienceId}`,
        {headers: {"x-api-key": api_key, "accept": "application/json"}},
    );

    const {video_url = "", gif_url = ""} = detailResponse.data.data;
    console.log("Initial video URL:", video_url);
    console.log("Initial gif URL:", gif_url);

    return {audienceId, video_url, gif_url};
  } catch (error) {
    console.error("Error during Heygen API call:", error.response ? error.response.data : error.message);
    throw new Error("Error creating video.");
  }
}

// Function to poll for video status and store Heygen video URL directly
async function pollForVideoStatus(videoToken, audienceId) {
  let polling = true;
  while (polling) {
    try {
      console.log(`Polling video status for audience ID: ${audienceId}`);

      const videoResponse = await axios.get(
          `https://api.heygen.com/v1/personalized_video/audience/detail?id=${audienceId}`,
          {headers: {"x-api-key": api_key, "accept": "application/json"}},
      );

      const videoStatus = videoResponse.data.data.status;
      const heygenVideoUrl = videoResponse.data.data.video_url;
      const gifUrl = videoResponse.data.data.gif_url;

      if (videoStatus === "ready") {
        polling = false;

        const docRef = admin.firestore().collection("videos").doc(videoToken);
        await docRef.update({videoUrl: heygenVideoUrl || "", gifUrl: gifUrl || ""});

        console.log(`Firestore document updated with Heygen video URL and gif URL for token ${videoToken}`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds before next poll
      }
    } catch (error) {
      console.error("Error while polling for video status:", error.message);
      polling = false;
    }
  }
}

// HTTP function for creating personalized video
exports.createPersonalizedVideo = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({error: "Method Not Allowed"});
    }

    const {first_name, email, language} = req.body;
    if (!first_name || !email || !language) {
      return res.status(400).json({error: "Missing required data."});
    }

    try {
      // Create the personalized video and retrieve initial URLs
      const {audienceId, video_url, gif_url} = await createPersonalizedVideoHelper(first_name, email, language);
      const videoToken = admin.firestore().collection("videos").doc().id;

      const videoPageUrl = `https://nkai-ea87e.web.app/video/${videoToken}`;

      // Store initial video and gif URLs in Firestore
      await admin.firestore().collection("videos").doc(videoToken).set({
        audience_id: audienceId,
        email,
        first_name,
        language,
        videoUrl: video_url || "",
        gifUrl: gif_url || "",
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Poll for video status to update URLs once fully processed
      pollForVideoStatus(videoToken, audienceId);

      // Respond to the request with initial video and gif URLs
      return res.status(200).json({
        status: "pending",
        video_page_url: videoPageUrl,
        audienceId,
        video_url,
        gif_url,
        videoToken,
      });
    } catch (error) {
      console.error("Error creating personalized video:", error.message);
      return res.status(500).json({error: "Internal Server Error", details: error.message});
    }
  });
});

// Serve the personalized video along with the generic video
exports.servePersonalizedVideo = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    const videoToken = req.path.split("/").pop();

    if (!videoToken) {
      return res.status(400).send("Invalid video URL.");
    }

    try {
      const docRef = admin.firestore().collection("videos").doc(videoToken);
      const doc = await docRef.get();

      if (!doc.exists) {
        return res.status(404).send("Video not found.");
      }

      const language = doc.data().language || "ar";

      const genericVideos = {
        ar: "https://firebasestorage.googleapis.com/v0/b/nkai-ea87e.appspot.com/o/generic%2FAR%20Adrienne%20Generic.mp4?alt=media&token=318873ca-2a4d-497a-8438-cf6d766df5fe",
        pl: "https://firebasestorage.googleapis.com/v0/b/nkai-ea87e.appspot.com/o/generic%2FPO%20Adrienne%20Generic.mp4?alt=media&token=69b16a7c-77f1-4299-909c-b8de11a8034a",
        ja: "https://firebasestorage.googleapis.com/v0/b/nkai-ea87e.appspot.com/o/generic%2FJA%20Adrienne%20Generic.mp4?alt=media&token=73d40a73-6b0d-46ae-90f9-eaaf177f58e8",
        he: "https://firebasestorage.googleapis.com/v0/b/nkai-ea87e.appspot.com/o/generic%2FHE%20Adrienne%20Generic.mp4?alt=media&token=3610ff90-f3b9-4343-9d0a-33bab951505d",
      };

      const htmlContent = `
      <html>
      <head>
        <style>
          body {
            background-color: #4221B8;
            font-family: 'Arial', sans-serif;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
          }
          .header {
            background-color: white;
            border-radius: 10px;
            padding: 20px;
            display: flex;
            justify-content: space-between;
            width: 100%;
            max-width: 95%;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
            position: absolute;
            top: 20px;
          }
          .header__logo {
            max-width: 90%;
            margin:5px;
          }
          .header__home-icon {
            max-width: 40px;
            cursor: pointer;
          }
          .container {
            text-align: center;
            padding: 20px;
            background-color: #fff;
            border-radius: 10px;
            box-shadow: 0 0 20px rgba(0, 0, 0, 0.1);
            width: 90%;
            max-width:800px;
          }
          h1 {
            font-size: 24px;
            color: #333;
          }
          .video-player {
            margin: 20px 0;
            border-radius: 10px;
            overflow: hidden;
          }
          .loading-spinner {
            border: 6px solid #f3f3f3;
            border-top: 6px solid #3498db;
            border-radius: 50%;
            width: 50px;
            height: 50px;
            animation: spin 2s linear infinite;
            display: inline-block;
          }
          .loading-text {
            font-size: 16px;
            color: #777;
            display: block;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .footer {
            font-size: 12px;
            color: #999;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <img src="https://cdn.novakidschool.com/landing/static/images/logo_dark-blue.svg" alt="Novakid Logo" class="header__logo"/>
          <a href="https://school.novakidschool.com/signin">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" class="bi bi-house header__home-icon" viewBox="0 0 16 16">
              <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L2 8.207V13.5A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V8.207l.646.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293zM13 7.207V13.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V7.207l5-5z"/>
            </svg>
          </a>
        </div>

        <div class="container">
          <div class="video-player">
            <video id="videoPlayer" controls style="width: 100%;" style="display:none;">
              <source id="videoSource" src="" type="video/mp4">
              Your browser does not support the video tag.
            </video>
          </div>

          <div class="loading-spinner" id="loadingSpinner"></div>
          <p class="loading-text" id="loadingText">Your video is being processed. Please check back shortly...</p>

          <div class="footer">
            <p>&copy; 2024 Novakid. All rights reserved.</p>
          </div>
        </div>
      </body>
      
      <script>
        const videoPlayer = document.getElementById('videoPlayer');
        const videoSource = document.getElementById('videoSource');
        const loadingSpinner = document.getElementById('loadingSpinner');
        const loadingText = document.getElementById('loadingText');
        const videoToken = '${videoToken}';
        const language = '${language}';

        const genericVideos = ${JSON.stringify(genericVideos)};

        // Poll Firestore for video URL every 3 seconds
        const interval = setInterval(async () => {
          try {
            const response = await fetch(\`https://firestore.googleapis.com/v1/projects/nkai-ea87e/databases/(default)/documents/videos/\${videoToken}\`);
            const data = await response.json();
            const videoUrl = data.fields.videoUrl?.stringValue;

            if (videoUrl) {
              videoSource.src = videoUrl;
              videoPlayer.style.display = "block";  // Show video player
              videoPlayer.load();  // Load the video player
              loadingSpinner.style.display = "none";  // Hide loading spinner
              loadingText.style.display = "none";  // Hide loading text
              clearInterval(interval);  // Stop polling once the video URL is found
            }
          } catch (error) {
            console.error('Error checking Firestore for video URL:', error);
          }
        }, 3000);

        // Play the generic video when the personalized video ends
        videoPlayer.addEventListener('ended', function() {
          const genericVideoUrl = genericVideos[language.toLowerCase()] || genericVideos['ar'];
          videoSource.src = genericVideoUrl;
          videoPlayer.load();
          videoPlayer.play();
        });
      </script>
      </html>
    `;

      res.status(200).send(htmlContent);
    } catch (error) {
      console.error("Error serving personalized video:", error);
      res.status(500).send("Internal Server Error.");
    }
  });
});

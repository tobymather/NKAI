/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
/* eslint-disable camelcase */
const functions = require("firebase-functions");
const axios = require("axios");
const admin = require("firebase-admin");

// Initialize Firebase Admin
admin.initializeApp();

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

// Function to poll for video status and store Heygen video URL directly
async function pollForVideoStatus(videoToken, audienceId) {
  let polling = true;
  while (polling) {
    try {
      console.log(`Polling video status for audience ID: ${audienceId}`);

      // Poll the Heygen API for the status of the video
      const videoResponse = await axios.get(
          `https://api.heygen.com/v1/personalized_video/audience/detail?id=${audienceId}`,
          {headers: {"x-api-key": api_key, "accept": "application/json"}},
      );

      const videoStatus = videoResponse.data.data.status;
      const heygenVideoUrl = videoResponse.data.data.video_url;

      console.log(`Heygen API returned status: ${videoStatus} for audience ID: ${audienceId}`);

      // If video is ready, save the Heygen video URL to Firestore and stop polling
      if (videoStatus === "ready") {
        console.log(`Heygen video is ready. Using video URL: ${heygenVideoUrl}`);
        polling = false;

        // Update Firestore with the Heygen video URL
        const docRef = admin.firestore().collection("videos").doc(videoToken);
        await docRef.update({videoUrl: heygenVideoUrl});

        console.log(`Firestore document updated with Heygen video URL for token ${videoToken}`);
      } else {
        console.log(`Video is still processing. Status: ${videoStatus}`);
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds before next poll
      }
    } catch (error) {
      console.error("Error while polling for video status:", error.message);
      polling = false; // Stop polling if there's a major issue
    }
  }
}

// HTTP function for creating personalized video
exports.createPersonalizedVideo = functions.https.onRequest((req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const {first_name, email, language} = req.body;

  if (!first_name || !email || !language) {
    return res.status(400).json({error: "Missing required data."});
  }

  try {
    createPersonalizedVideoHelper(first_name, email, language).then(({audienceId}) => {
      const videoToken = admin.firestore().collection("videos").doc().id;

      admin.firestore().collection("videos").doc(videoToken).set({
        audience_id: audienceId,
        email: email,
        first_name: first_name,
        language: language,
        videoUrl: null,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Start polling for video status (server-side polling)
      pollForVideoStatus(videoToken, audienceId);

      // Generate the personalized video page URL and return it immediately to the client
      const videoPageUrl = `https://nkai-ea87e.web.app/video/${videoToken}`;

      return res.status(200).json({
        status: "pending",
        video_page_url: videoPageUrl,
        audienceId: audienceId,
      });
    }).catch((error) => {
      console.error("Error creating personalized video:", error);
      return res.status(500).json({error: "Error creating personalized video."});
    });
  } catch (error) {
    console.error("Error creating personalized video:", error);
    return res.status(500).json({error: "Error creating personalized video."});
  }
});

exports.servePersonalizedVideo = functions.https.onRequest(async (req, res) => {
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

    const language = doc.data().language || "english";

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
        <!-- Header -->
        <div class="header">
          <img src="https://cdn.novakidschool.com/landing/static/images/logo_dark-blue.svg" alt="Novakid Logo" class="header__logo"/>
          <a href="https://school.novakidschool.com/signin">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" class="bi bi-house header__home-icon" viewBox="0 0 16 16">
              <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L2 8.207V13.5A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V8.207l.646.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293zM13 7.207V13.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V7.207l5-5z"/>
            </svg>
          </a>
        </div>

        <!-- Content -->
        <div class="container">          

          <!-- Video Player -->
          <div class="video-player">
            <video id="videoPlayer" controls style="width: 100%;" style="display:none;">
              <source id="videoSource" src="" type="video/mp4">
              Your browser does not support the video tag.
            </video>
          </div>

          <!-- Loading spinner and text while video is processing -->
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
        
        const genericVideos = {
          english: 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          russian: 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          turkish: 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
        };

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
          const genericVideoUrl = genericVideos[language.toLowerCase()] || genericVideos['english'];
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

  const {child_name, language, email} = req.body;

  console.log("Received data from webhook:", {child_name, language, email});

  if (!child_name || !language || !email) {
    return res.status(400).send("Missing required fields.");
  }

  try {
    const result = await createPersonalizedVideoHelper(child_name, email, language);
    const {audienceId} = result;

    if (!audienceId) {
      throw new Error("Failed to create video.");
    }

    // Optionally send a response back to the third-party system with the video URL or status
    res.status(200).send({message: "Video creation initiated.", audienceId});
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).send("Internal Server Error.");
  }
});

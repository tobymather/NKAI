/* eslint-disable require-jsdoc */
/* eslint-disable camelcase */
/* eslint-disable max-len */
const functions = require("firebase-functions");
const axios = require("axios");
const api_key = "YzYxZWQwZDI2MmEzNDEyYTgxOWQxN2RmMzhkMjhhNzgtMTcyNzk1MzgzOQ==";

exports.createPersonalizedVideo = functions.https.onCall(async (data, context) => {
  const {first_name, email, datetime, language} = data.data;

  console.log("Received data from frontend:", {first_name, email, datetime, language});

  // Check if required data is present
  if (!first_name || !email || !datetime || !language) {
    console.error("Missing required data:", {first_name, email, datetime, language});
    throw new functions.https.HttpsError("invalid-argument", "Missing required data.");
  }

  // Map language to the appropriate Heygen project ID
  const projectIds = {
    english: "d083109364e646a3b44730974cb077e1",
    russian: "dd55196fb7b14f7596343ef6d2307281",
    turkish: "a3f71b47014e440ab863635cc52dd811",
  };

  const project_id = projectIds[language.toLowerCase()];
  if (!project_id) {
    console.error("Unsupported language provided:", language);
    throw new functions.https.HttpsError("invalid-argument", "Unsupported language provided.");
  }

  // Convert the datetime into a human-readable format
  const formattedDatetime = formatHumanReadableDatetime(datetime);
  console.log("Formatted datetime:", formattedDatetime);

  const variables_list = [
    {"first_name": first_name, "email": email, "datetime": formattedDatetime},
  ];

  try {
    console.log("Sending request to Heygen API:", {project_id, variables_list});

    const response = await axios.post(
        "https://api.heygen.com/v1/personalized_video/add_contact",
        {
          project_id: project_id,
          variables_list: variables_list,
        },
        {
          headers: {
            "x-api-key": api_key,
            "content-type": "application/json",
            "accept": "application/json",
          },
        },
    );

    console.log("Heygen API response:", response.data);

    const audienceId = response.data.data.id;
    console.log("Generated audience ID:", audienceId);

    return {audienceId}; // Return the audience ID to the frontend for status checking
  } catch (error) {
    console.error("Error during Heygen API call:", error.response ? error.response.data : error.message);
    throw new functions.https.HttpsError("failed-precondition", "Error creating video.");
  }
});

exports.checkVideoStatus = functions.https.onCall(async (data, context) => {
  const {audienceId} = data.data;

  console.log("Checking video status for audience ID:", audienceId);

  if (!audienceId) {
    console.error("No audience ID provided.");
    throw new functions.https.HttpsError("invalid-argument", "Audience ID is required.");
  }

  try {
    const videoResponse = await axios.get(
        `https://api.heygen.com/v1/personalized_video/audience/detail?id=${audienceId}`,
        {headers: {"x-api-key": api_key, "accept": "application/json"}},
    );

    const videoStatus = videoResponse.data.data.status;
    const videoUrl = videoResponse.data.data.video_url;

    console.log("Video status:", videoStatus);

    if (videoStatus === "ready") {
      console.log("Video is ready, URL:", videoUrl);
      return {status: "ready", video_url: videoUrl};
    } else {
      return {status: videoStatus};
    }
  } catch (error) {
    console.error("Error while checking video status:", error.response ? error.response.data : error.message);
    throw new functions.https.HttpsError("failed-precondition", "Error checking video status.");
  }
});

function formatHumanReadableDatetime(datetime) {
  const date = new Date(datetime);
  const options = {weekday: "long", hour: "numeric", minute: "numeric", hour12: true};
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

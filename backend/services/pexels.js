const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Cloudflare Workers AI — Image Generation (flux-1-schnell or dreamshaper)
// Docs: https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN  = process.env.CF_API_TOKEN;
const CF_MODEL      = process.env.CF_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";

async function fetchBackgroundImage(query, jobId, sceneId) {
  try {
    // Build a prompt suitable for portrait background
    const prompt = `cinematic portrait background, ${query}, vertical 9:16 aspect ratio, high quality, no text, no people`;

    const response = await axios.post(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`,
      { prompt, num_steps: 4 },
      {
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        responseType: "arraybuffer"
      }
    );

    // Save image locally and return file path
    const imgDir = path.join(__dirname, `../temp/${jobId}/images`);
    fs.mkdirSync(imgDir, { recursive: true });
    const imgPath = path.join(imgDir, `scene_${sceneId}.png`);
    fs.writeFileSync(imgPath, Buffer.from(response.data));
    return imgPath;
  } catch (e) {
    console.error("Cloudflare image error:", e.message);
    return null;
  }
}

async function fetchAllImages(scenes, jobId) {
  const imagePaths = [];
  for (const scene of scenes) {
    const imgPath = await fetchBackgroundImage(scene.searchQuery, jobId, scene.id);
    imagePaths.push(imgPath);
    await new Promise(r => setTimeout(r, 500));
  }
  return imagePaths;
}

module.exports = { fetchAllImages };

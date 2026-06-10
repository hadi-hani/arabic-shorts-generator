const axios = require("axios");

async function fetchBackgroundImage(query) {
  try {
    const response = await axios.get("https://api.pexels.com/v1/search", {
      params: { query, per_page: 5, orientation: "portrait" },
      headers: { Authorization: process.env.PEXELS_API_KEY }
    });
    const photos = response.data.photos;
    if (!photos || photos.length === 0) return null;
    const photo = photos[Math.floor(Math.random() * photos.length)];
    return photo.src.portrait || photo.src.large;
  } catch (e) {
    console.error("Pexels image error:", e.message);
    return null;
  }
}

async function fetchAllImages(scenes) {
  const imageUrls = [];
  for (const scene of scenes) {
    const url = await fetchBackgroundImage(scene.searchQuery);
    imageUrls.push(url);
    await new Promise(r => setTimeout(r, 300));
  }
  return imageUrls;
}

module.exports = { fetchAllImages };

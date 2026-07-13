const axios = require("axios");

// Fallback keywords for Arabic topics when primary query fails
const FALLBACK_QUERIES = ["nature", "abstract", "city", "technology", "background"];

async function fetchBackgroundImage(query, attempt = 0) {
  const searchQuery = attempt === 0 ? query : FALLBACK_QUERIES[(attempt - 1) % FALLBACK_QUERIES.length];
  try {
    const response = await axios.get("https://api.pexels.com/v1/search", {
      params: { query: searchQuery, per_page: 8, orientation: "portrait" },
      headers: { Authorization: process.env.PEXELS_API_KEY },
      timeout: 8000
    });
    const photos = response.data.photos;
    if (!photos || photos.length === 0) {
      if (attempt < FALLBACK_QUERIES.length) {
        console.warn(`⚠️ Pexels: no results for "${searchQuery}", trying fallback ${attempt + 1}`);
        return fetchBackgroundImage(query, attempt + 1);
      }
      return null;
    }
    const photo = photos[Math.floor(Math.random() * photos.length)];
    return photo.src.portrait || photo.src.large;
  } catch (e) {
    if (attempt < FALLBACK_QUERIES.length) {
      console.warn(`⚠️ Pexels error for "${searchQuery}": ${e.message}, retrying...`);
      return fetchBackgroundImage(query, attempt + 1);
    }
    console.error(`❌ Pexels failed after ${attempt + 1} attempts: ${e.message}`);
    return null;
  }
}

// #5 FIX: Parallel image fetching + retry with fallback keywords
async function fetchAllImages(scenes) {
  const results = await Promise.all(
    scenes.map(scene => fetchBackgroundImage(scene.searchQuery))
  );
  return results;
}

module.exports = { fetchAllImages };

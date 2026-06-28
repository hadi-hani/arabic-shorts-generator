const axios = require("axios");

async function generateScript(topic) {
  const prompt = `You are an expert short video content creator.
Create a script for a 30-60 second short video about: "${topic}"

Return ONLY valid JSON, no markdown, no extra text:
{
  "title": "Video title",
  "scenes": [
    {
      "id": 1,
      "narration": "Arabic narration text for this scene",
      "caption": "Short Arabic caption (max 6 words)",
      "searchQuery": "english keyword for background video",
      "duration": 10
    }
  ],
  "hashtags": ["#tag1", "#tag2"]
}
Create 4-5 scenes. Keep narration in Arabic.`;

  const response = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
    {
      contents: [{ parts: [{ text: prompt }] }]
    },
    {
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "Content-Type": "application/json"
      }
    }
  );

  let text = response.data.candidates[0].content.parts[0].text.trim();
  text = text.replace(/```json/g, "").replace(/```/g, "").trim();
  return JSON.parse(text);
}

module.exports = { generateScript };

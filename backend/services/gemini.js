const axios = require("axios");

const PLATFORM_CONFIGS = {
  tt: {
    name: "TikTok",
    maxChars: 2200,
    hashtagCount: 5,
    tone: "trendy, energetic, youth-oriented",
    emojiStyle: "heavy emojis",
    ctaExample: "متابعة للمزيد 🔥"
  },
  yt: {
    name: "YouTube Shorts",
    maxChars: 5000,
    hashtagCount: 8,
    tone: "informative, engaging, value-focused",
    emojiStyle: "moderate emojis",
    ctaExample: "اشترك في القناة 🔔"
  },
  fb: {
    name: "Facebook",
    maxChars: 63206,
    hashtagCount: 3,
    tone: "conversational, community-friendly",
    emojiStyle: "light emojis",
    ctaExample: "شاركها مع أصدقائك ❤️"
  },
  ig: {
    name: "Instagram",
    maxChars: 2200,
    hashtagCount: 10,
    tone: "aesthetic, inspirational, visual-focused",
    emojiStyle: "heavy emojis",
    ctaExample: "احفظ المنشور 💾"
  }
};

async function generateScript(topic, platforms = []) {
  const platformsBlock = platforms.length > 0
    ? `
Also generate platform-specific captions for the following platforms: ${platforms.map(p => PLATFORM_CONFIGS[p].name).join(", ")}.
For each platform return a JSON key matching the platform code with this structure:
${platforms.map(p => {
  const cfg = PLATFORM_CONFIGS[p];
  return `"${p}": { "caption": "Full ${cfg.name} caption in Arabic, max ${cfg.maxChars} chars, ${cfg.tone}, ${cfg.emojiStyle}, include ${cfg.hashtagCount} relevant Arabic/English hashtags, end with CTA like '${cfg.ctaExample}'" }`;
}).join(",\n")}
`
    : "";

  const platformsJsonExample = platforms.length > 0
    ? `,
  "platforms": {
    ${platforms.map(p => `"${p}": { "caption": "..." }`).join(",\n    ")}
  }`
    : "";

  const prompt = `You are an expert Arabic short video content creator and social media expert.
Create a script for a 30-60 second short video about: "${topic}"
${platformsBlock}
Return ONLY valid JSON, no markdown, no extra text:
{
  "title": "Video title in Arabic",
  "scenes": [
    {
      "id": 1,
      "narration": "Arabic narration text for this scene",
      "caption": "Short Arabic caption (max 6 words)",
      "searchQuery": "english keyword for background image",
      "duration": 10
    }
  ],
  "hashtags": ["#tag1", "#tag2"]${platformsJsonExample}
}
Create 4-5 scenes. Keep narration in Arabic.`;

  const response = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent",
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

module.exports = { generateScript, PLATFORM_CONFIGS };

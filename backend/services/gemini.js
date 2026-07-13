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

// Model fallback chain: try each model in order
// gemini-2.5-flash is paid but has free quota; gemini-2.0-flash-lite is free tier
const MODEL_CHAIN = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite"
];

let currentModelIndex = 0;

// Gemini API call with model fallback + retry on 429
async function callGemini(prompt, retries = 3) {
  // Try from current model index onward
  for (let mi = currentModelIndex; mi < MODEL_CHAIN.length; mi++) {
    const model = MODEL_CHAIN[mi];
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          { contents: [{ parts: [{ text: prompt }] }] },
          {
            headers: {
              "x-goog-api-key": process.env.GEMINI_API_KEY,
              "Content-Type": "application/json"
            },
            timeout: 90000
          }
        );
        // Success — remember this model works
        if (mi !== currentModelIndex) {
          console.log(`✅ Switched to model: ${model}`);
          currentModelIndex = mi;
        }
        let text = response.data.candidates[0].content.parts[0].text.trim();
        text = text.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(text);
      } catch (err) {
        const status = err.response && err.response.status;
        const errMsg = (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || err.message;

        if (status === 429) {
          if (attempt < retries) {
            // Rate limit — wait and retry same model
            const delay = attempt * 20000;
            console.warn(`⚠️ ${model} 429 – retry ${attempt}/${retries} after ${delay/1000}s`);
            await new Promise(r => setTimeout(r, delay));
          } else {
            // Exhausted retries on this model — try next model
            console.warn(`⚠️ ${model} quota exhausted, trying next model...`);
            break; // break attempt loop, continue to next model
          }
        } else if (status === 404) {
          // Model not available — skip to next
          console.warn(`⚠️ ${model} not available (404), skipping...`);
          break;
        } else {
          throw new Error(errMsg);
        }
      }
    }
  }
  throw new Error("جميع نماذج Gemini وصلت حد الاستخدام أو غير متاحة. حاول لاحقاً أو استخدم API key آخر.");
}

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

  return callGemini(prompt);
}

// Generate ONLY social media captions — returns unified description per platform
async function generateCaptions(topic, platforms) {
  const allPlatforms = (platforms && platforms.length > 0) ? platforms : ["tt", "yt", "fb", "ig"];

  const platformDetails = allPlatforms.map(function(p) {
    const cfg = PLATFORM_CONFIGS[p];
    return `- ${p} (${cfg.name}): ${cfg.tone}، ${cfg.emojiStyle}، ${cfg.hashtagCount} هاشتاغ، CTA مثل: "${cfg.ctaExample}"`;
  }).join("\n");

  const jsonShape = allPlatforms.map(function(p) {
    return `    "${p}": { "description": "النص الكامل لـ ${PLATFORM_CONFIGS[p].name}" }`;
  }).join(",\n");

  const prompt = `أنت خبير في كتابة محتوى السوشيال ميديا بالعربية.
الموضوع: "${topic}"
المنصات المطلوبة: ${allPlatforms.join(", ")}

تفاصيل كل منصة:
${platformDetails}

لكل منصة، أنتج نصاً واحداً جاهزاً للنسخ واللصق مباشرة في حقل الوصف عند النشر.
النص يجب أن يحتوي على: العنوان + الوصف + الهاشتاغات — كلها معًا في نص واحد متكامل.

أرجع JSON بهذا الشكل فقط (بدون markdown أو نص إضافي):
{
  "results": {
${jsonShape}
  }
}
أعد فقط المنصات المطلوبة: ${allPlatforms.join(", ")}`;

  return callGemini(prompt);
}

module.exports = { generateScript, generateCaptions, PLATFORM_CONFIGS };
const fs = require("fs");
const path = require("path");

let EdgeTTS;
try {
  ({ EdgeTTS } = require("node-edge-tts"));
} catch (_) {
  EdgeTTS = null;
}

// Edge TTS voice map — mirrors the old Google male/female choices plus
// sensible Arabic defaults. Accepts a full voice name directly too.
const EDGE_VOICES = {
  male:   "ar-SA-HamedNeural",
  female: "ar-SA-ZariyahNeural",
  default: "ar-SA-ZariyahNeural"
};

function resolveVoice(voice) {
  if (!voice) return EDGE_VOICES.default;
  if (EDGE_VOICES[voice]) return EDGE_VOICES[voice];
  if (voice.toLowerCase().startsWith("ar")) {
    // Accept short forms like "ar-SA-Zariyah" → "ar-SA-ZariyahNeural"
    if (!/\w$/.test(voice)) return EDGE_VOICES.default;
    return /Neural$/.test(voice) ? voice : `${voice}Neural`;
  }
  return EDGE_VOICES.default;
}

/**
 * Generate speech with Edge TTS plus precise word-level timings.
 *
 * Returns:
 *   { audioPath, wordTimings: [{word, start, end}, ...] }
 * with times in seconds (ms from node-edge-tts, converted to match the
 * schema used by vertical-shorts-generator's tts_word_timings.py).
 */
async function generateWithTimings(text, outputPath, { voice = "default", rate = "+0%" } = {}) {
  if (!EdgeTTS) {
    throw new Error("node-edge-tts is not installed");
  }

  const resolved = resolveVoice(voice);
  const tts = new EdgeTTS({
    voice: resolved,
    lang: resolved.split("-").slice(0, 2).join("-"),
    saveSubtitles: true,
    rate
  });

  await tts.ttsPromise(text, outputPath);

  const timingsPath = `${outputPath}.json`;
  const wordTimings = [];
  if (fs.existsSync(timingsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(timingsPath, "utf8"));
      for (const item of raw) {
        const word = (item.part || "").trim();
        const start = (item.start || 0) / 1000;
        const end = (item.end || item.start || 0) / 1000;
        if (word) {
          wordTimings.push({
            word,
            start: Math.round(start * 1000) / 1000,
            end: Math.round(Math.max(end, start) * 1000) / 1000
          });
        }
      }
      fs.unlinkSync(timingsPath);
    } catch (e) {
      console.warn(`⚠️ Could not parse edge-tts timings ${timingsPath}: ${e.message}`);
    }
  }

  return { audioPath: outputPath, wordTimings, source: "edge" };
}

module.exports = { generateWithTimings, resolveVoice, EDGE_VOICES };
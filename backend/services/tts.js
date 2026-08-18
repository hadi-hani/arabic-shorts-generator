const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { generateWithTimings } = require("./edge_tts");

// Available Arabic voices (Google TTS)
const VOICES = {
  male:   { name: "ar-XA-Wavenet-B", ssmlGender: "MALE" },
  female: { name: "ar-XA-Wavenet-A", ssmlGender: "FEMALE" }
};

// ── Google TTS (legacy, kept for compatibility) ──────────────────────────
async function textToSpeech(text, outputPath, { voice = "male", speakingRate = 0.95 } = {}) {
  const voiceCfg = VOICES[voice] || VOICES.male;
  const response = await axios.post(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_KEY}`,
    {
      input: { text },
      voice: {
        languageCode: "ar-XA",
        name: voiceCfg.name,
        ssmlGender: voiceCfg.ssmlGender
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: Math.min(1.5, Math.max(0.5, speakingRate)),
        pitch: 0.0
      }
    },
    { headers: { "Content-Type": "application/json" } }
  );

  const audioBuffer = Buffer.from(response.data.audioContent, "base64");
  fs.writeFileSync(outputPath, audioBuffer);
  return outputPath;
}

// ── Unified TTS entry ──────────────────────────────────────────────────────
// options: { ttsType: "edge" | "google", voice, rate, speakingRate, enableTimings }
// Returns: { audioPath, wordTimings: [{word,start,end}] | null, source }
async function generateTTS(text, outputPath, options = {}) {
  const ttsType = options.ttsType || "edge";
  if (ttsType === "edge") {
    const result = await generateWithTimings(text, outputPath, {
      voice: options.voice || "default",
      rate: options.rate || "+0%"
    });
    return result;
  }
  // google (legacy path)
  await textToSpeech(text, outputPath, {
    voice: options.voice || "male",
    speakingRate: options.speakingRate || 0.95
  });
  return { audioPath: outputPath, wordTimings: null, source: "google" };
}

// ── Legacy: parallel audio generation (Google TTS) — deprecated, not removed
async function generateAllAudio(scenes, jobId, { voice = "male", speakingRate = 0.95 } = {}) {
  const audioDir = path.join(__dirname, `../temp/${jobId}/audio`);
  fs.mkdirSync(audioDir, { recursive: true });

  const results = await Promise.all(
    scenes.map(async (scene) => {
      try {
        const filePath = path.join(audioDir, `scene_${scene.id}.mp3`);
        await textToSpeech(scene.narration, filePath, { voice, speakingRate });
        return filePath;
      } catch (e) {
        console.warn(`⚠️ Audio skipped scene ${scene.id}: ${e.message}`);
        return null;
      }
    })
  );

  return results;
}

// ── New: generate audio (edge | google) per scene + optional word timings ─
// Returns: { audioPaths: [path|null], timingsList: [[{word,start,end}]|null] }
async function generateSceneAudio(scenes, jobId, options = {}) {
  const audioDir = path.join(__dirname, `../temp/${jobId}/audio`);
  fs.mkdirSync(audioDir, { recursive: true });

  const ttsType = options.ttsType || "edge";
  const results = await Promise.all(
    scenes.map(async (scene) => {
      try {
        const filePath = path.join(audioDir, `scene_${scene.id}.mp3`);
        const out = await generateTTS(scene.narration, filePath, { ...options, ttsType });
        return { audioPath: filePath, wordTimings: out.wordTimings || null };
      } catch (e) {
        console.warn(`⚠️ Audio skipped scene ${scene.id} (${ttsType}): ${e.message}`);
        return { audioPath: null, wordTimings: null };
      }
    })
  );

  return {
    audioPaths: results.map((r) => r.audioPath),
    timingsList: results.map((r) => r.wordTimings)
  };
}

module.exports = { textToSpeech, generateAllAudio, generateTTS, generateSceneAudio, VOICES };
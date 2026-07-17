const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Available Arabic voices
const VOICES = {
  male:   { name: "ar-XA-Wavenet-B", ssmlGender: "MALE" },
  female: { name: "ar-XA-Wavenet-A", ssmlGender: "FEMALE" }
};

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

// #1 FIX: Parallel audio generation (was sequential for..of)
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

module.exports = { generateAllAudio, VOICES };

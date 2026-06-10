const axios = require("axios");
const fs = require("fs");
const path = require("path");

async function textToSpeech(text, outputPath) {
  const response = await axios.post(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_KEY}`,
    {
      input: { text },
      voice: {
        languageCode: "ar-XA",
        name: "ar-XA-Wavenet-B",
        ssmlGender: "MALE"
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 0.95,
        pitch: 0.0
      }
    },
    { headers: { "Content-Type": "application/json" } }
  );

  const audioBuffer = Buffer.from(response.data.audioContent, "base64");
  fs.writeFileSync(outputPath, audioBuffer);
  return outputPath;
}

async function generateAllAudio(scenes, jobId) {
  const audioDir = path.join(__dirname, `../temp/${jobId}/audio`);
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPaths = [];
  for (const scene of scenes) {
    try {
      const filePath = path.join(audioDir, `scene_${scene.id}.mp3`);
      await textToSpeech(scene.narration, filePath);
      audioPaths.push(filePath);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.warn(`Audio skipped scene ${scene.id}: ${e.message}`);
      audioPaths.push(null);
    }
  }
  return audioPaths;
}

module.exports = { generateAllAudio };

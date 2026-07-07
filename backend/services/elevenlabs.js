const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const fs = require("fs");
const path = require("path");

// Microsoft Edge TTS — free, high-quality Arabic voices
// Voice options: ar-SA-HamedNeural (male), ar-SA-ZariyahNeural (female)
const ARABIC_VOICE = process.env.EDGE_TTS_VOICE || "ar-SA-HamedNeural";

async function textToSpeech(text, outputPath) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(ARABIC_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  return new Promise((resolve, reject) => {
    const readable = tts.toStream(text);
    const writable = fs.createWriteStream(outputPath);

    readable.on("error", reject);
    writable.on("error", reject);
    writable.on("finish", () => resolve(outputPath));

    readable.pipe(writable);
  });
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
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.warn(`Audio skipped scene ${scene.id}: ${e.message}`);
      audioPaths.push(null);
    }
  }
  return audioPaths;
}

module.exports = { generateAllAudio };

// Standalone pipeline runner — drives the real video pipeline (gemini → pexels
// → TTS → render) WITHOUT starting the HTTP server, so it can be tested in a
// foreground process. Usage: node scripts/test_engine.js <ttsType> <outName>
const path = require("path");
const fs = require("fs");

const { runPipeline } = require("../server.js");
const { getAudioDuration } = require("../services/tts.js");

async function main() {
  const ttsType = process.argv[2] || "piper";
  const outName = process.argv[3] || ttsType;
  const jobId = require("uuid").v4();
  const topic = process.argv[4] || "نصائح للقراءة السريعة وتطوير الذات";

  console.log(`\n🚀 [${ttsType}] generating: "${topic}"`);
  const result = await runPipeline(
    topic,
    jobId,
    ["yt", "tt"],
    { ttsType, subtitleMode: "word", enableSubtitles: true, enableTashkeel: true }
  );

  const finalName = path.join(__dirname, `${outName}.mp4`);
  fs.copyFileSync(result.videoPath, finalName);
  const dur = await getAudioDuration(finalName);
  console.log(`✅ [${ttsType}] DONE -> ${finalName}`);
  console.log(`   engine used : ${result.metadata.ttsType}`);
  console.log(`   duration    : ${dur.toFixed(1)}s`);
  console.log(`   wordCount   : ${result.metadata.wordCount}`);
  console.log(`   scenes      : ${result.scenes.length}`);
  console.log(`   error       : ${result.error || "none"}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("❌ FAILED:", e.message);
  process.exit(1);
});

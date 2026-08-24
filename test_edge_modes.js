// test_edge_modes.js — Test Edge TTS with all 3 subtitle modes
// Generates 3 test videos (word / sentence / progressive) using the real
// pipeline: Gemini script → Pexels images → Edge TTS → FFmpeg render.
//
// Usage:
//   node test_edge_modes.js            # run all 3 modes
//   node test_edge_modes.js word       # run a single mode
//
// Requires GEMINI_API_KEY + PEXELS_API_KEY in the environment or .env.
const path = require("path");
const fs = require("fs");

// Dependencies live in backend/node_modules — resolve them explicitly
// (must run before requiring any third-party module)
module.paths.unshift(path.join(__dirname, "backend", "node_modules"));

require("dotenv").config();
const { v4: uuidv4 } = require("uuid");

// Load the real pipeline from backend/server.js (does NOT start the HTTP server)
const { runPipeline } = require("./backend/server.js");
const { getAudioDuration } = require("./backend/services/tts.js");

const OUTPUT_ROOT = path.join(__dirname, "backend", "scripts");

// The renderer passes RELATIVE paths to ffmpeg (temp/..., fontsdir=fonts),
// so the process must run from backend/ — same requirement as the server.
process.chdir(path.join(__dirname, "backend"));

async function runMode(mode) {
  const topic = "الذكاء الاصطناعي وكيف يغير عالمنا";
  const jobId = uuidv4();
  console.log(`📝 [${mode}] generating: "${topic}"`);

  const result = await runPipeline(
    topic,
    jobId,
    ["yt", "tt"],
    {
      ttsType: "edge",
      subtitleMode: mode,
      enableSubtitles: true,
      enableTashkeel: true
    }
  );

  const outName = path.join(OUTPUT_ROOT, `test-edge-${mode}.mp4`);
  fs.copyFileSync(result.videoPath, outName);
  const dur = await getVideoDuration(outName);
  console.log(`✅ [${mode}] DONE -> ${outName}`);
  console.log(`   engine used : ${result.metadata.ttsType}`);
  console.log(`   duration    : ${dur.toFixed(1)}s`);
  console.log(`   wordCount   : ${result.metadata.wordCount}`);
  console.log(`   scenes      : ${result.scenes.length}`);
}

function getVideoDuration(videoPath) {
  return new Promise((resolve) => {
    const { spawn } = require("child_process");
    const proc = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", videoPath
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", d => (out += d.toString()));
    proc.on("close", () => resolve(parseFloat(out.trim()) || 0));
  });
}

async function main() {
  const only = process.argv[2];
  const modes = ["word", "sentence", "progressive"].filter(
    (m) => !only || m === only
  );
  if (!modes.length) {
    console.error(`Unknown mode "${only}" — valid: word | sentence | progressive`);
    process.exit(1);
  }

  console.log(`🎬 Starting Edge TTS test videos (${modes.join(", ")})...\n`);
  for (const mode of modes) {
    await runMode(mode);
    console.log("");
  }

  console.log("🎉 All tests completed!");
  for (const mode of modes) {
    console.log(`   - ${path.join("backend/scripts", `test-edge-${mode}.mp4`)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("❌ FAILED:", e.message);
  process.exit(1);
});

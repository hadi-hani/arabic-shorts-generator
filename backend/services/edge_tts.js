const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

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
 * Uses the `edge-tts` Python package (>= 6.1.15) via a subprocess, because the
 * Node `node-edge-tts` package embeds an outdated Sec-MS-GEC handshake that
 * Microsoft rate-limits (HTTP 403). The Python package is actively maintained
 * and returns WordBoundary metadata (offsets in 100-nanosecond ticks, matching
 * the vertical-shorts-generator schema after converting to seconds).
 *
 * Returns:
 *   { audioPath, wordTimings: [{word, start, end}, ...] }
 * with times in seconds. Throws on any failure so the caller can fall back.
 */
async function generateWithTimings(text, outputPath, { voice = "default", rate = "+0%" } = {}) {
  const resolved = resolveVoice(voice);

  const script = [
    "import asyncio, edge_tts, json, sys",
    "",
    "async def main():",
    `    text = sys.argv[1]`,
    `    out = sys.argv[2]`,
    `    voice = sys.argv[3]`,
    `    rate = sys.argv[4]`,
    "    c = edge_tts.Communicate(text, voice, rate=rate, boundary='WordBoundary')",
    "    timings = []",
    "    with open(out, 'wb') as f:",
    "        async for chunk in c.stream():",
    "            t = chunk['type']",
    "            if t == 'audio':",
    "                f.write(chunk['data'])",
    "            elif t == 'WordBoundary':",
    "                offset_ms = chunk['offset'] // 10000",
    "                duration_ms = chunk['duration'] // 10000",
    "                timings.append({",
    "                    'word': chunk['text'],",
    "                    'start': offset_ms / 1000.0,",
    "                    'end': (offset_ms + duration_ms) / 1000.0",
    "                })",
    "    print(json.dumps({'wordTimings': timings}))",
    "",
    "asyncio.run(main())"
  ].join("\n");

  const scriptPath = path.join(os.tmpdir(), `edge_tts_${Date.now()}_${Math.floor(Math.random() * 1e6)}.py`);
  fs.writeFileSync(scriptPath, script, "utf8");

  return new Promise((resolve, reject) => {
    const args = [scriptPath, String(text), String(outputPath), resolved, String(rate)];
    const proc = spawn("python3", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      fs.unlinkSync(scriptPath);
      if (code !== 0) {
        return reject(new Error(`edge-tts (python) failed: ${(stderr || stdout).trim()}`));
      }
      let wordTimings = [];
      try {
        const parsed = JSON.parse(stdout.trim().split("\n").pop());
        wordTimings = parsed.wordTimings || [];
      } catch (e) {
        return reject(new Error(`edge-tts (python) bad output: ${e.message}`));
      }
      if (!fs.existsSync(outputPath)) {
        return reject(new Error("edge-tts (python) produced no audio file"));
      }
      resolve({ audioPath: outputPath, wordTimings, source: "edge" });
    });
  });
}

module.exports = { generateWithTimings, resolveVoice, EDGE_VOICES };
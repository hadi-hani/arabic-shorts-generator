const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");

const MODELS_DIR = path.join(__dirname, "../models/piper");
const PIPER_RELEASE = "https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_linux_x86_64.tar.gz";
const HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0";

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

// Map "ar_JO-kareem-medium" -> ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx
function modelPaths(voice) {
  const parts = voice.split("-"); // [locale, speaker, quality]
  if (parts.length < 3) throw new Error(`Invalid Piper voice name: ${voice}`);
  const locale = parts[0];
  const lang = locale.split("_")[0];
  const speaker = parts[1];
  const quality = parts[2];
  const onnx = `${voice}.onnx`;
  const json = `${voice}.onnx.json`;
  return {
    onnxUrl: `${HF_BASE}/${lang}/${locale}/${speaker}/${quality}/${onnx}`,
    jsonUrl: `${HF_BASE}/${lang}/${locale}/${speaker}/${quality}/${json}`,
    onnxPath: path.join(MODELS_DIR, onnx),
    jsonPath: path.join(MODELS_DIR, json)
  };
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    let file = null;
    const fail = (err) => {
      // Never leave a partial file or an open fd behind.
      if (file) { try { file.destroy(); } catch (_) {} }
      try { fs.unlinkSync(dest); } catch (_) {}
      reject(err);
    };
    const doGet = (u) => {
      https.get(u, { headers: { "User-Agent": "arabic-shorts-generator" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          res.resume(); // drain redirect body so the socket is freed
          const loc = res.headers.location;
          const nextUrl = loc.startsWith("http") ? loc : new URL(loc, u).href;
          return doGet(nextUrl);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error(`Download failed (${res.statusCode}): ${u}`));
        }
        file = fs.createWriteStream(dest);
        file.on("error", (e) => fail(new Error(`Download write failed: ${e.message}`)));
        res.on("error", (e) => fail(new Error(`Download network error: ${e.message}`)));
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(dest)));
      }).on("error", (e) => fail(new Error(`Download request error: ${e.message}`)));
    };
    doGet(url);
  });
}

async function ensureModel(voice) {
  ensureDir(MODELS_DIR);
  const { onnxUrl, jsonUrl, onnxPath, jsonPath } = modelPaths(voice);
  if (!fs.existsSync(onnxPath)) {
    console.log(`⬇️ Downloading Piper voice model: ${voice}`);
    await downloadFile(onnxUrl, onnxPath);
  }
  if (!fs.existsSync(jsonPath)) {
    await downloadFile(jsonUrl, jsonPath);
  }
  return { onnxPath, jsonPath };
}

function findPiperBin() {
  if (process.env.PIPER_BIN && fs.existsSync(process.env.PIPER_BIN)) return process.env.PIPER_BIN;
  // Check PATH; throw a clear error if missing so the caller can fall back
  // WITHOUT first downloading a large model unnecessarily.
  try {
    const res = require("child_process").spawnSync("sh", ["-c", "command -v piper || true"], { encoding: "utf8" });
    const p = (res.stdout || "").trim();
    if (p) return p;
  } catch (_) {}
  throw new Error("'piper' binary not found in PATH (install piper-tts or set PIPER_BIN)");
}

/**
 * Piper TTS (solid Arabic support: ar_JO-kareem-medium, ar_JO-SA_dii-high, ...).
 * Usage: generatePiper(text, outWavPath, { voice, speed })
 * Auto-downloads the voice model on first use. Writes a WAV file.
 */
async function generatePiper(text, outputPath, { voice = "ar_JO-kareem-medium", speed = 1.0 } = {}) {
  const bin = findPiperBin(); // throws early if missing
  const { onnxPath, jsonPath } = await ensureModel(voice);
  const lengthScale = (1.0 / Math.max(0.25, Math.min(4.0, speed))).toFixed(3);

  return new Promise((resolve, reject) => {
    const args = [
      "--model", onnxPath,
      "--config", jsonPath,
      "--output_file", outputPath,
      "--length_scale", lengthScale
    ];
    const proc = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    proc.stdin.write(text);
    proc.stdin.end();
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => reject(new Error(`piper spawn failed: ${err.message} (is 'piper' installed?)`)));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`piper failed (${code}): ${stderr.trim().slice(-500)}`));
      if (!fs.existsSync(outputPath)) return reject(new Error("piper produced no audio file"));
      resolve({ audioPath: outputPath });
    });
  });
}

module.exports = { generatePiper, ensureModel, modelPaths };

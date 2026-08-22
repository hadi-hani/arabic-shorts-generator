const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

/**
 * Kokoro TTS (community/experimental Arabic support).
 *
 * NOTE: The official Kokoro-82M model does NOT ship Arabic voicepacks
 * (en, es, fr, hi, it, ja, pt, zh only). Arabic requires a community build
 * (e.g. AsmaaQ25/kokoro-ar) or a fine-tuned Arabic model. Set the engine via:
 *   KOKORO_LANG_CODE  (default "a")  — depends on the community model
 *   KOKORO_VOICE      (default "ar") — voice name expected by that model
 *
 * Usage:  generateKokoro(text, outWavPath, { voice, langCode, speed })
 * Returns nothing on success; throws on failure so the caller can fall back.
 */
async function generateKokoro(text, outputPath, { voice = "ar", langCode = "a", speed = 1.0 } = {}) {
  const script = [
    "import sys, numpy as np, soundfile as sf",
    "try:",
    "    from kokoro import KPipeline",
    "except Exception as e:",
    "    sys.stderr.write('kokoro import failed: ' + str(e) + '\\n'); sys.exit(2)",
    "lang_code = sys.argv[1]",
    "voice = sys.argv[2]",
    "speed = float(sys.argv[3])",
    "text = sys.argv[4]",
    "out = sys.argv[5]",
    "try:",
    "    pipeline = KPipeline(lang_code=lang_code)",
    "except Exception as e:",
    "    sys.stderr.write('KPipeline init failed: ' + str(e) + '\\n'); sys.exit(3)",
    "chunks = []",
    "try:",
    "    for _, _, audio in pipeline.generate(text, voice=voice, speed=speed, split_sentences=True):",
    "        if audio is not None:",
    "            chunks.append(np.asarray(audio, dtype=np.float32))",
    "except Exception as e:",
    "    sys.stderr.write('kokoro generate failed: ' + str(e) + '\\n'); sys.exit(4)",
    "if not chunks:",
    "    sys.stderr.write('kokoro produced no audio\\n'); sys.exit(5)",
    "full = np.concatenate(chunks)",
    "sf.write(out, full, 24000)",
    "sys.stdout.write('ok')"
  ].join("\n");

  const scriptPath = path.join(os.tmpdir(), `kokoro_${Date.now()}_${Math.floor(Math.random() * 1e6)}.py`);
  fs.writeFileSync(scriptPath, script, "utf8");

  return new Promise((resolve, reject) => {
    const args = [scriptPath, String(langCode), String(voice), String(speed), String(text), String(outputPath)];
    const proc = spawn("python3", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      fs.unlinkSync(scriptPath);
      if (code !== 0) return reject(new Error(`kokoro (python) failed (${code}): ${(stderr || stdout).trim()}`));
      if (!fs.existsSync(outputPath)) return reject(new Error("kokoro produced no audio file"));
      resolve({ audioPath: outputPath });
    });
  });
}

module.exports = { generateKokoro };

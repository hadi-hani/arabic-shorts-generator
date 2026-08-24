const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

/**
 * Kokoro TTS → oddadmix/Nabra-82M-v0.1 (Arabic MSA, voice af_msa).
 *
 * Nabra is a fine-tune of Kokoro-82M for Modern Standard Arabic, loaded through
 * the Oddadmix kokoro fork. It requires diacritized (tashkeel'd) input — our
 * narration already carries selective tashkeel, so we pass it with
 * ArabicG2P(diacritize=False) and skip camel-tools entirely.
 *
 * Model weights are fetched once via huggingface_hub into NABRA_MODEL_DIR
 * (default ../models/nabra, gitignored).
 *
 * Usage:  generateKokoro(text, outWavPath, { voice, langCode, speed })
 * Throws on failure so the caller (tts.js) can fall back to edge.
 */
async function generateKokoro(text, outputPath, { voice = "af_msa", langCode = "ar", speed = 1.0 } = {}) {
  const modelDir = process.env.NABRA_MODEL_DIR ||
    path.join(__dirname, "..", "models", "nabra");
  const repoId = process.env.NABRA_REPO_ID || "oddadmix/Nabra-82M-v0.1";

  const script = [
    "import sys, os",
    "sys.path.insert(0, os.environ.get('KOKORO_HELPER_DIR', ''))",
    "import numpy as np, torch, soundfile as sf",
    "try:",
    "    from huggingface_hub import hf_hub_download, list_repo_files",
    "    from kokoro import KModel, KPipeline",
    "    from kokoro import pipeline as kpipeline_mod",
    "    from arabic_g2p import ArabicG2P, EXTRA_SYMBOLS, clean_phonemes, normalize_text",
    "except Exception as e:",
    "    sys.stderr.write('import failed: ' + str(e) + '\\n'); sys.exit(2)",
    "lang_code = sys.argv[1]",
    "voice_arg = sys.argv[2]",
    "speed = float(sys.argv[3])",
    "text = sys.argv[4]",
    "out = sys.argv[5]",
    "repo_id = os.environ.get('NABRA_REPO_ID', 'oddadmix/Nabra-82M-v0.1')",
    "model_dir = os.environ.get('NABRA_MODEL_DIR', '')",
    "try:",
    "    files = list_repo_files(repo_id)",
    "    model_file = next((f for f in files if f.endswith('.pth')), None)",
    "    voice_file = next((f for f in files if f.endswith('.pt')), None)",
    "    if not model_file or not voice_file:",
    "        sys.stderr.write('nabra model files not found in repo\\n'); sys.exit(6)",
    "    cfg = hf_hub_download(repo_id, 'config.json', local_dir=model_dir)",
    "    mdl = hf_hub_download(repo_id, model_file, local_dir=model_dir)",
    "    vox = hf_hub_download(repo_id, voice_file, local_dir=model_dir)",
    "except Exception as e:",
    "    sys.stderr.write('model download failed: ' + str(e) + '\\n'); sys.exit(6)",
    "try:",
    "    kmodel = KModel(repo_id=repo_id, config=cfg, model=mdl, disable_complex=True).eval()",
    "    kmodel.vocab.update(EXTRA_SYMBOLS)",
    "    kpipeline_mod.LANG_CODES.setdefault('ar', 'ar')",
    "    pipeline = KPipeline(lang_code='ar', repo_id=repo_id, model=kmodel)",
    "    _orig = pipeline.g2p",
    "    pipeline.g2p = lambda t: (clean_phonemes(_orig(t)[0]), _orig(t)[1])",
    "except Exception as e:",
    "    sys.stderr.write('pipeline init failed: ' + str(e) + '\\n'); sys.exit(3)",
    "try:",
    "    if voice_arg and os.path.exists(voice_arg):",
    "        vox = voice_arg",
    "    voice = torch.load(vox, map_location='cpu', weights_only=True)",
    "except Exception as e:",
    "    sys.stderr.write('voice load failed: ' + str(e) + '\\n'); sys.exit(7)",
    "g2p = ArabicG2P(diacritize=False)",
    "text_norm, _ = normalize_text(text)",
    "chunks = []",
    "try:",
    "    for _, _, audio in pipeline(text_norm, voice=voice, speed=speed):",
    "        if audio is not None:",
    "            chunks.append(np.asarray(audio, dtype=np.float32))",
    "except Exception as e:",
    "    sys.stderr.write('generate failed: ' + str(e) + '\\n'); sys.exit(4)",
    "if not chunks:",
    "    sys.stderr.write('no audio produced\\n'); sys.exit(5)",
    "full = np.concatenate(chunks)",
    "sf.write(out, full, 24000)",
    "sys.stdout.write('ok')"
  ].join("\n");

  const scriptPath = path.join(os.tmpdir(), `kokoro_nabra_${Date.now()}_${Math.floor(Math.random() * 1e6)}.py`);
  fs.writeFileSync(scriptPath, script, "utf8");

  return new Promise((resolve, reject) => {
    const args = [scriptPath, String(langCode), String(voice), String(speed), String(text), String(outputPath)];
    const env = {
      ...process.env,
      KOKORO_HELPER_DIR: __dirname,
      NABRA_MODEL_DIR: modelDir,
      NABRA_REPO_ID: repoId
    };
    const pythonBin = process.env.KOKORO_PYTHON || "python3";
    const proc = spawn(pythonBin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    // Model load + synthesis per scene; hung torch import must not block forever.
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch (_) {}
      reject(new Error("[kokoro] timed out after 180s"));
    }, 180000);
    const done = (fn) => (...a) => { clearTimeout(timer); fn(...a); };
    const cleanupScript = () => { try { fs.unlinkSync(scriptPath); } catch (_) {} };

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", done((err) => {
      cleanupScript();
      reject(new Error(`[kokoro] spawn failed (${pythonBin}): ${err.message}`));
    }));
    proc.on("close", done((code) => {
      cleanupScript();
      if (code !== 0) return reject(new Error(`kokoro/nabra (python) failed (${code}): ${(stderr || stdout).trim().slice(-400)}`));
      if (!fs.existsSync(outputPath)) return reject(new Error("kokoro/nabra produced no audio file"));
      resolve({ audioPath: outputPath });
    }));
  });
}

module.exports = { generateKokoro };

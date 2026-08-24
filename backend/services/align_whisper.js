const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

/**
 * Word-level forced alignment via `faster-whisper` (Arabic: language "ar").
 *
 * Given the full narration audio (the single whole-narration TTS file), returns
 * a flat list of { word, start, end } in seconds, in spoken order. These are
 * REAL, non-uniform word timestamps extracted from the audio — so on-screen
 * subtitles stay perfectly in sync while the audio remains one continuous file
 * (no silence gaps between scenes).
 *
 * Usage: alignWordsWhisper(audioPath, text, {language, model}) -> Promise<[{word,start,end}]>
 * Throws on failure so the caller can fall back to length-proportional timings.
 *
 * Model size (env WHISPER_MODEL) defaults to "base"; use "small"/"medium" for
 * higher Arabic accuracy at the cost of speed. The model is downloaded once and
 * cached by faster-whisper (~/.cache/huggingface).
 */
async function alignWordsWhisper(audioPath, text, { language = "ar", model = process.env.WHISPER_MODEL || "base" } = {}) {
  const outPath = path.join(os.tmpdir(), `whisper_out_${Date.now()}_${Math.floor(Math.random() * 1e6)}.json`);

  const script = [
    "import sys, json",
    "from faster_whisper import WhisperModel",
    "audio_path = sys.argv[1]",
    "out_path = sys.argv[2]",
    "lang = sys.argv[3]",
    "model_name = sys.argv[4] if len(sys.argv) > 4 else 'base'",
    "model = WhisperModel(model_name, device='cpu', compute_type='int8')",
    "segments, _ = model.transcribe(audio_path, language=lang, word_timestamps=True, beam_size=5)",
    "out = []",
    "for seg in segments:",
    "    for w in seg.words:",
    "        out.append({'word': w.word, 'start': float(w.start), 'end': float(w.end)})",
    "with open(out_path, 'w', encoding='utf-8') as f:",
    "    json.dump(out, f, ensure_ascii=False)"
  ].join("\n");

  const scriptPath = path.join(os.tmpdir(), `whisper_align_${Date.now()}_${Math.floor(Math.random() * 1e6)}.py`);
  fs.writeFileSync(scriptPath, script, "utf8");

  return new Promise((resolve, reject) => {
    const args = [scriptPath, audioPath, outPath, language, model];
    const proc = spawn("python3", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    // Whisper on long narrations can take a while; 5 minutes is generous.
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch (_) {}
      fail(new Error("[whisper] timed out after 300s"));
    }, 300000);
    const done = (fn) => (...a) => { clearTimeout(timer); fn(...a); };
    // Every exit path must leave zero temp files behind.
    function fail(err) {
      try { fs.unlinkSync(scriptPath); } catch (_) {}
      try { fs.unlinkSync(outPath); } catch (_) {}
      reject(err);
    }

    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", done((err) => fail(new Error(`[whisper] spawn failed: ${err.message}`))));
    proc.on("close", done((code) => {
      try { fs.unlinkSync(scriptPath); } catch (_) {}
      if (code !== 0) {
        try { fs.unlinkSync(outPath); } catch (_) {}
        return reject(new Error(`whisper failed (${code}): ${stderr.trim().slice(-800)}`));
      }
      let data;
      try {
        data = JSON.parse(fs.readFileSync(outPath, "utf8"));
      } catch (e) {
        try { fs.unlinkSync(outPath); } catch (_) {}
        return reject(new Error(`whisper output parse failed: ${e.message}`));
      }
      try { fs.unlinkSync(outPath); } catch (_) {}
      if (!Array.isArray(data) || !data.length) return reject(new Error("whisper returned no words"));
      resolve(data);
    }));
  });
}

module.exports = { alignWordsWhisper };

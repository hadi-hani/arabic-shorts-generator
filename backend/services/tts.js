const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// ffmpeg binary resolution: bundled static build (has libass/subtitles) → PATH
const FFMPEG_BIN = (() => {
  const localBin = path.join(__dirname, "../bin/ffmpeg");
  if (fs.existsSync(localBin)) return localBin;
  return "ffmpeg";
})();

// ── Temp-file hygiene helpers ──────────────────────────────────────────────
// Every intermediate artifact this module creates should eventually hit one
// of these. safeUnlink never throws — cleanup must not mask the real error.
function safeUnlink(p) {
  if (!p) return;
  try { fs.unlinkSync(p); } catch (_) {}
}

function cleanupFiles(paths) {
  (paths || []).forEach(safeUnlink);
}

// ── Unified child_process runner ───────────────────────────────────────────
// Guarantees for every ffmpeg/ffprobe call in this module:
//   • stderr/stdout captured for diagnostics
//   • spawn 'error' event ALWAYS handled (missing binary no longer crashes)
//   • optional timeout with SIGKILL
//   • labeled, contextual error messages: [label] exited N: <stderr tail>
function runBin(bin, args, { label = bin, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch (_) {}
        reject(new Error(`[${label}] timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`[${label}] spawn failed: ${err.message}`));
    });
    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`[${label}] exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}
const { generateWithTimings } = require("./edge_tts");
const { alignWordsWhisper } = require("./align_whisper");
const { stripTashkeel, tokenizeWords } = require("./word_aligner");

// ── Audio duration via ffprobe ─────────────────────────────────────────────
// Resolves 0 on failure (callers depend on a number) but logs loudly so the
// silent-zero is never invisible during debugging.
function getAudioDuration(audioPath) {
  return runBin("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", audioPath
  ], { label: "ffprobe:duration" })
    .then(({ stdout }) => {
      const dur = parseFloat(stdout.trim());
      return Number.isFinite(dur) ? dur : 0;
    })
    .catch((e) => {
      console.warn(`[TTS:getAudioDuration] probe failed for "${path.basename(String(audioPath))}" → returning 0 (${e.message})`);
      return 0;
    });
}

// ── Extract [start,end] segment from a source audio file ──────────────────
async function extractSegment(srcPath, outPath, start, end) {
  await runBin(FFMPEG_BIN, [
    "-ss", String(start),
    "-i", srcPath,
    "-t", String(Math.max(0.05, end - start)),
    "-c", "copy",
    "-avoid_negative_ts", "make_zero",
    "-y", outPath
  ], { label: `ffmpeg:extractSegment→${path.basename(outPath)}` });
  return outPath;
}

// ── Convert any audio file to mp3 ──────────────────────────────────────────
async function toMp3(srcPath, outPath) {
  if (srcPath === outPath) return outPath;
  await runBin(FFMPEG_BIN, [
    "-y", "-i", srcPath, "-c:a", "libmp3lame", "-q:a", "4", outPath
  ], { label: `ffmpeg:toMp3→${path.basename(outPath)}` });
  return outPath;
}

// ── Strip Arabic punctuation that hurts word matching ──────────────────────
// Keeps tashkeel intact — only removes ؟ ، ; and similar non-alphabetic chars.
function stripArabicPunctuation(text) {
  return String(text || "")
    .replace(/[؟،؛]/g, "")   // Arabic question mark, comma, semicolon
    .replace(/[!"'::…\-–—]+/g, " ")  // replace other punctuation with space
    .replace(/\s+/g, " ")
    .trim();
}

// ── Unified single-call TTS (Microsoft Edge TTS — the only engine) ─────────
// Returns { audioPath, wordTimings: [{word,start,end}] | null }
async function generateFull(text, outputPath, options = {}) {
  const mp3Path = outputPath.replace(/\.[^.]+$/, "") + ".mp3";

  // Speed control: 0.8x to 1.5x, default 1.0x — mapped onto Edge's rate string.
  const speed = options.speed !== undefined ? Math.max(0.8, Math.min(1.5, options.speed)) : 1.0;
  const pct = Math.round((speed - 1) * 100);
  const rate = options.rate || (pct === 0 ? "+0%" : `${pct > 0 ? "+" : ""}${pct}%`);

  const t0 = Date.now();
  console.log(`[TTS:generateFull] start engine=edge chars=${text.length} speed=${speed}`);
  try {
    const r = await generateWithTimings(text, mp3Path, {
      voice: options.voice || "default",
      rate
    });
    if (!r || !r.audioPath || !fs.existsSync(r.audioPath)) {
      throw new Error("edge produced no audio file");
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[TTS:generateFull] done engine=edge in ${secs}s → ${path.basename(r.audioPath)}`);
    return { audioPath: r.audioPath, wordTimings: r.wordTimings || null };
  } catch (e) {
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const msg = (e && e.message) ? e.message : String(e);
    console.error(`[TTS:generateFull] FAILED engine=edge after ${secs}s: ${msg}`);
    throw new Error(`[TTS:generateFull] edge failed after ${secs}s: ${msg}`);
  }
}

// ── Clean audio: silence trimming, noise gate, click/pop removal ──────────
async function cleanAudio(inputPath, outputPath) {
  await runBin(FFMPEG_BIN, [
    "-i", inputPath,
    "-af", "silenceremove=start_periods=1:start_silence=0.5,aresample=async=1",
    "-y", outputPath
  ], { label: `ffmpeg:cleanAudio→${path.basename(outputPath)}` });
  if (!fs.existsSync(outputPath)) {
    throw new Error("[TTS:cleanAudio] ffmpeg exited 0 but produced no output file");
  }
  return outputPath;
}

// ── Whole-script narration TTS → split into per-scene segments ────────────
// Generates the ENTIRE narration in one TTS call (natural prosody, no silence
// gaps between scenes), then cuts the single audio file into per-scene pieces.
// Returns:
//   { audioPaths: [path|null], timingsList: [[{word,start,end}]|null], engine }
async function generateFullNarration(scenes, jobId, options = {}) {
  const audioDir = path.join(__dirname, "../temp/" + jobId + "/audio");
  fs.mkdirSync(audioDir, { recursive: true });

  const sceneTexts = scenes
    .map((s) => String(s.narration || "").trim())
    .filter(Boolean);

  if (!sceneTexts.length) return { audioPaths: [], timingsList: [], engine: "edge" };

  // Join with an Arabic comma so the engine inserts a clean natural pause
  // (avoids the glitchy blip the bare period " . " produced in Nabra).
  const SEP = "، ";
  const fullText = sceneTexts.join(SEP);

  const fullPath = path.join(audioDir, "full_narration.mp3");
  const t0 = Date.now();
  console.log(`[TTS:narration] start jobId=${jobId} engine=edge scenes=${sceneTexts.length} words=${sceneTexts.join(" ").split(/\s+/).length}`);

  const result = await generateFull(fullText, fullPath, { ...options, ttsType: "edge" });

  const fullDuration = await getAudioDuration(result.audioPath);
  const eps = 0.3;

  // Proportional scene boundaries by character length (used as the fallback
  // when no real alignment is available).
  const lengths = sceneTexts.map((t) => Array.from(t).length);
  const totalLen = lengths.reduce((a, b) => a + b, 0) || 1;
  const ranges = [];
  let acc = 0;
  for (const L of lengths) {
    const start = (acc / totalLen) * fullDuration;
    acc += L;
    const end = (acc / totalLen) * fullDuration;
    ranges.push({ start, end });
  }

  const cleanSceneWords = sceneTexts.map((t) => tokenizeWords(stripTashkeel(t)));
  const sceneWordCounts = cleanSceneWords.map((w) => w.length);
  const totalClean = sceneWordCounts.reduce((a, b) => a + b, 0) || 1;

  const audioPaths = [];
  const timingsList = [];

  // Word timings cascade:
  //  1. edge → native WordBoundary timings (real timestamps).
  //  2. no native timings → forced alignment via faster-whisper on the full
  //     audio (exact, non-uniform word timestamps). We consume whisper words
  //     IN ORDER, distributing them across scenes proportionally to each
  //     scene's word count.
  //  3. whisper unavailable → length-proportional distribution.
  let globalTimings = null;
  if (result.wordTimings && result.wordTimings.length) {
    globalTimings = result.wordTimings;
  } else {
    try {
      console.log(`[TTS:narration] edge gave no word timings — whisper alignment starting…`);
      const cleanFull = sceneTexts.map((t) => stripArabicPunctuation(stripTashkeel(t)).replace(/[؟]/g, "")).join(" ");
      globalTimings = await alignWordsWhisper(result.audioPath, cleanFull, { language: "ar" });
      console.log(`[TTS:narration] whisper aligned ${globalTimings.length} words`);
    } catch (e) {
      console.warn(`[TTS:narration] whisper alignment failed (${e.message}) — using length-proportional timings`);
      globalTimings = null;
    }
  }

  if (globalTimings && globalTimings.length) {
    const totalW = globalTimings.length;
    let wi = 0;
    for (let i = 0; i < sceneTexts.length; i++) {
      const sceneId = scenes[i].id != null ? scenes[i].id : i + 1;
      const segPath = path.join(audioDir, "scene_" + sceneId + ".mp3");
      const take = (i === sceneTexts.length - 1)
        ? (totalW - wi)
        : Math.max(1, Math.round((sceneWordCounts[i] / totalClean) * totalW));
      const seg = globalTimings.slice(wi, wi + take);
      wi += take;

      if (!seg.length) {
        // No aligned words for this scene → length-proportional fallback.
        const { start, end } = ranges[i];
        try {
          await extractSegment(result.audioPath, segPath, start, end);
        } catch (e) {
          throw new Error(`[TTS:narration] segment extraction failed for scene ${i + 1}/${sceneTexts.length} (id ${sceneId}): ${e.message}`);
        }
        const words = cleanSceneWords[i];
        const wlen = words.map((w) => Array.from(w).length);
        const wsum = wlen.reduce((a, b) => a + b, 0) || 1;
        const dur = Math.max(0.1, end - start);
        let t = 0;
        const sceneTimings = words.map((w, idx) => {
          const ws = (wlen[idx] / wsum) * dur;
          const st = t, en = t + ws;
          t = en;
          return { word: w, start: st, end: en };
        });
        audioPaths.push(segPath);
        timingsList.push(sceneTimings);
        continue;
      }

      const aStart = seg[0].start;
      const aEnd = seg[seg.length - 1].end;
      try {
        await extractSegment(result.audioPath, segPath, aStart, aEnd);
      } catch (e) {
        throw new Error(`[TTS:narration] segment extraction failed for scene ${i + 1}/${sceneTexts.length} (id ${sceneId}, ${aStart.toFixed(1)}s–${aEnd.toFixed(1)}s): ${e.message}`);
      }
      const sceneTimings = seg.map((w) => ({
        word: w.word,
        start: Math.max(0, w.start - aStart),
        end: Math.max(0, w.end - aStart)
      }));
      audioPaths.push(segPath);
      timingsList.push(sceneTimings);
    }
  } else {
    // Fallback: proportional boundaries + length-proportional word timings.
    console.log("[TTS:narration] using length-proportional scene boundaries (no real timings)");
    for (let i = 0; i < sceneTexts.length; i++) {
      const { start, end } = ranges[i];
      const sceneId = scenes[i].id != null ? scenes[i].id : i + 1;
      const segPath = path.join(audioDir, "scene_" + sceneId + ".mp3");
      try {
        await extractSegment(result.audioPath, segPath, start, end);
      } catch (e) {
        throw new Error(`[TTS:narration] segment extraction failed for scene ${i + 1}/${sceneTexts.length} (id ${sceneId}): ${e.message}`);
      }

      const words = cleanSceneWords[i];
      const wlen = words.map((w) => Array.from(w).length);
      const wsum = wlen.reduce((a, b) => a + b, 0) || 1;
      const dur = Math.max(0.1, end - start);
      let t = 0;
      const sceneTimings = words.map((w, idx) => {
        const ws = (wlen[idx] / wsum) * dur;
        const st = t, en = t + ws;
        t = en;
        return { word: w, start: st, end: en };
      });
      audioPaths.push(segPath);
      timingsList.push(sceneTimings);
    }
  }

  console.log(`[TTS:narration] done engine=edge in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${audioPaths.filter(Boolean).length}/${sceneTexts.length} segments`);
  return { audioPaths, timingsList, engine: "edge" };
}

async function generateTTS(text, outputPath, options = {}) {
  return generateFull(text, outputPath, options);
}

module.exports = {
  generateTTS, generateFull, generateFullNarration, getAudioDuration, toMp3, cleanAudio
};

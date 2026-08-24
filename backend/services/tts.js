const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

// ffmpeg binary resolution: bundled static build (has libass/subtitles) → PATH
const FFMPEG_BIN = (() => {
  const localBin = path.join(__dirname, "../bin/ffmpeg");
  if (fs.existsSync(localBin)) return localBin;
  return "ffmpeg";
})();

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
const { generateKokoro } = require("./kokoro_tts");
const { generatePiper } = require("./piper_tts");
const { alignWordsWhisper } = require("./align_whisper");
const { stripTashkeel, tokenizeWords } = require("./word_aligner");

// Available Arabic voices (Google TTS, legacy)
const VOICES = {
  male:   { name: "ar-XA-Wavenet-B", ssmlGender: "MALE" },
  female: { name: "ar-XA-Wavenet-A", ssmlGender: "FEMALE" }
};

// ── Google TTS (legacy, kept for compatibility) ──────────────────────────
async function textToSpeech(text, outputPath, { voice = "male", speakingRate = 0.95 } = {}) {
  const axios = require("axios");
  const apiKey = process.env.GOOGLE_TTS_KEY;
  if (!apiKey) {
    throw new Error("[TTS:textToSpeech] GOOGLE_TTS_KEY is not set — Google TTS is unavailable");
  }
  const voiceCfg = VOICES[voice] || VOICES.male;
  const t0 = Date.now();
  try {
    // Key sent via header (never in URL) so it can never leak through error payloads.
    const response = await axios.post(
      "https://texttospeech.googleapis.com/v1/text:synthesize",
      {
        input: { text },
        voice: {
          languageCode: "ar-XA",
          name: voiceCfg.name,
          ssmlGender: voiceCfg.ssmlGender
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: Math.min(1.5, Math.max(0.5, speakingRate)),
          pitch: 0.0
        }
      },
      { headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey }, timeout: 30000 }
    );

    const audioBuffer = Buffer.from(response.data.audioContent, "base64");
    if (!audioBuffer.length) throw new Error("empty audio payload from Google");
    fs.writeFileSync(outputPath, audioBuffer);
    console.log(`[TTS:textToSpeech] google ok ${((Date.now() - t0) / 1000).toFixed(1)}s ${(audioBuffer.length / 1024).toFixed(0)}KB`);
    return outputPath;
  } catch (e) {
    let msg = (e && e.message) ? e.message : String(e);
    if (apiKey) msg = msg.split(apiKey).join("***"); // defense in depth
    throw new Error(`[TTS:textToSpeech] google tts failed (${((Date.now() - t0) / 1000).toFixed(1)}s): ${msg}`);
  }
}

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

// ── Convert any audio file to mp3 (used by engines that emit wav) ──────────
async function toMp3(srcPath, outPath) {
  if (srcPath === outPath) return outPath;
  await runBin(FFMPEG_BIN, [
    "-y", "-i", srcPath, "-c:a", "libmp3lame", "-q:a", "4", outPath
  ], { label: `ffmpeg:toMp3→${path.basename(outPath)}` });
  return outPath;
}

// ── Arabic sentence splitter ───────────────────────────────────────────────
function splitArabicSentences(text) {
  // Arabic sentence terminators: "۔" (Arabic full stop/stop sign),
  // "؟" (Arabic question mark)
  // Arabic comma "、" is NOT a sentence terminator (used within sentences)
  // Latin . ? ! are NOT treated as sentence terminators to avoid false splits
  const ARABIC_FULL_STOP = "۔";
  const ARABIC_QUESTION_MARK = "؟";
  let sentences = text.split(ARABIC_FULL_STOP);
  sentences = sentences.reduce((acc, part) => {
    const subParts = part.split(ARABIC_QUESTION_MARK);
    subParts.forEach((s) => {
      const trimmed = s.trim();
      if (trimmed) acc.push(trimmed);
    });
    return acc;
  }, []);
  // Filter empty strings
  return sentences.filter((s) => s.length > 0);
}

// ── Strip Arabic punctuation that Piper mispronounces (causes misalignment) ─
// Keeps tashkeel intact — only removes ؟ ، ; and similar non-alphabetic chars.
function stripArabicPunctuation(text) {
  return String(text || "")
    .replace(/[؟،؛]/g, "")   // Arabic question mark, comma, semicolon
    .replace(/[!"'::…\-–—]+/g, " ")  // replace other punctuation with space
    .replace(/\s+/g, " ")
    .trim();
}

/** Prepare text specifically for Piper TTS — strips ? + break tags only.
 *  Piper mispronounces ؟ (garbled click/syllable) and <break> tags,
 *  but CORRECTLY pronounces tashkeel diacritics. Keep tashkeel for accurate speech. */
function preparePiperText(text) {
  return stripArabicPunctuation(
    text.replace(/<[^>]+>/g, " ")  // strip <break time=.../> tags, collapse spaces
  ).replace(/[؟]/g, "");
}

// ── Add 200-500ms pauses between sentences for TTS engines ────────────────
function addSentencePauses(text, ttsType) {
  const sentences = splitArabicSentences(text);
  if (sentences.length <= 1) return text;

  const pauseMs = ttsType === "piper" ? 100 : 300; // Piper is naturally slow — shorter breaks

  if (ttsType === "piper") {
    // Piper supports SSML <break> tags
    return sentences.map((s, i) => {
      if (i < sentences.length - 1) {
        return s + " <break time=" + pauseMs + "ms/>";
      }
      return s;
    }).join(" ");
  }

  if (ttsType === "kokoro") {
    // Kokoro: insert pause marker using ellipsis + space
    const pauseMarker = " ... ";
    return sentences.map((s, i) => {
      if (i < sentences.length - 1) {
        return s + pauseMarker;
      }
      return s;
    }).join(" ");
  }

  return text;
}

// ── Unified single-call TTS dispatch ───────────────────────────────────────
// Returns { audioPath, wordTimings: [{word,start,end}] | null }
async function generateFull(text, outputPath, options = {}) {
  const ttsType = options.ttsType || "edge";
  const mp3Path = outputPath.replace(/\.[^.]+$/, "") + ".mp3";

  // Speed control: 0.8x to 1.5x, default 1.0x
  const speed = options.speed !== undefined ? Math.max(0.8, Math.min(1.5, options.speed)) : 1.0;

  // Add sentence-aware pauses for Kokoro & Piper TTS
  const processedText = addSentencePauses(text, ttsType);

  const t0 = Date.now();
  console.log(`[TTS:generateFull] start engine=${ttsType} chars=${text.length} speed=${speed}`);
  let audioPath;
  let wordTimings = null;

  try {
    if (ttsType === "edge") {
      const r = await generateWithTimings(processedText, mp3Path, {
        voice: options.voice || "default",
        rate: options.rate || "+0%"
      });
      if (!r || !r.audioPath || !fs.existsSync(r.audioPath)) {
        throw new Error("edge produced no audio file");
      }
      audioPath = r.audioPath;
      wordTimings = r.wordTimings || null;
    } else if (ttsType === "google") {
      const wavPath = mp3Path.replace(/\.mp3$/, ".wav");
      await textToSpeech(processedText, wavPath, {
        voice: options.voice || "male",
        speakingRate: options.speakingRate || 0.95
      });
      // Use FFmpeg atempo to adjust speed for Google TTS
      const tempMp3 = mp3Path.replace(/\.[^.]+$/, "") + "_temp.mp3";
      try {
        await toMp3(wavPath, tempMp3);
        await runBin(FFMPEG_BIN, [
          "-i", tempMp3,
          "-af", "atempo=" + speed,
          "-y", mp3Path
        ], { label: `ffmpeg:atempo(${speed})` });
      } finally {
        try { fs.unlinkSync(tempMp3); } catch (_) {}
      }
      audioPath = mp3Path;
    } else if (ttsType === "kokoro") {
      const wavPath = mp3Path.replace(/\.mp3$/, ".wav");
      const voice = (options.voice && !/^(male|female)$/i.test(options.voice))
        ? options.voice : (process.env.KOKORO_VOICE || "af_msa");
      await generateKokoro(processedText, wavPath, {
        voice,
        langCode: options.langCode || process.env.KOKORO_LANG_CODE || "ar",
        speed: speed
      });
      await toMp3(wavPath, mp3Path);
      audioPath = mp3Path;
      wordTimings = null;
    } else if (ttsType === "piper") {
      const wavPath = mp3Path.replace(/\.mp3$/, ".wav");
      const voice = (options.voice && !/^(male|female)$/i.test(options.voice))
        ? options.voice : (process.env.PIPER_VOICE || "ar_JO-kareem-medium");
      // Piper speaks slowly at default length_scale=1.0; drive it faster (default 1.8x)
      const piperSpeed = speed > 0 ? Math.max(1.6, speed) : 1.8;
      // Strip tashkeel + break tags + ؟ — Piper mispronounces all three (garbles audio
      // at sentence ends and merges words), which destroys whisper alignment.
      await generatePiper(preparePiperText(processedText), wavPath, {
        voice,
        speed: piperSpeed
      });
      await toMp3(wavPath, mp3Path);
      audioPath = mp3Path;
    } else {
      throw new Error(`unknown ttsType "${ttsType}" — valid: edge | google | kokoro | piper`);
    }

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[TTS:generateFull] done engine=${ttsType} in ${secs}s → ${path.basename(audioPath)}`);
    return { audioPath, wordTimings };
  } catch (e) {
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const msg = (e && e.message) ? e.message : String(e);
    console.error(`[TTS:generateFull] FAILED engine=${ttsType} after ${secs}s: ${msg}`);
    throw new Error(`[TTS:generateFull] ${ttsType} failed after ${secs}s: ${msg}`);
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

// ── Kokoro: generate per-scene audio with explicit silence gaps ──────────
// Kokoro ignores all sentence-boundary markers (..., ., etc.) and produces one
// continuous chunk — so we generate each scene separately and stitch with 400ms
// silence to get natural-feeling pauses between scenes.
const KOKORO_PAUSE_MS = 400;

async function generateKokoroWithPauses(sceneTexts, audioDir, options) {
  const { speed } = options;
  const wavPaths = [];
  const t0 = Date.now();

  for (let i = 0; i < sceneTexts.length; i++) {
    const txt = stripArabicPunctuation(sceneTexts[i]);
    const wavPath = path.join(audioDir, `kokoro_scene_${i}.wav`);
    try {
      await generateKokoro(txt, wavPath, { ...options, speed });
      wavPaths.push(wavPath);
    } catch (e) {
      console.warn(`[TTS:kokoroPauses] scene ${i + 1}/${sceneTexts.length} failed: ${e.message}`);
      wavPaths.push(null);
    }
  }

  const okCount = wavPaths.filter(Boolean).length;
  if (okCount === 0) {
    console.error(`[TTS:kokoroPauses] all ${sceneTexts.length} scenes failed — no audio produced`);
    return null;
  }
  if (okCount < sceneTexts.length) {
    console.warn(`[TTS:kokoroPauses] partial success: ${okCount}/${sceneTexts.length} scenes generated`);
  }
  console.log(`[TTS:kokoroPauses] generated ${okCount}/${sceneTexts.length} scenes in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Concatenate with silence gaps between valid segments
  const validPaths = wavPaths.filter(Boolean);
  if (validPaths.length === 1) return validPaths[0];

  const outWav = path.join(audioDir, "full_narration.wav");
  const concatList = path.join(audioDir, "concat.txt");
  const lines = [];
  for (let i = 0; i < validPaths.length; i++) {
    lines.push("file '" + validPaths[i] + "'");
    if (i < validPaths.length - 1) {
      // Insert silence segment; on generation failure continue without pause
      const silPath = path.join(audioDir, `silence_${i}.wav`);
      const sil = spawnSync(FFMPEG_BIN, [
        "-y", "-f", "lavfi", "-i",
        "anullsrc=r=24000:cl=stereo",
        "-t", String(KOKORO_PAUSE_MS / 1000),
        "-c:a", "pcm_s16le", silPath
      ], { stdio: ["ignore", "pipe", "pipe"] });
      if (sil.status !== 0 || !fs.existsSync(silPath)) {
        console.warn(`[TTS:kokoroPauses] silence_${i} generation failed (exit ${sil.status}) — concatenating without this pause`);
      } else {
        lines.push("file '" + silPath + "'");
      }
    }
  }
  fs.writeFileSync(concatList, lines.join("\n"), "utf8");

  await new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, [
      "-f", "concat", "-safe", "0", "-i", concatList,
      "-c:a", "pcm_s16le", "-y", outWav
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", d => (stderr += d.toString()));
    proc.on("close", code => {
      validPaths.forEach(p => { try { fs.unlinkSync(p); } catch (_) {} });
      for (let i = 0; i < validPaths.length - 1; i++) {
        try { fs.unlinkSync(path.join(audioDir, `silence_${i}.wav`)); } catch (_) {}
      }
      try { fs.unlinkSync(concatList); } catch (_) {}
      if (code !== 0) return reject(new Error("kokoro concat failed: " + stderr.slice(-400)));
      resolve();
    });
  });

  // Convert to mp3 (what the rest of the pipeline expects)
  const mp3Path = path.join(audioDir, "full_narration.mp3");
  await toMp3(outWav, mp3Path);
  try { fs.unlinkSync(outWav); } catch (_) {}
  return mp3Path;
}

// ── Whole-script narration TTS → split into per-scene segments ────────────
// Generates the ENTIRE narration in one TTS call (natural prosody, no silence
// gaps between scenes), then cuts the single audio file into per-scene pieces.
// Returns the SAME contract as the old generateSceneAudio:
//   { audioPaths: [path|null], timingsList: [[{word,start,end}]|null] }
async function generateFullNarration(scenes, jobId, options = {}) {
  const audioDir = path.join(__dirname, "../temp/" + jobId + "/audio");
  require("fs").mkdirSync(audioDir, { recursive: true });

  const ttsType = options.ttsType || "edge";
  const sceneTexts = scenes
    .map((s) => String(s.narration || "").trim())
    .filter(Boolean);

  if (!sceneTexts.length) return { audioPaths: [], timingsList: [] };

  // Join with an Arabic comma so the engine inserts a clean natural pause
  // (avoids the glitchy blip the bare period " . " produced in Nabra).
  const SEP = "، ";
  const fullText = sceneTexts.join(SEP);

  const fullPath = path.join(audioDir, "full_narration.mp3");
  let result;
  let usedEngine = ttsType;
  const t0 = Date.now();
  console.log(`[TTS:narration] start jobId=${jobId} engine=${ttsType} scenes=${sceneTexts.length} words=${sceneTexts.join(" ").split(/\s+/).length}`);

  // Edge is the universal safety net. If the primary engine fails AND edge
  // also fails, surface BOTH errors — never a bare message without context.
  const fallbackToEdge = async (primaryErr) => {
    console.warn(`[TTS:narration] ${usedEngine} failed (${primaryErr.message}) — falling back to edge`);
    usedEngine = "edge";
    try {
      return await generateFull(fullText, fullPath, { ...options, ttsType: "edge" });
    } catch (fbErr) {
      throw new Error(
        `[TTS:narration] ${primaryErr.message}; then edge fallback also failed (${fbErr.message})`
      );
    }
  };

  if (ttsType === "kokoro") {
    // Kokoro ignores all pause markers — generate per-scene with explicit silence gaps
    try {
      const kokoroPath = await generateKokoroWithPauses(sceneTexts, audioDir, options);
      if (!kokoroPath) throw new Error("kokoro produced no audio for any scene");
      result = { audioPath: kokoroPath, wordTimings: null };
    } catch (e) {
      result = await fallbackToEdge(e);
    }
  } else {
    try {
      result = await generateFull(fullText, fullPath, { ...options, ttsType });
    } catch (e) {
      // Graceful fallback so a video is still produced even if the chosen
      // engine (piper/google) fails to load its model.
      if (ttsType !== "edge") {
        result = await fallbackToEdge(e);
      } else {
        throw e;
      }
    }
  }

  const fullDuration = await getAudioDuration(result.audioPath);
  const eps = 0.3;

  // Proportional scene boundaries by character length (used for Edge time-range
  // filtering and as the fallback when no real alignment is available).
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

  // Real word timings:
  //  - edge → native WordBoundary timings (already real).
  //  - kokoro/piper → forced alignment via faster-whisper on the full audio
  //    (exact, non-uniform word timestamps). We consume whisper words IN ORDER,
  //    distributing them across scenes proportionally to each scene's word count,
  //    which yields exact per-scene audio boundaries + real per-word timings.
  let globalTimings = null;
  if (ttsType === "edge" && result.wordTimings && result.wordTimings.length) {
    globalTimings = result.wordTimings;
  } else if (ttsType === "kokoro" || ttsType === "piper") {
    try {
      console.log(`[TTS:narration] whisper alignment starting (${usedEngine} audio)…`);
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
        // No whisper words for this scene → length-proportional fallback.
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

      let sceneTimings = null;
      if (ttsType === "edge" && result.wordTimings && result.wordTimings.length) {
        sceneTimings = result.wordTimings
          .filter((t) => (t.end != null ? t.end : t.start) >= start - eps &&
                         (t.start != null ? t.start : 0) <= end + eps)
          .map((t) => ({
            word: t.word,
            start: Math.max(0, (t.start != null ? t.start : 0) - start),
            end: Math.max(0, (t.end != null ? t.end : 0) - start)
          }));
      }
      if (!sceneTimings || !sceneTimings.length) {
        const words = cleanSceneWords[i];
        const wlen = words.map((w) => Array.from(w).length);
        const wsum = wlen.reduce((a, b) => a + b, 0) || 1;
        const dur = Math.max(0.1, end - start);
        let t = 0;
        sceneTimings = words.map((w, idx) => {
          const ws = (wlen[idx] / wsum) * dur;
          const st = t, en = t + ws;
          t = en;
          return { word: w, start: st, end: en };
        });
      }
      audioPaths.push(segPath);
      timingsList.push(sceneTimings);
    }
  }

  console.log(`[TTS:narration] done engine=${usedEngine} in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${audioPaths.filter(Boolean).length}/${sceneTexts.length} segments`);
  return { audioPaths, timingsList, engine: usedEngine };
}

// ── Legacy: per-scene Google TTS (deprecated) ─────────────────────────────
async function generateAllAudio(scenes, jobId, { voice = "male", speakingRate = 0.95 } = {}) {
  const audioDir = path.join(__dirname, "../temp/" + jobId + "/audio");
  require("fs").mkdirSync(audioDir, { recursive: true });

  const results = await Promise.all(
    scenes.map(async (scene) => {
      try {
        const filePath = path.join(audioDir, "scene_" + scene.id + ".mp3");
        await textToSpeech(scene.narration, filePath, { voice, speakingRate });
        return filePath;
      } catch (e) {
        console.warn("⚠️ Audio skipped scene " + scene.id + ": " + e.message);
        return null;
      }
    })
  );

  return results;
}

// ── Legacy: per-scene TTS (deprecated; use generateFullNarration) ─────────
async function generateSceneAudio(scenes, jobId, options = {}) {
  const audioDir = path.join(__dirname, "../temp/" + jobId + "/audio");
  require("fs").mkdirSync(audioDir, { recursive: true });

  const ttsType = options.ttsType || "edge";
  const results = await Promise.all(
    scenes.map(async (scene) => {
      try {
        const filePath = path.join(audioDir, "scene_" + scene.id + ".mp3");
        const out = await generateFull(scene.narration, filePath, { ...options, ttsType });
        return { audioPath: out.audioPath, wordTimings: out.wordTimings || null };
      } catch (e) {
        console.warn("⚠️ Audio skipped scene " + scene.id + " (" + options.ttsType + "): " + e.message);
        return { audioPath: null, wordTimings: null };
      }
    })
  );

  return {
    audioPaths: results.map((r) => r.audioPath),
    timingsList: results.map((r) => r.wordTimings)
  };
}

async function generateTTS(text, outputPath, options = {}) {
  return generateFull(text, outputPath, options);
}

module.exports = {
  textToSpeech, generateAllAudio, generateTTS, generateSceneAudio,
  generateFull, generateFullNarration, getAudioDuration, toMp3, cleanAudio
};

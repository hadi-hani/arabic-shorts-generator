const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
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
  const voiceCfg = VOICES[voice] || VOICES.male;
  const response = await axios.post(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_KEY}`,
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
    { headers: { "Content-Type": "application/json" } }
  );

  const audioBuffer = Buffer.from(response.data.audioContent, "base64");
  fs.writeFileSync(outputPath, audioBuffer);
  return outputPath;
}

// ── Audio duration via ffprobe ─────────────────────────────────────────────
function getAudioDuration(audioPath) {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", audioPath
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("close", () => resolve(parseFloat(out.trim()) || 0));
  });
}

// ── Extract [start,end] segment from a source audio file ──────────────────
function extractSegment(srcPath, outPath, start, end) {
  return new Promise((resolve, reject) => {
    const args = [
      "-ss", String(start),
      "-i", srcPath,
      "-t", String(Math.max(0.05, end - start)),
      "-c", "copy",
      "-avoid_negative_ts", "make_zero",
      "-y", outPath
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg segment failed: ${stderr.slice(-500)}`));
      resolve(outPath);
    });
  });
}

// ── Convert any audio file to mp3 (used by engines that emit wav) ──────────
function toMp3(srcPath, outPath) {
  return new Promise((resolve, reject) => {
    if (srcPath === outPath) return resolve(outPath);
    const proc = spawn("ffmpeg", [
      "-y", "-i", srcPath, "-c:a", "libmp3lame", "-q:a", "4", outPath
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg toMp3 failed: ${stderr.slice(-500)}`));
      resolve(outPath);
    });
  });
}

// ── Unified single-call TTS dispatch ───────────────────────────────────────
// Returns { audioPath, wordTimings: [{word,start,end}] | null }
async function generateFull(text, outputPath, options = {}) {
  const ttsType = options.ttsType || "edge";
  const mp3Path = outputPath.replace(/\.[^.]+$/, "") + ".mp3";

  if (ttsType === "edge") {
    const r = await generateWithTimings(text, mp3Path, {
      voice: options.voice || "default",
      rate: options.rate || "+0%"
    });
    return { audioPath: r.audioPath, wordTimings: r.wordTimings };
  }

  if (ttsType === "google") {
    const wavPath = mp3Path.replace(/\.mp3$/, ".wav");
    await textToSpeech(text, wavPath, {
      voice: options.voice || "male",
      speakingRate: options.speakingRate || 0.95
    });
    await toMp3(wavPath, mp3Path);
    return { audioPath: mp3Path, wordTimings: null };
  }

  if (ttsType === "kokoro") {
    const wavPath = mp3Path.replace(/\.mp3$/, ".wav");
    const voice = (options.voice && !/^(male|female)$/i.test(options.voice))
      ? options.voice : (process.env.KOKORO_VOICE || "af_msa");
    await generateKokoro(text, wavPath, {
      voice,
      langCode: options.langCode || process.env.KOKORO_LANG_CODE || "ar",
      speed: options.speed || 0.9
    });
    await toMp3(wavPath, mp3Path);
    return { audioPath: mp3Path, wordTimings: null };
  }

  if (ttsType === "piper") {
    const wavPath = mp3Path.replace(/\.mp3$/, ".wav");
    const voice = (options.voice && !/^(male|female)$/i.test(options.voice))
      ? options.voice : (process.env.PIPER_VOICE || "ar_JO-kareem-medium");
    await generatePiper(text, wavPath, {
      voice,
      speed: options.speed || 1.1
    });
    await toMp3(wavPath, mp3Path);
    return { audioPath: mp3Path, wordTimings: null };
  }

  throw new Error(`Unknown ttsType: ${ttsType}`);
}

// ── Whole-script narration TTS → split into per-scene segments ────────────
// Generates the ENTIRE narration in one TTS call (natural prosody, no silence
// gaps between scenes), then cuts the single audio file into per-scene pieces.
// Returns the SAME contract as the old generateSceneAudio:
//   { audioPaths: [path|null], timingsList: [[{word,start,end}]|null] }
async function generateFullNarration(scenes, jobId, options = {}) {
  const audioDir = path.join(__dirname, `../temp/${jobId}/audio`);
  fs.mkdirSync(audioDir, { recursive: true });

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
  try {
    result = await generateFull(fullText, fullPath, { ...options, ttsType });
  } catch (e) {
    // Graceful fallback so a video is still produced even if the chosen
    // engine (kokoro/piper) fails to load its model.
    if (ttsType !== "edge") {
      console.warn(`⚠️ ${ttsType} TTS failed (${e.message}) — falling back to edge`);
      usedEngine = "edge";
      result = await generateFull(fullText, fullPath, { ...options, ttsType: "edge" });
    } else {
      throw e;
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
      const cleanFull = sceneTexts.map((t) => stripTashkeel(t)).join(" ");
      globalTimings = await alignWordsWhisper(result.audioPath, cleanFull, { language: "ar" });
    } catch (e) {
      console.warn(`⚠️ whisper alignment failed (${e.message}) — using length-proportional timings`);
      globalTimings = null;
    }
  }

  if (globalTimings && globalTimings.length) {
    const totalW = globalTimings.length;
    let wi = 0;
    for (let i = 0; i < sceneTexts.length; i++) {
      const sceneId = scenes[i].id != null ? scenes[i].id : i + 1;
      const segPath = path.join(audioDir, `scene_${sceneId}.mp3`);
      const take = (i === sceneTexts.length - 1)
        ? (totalW - wi)
        : Math.max(1, Math.round((sceneWordCounts[i] / totalClean) * totalW));
      const seg = globalTimings.slice(wi, wi + take);
      wi += take;

      if (!seg.length) {
        // No whisper words for this scene → length-proportional fallback.
        const { start, end } = ranges[i];
        await extractSegment(result.audioPath, segPath, start, end);
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
      await extractSegment(result.audioPath, segPath, aStart, aEnd);
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
    for (let i = 0; i < sceneTexts.length; i++) {
      const { start, end } = ranges[i];
      const sceneId = scenes[i].id != null ? scenes[i].id : i + 1;
      const segPath = path.join(audioDir, `scene_${sceneId}.mp3`);
      await extractSegment(result.audioPath, segPath, start, end);

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

  return { audioPaths, timingsList, engine: usedEngine };
}

// ── Legacy: per-scene Google TTS (deprecated) ─────────────────────────────
async function generateAllAudio(scenes, jobId, { voice = "male", speakingRate = 0.95 } = {}) {
  const audioDir = path.join(__dirname, `../temp/${jobId}/audio`);
  fs.mkdirSync(audioDir, { recursive: true });

  const results = await Promise.all(
    scenes.map(async (scene) => {
      try {
        const filePath = path.join(audioDir, `scene_${scene.id}.mp3`);
        await textToSpeech(scene.narration, filePath, { voice, speakingRate });
        return filePath;
      } catch (e) {
        console.warn(`⚠️ Audio skipped scene ${scene.id}: ${e.message}`);
        return null;
      }
    })
  );

  return results;
}

// ── Legacy: per-scene TTS (deprecated; use generateFullNarration) ─────────
async function generateSceneAudio(scenes, jobId, options = {}) {
  const audioDir = path.join(__dirname, `../temp/${jobId}/audio`);
  fs.mkdirSync(audioDir, { recursive: true });

  const ttsType = options.ttsType || "edge";
  const results = await Promise.all(
    scenes.map(async (scene) => {
      try {
        const filePath = path.join(audioDir, `scene_${scene.id}.mp3`);
        const out = await generateFull(scene.narration, filePath, { ...options, ttsType });
        return { audioPath: out.audioPath, wordTimings: out.wordTimings || null };
      } catch (e) {
        console.warn(`⚠️ Audio skipped scene ${scene.id} (${ttsType}): ${e.message}`);
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
  generateFull, generateFullNarration, getAudioDuration, toMp3
};

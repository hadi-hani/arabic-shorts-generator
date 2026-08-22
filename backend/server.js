const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const { generateScript, generateCaptions, PLATFORM_CONFIGS } = require("./services/gemini");
const { generateAllAudio, generateSceneAudio } = require("./services/tts");
const { fetchAllImages }   = require("./services/pexels");
const { renderVideo }      = require("./services/renderer");

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use("/output", express.static(path.join(__dirname, "output")));
app.use(express.static(path.join(__dirname, "public")));

// ─── Job Store (persisted to disk) ────────────────────────────────────────────
const JOBS_FILE = path.join(__dirname, "data", "jobs.json");
fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true });

let jobs = {};
try {
  const raw = fs.readFileSync(JOBS_FILE, "utf8");
  jobs = JSON.parse(raw);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, job] of Object.entries(jobs)) {
    if (job.createdAt && job.createdAt < cutoff) delete jobs[id];
    if (job.status === "processing") {
      jobs[id] = { status: "error", message: "Server was restarted during processing" };
    }
  }
  console.log(`💾 Loaded ${Object.keys(jobs).length} jobs from disk`);
} catch (_) {
  jobs = {};
}

function saveJobs() {
  try { fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2)); } catch (e) {
    console.warn("⚠️ Could not save jobs:", e.message);
  }
}

const VIDEO_TTL_MS = (parseInt(process.env.VIDEO_TTL_HOURS, 10) || 24) * 60 * 60 * 1000;

function setJob(jobId, data) {
  const createdAt = jobs[jobId]?.createdAt || Date.now();
  jobs[jobId] = {
    ...data,
    createdAt,
    expiresAt: createdAt + VIDEO_TTL_MS
  };
  saveJobs();
}

function validatePlatforms(platforms) {
  if (!Array.isArray(platforms)) return [];
  const valid = ["tt", "yt", "fb", "ig"];
  return platforms.filter(p => valid.includes(p));
}

// ─── Font validation ─────────────────────────────────────────────────────────
const VALID_FONTS = ["NotoSansArabic"];
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function sanitizeFontOptions(options = {}) {
  const fontName = VALID_FONTS.includes(options.fontName) ? options.fontName : "NotoSansArabic";
  const fontSize =
    options.fontSize != null &&
    Number.isFinite(Number(options.fontSize)) &&
    Number(options.fontSize) >= 20 &&
    Number(options.fontSize) <= 160
      ? Math.round(Number(options.fontSize))
      : null;
  const color = (v, fallback) =>
    typeof v === "string" &&
    (HEX_RE.test(v) || /^rgba?\([^)]+\)$/i.test(v) || /^[a-z]+$/i.test(v))
      ? v
      : fallback;
  return {
    fontName,
    fontSize,
    fontColor: color(options.fontColor, "white"),
    borderColor: color(options.borderColor, "black"),
    borderWidth:
      options.borderWidth != null &&
      Number.isFinite(Number(options.borderWidth)) &&
      Number(options.borderWidth) >= 0 &&
      Number(options.borderWidth) <= 12
        ? Math.round(Number(options.borderWidth))
        : 5,
    backgroundColor:
      options.backgroundColor != null && String(options.backgroundColor).trim() !== ""
        ? String(options.backgroundColor).trim()
        : null
  };
}

// ─── Core Video Pipeline ───────────────────────────────────────────────────────
async function runPipeline(topic, jobId, platforms, options = {}) {
  const { ttsType = "edge", subtitleMode = "word", enableSubtitles = true, voice, enableTashkeel = true } = options;
  const fontOptions = sanitizeFontOptions(options);

  setJob(jobId, { status: "processing", step: "🤖 Gemini يولّد السكريبت...", platforms });
  const script = await generateScript(topic, platforms, { enableTashkeel });

  setJob(jobId, { status: "processing", step: "🖼️ جلب الصور من Pexels...", platforms });
  const imageUrls = await fetchAllImages(script.scenes);

  setJob(jobId, { status: "processing", step: `🔊 توليد الصوت (${ttsType})...`, platforms });
  const { audioPaths, timingsList } = await generateSceneAudio(script.scenes, jobId, {
    ttsType,
    voice: ttsType === "edge" ? (voice || "default") : (voice || "male"),
    speakingRate: 0.95
  });

  const outputDir = path.join(__dirname, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const audioUrls = audioPaths.map((ap, i) => {
    if (ap && fs.existsSync(ap)) {
      const dest = path.join(outputDir, `${jobId}_audio_${i}.mp3`);
      fs.copyFileSync(ap, dest);
      return `/output/${jobId}_audio_${i}.mp3`;
    }
    return null;
  });

  setJob(jobId, { status: "processing", step: "🎥 FFmpeg يبني الفيديو...", platforms });
  const { finalPath, srtPath } = await renderVideo({
    script, imageUrls, audioPaths, wordTimingsList: timingsList,
    subtitleMode, enableSubtitles, jobId,
    fontName: fontOptions.fontName, fontOptions
  });

  const wordCount = (timingsList || []).reduce((acc, t) => acc + (Array.isArray(t) ? t.length : 0), 0);
  const duration = await getVideoDuration(finalPath);

  const result = {
    status: "done",
    title: script.title,
    videoUrl: `/output/${jobId}.mp4`,
    videoPath: finalPath,
    subtitlesUrl: srtPath ? `/output/${jobId}.srt` : null,
    metadata: { ttsType, subtitleMode, enableSubtitles, enableTashkeel, wordCount, duration, ...fontOptions },
    scenes: script.scenes.map((sc, i) => ({ ...sc, imageUrl: imageUrls[i], audioUrl: audioUrls[i] })),
    platforms: script.platforms || {}
  };

  setJob(jobId, result);
  return result;
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

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Returns { status: "ok" }
 */
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

/**
 * POST /api/generate  (also aliased as /api/video for backward compatibility)
 * Body:     { topic: string, platforms?: ["tt","yt","fb","ig"],
 *             ttsType?: "edge"|"google", subtitleMode?: "word"|"sentence"|"progressive",
 *             enableSubtitles?: boolean, enableTashkeel?: boolean, voice?: string,
 *             fontName?: "NotoSansArabic",
 *             fontSize?: number (20-160), fontColor?: "#RRGGBB"|name,
 *             borderColor?: "#RRGGBB"|name, borderWidth?: number (0-12),
 *             backgroundColor?: "#RRGGBB"|"rgba(...)"|null }
 * Response: { jobId, title, videoUrl, downloadUrl, statusUrl, captions,
 *             subtitlesUrl, metadata }
 *
 * Generates a full Arabic short video and returns download + caption links.
 * platforms defaults to ["tt","yt","fb","ig"] if omitted.
 * ttsType defaults to "edge"; subtitleMode defaults to "word"; enableSubtitles defaults to true.
 * enableTashkeel defaults to true (selective diacritics for TTS pronunciation; on-screen subtitles stay clean).
 * fontName defaults to "NotoSansArabic"; borderWidth defaults to 5; fontColor "white"; borderColor "black".
 * Takes ~1-3 minutes depending on video length.
 */
app.post("/api/generate", videoRouteHandler);
app.post("/api/video", videoRouteHandler);   // alias — documented in README
async function videoRouteHandler(req, res) {
  const { topic, platforms, ttsType, subtitleMode, enableSubtitles, voice, enableTashkeel, fontName, fontSize, fontColor, borderColor, borderWidth, backgroundColor } = req.body;
  if (!topic) return res.status(400).json({ error: "topic is required" });

  const validPlatforms = validatePlatforms(platforms);
  const targetPlatforms = validPlatforms.length > 0 ? validPlatforms : ["tt", "yt", "fb", "ig"];
  const jobId = uuidv4();

  const options = {
    ttsType: ttsType === "google" ? "google" : "edge",
    subtitleMode: ["word", "sentence", "progressive"].includes(subtitleMode) ? subtitleMode : "word",
    enableSubtitles: enableSubtitles !== false,
    enableTashkeel: enableTashkeel !== false,
    voice: voice || undefined,
    fontName, fontSize, fontColor, borderColor, borderWidth, backgroundColor
  };

  setJob(jobId, { status: "processing", step: "🤖 Gemini يولّد السكريبت...", platforms: targetPlatforms });

  try {
    const result = await runPipeline(topic, jobId, targetPlatforms, options);

    const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const captions = {};
    for (const [platform, data] of Object.entries(result.platforms)) {
      captions[platform] = {
        caption:  data.caption || data.description || "",
        hashtags: data.hashtags || []
      };
    }

    return res.json({
      jobId,
      title:       result.title,
      videoUrl:    `${base}${result.videoUrl}`,
      downloadUrl: `${base}${result.videoUrl}`,
      statusUrl:   `${base}/api/status/${jobId}`,
      subtitlesUrl: result.subtitlesUrl ? `${base}${result.subtitlesUrl}` : null,
      metadata:    result.metadata,
      captions
    });
  } catch (err) {
    console.error("❌ /api/video error:", err.message);
    setJob(jobId, { status: "error", message: err.message });
    return res.status(500).json({ error: err.message });
  }
}


/**
 * GET /api/status/:jobId
 * Returns current job status: processing | done | error
 */
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "processing" && job.expiresAt && Date.now() > job.expiresAt) {
    return res.json({ ...job, status: "expired", message: "انتهت صلاحية الفيديو وحُذف تلقائياً" });
  }
  if (job.status === "done") {
    const videoPath = path.join(__dirname, "output", `${req.params.jobId}.mp4`);
    if (!fs.existsSync(videoPath)) {
      return res.json({ ...job, status: "expired", message: "انتهت صلاحية الفيديو وحُذف تلقائياً" });
    }
  }
  res.json(job);
});

// ─── Auto-cleanup: delete videos older than VIDEO_TTL_HOURS ───────────────────
function cleanupExpired() {
  const outputDir = path.join(__dirname, "output");
  const now = Date.now();
  let removed = 0;
  for (const [id, job] of Object.entries(jobs)) {
    const expiresAt = job.expiresAt || (job.createdAt ? job.createdAt + VIDEO_TTL_MS : 0);
    if (expiresAt && now > expiresAt) {
      for (const ext of [".mp4", ".srt", ".ass", ".json"]) {
        const fp = path.join(outputDir, id + ext);
        if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); removed++; } catch (e) {} }
      }
      if (job.status !== "expired") { job.status = "expired"; saveJobs(); }
    }
  }
  // fallback: remove any orphaned files older than TTL by mtime
  try {
    for (const file of fs.readdirSync(outputDir)) {
      const fp = path.join(outputDir, file);
      if (fs.statSync(fp).mtimeMs < now - VIDEO_TTL_MS) { fs.unlinkSync(fp); removed++; }
    }
  } catch (e) {}
  if (removed > 0) console.log(`🧹 Auto-cleaned ${removed} expired output file(s)`);
}
cleanupExpired();
setInterval(cleanupExpired, 60 * 60 * 1000);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));

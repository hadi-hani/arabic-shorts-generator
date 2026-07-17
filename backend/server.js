const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const { generateScript, generateCaptions, PLATFORM_CONFIGS } = require("./services/gemini");
const { generateAllAudio } = require("./services/tts");
const { fetchAllImages }   = require("./services/pexels");
const { renderVideo }      = require("./services/renderer");

const app = express();
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

function setJob(jobId, data) {
  jobs[jobId] = { ...data, createdAt: jobs[jobId]?.createdAt || Date.now() };
  saveJobs();
}

function validatePlatforms(platforms) {
  if (!Array.isArray(platforms)) return [];
  const valid = ["tt", "yt", "fb", "ig"];
  return platforms.filter(p => valid.includes(p));
}

// ─── Core Video Pipeline ───────────────────────────────────────────────────────
async function runPipeline(topic, jobId, platforms) {
  setJob(jobId, { status: "processing", step: "🤖 Gemini يولّد السكريبت...", platforms });
  const script = await generateScript(topic, platforms);

  setJob(jobId, { status: "processing", step: "🖼️ جلب الصور من Pexels...", platforms });
  const imageUrls = await fetchAllImages(script.scenes);

  setJob(jobId, { status: "processing", step: "🔊 توليد الصوت...", platforms });
  const audioPaths = await generateAllAudio(script.scenes, jobId, { voice: "male", speakingRate: 0.95 });

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
  const finalPath = await renderVideo({ script, imageUrls, audioPaths, jobId });

  const result = {
    status: "done",
    title: script.title,
    videoUrl: `/output/${jobId}.mp4`,
    videoPath: finalPath,
    scenes: script.scenes.map((sc, i) => ({ ...sc, imageUrl: imageUrls[i], audioUrl: audioUrls[i] })),
    platforms: script.platforms || {}
  };

  setJob(jobId, result);
  return result;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Returns { status: "ok" }
 */
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

/**
 * POST /api/generate  (also aliased as /api/video for backward compatibility)
 * Body:     { topic: string, platforms?: ["tt","yt","fb","ig"] }
 * Response: { jobId, title, videoUrl, downloadUrl, statusUrl, captions }
 *
 * Generates a full Arabic short video and returns download + caption links.
 * platforms defaults to ["tt","yt","fb","ig"] if omitted.
 * Takes ~1-3 minutes depending on video length.
 */
app.post("/api/generate", videoRouteHandler);
app.post("/api/video", videoRouteHandler);   // alias — documented in README
async function videoRouteHandler(req, res) {
  const { topic, platforms } = req.body;
  if (!topic) return res.status(400).json({ error: "topic is required" });

  const validPlatforms = validatePlatforms(platforms);
  const targetPlatforms = validPlatforms.length > 0 ? validPlatforms : ["tt", "yt", "fb", "ig"];
  const jobId = uuidv4();

  setJob(jobId, { status: "processing", step: "🤖 Gemini يولّد السكريبت...", platforms: targetPlatforms });

  try {
    const result = await runPipeline(topic, jobId, targetPlatforms);

    const base = `${req.protocol}://${req.get("host")}`;
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
  res.json(job);
});

// ─── Auto-cleanup output files older than 48h ──────────────────────────────────
setInterval(() => {
  const outputDir = path.join(__dirname, "output");
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  try {
    let removed = 0;
    for (const file of fs.readdirSync(outputDir)) {
      const fp = path.join(outputDir, file);
      if (fs.statSync(fp).mtimeMs < cutoff) { fs.unlinkSync(fp); removed++; }
    }
    if (removed > 0) console.log(`🧹 Auto-cleaned ${removed} old output files`);
  } catch (e) {
    console.warn("⚠️ Cleanup error:", e.message);
  }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));

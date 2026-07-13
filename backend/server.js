const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const { generateScript, generateCaptions, PLATFORM_CONFIGS } = require("./services/gemini");
const { generateAllAudio } = require("./services/elevenlabs");
const { fetchAllImages }   = require("./services/pexels");
const { renderVideo }      = require("./services/renderer");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/output", express.static(path.join(__dirname, "output")));

// #6 FIX: Persist jobs to disk so restarts don't lose state
const JOBS_FILE = path.join(__dirname, "data", "jobs.json");
fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true });

let jobs = {};
try {
  const raw = fs.readFileSync(JOBS_FILE, "utf8");
  jobs = JSON.parse(raw);
  // Only keep jobs from last 24 hours
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, job] of Object.entries(jobs)) {
    if (job.createdAt && job.createdAt < cutoff) delete jobs[id];
    // Drop stale "processing" jobs from previous server instance
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
  if (!platforms) return [];
  if (!Array.isArray(platforms)) return [];
  const valid = ["tt", "yt", "fb", "ig"];
  return platforms.filter(p => valid.includes(p));
}

async function runPipeline(topic, jobId, platforms, { voice = "male", speakingRate = 0.95 } = {}) {
  setJob(jobId, { status: "processing", step: "🤖 Gemini يولّد السكريبت...", platforms });
  const script = await generateScript(topic, platforms);

  setJob(jobId, { status: "processing", step: "🖼️ جلب صور الخلفية من Pexels...", platforms });
  const imageUrls = await fetchAllImages(script.scenes);

  setJob(jobId, { status: "processing", step: `🔊 توليد الصوت (${voice})...`, platforms });
  const audioPaths = await generateAllAudio(script.scenes, jobId, { voice, speakingRate });

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

  setJob(jobId, { status: "processing", step: "🎥 FFmpeg يبني الفيديو النهائي...", platforms });
  const finalPath = await renderVideo({ script, imageUrls, audioPaths, jobId });

  const result = {
    status: "done",
    title: script.title,
    hashtags: script.hashtags,
    videoUrl: `/output/${jobId}.mp4`,
    videoPath: finalPath,
    scenes: script.scenes.map((sc, i) => ({
      ...sc,
      imageUrl: imageUrls[i],
      audioUrl: audioUrls[i]
    }))
  };

  if (script.platforms && Object.keys(script.platforms).length > 0) {
    result.platforms = script.platforms;
  }

  setJob(jobId, result);
  return result;
}

// GET /api/health
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// GET /api/platforms
app.get("/api/platforms", (req, res) => {
  const info = Object.entries(PLATFORM_CONFIGS).map(([code, cfg]) => ({
    code, name: cfg.name, maxChars: cfg.maxChars, hashtagCount: cfg.hashtagCount
  }));
  res.json({ platforms: info });
});

// #8 NEW: GET /api/preview — generate script only, no video, fast
// Body: { topic: string, platforms?: [...] }
app.post("/api/preview", async (req, res) => {
  const { topic, platforms } = req.body;
  if (!topic) return res.status(400).json({ error: "topic is required" });
  try {
    const validPlatforms = validatePlatforms(platforms);
    const script = await generateScript(topic, validPlatforms);
    return res.json({ topic, script });
  } catch (err) {
    console.error("Preview error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/generate — async pipeline
// Body: { topic, platforms?, voice?, speakingRate? }
app.post("/api/generate", async (req, res) => {
  const { topic, platforms, voice, speakingRate } = req.body;
  if (!topic) return res.status(400).json({ error: "topic is required" });

  const validPlatforms = validatePlatforms(platforms);
  const jobId = uuidv4();
  setJob(jobId, { status: "processing", step: "🤖 Gemini يولّد السكريبت...", platforms: validPlatforms });
  res.json({ jobId, platforms: validPlatforms });

  (async () => {
    try {
      await runPipeline(topic, jobId, validPlatforms, {
        voice: voice || "male",
        speakingRate: speakingRate ? Math.min(1.5, Math.max(0.5, Number(speakingRate))) : 0.95
      });
    } catch (err) {
      console.error("Pipeline error:", err.message);
      setJob(jobId, { status: "error", message: err.message });
    }
  })();
});

// POST /api/generate-sync
app.post("/api/generate-sync", async (req, res) => {
  const { topic, filename, platforms, voice, speakingRate } = req.body;
  if (!topic) return res.status(400).json({ error: "topic is required" });

  const validPlatforms = validatePlatforms(platforms);
  const jobId = uuidv4();
  setJob(jobId, { status: "processing", step: "🤖 Gemini يولّد السكريبت...", platforms: validPlatforms });

  try {
    const result = await runPipeline(topic, jobId, validPlatforms, {
      voice: voice || "male",
      speakingRate: speakingRate ? Math.min(1.5, Math.max(0.5, Number(speakingRate))) : 0.95
    });
    if (result.platforms) {
      res.setHeader("X-Platforms-Captions", Buffer.from(JSON.stringify(result.platforms)).toString("base64"));
    }
    const downloadName = (filename || `${jobId}.mp4`).replace(/[^a-zA-Z0-9._-]/g, "_");
    return res.download(result.videoPath, downloadName);
  } catch (err) {
    console.error("Sync pipeline error:", err.message);
    setJob(jobId, { status: "error", message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/status/:jobId
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// POST /api/captions
app.post("/api/captions", async (req, res) => {
  const { topic, platforms } = req.body;
  if (!topic) return res.status(400).json({ error: "topic is required" });

  const validPlatforms = validatePlatforms(platforms);
  const targetPlatforms = validPlatforms.length > 0 ? validPlatforms : ["tt", "yt", "fb", "ig"];

  try {
    const result = await generateCaptions(topic, targetPlatforms);
    return res.json({ topic, ...result });
  } catch (err) {
    console.error("Captions error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});


// POST /api/video — simple endpoint: topic + platforms -> videoUrl + previewUrl + captions
// Body: { topic: string, platforms?: ["tt","yt","fb","ig"] }
// Response: { jobId, videoUrl, previewUrl, downloadUrl, captions: { tt: {...}, yt: {...}, ... } }
app.post("/api/video", async (req, res) => {
  const { topic, platforms } = req.body;
  if (!topic) return res.status(400).json({ error: "topic is required" });

  const validPlatforms = validatePlatforms(platforms);
  const targetPlatforms = validPlatforms.length > 0 ? validPlatforms : ["tt", "yt", "fb", "ig"];
  const jobId = uuidv4();

  setJob(jobId, { status: "processing", step: "🤖 Gemini يولّد السكريبت...", platforms: targetPlatforms });

  try {
    const result = await runPipeline(topic, jobId, targetPlatforms, { voice: "male", speakingRate: 0.95 });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const videoUrl    = `${baseUrl}${result.videoUrl}`;
    const previewUrl  = `${baseUrl}/api/status/${jobId}`;
    const downloadUrl = `${baseUrl}${result.videoUrl}`;

    const captions = {};
    if (result.platforms) {
      for (const [platform, data] of Object.entries(result.platforms)) {
        captions[platform] = {
          caption: data.caption || data.description || "",
          hashtags: data.hashtags || []
        };
      }
    }

    return res.json({
      jobId,
      title: result.title,
      videoUrl,
      previewUrl,
      downloadUrl,
      captions
    });
  } catch (err) {
    console.error("Video endpoint error:", err.message);
    setJob(jobId, { status: "error", message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// #3 CRON: Auto-cleanup output files older than 48 hours (runs every hour)
setInterval(() => {
  const outputDir = path.join(__dirname, "output");
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  try {
    const files = fs.readdirSync(outputDir);
    let removed = 0;
    for (const file of files) {
      const fp = path.join(outputDir, file);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fp);
        removed++;
      }
    }
    if (removed > 0) console.log(`🧹 Auto-cleaned ${removed} old output files`);
  } catch (e) {
    console.warn("⚠️ Cleanup error:", e.message);
  }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));

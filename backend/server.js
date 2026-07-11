const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const { generateScript, PLATFORM_CONFIGS } = require("./services/gemini");
const { generateAllAudio } = require("./services/elevenlabs");
const { fetchAllImages }   = require("./services/pexels");
const { renderVideo }      = require("./services/renderer");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/output", express.static(path.join(__dirname, "output")));

const jobs = {};

// Validate platforms array — only allow: tt, yt, fb, ig
function validatePlatforms(platforms) {
  if (!platforms) return [];
  if (!Array.isArray(platforms)) return [];
  const valid = ["tt", "yt", "fb", "ig"];
  return platforms.filter(p => valid.includes(p));
}

async function runPipeline(topic, jobId, platforms) {
  jobs[jobId].step = "🤖 Gemini يولّد السكريبت...";
  const script = await generateScript(topic, platforms);

  jobs[jobId].step = "🖼️ جلب صور الخلفية من Pexels...";
  const imageUrls = await fetchAllImages(script.scenes);

  jobs[jobId].step = "🔊 توليد الصوت بالعربية...";
  const audioPaths = await generateAllAudio(script.scenes, jobId);

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

  jobs[jobId].step = "🎥 FFmpeg يبني الفيديو النهائي...";
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

  // Attach platform captions if generated
  if (script.platforms && Object.keys(script.platforms).length > 0) {
    result.platforms = script.platforms;
  }

  jobs[jobId] = result;
  return result;
}

// GET /api/health
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// GET /api/platforms — list supported platforms
app.get("/api/platforms", (req, res) => {
  const info = Object.entries(PLATFORM_CONFIGS).map(([code, cfg]) => ({
    code,
    name: cfg.name,
    maxChars: cfg.maxChars,
    hashtagCount: cfg.hashtagCount
  }));
  res.json({ platforms: info });
});

// POST /api/generate — async
// Body: { topic: string, platforms?: ["tt","yt","fb","ig"] }
app.post("/api/generate", async (req, res) => {
  const { topic, platforms } = req.body;
  if (!topic) return res.status(400).json({ error: "topic is required" });

  const validPlatforms = validatePlatforms(platforms);
  const jobId = uuidv4();
  jobs[jobId] = { status: "processing", step: "🤖 Gemini يولّد السكريبت...", platforms: validPlatforms };
  res.json({ jobId, platforms: validPlatforms });

  (async () => {
    try {
      await runPipeline(topic, jobId, validPlatforms);
    } catch (err) {
      console.error("Pipeline error:", err.message);
      jobs[jobId] = { status: "error", message: err.message };
    }
  })();
});

// POST /api/generate-sync — synchronous, returns video file directly
// Body: { topic: string, filename?: string, platforms?: ["tt","yt","fb","ig"] }
app.post("/api/generate-sync", async (req, res) => {
  const { topic, filename, platforms } = req.body;
  if (!topic) return res.status(400).json({ error: "topic is required" });

  const validPlatforms = validatePlatforms(platforms);
  const jobId = uuidv4();
  jobs[jobId] = { status: "processing", step: "🤖 Gemini يولّد السكريبت...", platforms: validPlatforms };

  try {
    const result = await runPipeline(topic, jobId, validPlatforms);
    // Return platforms captions in response header as JSON (base64 to avoid header encoding issues)
    if (result.platforms) {
      res.setHeader("X-Platforms-Captions", Buffer.from(JSON.stringify(result.platforms)).toString("base64"));
    }
    const downloadName = (filename || `${jobId}.mp4`).replace(/[^a-zA-Z0-9._-]/g, "_");
    return res.download(result.videoPath, downloadName);
  } catch (err) {
    console.error("Sync pipeline error:", err.message);
    jobs[jobId] = { status: "error", message: err.message };
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/status/:jobId
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`\u2705 Backend running on port ${PORT}`));

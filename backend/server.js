const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const { generateScript }   = require("./services/gemini");
const { generateAllAudio } = require("./services/elevenlabs");
const { fetchAllImages }   = require("./services/pexels");
const { renderVideo }      = require("./services/renderer");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/output", express.static(path.join(__dirname, "output")));

const jobs = {};

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.post("/api/generate", async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: "topic is required" });

  const jobId = uuidv4();
  jobs[jobId] = { status: "processing", step: "🤖 Gemini يولّد السكريبت..." };
  res.json({ jobId });

  (async () => {
    try {
      jobs[jobId].step = "🤖 Gemini يولّد السكريبت...";
      const script = await generateScript(topic);

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
      await renderVideo({ script, imageUrls, audioPaths, jobId });

      jobs[jobId] = {
        status: "done",
        title: script.title,
        hashtags: script.hashtags,
        videoUrl: `/output/${jobId}.mp4`,
        scenes: script.scenes.map((sc, i) => ({
          ...sc,
          imageUrl: imageUrls[i],
          audioUrl: audioUrls[i]
        }))
      };
    } catch (err) {
      console.error("Pipeline error:", err.message);
      jobs[jobId] = { status: "error", message: err.message };
    }
  })();
});

app.get("/api/status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));

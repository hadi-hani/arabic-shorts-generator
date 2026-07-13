# Arabic Shorts Generator 🎥

> **Generate ready-to-publish Arabic short videos (Shorts / Reels / TikToks) with a single API call.**

Provide a topic → get back a vertical 1080×1920 MP4 video + platform-optimized captions for TikTok, YouTube Shorts, Facebook, and Instagram — fully automated.

---

## How It Works

```
POST /api/video  { "topic": "..." }
        │
        ├── Gemini AI     → Arabic script + hashtags
        ├── Google TTS    → Arabic voiceover (per scene)
        ├── Pexels API    → background images
        └── FFmpeg        → 1080×1920 MP4 with Ken Burns + subtitles
```

---

## API Reference

### `POST /api/video`
Generates a complete short video. Takes **1–3 minutes** depending on length.

**Request**
```json
{
  "topic": "فوائد شرب الماء",
  "platforms": ["tt", "yt", "fb", "ig"]   // optional — defaults to all four
}
```

**Platform codes**
| Code | Platform |
|------|----------|
| `tt` | TikTok |
| `yt` | YouTube Shorts |
| `fb` | Facebook Reels |
| `ig` | Instagram Reels |

**Response**
```json
{
  "jobId":      "e2a3e447-...",
  "title":      "الماء سر الحياة: فوائد مذهلة!",
  "videoUrl":   "http://your-host/output/e2a3e447-....mp4",
  "downloadUrl":"http://your-host/output/e2a3e447-....mp4",
  "statusUrl":  "http://your-host/api/status/e2a3e447-...",
  "captions": {
    "tt": { "caption": "...", "hashtags": [] },
    "yt": { "caption": "...", "hashtags": [] }
  }
}
```

---

### `GET /api/status/:jobId`
Check the status of a running or completed job.

**Response — while processing**
```json
{ "status": "processing", "step": "🤖 Gemini يولّد السكريبت..." }
```

**Response — done**
```json
{ "status": "done", "title": "...", "videoUrl": "/output/....mp4", ... }
```

**Response — error**
```json
{ "status": "error", "message": "..." }
```

---

### `GET /api/health`
```json
{ "status": "ok" }
```

---

## Running with Docker

### 1. Clone the repo
```bash
git clone https://github.com/hadihani/arabic-shorts-generator.git
cd arabic-shorts-generator
```

### 2. Set environment variables
Create `backend/.env`:
```env
GEMINI_API_KEY=your_gemini_key
GOOGLE_TTS_KEY=your_google_tts_key
PEXELS_API_KEY=your_pexels_key
```
> ⚠️ Never commit `.env` to Git. It’s already in `.gitignore`.

### 3. Build & run
```bash
# Build the backend image
docker build -t arabic-shorts-backend ./backend

# Run (maps container port 80 → host port 8282)
docker run -d \
  --name arabic-shorts \
  -p 8282:80 \
  --env-file ./backend/.env \
  -v $(pwd)/backend/output:/app/output \
  -v $(pwd)/backend/temp:/app/temp \
  arabic-shorts-backend
```

### 4. Test it
```bash
# Health check
curl http://localhost:8282/api/health

# Generate a video
curl -X POST http://localhost:8282/api/video \
  -H 'Content-Type: application/json' \
  -d '{ "topic": "فوائد شرب الماء", "platforms": ["tt", "yt"] }'
```

---

## Project Structure

```
arabic-shorts-generator/
└── backend/
    ├── server.js          # Express API (3 endpoints)
    ├── services/
    │   ├── gemini.js        # Script + captions generation
    │   ├── elevenlabs.js    # Arabic TTS (Google TTS)
    │   ├── pexels.js        # Background image search
    │   └── renderer.js      # FFmpeg video builder
    ├── Dockerfile         # nginx + node + supervisor
    ├── nginx.conf         # Proxy config (600s timeout)
    ├── supervisord.conf   # Process manager
    ├── package.json
    ├── output/            # Generated MP4 files (auto-cleaned after 48h)
    └── temp/              # Temporary audio files
```

---

## Requirements

| Service | Used for | Free tier? |
|---------|----------|------------|
| [Google Gemini API](https://aistudio.google.com/) | Script + captions | ✅ Yes |
| [Google Cloud TTS](https://cloud.google.com/text-to-speech) | Arabic voiceover | ✅ 1M chars/month |
| [Pexels API](https://www.pexels.com/api/) | Background images | ✅ Yes |

---

## Notes

- Video generation is **synchronous** — the request stays open until the video is ready (up to 3 min). Make sure your HTTP client has a long enough timeout.
- Generated videos are **auto-deleted after 48 hours** to save disk space.
- The container runs **nginx** (port 80) as a reverse proxy in front of **Node.js** (port 3001), managed by **supervisord**.

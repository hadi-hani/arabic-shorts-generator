# Arabic Shorts Generator 🎥

> **Generate ready-to-publish Arabic short videos (Shorts / Reels / TikToks) with a single API call.**

Provide a topic → get back a vertical 1080×1920 MP4 video + platform-optimized captions for TikTok, YouTube Shorts, Facebook, and Instagram — fully automated.

---

## How It Works

```
POST /api/generate  { "topic": "..." }
        │
        ├── Gemini AI     → Arabic script + hashtags
        ├── Google TTS    → Arabic voiceover (per scene)
        ├── Pexels API    → background images
        └── FFmpeg        → 1080×1920 MP4 with Ken Burns + subtitles
```

---

## Quick Start (Any Server)

### 1. Prerequisites
- [Docker](https://docs.docker.com/get-docker/) (for containerized deployment)
- API keys from:
  - [Google Gemini API](https://aistudio.google.com/) — free tier available
  - [Google Cloud TTS](https://cloud.google.com/text-to-speech) — 1M chars/month free
  - [Pexels API](https://www.pexels.com/api/) — free

### 2. Clone & Configure

```bash
git clone https://github.com/hadi-hani/arabic-shorts-generator.git
cd arabic-shorts-generator

# Create environment file with your API keys
cp .env.example backend/.env
# Then edit backend/.env with your real keys
```

### 3. Build & Run (Single Container)

```bash
# Option A: Using docker-compose (recommended)
docker compose up -d

# Option B: Using plain docker
docker build -t arabic-shorts-generator .
docker run -d \
  --name arabic-shorts \
  -p 8282:80 \
  --env-file ./backend/.env \
  -v $(pwd)/backend/output:/app/output \
  -v $(pwd)/backend/temp:/app/temp \
  arabic-shorts-generator
```

### 4. Open in Browser

Visit **http://localhost:8282** — you'll see the Arabic UI.

### 5. Test the API

```bash
# Health check
curl http://localhost:8282/api/health

# Generate a short video
curl -X POST http://localhost:8282/api/generate \
  -H 'Content-Type: application/json' \
  -d '{ "topic": "فوائد شرب الماء", "platforms": ["tt", "yt"] }'
```

---

## API Reference

### `POST /api/generate` (also `POST /api/video`)
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

## Push to Docker Hub (CI/CD)

The repository includes a **GitHub Actions** workflow (`.github/workflows/docker-publish.yml`) that automatically builds and pushes to Docker Hub on every push to `main`.

To enable it:
1. Add these **secrets** to your GitHub repo (Settings → Secrets and variables → Actions):
   - `DOCKERHUB_USERNAME` — your Docker Hub username
   - `DOCKERHUB_TOKEN` — a Docker Hub access token
2. Push to `main` — the action builds and tags as `yourusername/arabic-shorts-generator:latest`

Then on any server:
```bash
docker run -d \
  --name arabic-shorts \
  -p 8282:80 \
  -e GEMINI_API_KEY=your_key \
  -e GOOGLE_TTS_KEY=your_key \
  -e PEXELS_API_KEY=your_key \
  yourusername/arabic-shorts-generator:latest
```

---

## Project Structure

```
arabic-shorts-generator/
├── Dockerfile                # Single combined image (nginx + node + ffmpeg)
├── docker-compose.yml        # One-command deployment
├── .env.example              # Template for API keys
├── .github/workflows/
│   └── docker-publish.yml    # Auto-build & push to Docker Hub on push
│
├── backend/
│   ├── server.js             # Express API (3 endpoints: generate, status, health)
│   ├── package.json
│   ├── nginx.conf            # Reverse proxy config (600s timeout)
│   ├── supervisord.conf      # Manages nginx + node processes
│   ├── Dockerfile            # Alternative base image (same structure)
│   │
│   ├── services/
│   │   ├── gemini.js         # Script + captions generation via Google Gemini
│   │   ├── tts.js            # Text-to-Speech via Google Cloud TTS
│   │   ├── pexels.js         # Background image search via Pexels
│   │   └── renderer.js       # FFmpeg video builder (Ken Burns + ASS subtitles)
│   │
│   ├── public/
│   │   └── index.html        # Frontend UI (Arabic interface)
│   │
│   ├── output/               # Generated MP4 files (auto-cleaned after 48h)
│   ├── temp/                 # Temporary audio/image segments
│   └── data/                 # Job persistence (jobs.json)
│
├── frontend/
│   ├── Dockerfile            # Standalone nginx container (alternative)
│   └── index.html            # Same UI (alternative deployment)
│
└── deploy.sh                 # Production deploy script (VPS with hot-reload)
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | ✅ | Google Gemini API key (script + captions) |
| `GOOGLE_TTS_KEY` | ✅ | Google Cloud TTS API key (voiceover) |
| `PEXELS_API_KEY` | ✅ | Pexels API key (background images) |
| `PORT` | ❌ | Backend port (default: 3001) |

Create `backend/.env` (already in `.gitignore`):
```env
GEMINI_API_KEY=your_gemini_key
GOOGLE_TTS_KEY=your_google_tts_key
PEXELS_API_KEY=your_pexels_key
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
- Arabic subtitles use **Noto Sans Arabic** font (included in the image) with ASS subtitle format for smooth rendering.
- Job state is **persisted to disk** (`backend/data/jobs.json`) — restarts won't lose in-progress jobs.

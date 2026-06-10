# Arabic Shorts Generator

مولد فيديوهات Shorts عربية باستخدام:
- Gemini لتوليد السكريبت
- Google TTS لتوليد الصوت العربي
- Pexels لجلب الصور
- FFmpeg لبناء الفيديو النهائي
- Ken Burns animations للحركة الديناميكية
- Nginx proxy لحل مشاكل CORS

## Features
- واجهة عربية بسيطة
- توليد فيديو عمودي 1080x1920
- Subtitles في المنتصف
- تحميل مباشر لملف MP4
- عرض progress أثناء التوليد
- Preview للمشاهد والصوت

## Run with Docker

```bash
docker build -t shorts-generator-backend ./backend
docker build -t shorts-generator-frontend ./frontend

docker network create shorts-net

docker run -d --name shorts-backend --network shorts-net -p 3002:3001 \
  -e GEMINI_API_KEY=YOUR_KEY \
  -e GOOGLE_TTS_KEY=YOUR_KEY \
  -e PEXELS_API_KEY=YOUR_KEY \
  -v $(pwd)/backend/output:/app/output \
  -v $(pwd)/backend/temp:/app/temp \
  shorts-generator-backend

docker run -d --name shorts-frontend --network shorts-net -p 8181:80 \
  shorts-generator-frontend
```

## Open
- Frontend: http://localhost:8181
- API Health: http://localhost:8181/api/health

## Notes
انسخ مفاتيح API الخاصة بك ولا ترفعها إلى GitHub.

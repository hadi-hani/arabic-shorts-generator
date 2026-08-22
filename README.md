# Arabic Shorts Generator 🎥

> **مولّد فيديوهات قصيرة عربية جاهزة للنشر** (Shorts / Reels / TikTok) — بطلب واحد من الـ API.

اكتب موضوعاً بالعربية → تحصل على فيديو عمودي بدقة 1080×1920 بصوت عربي وترجمة متحركة + أوصاف جاهزة للنشر على تيك توك ويوتيوب شورتس وفيسبوك وإنستغرام — كل شيء تلقائياً.

---

## كيف يعمل؟ 🤔

```
POST /api/generate  { "topic": "فوائد شرب الماء" }
        │
        ├── Gemini AI    →  السيناريو + الأوصاف + الهاشتاغات
        ├── Edge TTS     →  صوت عربي + توقيت كل كلمة (بدون مفتاح API)
        ├── Pexels       →  صور خلفية للفيديو
        └── FFmpeg       →  فيديو 1080×1920 مع حركة Ken Burns + ترجمة ASS
```

---

## المتطلبات قبل البدء

| الخدمة | الاستخدام | مفتاح API؟ |
|--------|-----------|------------|
| [Google Gemini](https://aistudio.google.com/) | توليد السيناريو والأوصاف | ✅ مطلوب (باقة مجانية متوفرة) |
| [Pexels](https://www.pexels.com/api/) | صور الخلفية | ✅ مطلوب (مجاني) |
| [Google Cloud TTS](https://cloud.google.com/text-to-speech) | صوت بديل (وضع قديم) | ❌ اختياري — لا يُستخدم افتراضياً |

> **ملاحظة مهمة**: الوضع الافتراضي للصوت هو **Edge TTS** من مايكروسوفت — **لا يحتاج أي مفتاح API**. يكفيك مفتاحان فقط (Gemini + Pexels) لتشغيل المشروع بالكامل.

---

## البدء السريع 🚀

### 1. تجهيز المفاتيح

1. احصل على مفتاح من [Google Gemini](https://aistudio.google.com/)
2. احصل على مفتاح من [Pexels](https://www.pexels.com/api/)

### 2. تنزيل المشروع وتجهيزه

```bash
git clone https://github.com/hadi-hani/arabic-shorts-generator.git
cd arabic-shorts-generator

# انسخ ملف المفاتيح ثم املأه بمفاتيحك الحقيقية
cp .env.example backend/.env
nano backend/.env   # ضع مفاتيحك هنا
```

### 3. التشغيل (حاوية واحدة)

```bash
# الخيار الموصى به
docker compose up -d
```

أو عبر docker مباشرة:

```bash
docker build -t arabic-shorts-generator .
docker run -d \
  --name arabic-shorts \
  -p 8282:80 \
  --env-file ./backend/.env \
  -v $(pwd)/backend/output:/app/output \
  -v $(pwd)/backend/temp:/app/temp \
  arabic-shorts-generator
```

### 4. فتح الواجهة

افتح المتصفح على: **http://localhost:8282**

ستجد واجهة عربية كاملة: اكتب الموضوع، اختر المنصات والإعدادات، واضغط «توليد».

### 5. تجربة الـ API عبر cURL

أمر واحد يكفي لتوليد فيديو كامل:

```bash
curl -X POST http://localhost:8282/api/generate \
  -H 'Content-Type: application/json' \
  -d '{ "topic": "فوائد شرب الماء" }'
```

> التوليد يستغرق **1-3 دقائق** — اجعل مهلة الـ HTTP طويلة كفاية. أمثلة أكثر (بكل الخيارات، متابعة الحالة، فحص الصحة) في [مرجع الـ API](#مرجع-ال-api--دليل-curl-شامل).

---

## مرجع الـ API 📡 — دليل cURL شامل

الخادم يوفر 4 دوال:

| الطريقة | المسار | الوصف |
|---------|--------|-------|
| `POST` | `/api/generate` | توليد فيديو كامل (الاسم القديم `/api/video` يعمل أيضاً) |
| `GET` | `/api/status/:jobId` | متابعة حالة مهمة |
| `GET` | `/api/health` | فحص صحة الخادم |

---

### `POST /api/generate` — توليد فيديو

ينشئ فيديو عمودياً (1080×1920) بصوت عربي وترجمة متحركة وأوصاف جاهزة للنشر.

**① الحد الأدنى — فيديو فقط:**
```bash
curl -X POST http://localhost:8282/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"topic":"فوائد شرب الماء"}'
```

**② بكل الخيارات — الشرح مدمج داخل الأوامر:**
```bash
curl -X POST http://localhost:8282/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "topic": "فوائد شرب الماء",            // مطلوب — موضوع الفيديو بالعربية
    "platforms": ["tt", "yt"],            // المنصات المطلوبة أوصافها: tt/yt/fb/ig — الحذف = الأربع كلها
    "ttsType": "edge",                    // محرك الصوت: edge (بدون مفتاح) | google (يتطلب مفتاحاً)
    "subtitleMode": "progressive",        // نمط الترجمة: word | sentence | progressive (الافتراضي: word)
    "enableSubtitles": true,              // تفعيل الترجمة على الفيديو
    "enableTashkeel": true,               // تشكيل السرد لتحسين النطق — للصوت فقط والترجمة تبقى نظيفة
    "voice": "ar-SA-Zariyah",             // الصوت: مع edge اسم مختصر مثل ar-SA-Zariyah — مع google: male/female
    "fontName": "NotoSansArabic",         // الخط الوحيد المتاح — مقبول للتوافق لكنه بلا تأثير
    "fontSize": 60,                       // حجم الخط 20-160 — الحذف = تلقائي
    "fontColor": "#FFD700",               // لون النص — "#RRGGBB" أو اسم
    "borderColor": "#000000",             // لون الحدود حول النص
    "borderWidth": 3,                     // سمك الحدود 0-12
    "backgroundColor": "rgba(0,0,0,0.5)"  // خلفية شبه شفافة للنص — الحذف = بدون خلفية
  }'
```

**③ قراءة الطلب من ملف JSON بدل الكتابة الطويلة:**
```bash
# أنشئ ملف payload.json بالمحتوى السابق ثم:
curl -X POST http://localhost:8282/api/generate \
  -H 'Content-Type: application/json' \
  -d @payload.json
```

> `platforms` يحدد **أي المنصات تُولَّد أوصافها** — الحذف = الأربع كلها، `[]` فارغ = فيديو فقط بدون أوصاف.

**الاستجابة:**
```json
{
  "jobId": "e2a3e447-...",
  "title": "الماء سر الحياة: فوائد مذهلة!",
  "videoUrl": "http://your-host/output/e2a3e447-....mp4",
  "downloadUrl": "http://your-host/output/e2a3e447-....mp4",
  "statusUrl": "http://your-host/api/status/e2a3e447-...",
  "subtitlesUrl": "http://your-host/output/e2a3e447-....srt",
  "metadata": {
    "ttsType": "edge",
    "subtitleMode": "word",
    "enableSubtitles": true,
    "enableTashkeel": true,
    "wordCount": 30,
    "duration": 20.5,
    "fontName": "NotoSansArabic",
    "fontSize": null,
    "fontColor": "white",
    "borderColor": "black",
    "borderWidth": 5,
    "backgroundColor": null
  },
  "captions": {
    "tt": { "caption": "...", "hashtags": ["#ماء", "..."] },
    "yt": { "caption": "...", "hashtags": ["#ماء", "..."] }
  }
}
```

> `captions` يحتوي أوصاف المنصات التي حددتها في الطلب فقط — إذا لم تحدد أي منصة فسيكون فارغاً `{}`.

---

### `GET /api/status/:jobId` — متابعة المهمة

استخدم الـ `jobId` من الاستجابة السابقة:

```bash
curl http://localhost:8282/api/status/e2a3e447-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**أثناء المعالجة:**
```json
{ "status": "processing", "step": "🤖 Gemini يولّد السكريبت..." }
```

**عند الاكتمال:**
```json
{ "status": "done", "title": "...", "videoUrl": "/output/....mp4", ... }
```

**عند الخطأ:**
```json
{ "status": "error", "message": "..." }
```

---

### `GET /api/health` — فحص الصحة

```bash
curl http://localhost:8282/api/health
```

**الاستجابة:**
```json
{ "status": "ok" }
```

---

## متغيرات البيئة 🔧

أنشئ ملف `backend/.env` (مُستثنى من git):

```env
GEMINI_API_KEY=your_gemini_key
PEXELS_API_KEY=your_pexels_key
# GOOGLE_TTS_KEY=your_google_tts_key   # فقط إذا استخدمت ttsType: "google"
# GEMINI_MODEL=gemini-2.5-flash        # اختياري — يفرض نموذجاّ محدداً بدل السلسلة الافتراضية

# رابط الـ API العام (مهم جداً للنشر على خادم حقيقي):
# PUBLIC_BASE_URL=https://shorts.example.com

# مدة بقاء الفيديوهات قبل الحذف التلقائي بالساعات (الافتراضي: 24)
# VIDEO_TTL_HOURS=24
```

| المتغير | مطلوب؟ | الوصف |
|---------|--------|-------|
| `GEMINI_API_KEY` | ✅ | مفتاح Google Gemini (السيناريو والأوصاف) |
| `PEXELS_API_KEY` | ✅ | مفتاح Pexels (صور الخلفية) |
| `GOOGLE_TTS_KEY` | ❌ | مطلوب فقط عند استخدام `ttsType: "google"` |
| `GEMINI_MODEL` | ❌ | نموذج محدد؛ يُجرَّب أولاً قبل سلسلة النماذج الافتراضية |
| `PUBLIC_BASE_URL` | ❌ | **مهم!** الرابط العام للمشروع (مثل `https://shorts.example.com`). بدونه تُستخدم `req.protocol + req.host` التي قد تكون خاطئة خلف reverse proxy |
| `VIDEO_TTL_HOURS` | ❌ | عدد الساعات قبل حذف الفيديو تلقائياً (الافتراضي: 24). الصفر = غير مُحدّد |
| `PORT` | ❌ | منفذ الخادم (افتراضي: 3001) |

> **سلسلة النماذج الافتراضية** في `gemini.js`: تُجرَّب بالترتيب `gemini-2.5-flash` ← `gemini-2.0-flash` ← `gemini-2.0-flash-lite`، مع إعادة محاولة تلقائية عند ضغط الاستخدام.

---

## بنية المشروع 📁

```
arabic-shorts-generator/
├── Dockerfile                # صورة واحدة متكاملة (nginx + node + ffmpeg)
├── docker-compose.yml        # تشغيل بأمر واحد
├── .env.example              # قالب المفاتيح
├── deploy.sh                 # سكربت نشر على خادم (رفع + تطبيق فوري)
├── .github/workflows/
│   └── docker-publish.yml    # بناء ونشر تلقائي إلى Docker Hub عند كل push
│
├── backend/                  # الخادم الرئيسي
│   ├── server.js             # واجهة Express API (توليد، حالة، صحة)
│   ├── package.json
│   ├── nginx.conf            # إعداد nginx (مهلة 600 ثانية)
│   ├── supervisord.conf      # إدارة عمليتي nginx + node
│   ├── Dockerfile            # صورة بديلة (نفس البنية)
│   │
│   ├── services/
│   │   ├── gemini.js         # السيناريو والأوصاف عبر Gemini
│   │   ├── tts.js            # مدخل الصوت الموحد (Edge + Google القديم)
│   │   ├── edge_tts.js       # Edge TTS + توقيت كل كلمة
│   │   ├── word_aligner.js   # محاذاة الكلمات + بناء ASS/SRT (3 أنماط)
│   │   ├── pexels.js         # البحث عن صور الخلفية
│   │   └── renderer.js       # بناء الفيديو (Ken Burns + ترجمة + الخطوط)
│   │
│   ├── fonts/                # الخط العربي المضمّن (Noto Sans Arabic)
│   │   └── README.md         # مصدر الخط وترخيصه
│   │
│   ├── FONTS.md              # مرجع خط الـ API
│   │
│   ├── public/
│   │   └── index.html        # الواجهة العربية (نسخة العمل الرئيسية)
│   │
│   ├── output/               # ملفات الفيديو (تُحذف تلقائياً بعد 48 ساعة)
│   ├── temp/                 # ملفات مؤقتة (صوت/صور)
│   └── data/                 # حفظ حالات المهام (jobs.json)
│
├── frontend/                 # واجهة بديلة (حاوية nginx مستقلة)
│   ├── Dockerfile
│   ├── nginx.conf            # يعيد التوجيه إلى خادم الواجهة الخلفية
│   └── index.html            # نفس الواجهة (نسخة مكررة)
│
└── .gitignore
```

> نسختا الواجهة (`backend/public/index.html` و `frontend/index.html`) متطابقتان — تُحدَّثان معاً.

---

## النشر على Docker Hub (CI/CD) ⚙️

يوجد workflow جاهز (`docker-publish.yml`) يبني الصورة ويرفعها إلى Docker Hub تلقائياً عند كل push إلى `main`.

لتفعيله:
1. أضف سرّين في GitHub (Settings → Secrets → Actions):
   - `DOCKERHUB_USERNAME` — اسم مستخدم Docker Hub
   - `DOCKERHUB_TOKEN` — رمز وصول من Docker Hub
2. ادفع إلى `main` — سيُبنى ويُرفع بوسم `yourusername/arabic-shorts-generator:latest`

ثم على أي خادم:

```bash
docker run -d \
  --name arabic-shorts \
  -p 8282:80 \
  -e GEMINI_API_KEY=your_key \
  -e PEXELS_API_KEY=your_key \
  -e GOOGLE_TTS_KEY=your_key \
  -e PUBLIC_BASE_URL=https://shorts.example.com \
  -e VIDEO_TTL_HOURS=24 \
  -v $(pwd)/backend/output:/app/output \
  -v $(pwd)/backend/temp:/app/temp \
  -v $(pwd)/backend/data:/app/data \
  yourusername/arabic-shorts-generator:latest
```

---

## ملاحظات 📌

- التوليد **متزامن** — يبقى الطلب مفتوحاً حتى جاهزية الفيديو (حتى 3 دقائق). اجعل مهلة الـ HTTP طويلة كفاية.
- الملفات المُولَّدة **تُحذف تلقائياً بعد 24 ساعة** (أو عدد الساعات المحدد في `VIDEO_TTL_HOURS`) لتوفير مساحة القرص.
- داخل الحاوية يعمل **nginx (منفذ 80)** كوسيط أمام **Node.js (منفذ 3001)**، ويديرهما **supervisord**.
- الترجمة العربية تُرسم عبر ASS/libass بالخط المضمّن — لا حاجة لتثبيت خطوط على النظام.
- حالة المهام **تُحفظ على القرص** (`backend/data/jobs.json`) — إعادة تشغيل الخادم لا تُفقد المهام الجارية.
- عند استخدام `PUBLIC_BASE_URL` تأكد من أنه يحتوي على بروتوكول كامل (مثل `https://shorts.example.com`) وليس فيه `/` في النهاية.

---

## الترخيص 📄

- الكود: استخدمه بحرية.
- الخطوط المضمّنة بترخيص **SIL OFL 1.1** (استخدام تجاري مسموح) — التفاصيل في [`backend/fonts/README.md`](backend/fonts/README.md).
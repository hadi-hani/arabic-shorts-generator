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

**فحص الصحة:**
```bash
curl http://localhost:8282/api/health
```

**أبسط طلب — توليد فيديو:**
```bash
curl -X POST http://localhost:8282/api/generate \
  -H 'Content-Type: application/json' \
  -d '{ "topic": "فوائد شرب الماء" }'
```

> التوليد يستغرق **1-3 دقائق** — اجعل مهلة الـ HTTP طويلة كفاية.

---

## مرجع الـ API 📡 — دليل cURL شامل

### نظرة سريعة على الدوال

| الدالة | الطريقة | المسار | الوصف |
|--------|---------|--------|-------|
| توليد فيديو | `POST` | `/api/generate` | ينشئ فيديو كاملاً ويعيد الروابط والأوصاف |
| (اسم قديم) | `POST` | `/api/video` | نفس الدالة السابقة للتوافق |
| حالة مهمة | `GET` | `/api/status/:jobId` | متابعة حالة مهمة جارية أو منتهية |
| فحص الصحة | `GET` | `/api/health` | التأكد أن الخادم يعمل |

---

### `POST /api/generate` — توليد فيديو

ينشئ فيديو عمودياً (1080×1920) بصوت عربي وترجمة متحركة وأوصاف جاهزة للنشر.

**جميع معاملات الطلب:**
| المعامل | النوع | الافتراضي | الوصف |
|---------|-------|-----------|-------|
| `topic` | string | — | **مطلوب** — موضوع الفيديو بالعربية |
| `platforms` | string[] | `["tt","yt","fb","ig"]` | المنصات المطلوبة أوصافها: `tt` (TikTok) `yt` (YouTube Shorts) `fb` (Facebook Reels) `ig` (Instagram Reels) |
| `ttsType` | string | `edge` | محرك الصوت: `edge` (بدون مفتاح) أو `google` (يتطلب مفتاحاً) |
| `subtitleMode` | string | `word` | نمط الترجمة: `word` (كلمة بكلمة) `sentence` (جمل كاملة) `progressive` (تدريجي) |
| `enableSubtitles` | boolean | `true` | تفعيل الترجمة على الفيديو |
| `enableTashkeel` | boolean | `true` | تشكيل السرد لتحسين النطق (للصوت فقط — الترجمة تبقى نظيفة) |
| `voice` | string | متغير | الصوت. مع `edge`: اسم مختصر مثل `ar-SA-Zariyah` (تُضاف `Neural` تلقائياً). مع `google`: `male` أو `female` |
| `fontName` | string | `NotoSansArabic` | الخط الوحيد المتاح — مقبول للتوافق مع الطلبات القديمة لكنه بلا تأثير |
| `fontSize` | number | `null` (تلقائي) | حجم الخط من 20 إلى 160 |
| `fontColor` | string | `white` | لون النص: `#RRGGBB` أو اسم |
| `borderColor` | string | `black` | لون الحدود حول النص |
| `borderWidth` | number | `5` | سمك الحدود من 0 إلى 12 |
| `backgroundColor` | string | `null` | خلفية شبه شفافة للنص: `#RRGGBB` أو `rgba(r,g,b,a)` |

---

#### أمثلة cURL عملية

**① الحد الأدنى — الفيديو فقط بدون أوصاف:**
```bash
curl -X POST http://localhost:8282/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"topic":"فوائد شرب الماء"}'
```

**② فيديو + أوصاف لمنصة أو منصتين:**
```bash
curl -X POST http://localhost:8282/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"topic":"فوائد شرب الماء","platforms":["tt","yt"]}'
```

**③ بكل الخيارات (صوت/ترجمة/تنسيق):**
```bash
curl -X POST http://localhost:8282/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "topic": "فوائد شرب الماء",
    "platforms": ["tt", "yt", "fb", "ig"],
    "ttsType": "edge",
    "subtitleMode": "progressive",
    "enableSubtitles": true,
    "enableTashkeel": true,
    "voice": "ar-SA-Zariyah",
    "fontName": "NotoSansArabic",
    "fontSize": 60,
    "fontColor": "#FFD700",
    "borderColor": "#000000",
    "borderWidth": 3,
    "backgroundColor": "rgba(0,0,0,0.5)"
  }'
```

**④ قراءة الطلب من ملف JSON بدل الكتابة الطويلة:**
```bash
# أنشئ ملف payload.json بالمحتوى السابق ثم:
curl -X POST http://localhost:8282/api/generate \
  -H 'Content-Type: application/json' \
  -d @payload.json
```

> `platforms` يحدد **أي المنصات تُولَّد أوصافها** — إذا حذفته فتُولَّد أوصاف للأربع كلها، وإذا أرسلته فارغاً `[]` فالفيديو فقط بدون أوصاف.

---

#### مثال الاستجابة

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

استخدم الـ `jobId` من الاستجابة السابقة لمعرفة حالة المهمة:

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
# GEMINI_MODEL=gemini-2.5-flash        # اختياري — يفرض نموذجاً محدداً بدل السلسلة الافتراضية
```

| المتغير | مطلوب؟ | الوصف |
|---------|--------|-------|
| `GEMINI_API_KEY` | ✅ | مفتاح Google Gemini (السيناريو والأوصاف) |
| `PEXELS_API_KEY` | ✅ | مفتاح Pexels (صور الخلفية) |
| `GOOGLE_TTS_KEY` | ❌ | مطلوب فقط عند استخدام `ttsType: "google"` |
| `GEMINI_MODEL` | ❌ | نموذج محدد؛ يُجرَّب أولاً قبل سلسلة النماذج الافتراضية |
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
  yourusername/arabic-shorts-generator:latest
```

---

## ملاحظات 📌

- التوليد **متزامن** — يبقى الطلب مفتوحاً حتى جاهزية الفيديو (حتى 3 دقائق). اجعل مهلة الـ HTTP طويلة كفاية.
- الملفات المُولَّدة **تُحذف تلقائياً بعد 48 ساعة** لتوفير مساحة القرص.
- داخل الحاوية يعمل **nginx (منفذ 80)** كوسيط أمام **Node.js (منفذ 3001)**، ويديرهما **supervisord**.
- الترجمة العربية تُرسم عبر ASS/libass بالخط المضمّن — لا حاجة لتثبيت خطوط على النظام.
- حالة المهام **تُحفظ على القرص** (`backend/data/jobs.json`) — إعادة تشغيل الخادم لا تُفقد المهام الجارية.

---

## الترخيص 📄

- الكود: استخدمه بحرية.
- الخطوط المضمّنة بترخيص **SIL OFL 1.1** (استخدام تجاري مسموح) — التفاصيل في [`backend/fonts/README.md`](backend/fonts/README.md).
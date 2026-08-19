# الخطوط العربية المدعومة

يدعم مولّد الفيديو خطاً عربياً واحداً احترافياً يُحرق على الفيديو عبر libass (ASS subtitles).
الخط مضمّن محلياً في `backend/fonts/` فلا يحتاج النظام إلى تثبيته.

## الخط المتاح

| القيمة (API) | الخط | النوع |
|--------------|------|-------|
| `NotoSansArabic` | Noto Sans Arabic — شامل ومقروء | **افتراضي (الوحيد)** |

## الاستخدام في API

```json
{
  "topic": "٣ نصائح لتصوير الفيديو بالهاتف",
  "fontName": "NotoSansArabic",
  "fontSize": 60,
  "fontColor": "#FFD700",
  "borderColor": "#000000",
  "borderWidth": 3,
  "backgroundColor": "rgba(0,0,0,0.5)"
}
```

### القيم المسموحة

| الحقل | الافتراضي | المدى/القيم |
|-------|-----------|-------------|
| `fontName` | `NotoSansArabic` | `NotoSansArabic` (الوحيد) |
| `fontSize` | تلقائي (حسب طول النص) | عدد صحيح من 20 إلى 160 — عند الحذف يبقى تلقائياً |
| `fontColor` | `white` | لون: `#RRGGBB` أو اسم (white/black/yellow/red/green/blue/gold) |
| `borderColor` | `black` | لون: `#RRGGBB` أو اسم |
| `borderWidth` | `5` | عدد صحيح من 0 إلى 12 |
| `backgroundColor` | `null` | `#RRGGBB` أو `rgba(r,g,b,a)` — عند إرساله تظهر خلفية شبه شفافة؛ `null` لإزالتها |

### ملاحظات

- عند حذف `fontSize` يستخدم المولّد الحجم التلقائي الذي يضبط كل كلمة لضمان المقروئية (سلوك سابق، توافق عكسي).
- `borderWidth` الافتراضي `5` يحافظ على شكل الفيديوهات السابقة.
- الألوان بصيغة ASS تُحوَّل تلقائياً (`#RRGGBB` / `rgba()` → `&HAABBGGRR`).
- كل الخطوط بترخيص **SIL OFL 1.1** (استخدام تجاري مسموح) — انظر `backend/fonts/README.md` للمصادر.
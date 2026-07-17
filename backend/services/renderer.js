const { spawn } = require("child_process");
const fs   = require("fs");
const path = require("path");
const axios = require("axios");

async function downloadFile(url, destPath) {
  const response = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
  fs.writeFileSync(destPath, response.data);
}

function ffmpeg(args, logPath = null) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", d => (stderr += d.toString()));
    proc.on("close", code => {
      if (logPath) { try { fs.writeFileSync(logPath, stderr); } catch (_) {} }
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

function getAudioDuration(audioPath) {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", audioPath
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", d => (out += d.toString()));
    proc.on("close", () => resolve(parseFloat(out.trim()) || 5));
  });
}

function getKenBurnsFilter(type, duration, fps = 25) {
  const totalFrames = Math.ceil(duration * fps * 1.3);
  switch (type % 4) {
    case 0: return `scale=2700:4800,zoompan=z='min(zoom+0.0008,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
    case 1: return `scale=2700:4800,zoompan=z='if(lte(zoom,1.0),1.25,max(1.001,zoom-0.0008))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
    case 2: return `scale=2700:4800,zoompan=z='1.12':x='min(iw-(iw/zoom),(on/${totalFrames})*(iw-(iw/zoom)))':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
    case 3: return `scale=2700:4800,zoompan=z='1.12':x='max(0,(iw-(iw/zoom))*(1-on/${totalFrames}))':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
  }
}

function resolveArabicFont() {
  const candidates = [
    // ── Alpine font-noto-arabic (confirmed path) ──────────────────
    "/usr/share/fonts/noto/NotoSansArabic-Bold.ttf",
    "/usr/share/fonts/noto/NotoSansArabic-SemiBold.ttf",
    "/usr/share/fonts/noto/NotoSansArabic-Medium.ttf",
    "/usr/share/fonts/noto/NotoSansArabic-Regular.ttf",
    // ── Noto Naskh Arabic (serif) ────────────────────────────────
    "/usr/share/fonts/noto/NotoNaskhArabic-Bold.ttf",
    "/usr/share/fonts/noto/NotoNaskhArabic-Regular.ttf",
    // ── Amiri — premium calligraphy (Dockerfile opt-in) ──────────
    "/usr/share/fonts/arabic/Amiri-Bold.ttf",
    "/usr/share/fonts/arabic/Amiri-Regular.ttf",
    // ── Debian/Ubuntu paths ───────────────────────────────────────
    "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf",
    // ── Windows paths (local dev) ────────────────────────────────
    "C:\\Windows\\Fonts\\arial.ttf",
    "C:\\Windows\\Fonts\\tahoma.ttf",
    "C:\\Windows\\Fonts\\trebuc.ttf",
    // ── Last resort (no Arabic shaping → boxes) ───────────────────
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"
  ];
  for (const f of candidates) {
    // Support simple glob for Noto wildcard path
    if (f.includes("*")) {
      try {
        const dir = path.dirname(f);
        const pattern = path.basename(f).replace(/\*/g, "");
        const match = fs.readdirSync(dir).find(n => n.includes(pattern.replace(/\.ttf$/, "")));
        if (match) { const full = path.join(dir, match); console.log(`🔤 Font (glob): ${full}`); return full; }
      } catch (_) {}
      continue;
    }
    if (fs.existsSync(f)) { console.log(`\uD83D\uDD24 Font: ${f}`); return f; }
  }
  console.warn("⚠️  No Arabic font found — subtitles may render as boxes. Add font-noto-arabic to Dockerfile.");
  return "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf";
}

// ─────────────────────────────────────────────────────────────
//  PROFESSIONAL ASS SUBTITLES GENERATOR
//  Style: Clean outlined text with fade-in
//  Font:  Arabic-capable font (resolved at runtime)
//  FX:    Smooth fade-in (300ms) per subtitle, no karaoke
// ─────────────────────────────────────────────────────────────

/**
 * Format seconds → ASS timestamp  h:mm:ss.cc
 */
function toASS(sec) {
  const h  = Math.floor(sec / 3600);
  const m  = Math.floor((sec % 3600) / 60);
  const s  = Math.floor(sec % 60);
  const cs = Math.round((sec % 1) * 100);
  return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;
}

/**
 * Group Arabic words into visual lines of max N chars
 * Preserves RTL word order — no reversal needed without karaoke tags
 */
function groupWordsIntoLines(text, maxChars = 18) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let cur = [];
  let curLen = 0;

  for (const word of words) {
    const addLen = word.length + (cur.length ? 1 : 0);
    if (curLen + addLen > maxChars && cur.length) {
      lines.push(cur.join(" "));
      cur = [word];
      curLen = word.length;
    } else {
      cur.push(word);
      curLen += addLen;
    }
  }
  if (cur.length) lines.push(cur.join(" "));

  return lines;
}

/**
 * Generate complete .ass subtitle file for one scene
 * No karaoke tags — full lines render as continuous Arabic text
 * so libass shapes letters correctly (connected, not منفصلة).
 * Uses BorderStyle=1 (outline) instead of opaque box for professional look.
 */
function generateASSFile({ text, startSec, durationSec, assPath, fontName }) {
  const visualLines = groupWordsIntoLines(text, 18);
  const fullText = visualLines.join("\\N"); // ASS \N = forced newline

  const s = toASS(startSec);
  const e = toASS(startSec + durationSec);

  // ASS header — style tuned for 1080x1920 vertical video
  // BorderStyle: 1 (outline) — clean look, doesn't block video content
  // Outline: 3, Shadow: 2 — good contrast on any background
  // Alignment: 2 (bottom-center) — standard for captions
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ArabicSubs,${fontName},84,&H00FFFFFF,&H00FFDD00,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,60,60,240,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,${s},${e},ArabicSubs,,0,0,0,,{\\fad(300,200)}‏${fullText}\n`;

  fs.writeFileSync(assPath, header, "utf8");
  return assPath;
}

// ─────────────────────────────────────────────────────────────
//  SCENE RENDERER
// ─────────────────────────────────────────────────────────────

async function renderScene({ scene, imageUrl, audioPath, jobId, index, total, fontFile, fontName, FPS }) {
  const workDir  = path.join(__dirname, `../temp/${jobId}`);
  const segOut   = path.join(workDir, `seg_${index}.mp4`);
  const imgPath  = path.join(workDir, `img_${index}.jpg`);
  const assPath  = path.join(workDir, `sub_${index}.ass`);
  const logPath  = path.join(workDir, `ffmpeg_${index}.log`);
  const hasAudio = audioPath && fs.existsSync(audioPath);

  let duration = scene.duration || 8;
  if (hasAudio) duration = await getAudioDuration(audioPath);

  if (imageUrl) {
    await downloadFile(imageUrl, imgPath);
  } else {
    await ffmpeg(["-f","lavfi","-i","color=c=black:s=1080x1920:d=1","-vframes","1","-y",imgPath]);
  }

  const kbFilter = getKenBurnsFilter(index, duration, FPS);

  // ── Generate ASS subtitle file ──
  const rawText = scene.narration || scene.caption || "";
  generateASSFile({
    text:        rawText,
    startSec:    0,           // relative to this scene
    durationSec: duration,
    assPath,
    fontName
  });

  // ── FFmpeg filter chain ──
  // 1. Ken Burns on image
  // 2. subtitles filter with ASS file (libass handles Arabic shaping + RTL + animation)
  // Note: on Windows, absolute paths contain `C:\` colons which conflict with FFmpeg `:` option separator.
  // We use a relative path (from CWD = backend/) to avoid colons entirely.
  const relAssPath = `temp/${jobId}/sub_${index}.ass`;
  const subFilter = `subtitles=${relAssPath}`;

  const filterComplex = `[0:v]${kbFilter},${subFilter}[vout]`;

  const ffArgs = [
    "-loop", "1", "-framerate", String(FPS), "-i", imgPath,
    ...(hasAudio ? ["-i", audioPath] : []),
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    ...(hasAudio ? ["-map", "1:a"] : ["-an"]),
    "-t", String(duration),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-r", String(FPS),
    ...(hasAudio ? ["-shortest"] : []),
    "-y", segOut
  ];

  await ffmpeg(ffArgs, logPath);
  console.log(`✅ Scene ${index+1}/${total} (${duration.toFixed(1)}s) KB-type:${index%4}`);
  return segOut;
}

// ─────────────────────────────────────────────────────────────
//  MAIN RENDER ENTRY
// ─────────────────────────────────────────────────────────────

async function renderVideo({ script, imageUrls, audioPaths, jobId }) {
  const workDir   = path.join(__dirname, `../temp/${jobId}`);
  const outputDir = path.join(__dirname, "../output");
  fs.mkdirSync(workDir,   { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const scenes   = script.scenes;
  const fontFile = resolveArabicFont();
  // Extract font name from path for ASS header (Amiri Bold → "Amiri Bold")
  const fontName = path.basename(fontFile, path.extname(fontFile))
    .replace(/-/g, " ")        // Amiri-Bold → Amiri Bold
    .replace(/\bRegular\b/,"") // drop "Regular" suffix
    .trim();
  const FPS = 25;

  console.log(`🔤 Using font: ${fontName} (${fontFile})`);
  console.log(`⏱️ Rendering ${scenes.length} scenes in parallel...`);
  const startTime = Date.now();

  const segmentPaths = await Promise.all(
    scenes.map((scene, i) => renderScene({
      scene,
      imageUrl:  imageUrls[i],
      audioPath: audioPaths[i],
      jobId, index: i, total: scenes.length, fontFile, fontName, FPS
    }))
  );

  console.log(`⏱️ Scenes done in ${((Date.now()-startTime)/1000).toFixed(1)}s`);

  const concatList  = path.join(workDir, "concat.txt");
  fs.writeFileSync(concatList, segmentPaths.map(p => `file '${p}'`).join("\n"));

  const finalOutput = path.join(outputDir, `${jobId}.mp4`);
  await ffmpeg([
    "-f","concat","-safe","0","-i",concatList,
    "-c","copy",
    "-movflags","+faststart","-y",finalOutput
  ]);

  const elapsed = ((Date.now()-startTime)/1000).toFixed(1);
  console.log(`🎬 Final video (${elapsed}s total): ${finalOutput}`);

  try {
    fs.rmSync(workDir, { recursive: true, force: true });
    console.log(`🧹 Cleaned temp dir: ${workDir}`);
  } catch (e) {
    console.warn(`⚠️ Cleanup failed: ${e.message}`);
  }

  return finalOutput;
}

module.exports = { renderVideo };

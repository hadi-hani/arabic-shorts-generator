const { spawn, execSync } = require("child_process");
const fs   = require("fs");
const path = require("path");
const axios = require("axios");
const { segmentCaptions, buildAssFile, buildSrt, stripTashkeel } = require("./word_aligner");

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

// ── Bundled Arabic fonts (backend/fonts) ─────────────────────────────────
// Font names are matched by fontconfig family name (libass resolves via fontsdir).
const FONT_MAP = {
  "NotoSansArabic": { family: "Noto Sans Arabic", file: "NotoSansArabic.ttf" }
};

function resolveFont(fontName) {
  const key = String(fontName || "").replace(/\s+/g, "");
  const entry = FONT_MAP[key] || FONT_MAP["NotoSansArabic"];
  const file = path.join(__dirname, "../fonts", entry.file);
  if (!fs.existsSync(file)) {
    console.warn(`⚠️ Font file missing: ${file} — falling back to fontconfig`);
    return { family: entry.family, file: resolveArabicFont() };
  }
  console.log(`🔤 Font: ${entry.family} (${file})`);
  return { family: entry.family, file };
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
  // 1) Prefer fontconfig to locate a real Arabic-capable font
  try {
    const fontFile = execSync("fc-match -f '%{file}' 'Noto Sans Arabic'", { encoding: "utf8" }).trim();
    if (fontFile && fs.existsSync(fontFile)) {
      console.log(`🔤 Font (fontconfig): ${fontFile}`);
      return fontFile;
    }
  } catch (_) {}
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
//  SCENE RENDERER
// ─────────────────────────────────────────────────────────────

async function renderScene({ scene, imageUrl, audioPath, wordTimings, subtitleMode, enableSubtitles, jobId, index, total, fontFamily, fontOptions, FPS }) {
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

  // ── Generate subtitle file (only when enabled) ──
  let subFilter = "";
  if (enableSubtitles !== false) {
    const rawText = scene.narration || scene.caption || "";
    // Audio is generated from the tashkeel'd narration (for correct TTS
    // pronunciation); the on-screen subtitle stays clean (diacritics removed).
    const displayText = stripTashkeel(rawText);
    const segments = segmentCaptions(wordTimings || [], displayText, {
      mode: subtitleMode || "word",
      duration
    });
    const assContent = buildAssFile(segments, {
      style: subtitleMode || "word",
      y: 1400,
      font: fontFamily,
      fontSize: fontOptions.fontSize,
      fontColor: fontOptions.fontColor,
      borderColor: fontOptions.borderColor,
      borderWidth: fontOptions.borderWidth,
      backgroundColor: fontOptions.backgroundColor
    });
    fs.writeFileSync(assPath, assContent, "utf8");

    // ── FFmpeg filter chain ──
    // 1. Ken Burns on image
    // 2. subtitles filter with ASS file (libass handles Arabic shaping + RTL + animation)
    //    fontsdir=<backend>/fonts makes the bundled Arabic fonts resolvable by name.
    // Note: on Windows, absolute paths contain `C:\` colons which conflict with FFmpeg `:` option separator.
    // We use a relative path (from CWD = backend/) to avoid colons entirely.
    const relAssPath = `temp/${jobId}/sub_${index}.ass`;
    subFilter = `,subtitles=${relAssPath}:fontsdir=fonts`;
  }

  const filterComplex = `[0:v]${kbFilter}${subFilter}[vout]`;

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

async function renderVideo({ script, imageUrls, audioPaths, wordTimingsList, subtitleMode, enableSubtitles, jobId, fontName, fontOptions = {} }) {
  const workDir   = path.join(__dirname, `../temp/${jobId}`);
  const outputDir = path.join(__dirname, "../output");
  fs.mkdirSync(workDir,   { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const scenes   = script.scenes;
  const { family: fontFamily } = resolveFont(fontName);
  const FPS = 25;

  console.log(`🔤 Using font: ${fontFamily} (${fontName})`);
  console.log(`🎨 Font options: ${JSON.stringify(fontOptions)}`);
  console.log(`⏱️ Rendering ${scenes.length} scenes in parallel...`);
  const startTime = Date.now();

  const segmentPaths = await Promise.all(
    scenes.map((scene, i) => renderScene({
      scene,
      imageUrl:  imageUrls[i],
      audioPath: audioPaths[i],
      wordTimings: wordTimingsList && wordTimingsList[i],
      subtitleMode,
      enableSubtitles,
      jobId, index: i, total: scenes.length, fontFamily, fontOptions, FPS
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

  // ── Build a combined .srt for the whole video (global timeline) ──
  const srtOutput = path.join(outputDir, `${jobId}.srt`);
  if (enableSubtitles !== false) {
    try {
      const allSegments = [];
      let offset = 0;
      for (let i = 0; i < scenes.length; i++) {
        const rawText = scenes[i].narration || scenes[i].caption || "";
        const displayText = stripTashkeel(rawText);
        const segs = segmentCaptions(wordTimingsList && wordTimingsList[i] || [], displayText, {
          mode: subtitleMode || "word",
          duration: await getAudioDuration(audioPaths[i]).catch(() => scenes[i].duration || 8)
        });
        for (const s of segs) {
          allSegments.push({
            words: s.words,
            start: s.start + offset,
            end: s.end + offset
          });
        }
        offset += await getAudioDuration(audioPaths[i]).catch(() => scenes[i].duration || 8);
      }
      fs.writeFileSync(srtOutput, buildSrt(allSegments), "utf8");
    } catch (e) {
      console.warn("⚠️ Could not build combined SRT:", e.message);
    }
  }

  const elapsed = ((Date.now()-startTime)/1000).toFixed(1);
  console.log(`🎬 Final video (${elapsed}s total): ${finalOutput}`);

  try {
    fs.rmSync(workDir, { recursive: true, force: true });
    console.log(`🧹 Cleaned temp dir: ${workDir}`);
  } catch (e) {
    console.warn(`⚠️ Cleanup failed: ${e.message}`);
  }

  return { finalPath: finalOutput, srtPath: enableSubtitles !== false ? srtOutput : null };
}

module.exports = { renderVideo };

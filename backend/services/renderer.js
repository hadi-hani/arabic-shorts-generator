const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

async function downloadFile(url, destPath) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  fs.writeFileSync(destPath, response.data);
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", d => (stderr += d.toString()));
    proc.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
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

function wrapText(text, maxChars = 24) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (test.length <= maxChars) { cur = test; }
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function getKenBurnsFilter(type, duration, fps = 25) {
  const totalFrames = Math.ceil(duration * fps);
  switch (type % 4) {
    case 0:
      return `scale=8000:-1,zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
    case 1:
      return `scale=8000:-1,zoompan=z='if(lte(zoom,1.0),1.5,max(1.001,zoom-0.0015))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
    case 2:
      return `scale=8000:-1,zoompan=z='min(zoom+0.001,1.3)':x='min(iw-(iw/zoom),on*2.5)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
    case 3:
      return `scale=8000:-1,zoompan=z='min(zoom+0.001,1.3)':x='max(0,iw-(iw/zoom)-on*2.5)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
  }
}

async function renderVideo({ script, imageUrls, audioPaths, jobId }) {
  const workDir = path.join(__dirname, `../temp/${jobId}`);
  const outputDir = path.join(__dirname, "../output");
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const scenes = script.scenes;
  const segments = [];
  const fontFile = "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf";
  const FPS = 25;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const imageUrl = imageUrls[i];
    const audioPath = audioPaths[i];
    const segOut = path.join(workDir, `seg_${i}.mp4`);
    const imgPath = path.join(workDir, `img_${i}.jpg`);
    const hasAudio = audioPath && fs.existsSync(audioPath);

    let duration = scene.duration || 8;
    if (hasAudio) duration = await getAudioDuration(audioPath);

    if (imageUrl) {
      await downloadFile(imageUrl, imgPath);
    } else {
      await ffmpeg(["-f","lavfi","-i",`color=c=black:s=1080x1920:d=1`,"-vframes","1","-y",imgPath]);
    }

    const kbFilter = getKenBurnsFilter(i, duration, FPS);
    const rawText = scene.narration || scene.caption || "";
    const safeT = (t) => t.replace(/\\/g,"\\\\").replace(/'/g,"\u2019").replace(/:/g,"\\:").replace(/\[/g,"\\[").replace(/\]/g,"\\]");
    const lines = wrapText(rawText, 24);
    const lineH = 66;
    const fSize = 52;
    const totalTH = lines.length * lineH;
    const baseY = 1920 - totalTH - 110;
    const bgH = totalTH + 44;
    const bgY = baseY - 22;

    const bgFilter = `drawbox=x=0:y=${bgY}:w=1080:h=${bgH}:color=black@0.55:t=fill`;
    const textFilters = lines.map((line, li) => {
      return `drawtext=text='${safeT(line)}':fontfile=${fontFile}:fontsize=${fSize}:fontcolor=white:borderw=2:bordercolor=black@0.8:x=(w-text_w)/2:y=${baseY + li * lineH}`;
    }).join(",");

    const filterComplex = `[0:v]${kbFilter},crop=1080:1920,${bgFilter},${textFilters}[vout]`;

    const ffArgs = [
      "-loop", "1", "-framerate", String(FPS), "-i", imgPath,
      ...(hasAudio ? ["-i", audioPath] : []),
      "-filter_complex", filterComplex,
      "-map", "[vout]",
      ...(hasAudio ? ["-map", "1:a"] : ["-an"]),
      "-t", String(duration),
      "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-r", String(FPS),
      ...(hasAudio ? ["-c:a","aac","-b:a","128k","-shortest"] : []),
      "-y", segOut
    ];

    await ffmpeg(ffArgs);
    segments.push(segOut);
  }

  const concatList = path.join(workDir, "concat.txt");
  fs.writeFileSync(concatList, segments.map(p => `file '${p}'`).join("\n"));
  const finalOutput = path.join(outputDir, `${jobId}.mp4`);
  await ffmpeg([
    "-f","concat","-safe","0","-i",concatList,
    "-c:v","libx264","-preset","fast","-crf","22",
    "-c:a","aac","-b:a","128k",
    "-movflags","+faststart","-y",finalOutput
  ]);

  return finalOutput;
}

module.exports = { renderVideo };

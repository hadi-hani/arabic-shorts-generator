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
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
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

// Ken Burns: use duration*1.3 safety margin so animation never freezes before audio ends
function getKenBurnsFilter(type, duration, fps = 25) {
  // Add 30% extra frames so zoom never reaches its end value before audio finishes
  const totalFrames = Math.ceil(duration * fps * 1.3);
  switch (type % 4) {
    case 0: // zoom in - slow and continuous
      return `scale=2700:4800,zoompan=z='min(zoom+0.0008,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
    case 1: // zoom out - starts at 1.25 goes to 1.001
      return `scale=2700:4800,zoompan=z='if(lte(zoom,1.0),1.25,max(1.001,zoom-0.0008))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
    case 2: // pan right - constant zoom + slow pan
      return `scale=2700:4800,zoompan=z='1.12':x='min(iw-(iw/zoom),(on/${totalFrames})*(iw-(iw/zoom)))':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
    case 3: // pan left - constant zoom + slow pan reversed
      return `scale=2700:4800,zoompan=z='1.12':x='max(0,(iw-(iw/zoom))*(1-on/${totalFrames}))':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
  }
}

async function renderScene({ scene, imageUrl, audioPath, jobId, index, total, fontFile, FPS }) {
  const workDir  = path.join(__dirname, `../temp/${jobId}`);
  const segOut   = path.join(workDir, `seg_${index}.mp4`);
  const imgPath  = path.join(workDir, `img_${index}.jpg`);
  const hasAudio = audioPath && fs.existsSync(audioPath);

  let duration = scene.duration || 8;
  if (hasAudio) duration = await getAudioDuration(audioPath);

  if (imageUrl) {
    await downloadFile(imageUrl, imgPath);
  } else {
    await ffmpeg(["-f","lavfi","-i","color=c=black:s=1080x1920:d=1","-vframes","1","-y",imgPath]);
  }

  const kbFilter = getKenBurnsFilter(index, duration, FPS);

  const rawText = scene.narration || scene.caption || "";
  const safeT   = (t) => t.replace(/\\/g,"\\\\").replace(/'/g,"\u2019").replace(/:/g,"\\:").replace(/\[/g,"\\[").replace(/\]/g,"\\]");
  const lines   = wrapText(rawText, 24);
  const lineH = 66, fSize = 52;
  const totalTH = lines.length * lineH;
  const baseY   = 1920 - totalTH - 110;

  const bgFilter    = `drawbox=x=0:y=${baseY-22}:w=1080:h=${totalTH+44}:color=black@0.55:t=fill`;
  const textFilters = lines.map((line, li) =>
    `drawtext=text='${safeT(line)}':fontfile=${fontFile}:fontsize=${fSize}:fontcolor=white:borderw=2:bordercolor=black@0.8:x=(w-text_w)/2:y=${baseY + li * lineH}`
  ).join(",");

  const filterComplex = `[0:v]${kbFilter},${bgFilter},${textFilters}[vout]`;

  const ffArgs = [
    "-loop", "1", "-framerate", String(FPS), "-i", imgPath,
    ...(hasAudio ? ["-i", audioPath] : []),
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    ...(hasAudio ? ["-map", "1:a"] : ["-an"]),
    "-t", String(duration),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    ...(hasAudio ? ["-shortest"] : []),
    "-y", segOut
  ];

  await ffmpeg(ffArgs);
  console.log(`✅ Scene ${index+1}/${total} (${duration.toFixed(1)}s) KB-type:${index%4}`);
  return segOut;
}

async function renderVideo({ script, imageUrls, audioPaths, jobId }) {
  const workDir   = path.join(__dirname, `../temp/${jobId}`);
  const outputDir = path.join(__dirname, "../output");
  fs.mkdirSync(workDir,   { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const scenes   = script.scenes;
  const fontFile = "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf";
  const FPS      = 25;

  // Parallel rendering of all scenes simultaneously
  console.log(`⏱️ Rendering ${scenes.length} scenes in parallel...`);
  const startTime = Date.now();

  const segmentPaths = await Promise.all(
    scenes.map((scene, i) => renderScene({
      scene,
      imageUrl:  imageUrls[i],
      audioPath: audioPaths[i],
      jobId, index: i, total: scenes.length, fontFile, FPS
    }))
  );

  console.log(`⏱️ Scenes done in ${((Date.now()-startTime)/1000).toFixed(1)}s`);

  // Concat in correct order - use -c copy to skip re-encoding
  const concatList  = path.join(workDir, "concat.txt");
  fs.writeFileSync(concatList, segmentPaths.map(p => `file '${p}'`).join("\n"));

  const finalOutput = path.join(outputDir, `${jobId}.mp4`);
  await ffmpeg([
    "-f","concat","-safe","0","-i",concatList,
    "-c","copy",
    "-movflags","+faststart","-y",finalOutput
  ]);

  const total = ((Date.now()-startTime)/1000).toFixed(1);
  console.log(`🎬 Final video (${total}s total): ${finalOutput}`);
  return finalOutput;
}

module.exports = { renderVideo };

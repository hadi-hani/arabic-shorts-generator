"use strict";

// ─────────────────────────────────────────────────────────────
//  Word Aligner + Caption Engine
//  Ported from vertical-shorts-generator's app/captions.js
//  and adapted to support three subtitle modes:
//    word        — each word appears alone (pop + fade)
//    sentence    — the whole sentence appears at once
//    progressive — words accumulate until the sentence completes
// ─────────────────────────────────────────────────────────────

const MAX_SENTENCE_WORDS = 9;
const LINE_MAX_CHARS = 20;
const MAX_WORD_WINDOW = 0.8;
const MIN_WORD_WINDOW = 0.12;

/* ── Time / text helpers ─────────────────────────────────── */

function toAssTime(sec) {
  const c = Math.max(0, Math.round(sec * 100));
  const cs = c % 100;
  const s = Math.floor(c / 100) % 60;
  const m = Math.floor(c / 6000) % 60;
  const h = Math.floor(c / 360000);
  const p = (n) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs)}`;
}

function toSrtTime(sec) {
  const v = Math.max(0, sec);
  const h = Math.floor(v / 3600);
  const m = Math.floor(v / 60) % 60;
  const s = Math.floor(v) % 60;
  const ms = Math.round((v - Math.floor(v)) * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)},${String(ms).padStart(3, "0")}`;
}

/* ── Color conversion (#RRGGBB | named | rgba → ASS &HAABBGGRR) ── */

const NAMED_COLORS = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  yellow: [255, 255, 0],
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  gold: [255, 215, 0]
};

function toRgb(input) {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (NAMED_COLORS[s]) return { rgb: NAMED_COLORS[s], alpha: 0 };
  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (!/^[0-9a-f]{6}$/.test(hex)) return null;
    const n = parseInt(hex, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 0 };
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(",").map((x) => parseFloat(x.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some((x) => Number.isNaN(x))) return null;
    const alpha = parts.length > 3 && !Number.isNaN(parts[3]) ? Math.round((1 - Math.max(0, Math.min(1, parts[3]))) * 255) : 0;
    return { rgb: parts.slice(0, 3), alpha };
  }
  return null;
}

/** Convert CSS-ish color to ASS `&HAABBGGRR` (alpha 0 = opaque). */
function toAssColor(input, fallback = [255, 255, 255]) {
  const c = toRgb(input) || { rgb: fallback, alpha: 0 };
  const [r, g, b] = c.rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))));
  const a = c.alpha;
  return `&H${a.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${r.toString(16).padStart(2, "0")}`;
}

function tokenizeWords(text) {
  return String(text || "").split(/\s+/).filter(Boolean);
}

function splitSentences(text) {
  const out = [];
  const re = /[^.!?؟…]*[.!?؟…]+/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    out.push(text.slice(last, re.lastIndex).trim());
    last = re.lastIndex;
  }
  if (last < text.length) {
    const rest = text.slice(last).trim();
    if (rest) out.push(rest);
  }
  return out.filter(Boolean);
}

/** Canonical key for matching script tokens against TTS word timings. */
/** Strip Arabic diacritics (tashkeel): harakat, sukun, tatweel, superscript alef. */
function stripTashkeel(text) {
  return String(text || "").replace(/[\u064B-\u0652\u0670\u0640]/g, "");
}

function timingKey(raw) {
  return String(raw || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[\p{P}\p{S}]+/gu, "")
    .replace(/\s+/g, "")
    .trim();
}

/* ── Font sizing (mirrors captions.js) ───────────────────── */

function fontsizeFor(text) {
  const len = Array.from(text).length;
  const size = Math.round(2375 / Math.max(1, len));
  return Math.max(60, Math.min(120, size));
}

function sentenceSize(tokens) {
  let maxLine = 0;
  let cur = 0;
  for (const t of tokens) {
    const L = Array.from(t).length + (cur ? 1 : 0);
    if (cur && cur + L > LINE_MAX_CHARS) {
      if (cur > maxLine) maxLine = cur;
      cur = Array.from(t).length;
    } else {
      cur += L;
    }
  }
  if (cur > maxLine) maxLine = cur;
  const size = Math.round(1800 / Math.max(1, maxLine));
  return Math.max(60, Math.min(110, size));
}

function splitLines(words, maxChars = LINE_MAX_CHARS) {
  const lines = [];
  let cur = "";
  for (const w of words) {
    const piece = cur ? `${cur} ${w}` : w;
    if (cur && Array.from(piece).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = piece;
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\\N");
}

/* ── Alignment ────────────────────────────────────────────── */

function alignTimings(timings, tokens) {
  if (!Array.isArray(timings) || !timings.length) return null;
  const words = tokens.map((text) => ({ text, start: 0, end: 0, _matched: false }));
  let j = 0;
  let matched = 0;
  for (let i = 0; i < tokens.length; i++) {
    const key = timingKey(tokens[i]);
    if (!key) continue;
    let found = -1;
    for (let s = j; s < timings.length; s++) {
      if (timingKey(timings[s].word) === key) {
        found = s;
        break;
      }
    }
    if (found === -1) continue;
    const t = timings[found];
    const start = Math.max(0, typeof t.start === "number" ? t.start : 0);
    const end =
      typeof t.end === "number" ? Math.max(t.end, start) : start + 0.3;
    words[i] = { text: tokens[i], start, end, _matched: true };
    j = found + 1;
    matched++;
  }
  if (!matched) return null;

  const matchedIdx = words.map((w, i) => (w._matched ? i : -1)).filter((i) => i >= 0);
  for (let i = 0; i < words.length; i++) {
    if (words[i]._matched) continue;
    const prevIdx = matchedIdx.filter((x) => x < i).pop();
    const nextIdx = matchedIdx.find((x) => x > i);
    if (prevIdx !== undefined && nextIdx !== undefined) {
      const a = words[prevIdx].start;
      const b = words[nextIdx].start;
      const gap = (b - a) / (nextIdx - prevIdx);
      words[i].start = a + gap * (i - prevIdx);
      words[i].end = words[i].start + gap;
    } else if (prevIdx !== undefined) {
      words[i].start = words[prevIdx].end;
      words[i].end = words[i].start + 0.3;
    } else if (nextIdx !== undefined) {
      words[i].end = words[nextIdx].start - 0.3 * (nextIdx - i - 1);
      words[i].start = Math.max(0, words[i].end - 0.3);
    } else {
      words[i].start = 0;
      words[i].end = 0.3;
    }
  }

  let prev = -Infinity;
  for (const w of words) {
    if (w.start < prev) w.start = prev;
    if (w.end < w.start) w.end = w.start;
    prev = w.start;
  }
  return { words, matched };
}

function evenSplitBySentence(tokens, duration) {
  const sents = splitSentences(tokens.join(" "));
  const counts = sents.map((s) => tokenizeWords(s).length).filter((c) => c > 0);
  const total = counts.reduce((a, b) => a + b, 0);

  const words = [];
  let t0 = 0;
  let k = 0;
  for (const wc of counts) {
    const t1 = k + wc >= tokens.length ? duration : t0 + (duration * wc) / total;
    const step = wc ? (t1 - t0) / wc : 0;
    for (let j = 0; j < wc && k < tokens.length; j++, k++) {
      words.push({ text: tokens[k], start: t0 + j * step, end: t0 + (j + 1) * step });
    }
    t0 = t1;
  }
  while (k < tokens.length) {
    words.push({ text: tokens[k], start: t0, end: t0 + 0.3 });
    t0 += 0.3;
    k++;
  }
  return words;
}

function buildWordList(timings, tokens, opts) {
  const n = tokens.length;
  if (!n) return [];
  const aligned = alignTimings(timings, tokens);
  if (aligned && aligned.matched / n >= 0.7) return aligned.words;
  const duration =
    opts.duration > 0 ? opts.duration : n / (opts.wordsPerSecond || 2.6);
  return evenSplitBySentence(tokens, duration);
}

function chunkByCount(words, n) {
  const chunks = [];
  for (let i = 0; i < words.length; i += n) chunks.push(words.slice(i, i + n));
  return chunks.filter((c) => c.length);
}

function sentenceChunks(words, text) {
  const counts = splitSentences(text).map((s) => tokenizeWords(s).length);
  const chunks = [];
  let k = 0;
  for (const sc of counts) {
    const slice = words.slice(k, k + sc);
    if (slice.length) {
      chunks.push(slice);
      k += sc;
    }
  }
  if (k < words.length) chunks.push(words.slice(k));
  return chunks
    .flatMap((c) =>
      c.length > MAX_SENTENCE_WORDS ? chunkByCount(c, MAX_SENTENCE_WORDS) : [c]
    )
    .filter((c) => c.length);
}

/**
 * Segment the narration into caption display units.
 *   mode 'sentence'/'progressive' — group by sentence.
 *   mode 'word'                  — one word per unit.
 * Returns [{ words: [{text,start,end}...], start, end }]
 */
function segmentCaptions(timings, text, opts = {}) {
  const tokens = tokenizeWords(text);
  if (!tokens.length) return [];
  const words = buildWordList(timings, tokens, opts);
  const mode = opts.mode || "sentence";

  if (mode === "word") {
    return words.map((w) => ({
      words: [w],
      start: w.start,
      end: w.end
    }));
  }

  const chunks = sentenceChunks(words, text);
  return chunks.map((c) => ({
    words: c,
    start: c[0].start,
    end: c[c.length - 1].end
  }));
}

/* ── ASS event builders ───────────────────────────────────── */

function eventLine(start, end, text) {
  return `Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Karaoke,,0,0,0,,${text}`;
}

function leadingTags(y, size, extra) {
  return `{\\pos(540,${y})\\an5\\fs${size}${extra || ""}}`;
}

function wordByWordEvents(seg, y, fixedSize) {
  const out = [];
  const words = seg.words;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const start = w.start;
    const nextStart = i + 1 < words.length ? words[i + 1].start : seg.end;
    const clamped = Math.min(nextStart, start + MAX_WORD_WINDOW);
    const end = Math.max(clamped, Math.min(nextStart, start + MIN_WORD_WINDOW));
    const size = fixedSize || fontsizeFor(w.text);
    const pop = "\\t(0,110,\\fscx100\\fscy100)";
    const text =
      leadingTags(y, size, `\\fscx75\\fscy75\\fad(40,40)${pop}`) + w.text;
    out.push(eventLine(start, end, text));
  }
  return out;
}

function sentenceEvents(seg, y, fixedSize) {
  const tokens = seg.words.map((w) => w.text);
  const size = fixedSize || sentenceSize(tokens);
  const text =
    leadingTags(y, size, `\\fad(120,120)`) + splitLines(tokens);
  return [eventLine(seg.start, seg.end, text)];
}

function progressiveEvents(seg, y, fixedSize) {
  const words = seg.words;
  const n = words.length;
  if (!n) return [];
  const tokens = words.map((w) => w.text);
  const size = fixedSize || sentenceSize(tokens);
  const out = [];
  for (let k = 0; k < n; k++) {
    const start = words[k].start;
    const end = k + 1 < n ? words[k + 1].start : seg.end;
    const shown = tokens.slice(0, k + 1);
    const fadeIn = k === 0 ? "\\fad(60,0)" : "\\fad(40,40)";
    const fadeOut = k === n - 1 ? "\\fad(40,120)" : "";
    out.push(
      eventLine(start, end, leadingTags(y, size, `${fadeIn}${fadeOut}`) + splitLines(shown))
    );
  }
  return out;
}

/** Build a full .ass subtitle file for one scene (times are scene-relative).
 * options: { style, y, font, fontSize?, fontColor?, borderColor?, borderWidth?, backgroundColor? }
 */
function buildAssFile(segments, options = {}) {
  const style = options.style || "word";
  const y = options.y != null ? options.y : 1400;
  const font = options.font || "Noto Sans Arabic";
  const fixedSize =
    options.fontSize != null
      ? Math.max(24, Math.min(140, Math.round(Number(options.fontSize) || 70)))
      : null;
  const fontColor = toAssColor(options.fontColor, [255, 255, 255]);
  const outlineColor = toAssColor(options.borderColor, [0, 0, 0]);
  const outline = options.borderWidth != null ? Math.max(0, Math.min(12, Math.round(Number(options.borderWidth) || 5))) : 5;
  const hasBg = options.backgroundColor != null && String(options.backgroundColor).trim() !== "" && String(options.backgroundColor).toLowerCase() !== "none";
  const backColor = hasBg ? toAssColor(options.backgroundColor, [0, 0, 0]) : "&H00000000";
  const borderStyle = hasBg ? 3 : 1;
  const events = [];
  for (const seg of segments) {
    const built =
      style === "progressive"
        ? progressiveEvents(seg, y, fixedSize)
        : style === "sentence"
          ? sentenceEvents(seg, y, fixedSize)
          : wordByWordEvents(seg, y, fixedSize);
    events.push(...built);
  }

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Karaoke,${font},${fixedSize || 70},${fontColor},&H00000000,${outlineColor},${backColor},-1,0,0,0,100,100,0,0,${borderStyle},${outline},2,5,60,60,60,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    ""
  ].join("\n");
}

/** Clean .srt — one block per caption segment. */
function buildSrt(segments) {
  return segments
    .map((seg, i) => {
      const text = seg.words.map((w) => w.text).join(" ");
      return (
        `${i + 1}\n${toSrtTime(seg.start)} --> ${toSrtTime(seg.end)}\n${text}\n`
      );
    })
    .join("\n");
}

module.exports = {
  segmentCaptions,
  buildAssFile,
  buildSrt,
  splitSentences,
  tokenizeWords,
  toAssTime,
  fontsizeFor,
  alignTimings,
  toAssColor,
  stripTashkeel
};
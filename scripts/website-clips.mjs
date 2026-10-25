import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { repoRoot } from "./paths.mjs";

/**
 * Makes the website's video clips from the rendered feature videos
 * (build/feature-videos, from scripts/feature-videos.mjs).
 *
 * Each feature becomes a short, silent loop of the comp side, cut around the
 * moment the command runs, in two files: AV1 in WebM (smallest, for Chrome,
 * Edge and Firefox) and H.264 in MP4 (for Safari and everything else), plus a
 * WebP poster that shows while the clip loads. The hero gets a montage of
 * four features with the panel in frame.
 *
 * Usage: node scripts/website-clips.mjs
 * Output: website/assets/clips/
 */

const ffmpeg = process.env["KVFX_FFMPEG"] ?? "ffmpeg";
const source = join(repoRoot, "build", "feature-videos");
const out = join(repoRoot, "website", "assets", "clips");
const BG = "0x0e0f12";
/** The comp side of a 16:9 feature video: the stage, panel left out. */
const STAGE = "crop=1180:846:680:150,scale=960:688:flags=lanczos";

// Times are seconds into the rendered 16:9 video (2.6 s of title card first).
const CLIPS = [
  { id: "resize", file: "01-resize", from: 11.0, to: 17.8, poster: 17.5 },
  { id: "silence", file: "02-silence", from: 6.4, to: 15.6, poster: 15.4 },
  { id: "follow", file: "03-follow", from: 10.2, to: 18.0, poster: 16.0 },
  { id: "unprecomp", file: "04-unprecomp", from: 5.2, to: 11.2, poster: 10.0 },
  { id: "duplicate", file: "05-duplicate", from: 11.2, to: 18.2, poster: 17.5 },
  { id: "sequence", file: "06-sequence", from: 6.4, to: 12.2, poster: 12.0 },
  { id: "align", file: "07-align", from: 15.4, to: 21.2, poster: 21.0 },
  { id: "gaps", file: "08-gaps", from: 5.2, to: 10.0, poster: 9.8 },
  { id: "anchor", file: "09-anchor", from: 5.0, to: 12.0, poster: 9.0 },
  { id: "gradient", file: "10-gradient", from: 8.6, to: 15.6, poster: 12.0 },
];

const HERO = [
  { file: "03-follow", from: 11.0, to: 14.2 },
  { file: "01-resize", from: 13.2, to: 16.8 },
  { file: "06-sequence", from: 13.8, to: 17.2 },
  { file: "04-unprecomp", from: 5.4, to: 8.6 },
];
const XFADE = 0.4;

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-y", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-1500)))));
  });
}

const AV1 = ["-c:v", "libsvtav1", "-crf", "42", "-preset", "5", "-g", "300", "-pix_fmt", "yuv420p", "-an"];
const H264 = ["-c:v", "libx264", "-crf", "28", "-preset", "slow", "-tune", "animation", "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"];

async function encode(inputArgs, filter, name) {
  await run([...inputArgs, "-filter_complex", filter, "-map", "[v]", ...AV1, join(out, `${name}.webm`)]);
  await run([...inputArgs, "-filter_complex", filter, "-map", "[v]", ...H264, join(out, `${name}.mp4`)]);
}

const kb = async (file) => Math.round((await stat(file)).size / 1024);

await mkdir(out, { recursive: true });
for (const clip of CLIPS) {
  const src = join(source, `${clip.file}-16x9.mp4`);
  if (!existsSync(src)) throw new Error(`Missing ${src}: run scripts/feature-videos.mjs first`);
  const d = clip.to - clip.from;
  // A short fade at each end, so the loop restarts cleanly.
  const filter = `[0:v]${STAGE},fade=t=in:st=0:d=0.3:color=${BG},fade=t=out:st=${(d - 0.3).toFixed(2)}:d=0.3:color=${BG},format=yuv420p[v]`;
  await encode(["-ss", String(clip.from), "-t", d.toFixed(2), "-i", src], filter, clip.id);
  await run(["-ss", String(clip.poster), "-i", src, "-frames:v", "1", "-vf", STAGE, "-c:v", "libwebp", "-quality", "80", join(out, `${clip.id}.webp`)]);
  console.log(`${clip.id}: webm ${String(await kb(join(out, `${clip.id}.webm`)))} KB, mp4 ${String(await kb(join(out, `${clip.id}.mp4`)))} KB, poster ${String(await kb(join(out, `${clip.id}.webp`)))} KB`);
}

// The hero: four features, panel and comp, cross-faded.
const inputs = HERO.flatMap((h) => ["-ss", String(h.from), "-t", (h.to - h.from).toFixed(2), "-i", join(source, `${h.file}-16x9.mp4`)]);
// Cropped a little, which also leaves out each video's progress line.
const parts = HERO.map((_, i) => `[${String(i)}:v]crop=1904:1071:8:0,scale=1280:720:flags=lanczos,setsar=1,fps=30[s${String(i)}]`);
let last = "s0";
let offset = 0;
for (let i = 1; i < HERO.length; i++) {
  offset += HERO[i - 1].to - HERO[i - 1].from - XFADE;
  const next = i === HERO.length - 1 ? "x" : `x${String(i)}`;
  parts.push(`[${last}][s${String(i)}]xfade=transition=fade:duration=${String(XFADE)}:offset=${offset.toFixed(2)}[${next}]`);
  last = next;
}
const total = HERO.reduce((sum, h) => sum + h.to - h.from, 0) - XFADE * (HERO.length - 1);
parts.push(`[x]fade=t=in:st=0:d=0.3:color=${BG},fade=t=out:st=${(total - 0.3).toFixed(2)}:d=0.3:color=${BG},format=yuv420p[v]`);
await encode(inputs, parts.join(";"), "hero");
await run(["-ss", "12.0", "-i", join(source, "03-follow-16x9.mp4"), "-frames:v", "1", "-vf", "crop=1904:1071:8:0,scale=1280:720:flags=lanczos", "-c:v", "libwebp", "-quality", "80", join(out, "hero.webp")]);
console.log(`hero: webm ${String(await kb(join(out, "hero.webm")))} KB, mp4 ${String(await kb(join(out, "hero.mp4")))} KB, poster ${String(await kb(join(out, "hero.webp")))} KB`);

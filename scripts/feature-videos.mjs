import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { repoRoot } from "./paths.mjs";
import { FEATURES, TOUR } from "../promo/features/features.mjs";

/**
 * Renders the Tools feature videos (promo/features) to MP4.
 *
 * Each frame is drawn by promo/features/studio.html in headless Chromium:
 * the panel recording on one side, the comp it changes on the other. The
 * sound is made here, not licensed: a soft click on every click in the
 * recording and a whoosh into and out of the demo. A music track placed in
 * promo/features/assets/music is mixed in underneath when there is one.
 *
 * Prerequisites: the panel recordings (node scripts/promo-capture.mjs --clip tf-…),
 * the built core package (npm run build; the Transitions scene uses its maths),
 * Playwright (KVFX_PLAYWRIGHT), Chromium (KVFX_CHROMIUM) and ffmpeg (KVFX_FFMPEG).
 *
 * Usage:
 *   node scripts/feature-videos.mjs [--only follow,resize] [--layout 16x9,9x16]
 *   node scripts/feature-videos.mjs --stills 3,12 --only follow     # PNG stills for a look
 * Output: build/feature-videos/NN-<id>-<layout>.mp4
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};
const FPS = 30;
const studioDir = join(repoRoot, "promo", "features");
const outDir = join(repoRoot, "build", "feature-videos");
const framesDir = join(outDir, "frames");
const sfxDir = join(outDir, "sfx");
const coreDist = join(repoRoot, "packages", "core", "dist");
const ffmpeg = process.env["KVFX_FFMPEG"] ?? "ffmpeg";
const only = flag("only", FEATURES.map((f) => f.id).join(",")).split(",");
const layouts = flag("layout", "16x9,9x16").split(",");
const stills = args.includes("--stills") ? flag("stills", "8").split(",").map(Number) : null;
const SIZES = { "16x9": [1920, 1080], "9x16": [1080, 1920] };

function run(command, commandArgs, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: [input ? "pipe" : "ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${String(code)}\n${stderr.slice(-2000)}`))));
    if (input) input(child.stdin);
  });
}

const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png" };

function serve() {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const path = decodeURIComponent((request.url ?? "/").split("?")[0]);
      // The scenes import the shipped transition maths from the built core package.
      const file = path.startsWith("/frames/")
        ? join(framesDir, path.slice("/frames/".length))
        : path.startsWith("/packages/core/dist/")
          ? join(repoRoot, path)
          : join(studioDir, path.replace(/^\/+/, ""));
      if (!file.startsWith(studioDir) && !file.startsWith(framesDir) && !file.startsWith(coreDist)) {
        response.writeHead(403).end();
        return;
      }
      readFile(file).then(
        (body) => {
          response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
          response.end(body);
        },
        () => response.writeHead(404).end(),
      );
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** The panel recording as numbered JPEGs the studio page can load one at a time. */
async function extractFrames(clip) {
  const dir = join(framesDir, clip);
  const source = join(studioDir, "assets", "clips", `${clip}.mp4`);
  if (!existsSync(source)) return false;
  if (existsSync(join(dir, "f0001.jpg"))) return true;
  await mkdir(dir, { recursive: true });
  await run(ffmpeg, ["-y", "-loglevel", "error", "-i", source, "-q:v", "2", join(dir, "f%04d.jpg")]);
  return true;
}

/** Two short sounds, synthesised: a soft click and a whoosh. */
async function makeSfx() {
  await mkdir(sfxDir, { recursive: true });
  const click = join(sfxDir, "click.wav");
  const whoosh = join(sfxDir, "whoosh.wav");
  if (!existsSync(click)) {
    await run(ffmpeg, [
      "-y", "-loglevel", "error", "-f", "lavfi", "-i",
      "aevalsrc=0.55*sin(2*PI*1850*t)*exp(-75*t)+0.35*sin(2*PI*620*t)*exp(-40*t):s=48000:d=0.12",
      "-af", "highpass=f=200,afade=t=out:st=0.08:d=0.04", click,
    ]);
  }
  if (!existsSync(whoosh)) {
    await run(ffmpeg, [
      "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anoisesrc=d=0.9:c=pink:a=0.5:r=48000",
      "-af", "bandpass=f=900:width_type=o:w=2.2,afade=t=in:st=0:d=0.45,afade=t=out:st=0.45:d=0.45,volume=0.8", whoosh,
    ]);
  }
  return { click, whoosh };
}

async function musicFile() {
  const dir = join(studioDir, "assets", "music");
  if (!existsSync(dir)) return null;
  const files = (await readdir(dir)).filter((f) => /\.(wav|mp3|m4a|aac|flac)$/i.test(f)).sort();
  return files.length ? join(dir, files[0]) : null;
}

/** The video's sound: clicks on the recording's clicks, whooshes at the cuts, music under it if any. */
async function soundTrack(info, sfx, music, target) {
  const inputs = ["-f", "lavfi", "-t", info.total.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo"];
  const parts = [];
  const events = [
    ...info.clicks.map((t) => ["click", t, 0.9]),
    ["whoosh", info.intro - 0.5, 0.55],
    ["whoosh", info.total - 3.6, 0.45],
  ];
  events.forEach(([kind, t, volume], i) => {
    inputs.push("-i", sfx[kind]);
    const ms = Math.max(0, Math.round(t * 1000));
    parts.push(`[${String(i + 1)}:a]adelay=${String(ms)}|${String(ms)},volume=${String(volume)}[e${String(i)}]`);
  });
  let mix = `[0:a]${events.map((_, i) => `[e${String(i)}]`).join("")}`;
  let count = events.length + 1;
  if (music) {
    inputs.push("-i", music);
    const m = events.length + 1;
    parts.push(`[${String(m)}:a]atrim=0:${info.total.toFixed(3)},afade=t=in:st=0:d=1,afade=t=out:st=${(info.total - 1.5).toFixed(3)}:d=1.5,volume=0.22[music]`);
    mix += "[music]";
    count += 1;
  }
  parts.push(`${mix}amix=inputs=${String(count)}:normalize=0:duration=first,alimiter=limit=0.9[out]`);
  await run(ffmpeg, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", parts.join(";"), "-map", "[out]", "-ac", "2", "-ar", "48000", target]);
}

const pw = await import(process.env["KVFX_PLAYWRIGHT"] ?? "playwright");
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch({ executablePath: process.env["KVFX_CHROMIUM"], args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"] });
const server = await serve();
const port = server.address().port;
await mkdir(outDir, { recursive: true });
const sfx = await makeSfx();
const music = await musicFile();

try {
  for (const id of only) {
    const index = FEATURES.findIndex((f) => f.id === id);
    const feature = FEATURES[index] ?? TOUR.find((f) => f.id === id);
    if (!feature) throw new Error(`Unknown feature "${id}". Known: ${[...FEATURES, ...TOUR].map((f) => f.id).join(", ")}`);
    const hasFrames = await extractFrames(feature.clip);
    if (!hasFrames) console.warn(`${feature.clip}.mp4 not recorded yet: the panel shows a placeholder`);
    for (const layout of layouts) {
      const [W, H] = SIZES[layout];
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      await page.goto(`http://127.0.0.1:${String(port)}/studio.html`);
      await page.waitForFunction(() => globalThis.studio !== undefined);
      const info = await page.evaluate(([f, l, base]) => globalThis.studio.load(f, l, base), [id, layout, hasFrames ? `/frames/${feature.clip}` : ""]);
      if (!info.fontsOk) console.warn("Unbounded did not load; titles use the fallback face");
      const name = index < 0 ? `tour-${id}-${layout}` : `${String(index + 1).padStart(2, "0")}-${id}-${layout}`;
      if (stills) {
        await mkdir(join(outDir, "stills"), { recursive: true });
        for (const t of stills) {
          await page.evaluate((v) => globalThis.studio.renderAt(v), t);
          await page.screenshot({ path: join(outDir, "stills", `${name}-${String(t)}.png`) });
        }
        console.log(`Stills for ${name}`);
        await page.close();
        continue;
      }
      const total = Math.round(info.total * FPS);
      const audio = join(outDir, `${name}.wav`);
      await soundTrack(info, sfx, music, audio);
      const target = join(outDir, `${name}.mp4`);
      const started = Date.now();
      await run(
        ffmpeg,
        [
          "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-i", audio,
          "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-tune", "animation", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", target,
        ],
        async (stdin) => {
          for (let f = 0; f < total; f++) {
            await page.evaluate((v) => globalThis.studio.renderAt(v), f / FPS);
            const png = await page.screenshot({ type: "png" });
            if (!stdin.write(png)) await new Promise((ok) => stdin.once("drain", ok));
          }
          stdin.end();
        },
      );
      await rm(audio, { force: true });
      console.log(`Rendered ${target} (${String(total)} frames, ${String(Math.round((Date.now() - started) / 1000))} s)`);
      await page.close();
    }
  }
} finally {
  server.close();
  await browser.close();
}

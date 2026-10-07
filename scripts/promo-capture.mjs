import { mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { repoRoot } from "./paths.mjs";

/**
 * Records the panel in use, for the promo.
 *
 * Each clip drives the real, built panel (the same pages scripts/preview.mjs
 * renders, with its canned host) through a short scripted interaction: a
 * cursor drags the ease curve, hovers the text presets, types into the search
 * palette. Time is faked, so every frame is captured at an exact 1/30 s step
 * however long the screenshot takes — the result plays back smoothly at 30 fps
 * instead of at whatever speed the machine managed.
 *
 *   - requestAnimationFrame, timers and performance.now: Playwright's clock.
 *   - Web Animations and CSS transitions: paused and seeked every frame.
 *
 * Prerequisites:
 *   npm run build && node scripts/preview.mjs --all --width 380
 *   Playwright      (KVFX_PLAYWRIGHT = module path, else the "playwright" package)
 *   Chromium        (KVFX_CHROMIUM, else Playwright's own)
 *   ffmpeg          (KVFX_FFMPEG, else "ffmpeg" on PATH)
 *
 * Usage: node scripts/promo-capture.mjs [--clip ease,text,palette,tools,generate]
 * Output: promo/assets/clips/<clip>.mp4 at 760 x 1720, 30 fps.
 */

const args = process.argv.slice(2);
function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

const FPS = 30;
const VIEWPORT = { width: 380, height: 860 };
const SCALE = 2;
const workDir = join(repoRoot, "build", "preview", "work");
const outDir = join(repoRoot, "promo", "assets", "clips");
const framesRoot = join(repoRoot, "build", "promo-frames");

// ---------------------------------------------------------------------------
// Clips. Times in seconds; positions in CSS pixels of the 380 x 860 panel.
//   cursor: waypoints [t, x, y]; the cursor eases between them.
//   events: [t, kind, ...] - down, up, click, key (a key name), type (one char).
//   setup:  run once before the first frame (not recorded).
// ---------------------------------------------------------------------------

const CLIPS = {
  ease: {
    tab: "ease",
    duration: 6.5,
    cursor: [
      [0, 330, 620], [0.55, 163, 432], [0.6, 163, 432], [1.4, 136, 271], [1.5, 136, 271],
      [1.9, 217, 271], [1.95, 217, 271], [2.6, 158, 271], [3.7, 158, 300],
      [4.0, 43, 795], [4.6, 43, 795], [5.0, 156, 558], [6.5, 170, 600],
    ],
    events: [[0.6, "down"], [1.4, "up"], [1.95, "down"], [2.6, "up"], [4.05, "click"], [5.05, "click"]],
  },
  text: {
    tab: "text",
    duration: 7.0,
    setup: [["fill", 'input[aria-label="Text"]', "KVFX TOOLS"]],
    cursor: [
      [0, 300, 700], [0.3, 52, 489], [1.25, 52, 489], [1.35, 144, 517], [2.25, 144, 517],
      [2.35, 236, 489], [3.25, 236, 489], [3.35, 236, 517], [4.25, 236, 517], [4.35, 328, 517],
      [5.25, 328, 517], [5.35, 144, 545], [6.0, 144, 545], [6.25, 231, 587], [7.0, 240, 640],
    ],
    events: [[6.3, "click"]],
  },
  palette: {
    tab: "tools",
    duration: 4.5,
    cursor: null,
    events: [[0.35, "key", "Control+Space"], [0.9, "type", "m"], [1.15, "type", "t"], [1.4, "type", "t"], [2.5, "key", "Enter"]],
  },
  tools: {
    tab: "tools",
    duration: 5.2,
    cursor: [
      [0, 330, 760], [0.5, 190, 537], [1.6, 190, 537], [2.0, 344, 501], [2.3, 344, 501],
      [2.65, 190, 537], [3.3, 190, 537], [3.8, 190, 321], [5.2, 200, 360],
    ],
    events: [[0.6, "click"], [2.15, "click"], [2.8, "click"], [4.0, "click"]],
  },
  generate: {
    tab: "generate",
    duration: 5.0,
    cursor: [[0, 320, 700], [0.5, 280, 294], [2.3, 280, 294], [2.8, 190, 464], [5.0, 210, 520]],
    events: [
      [0.6, "click"], [0.65, "key", "Control+A"], [0.8, "type", "4"], [0.9, "type", "8"],
      [1.0, "type", "9"], [1.1, "type", "2"], [1.2, "type", "0"], [1.4, "key", "Tab"], [2.9, "click"],
    ],
  },
};

// ---------------------------------------------------------------------------
// In-page helpers: a drawn cursor with click ripples, and a stepper that
// seeks every Web Animation (CSS transitions included) to the fake time.
// ---------------------------------------------------------------------------

const PAGE_HELPERS = `
(function () {
  var started = new WeakMap();
  var cursor = null;
  var ring = null;
  function ensure() {
    if (cursor) return;
    cursor = document.createElement("div");
    cursor.style.cssText = "position:fixed;left:0;top:0;width:22px;height:30px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 2px 3px rgba(0,0,0,.55));transform-origin:0 0";
    cursor.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M1.5 1.5 L1.5 23 L7 18 L11 27.5 L15 25.8 L11 16.8 L18.5 16.8 Z" fill="#FFF4E8" stroke="#0B0C0F" stroke-width="2" stroke-linejoin="round"/></svg>';
    ring = document.createElement("div");
    ring.style.cssText = "position:fixed;left:0;top:0;width:40px;height:40px;margin:-20px 0 0 -20px;border:3px solid #FF8F3F;border-radius:50%;pointer-events:none;z-index:2147483646;opacity:0";
    document.body.appendChild(ring);
    document.body.appendChild(cursor);
  }
  window.__kvFrame = function (now, x, y, visible, down, clickAge) {
    var list = document.getAnimations();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!started.has(a)) { started.set(a, now); a.pause(); }
      a.currentTime = now - started.get(a);
    }
    ensure();
    cursor.style.display = visible ? "block" : "none";
    cursor.style.transform = "translate(" + x + "px," + y + "px) scale(" + (down ? 0.88 : 1) + ")";
    if (clickAge >= 0 && clickAge < 450) {
      var k = clickAge / 450;
      ring.style.left = x + "px";
      ring.style.top = y + "px";
      ring.style.opacity = String(1 - k);
      ring.style.transform = "scale(" + (0.4 + k * 1.4) + ")";
    } else {
      ring.style.opacity = "0";
    }
  };
})();
`;

// ---------------------------------------------------------------------------

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function cursorAt(points, t) {
  if (!points || points.length === 0) return null;
  if (t <= points[0][0]) return [points[0][1], points[0][2]];
  for (let i = 1; i < points.length; i++) {
    const [t1, x1, y1] = points[i];
    if (t <= t1) {
      const [t0, x0, y0] = points[i - 1];
      const k = t1 === t0 ? 1 : smooth((t - t0) / (t1 - t0));
      return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
    }
  }
  const last = points[points.length - 1];
  return [last[1], last[2]];
}

const MEDIA_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function serve(root) {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const path = (request.url ?? "/").split("?")[0];
      const resolved = join(root, decodeURIComponent(path).replace(/^\/+/, ""));
      if (!resolved.startsWith(root)) {
        response.writeHead(403).end();
        return;
      }
      readFile(resolved).then(
        (body) => {
          response.writeHead(200, { "content-type": MEDIA_TYPES[extname(resolved)] ?? "application/octet-stream" });
          response.end(body);
        },
        () => response.writeHead(404).end(),
      );
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${String(code)}\n${stderr.slice(-2000)}`))));
  });
}

async function record(browser, port, name, clip) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.goto(`http://127.0.0.1:${String(port)}/panel-${clip.tab}.html`);
  await page.waitForSelector(".kvfx-tabbtn");
  await page.clock.runFor(1500);
  await page.evaluate(PAGE_HELPERS);
  for (const step of clip.setup ?? []) {
    if (step[0] === "fill") await page.fill(step[1], step[2]);
  }
  await page.clock.runFor(500);
  const fakeNow = await page.evaluate("Date.now()");
  await page.clock.pauseAt(fakeNow + 1000);

  const frames = join(framesRoot, name);
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });

  const total = Math.round(clip.duration * FPS);
  const pending = [...clip.events].sort((a, b) => a[0] - b[0]);
  let down = false;
  let lastClick = -1;
  let last = null;
  for (let f = 0; f < total; f++) {
    const t = f / FPS;
    const pos = cursorAt(clip.cursor, t);
    if (pos && (!last || Math.abs(pos[0] - last[0]) + Math.abs(pos[1] - last[1]) > 0.2)) {
      await page.mouse.move(pos[0], pos[1]);
      last = pos;
    }
    while (pending.length > 0 && pending[0][0] <= t + 1e-6) {
      const [, kind, value] = pending.shift();
      if (kind === "down") { await page.mouse.down(); down = true; }
      if (kind === "up") { await page.mouse.up(); down = false; }
      if (kind === "click") { await page.mouse.down(); await page.mouse.up(); lastClick = t; }
      if (kind === "key") await page.keyboard.press(value);
      if (kind === "type") await page.keyboard.type(value);
    }
    await page.clock.runFor(1000 / FPS);
    const now = (f + 1) * (1000 / FPS);
    const age = lastClick < 0 ? -1 : (t - lastClick) * 1000;
    const [x, y] = pos ?? [0, 0];
    await page.evaluate(`window.__kvFrame(${String(now)}, ${String(x)}, ${String(y)}, ${String(pos !== null)}, ${String(down)}, ${String(age)})`);
    await page.screenshot({ path: join(frames, `f${String(f).padStart(4, "0")}.png`) });
  }
  await context.close();

  const target = join(outDir, `${name}.mp4`);
  await run(process.env["KVFX_FFMPEG"] ?? "ffmpeg", [
    "-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frames, "f%04d.png"),
    "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "animation",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", target,
  ]);
  console.log(`Recorded ${target} (${String(total)} frames)`);
}

if (!existsSync(join(workDir, "panel-ease.html"))) {
  console.error("No preview pages. Run: npm run build && node scripts/preview.mjs --all --width 380");
  process.exit(1);
}

const pw = await import(process.env["KVFX_PLAYWRIGHT"] ?? "playwright");
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch({
  executablePath: process.env["KVFX_CHROMIUM"],
  args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
});
const server = await serve(workDir);
await mkdir(outDir, { recursive: true });
const wanted = flag("clip", Object.keys(CLIPS).join(",")).split(",");
try {
  for (const name of wanted) {
    if (!CLIPS[name]) throw new Error(`Unknown clip "${name}". Known: ${Object.keys(CLIPS).join(", ")}`);
    await record(browser, server.address().port, name, CLIPS[name]);
  }
} finally {
  server.close();
  await browser.close();
}

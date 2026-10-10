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
 * Usage: node scripts/promo-capture.mjs [--clip ease,text,palette,tools,generate] [--dry]
 * Output: promo/assets/clips/<clip>.mp4 at 760 x 1720, 30 fps. Clips whose
 * name starts with "wt-" are for the walkthrough and go to
 * promo/walkthrough/assets/clips instead. --dry walks every clip without
 * taking screenshots, to check its targets resolve.
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
const walkthroughDir = join(repoRoot, "promo", "walkthrough", "assets", "clips");
const DRY = args.includes("--dry");
const framesRoot = join(repoRoot, "build", "promo-frames");

// ---------------------------------------------------------------------------
// Clips. Times in seconds; positions in CSS pixels of the 380 x 860 panel.
//   cursor: waypoints [t, x, y] or [t, target]; the cursor eases between them.
//           A target is { sel } (CSS), { button } (a button's exact text or
//           label) or { tab } (a tab's name), optionally with dx/dy; it is found when the cursor sets
//           off towards it, so it can follow a scroll.
//   events: [t, kind, ...] - down, up, click, tap (the ring only), key (a key name), type (one char),
//           scroll (target, seconds: brings it near the top of the view),
//           select (target, value).
//   setup:  run once before the first frame (not recorded).
// ---------------------------------------------------------------------------

/** Typing a string, one key event per character from t. */
function typed(t, text, perSecond = 14) {
  return [...text].map((c, i) => [t + i / perSecond, "type", c]);
}
const B = (button, dx = 0, dy = 0) => ({ button, dx, dy });
const S = (sel, dx = 0, dy = 0) => ({ sel, dx, dy });
const T = (tab) => ({ tab, dx: 0, dy: 0 });

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

  // Walkthrough, chapter by chapter.
  "wt-layouts": {
    tab: "generate",
    duration: 12,
    cursor: [
      [0, 330, 760], [0.6, B("Chat Thread")], [1.1, B("Chat Thread")], [1.5, B("Notification")], [2.0, B("Notification")],
      [2.4, B("Bar Chart")], [2.9, B("Bar Chart")], [3.3, B("Pricing Card")], [3.8, B("Pricing Card")], [4.3, B("Metric Cards")],
      [5.2, B("Metric Cards")], [5.8, S('input[aria-label="Labels"]', 60)], [8.4, S('input[aria-label="Labels"]', 60)],
      [9.6, B("Build Layout", 40)], [11.2, B("Build Layout", 60, 30)], [12, B("Build Layout", 70, 40)],
    ],
    events: [
      [4.4, "click"], [5.9, "click"], [6.0, "key", "Control+A"], ...typed(6.1, "Revenue, Signups, Conversion", 13),
      [8.5, "scroll", B("Build Layout"), 0.8], [9.7, "click"],
    ],
  },
  "wt-motion": {
    tab: "generate",
    duration: 11,
    cursor: [
      [0, 330, 700], [0.5, B("UI Motion")], [1.0, B("UI Motion")], [1.6, S('[data-section="gen.uistagger"] select[aria-label="Order"]')],
      [2.6, S('[data-section="gen.uistagger"] select[aria-label="Order"]')], [3.1, S('[data-section="gen.uistagger"] input[aria-label="Stagger"]')],
      [4.0, S('[data-section="gen.uistagger"] input[aria-label="Stagger"]')], [4.6, B("Stagger In", 30)], [5.6, B("Stagger In", 30)],
      [7.4, B("Build Card Carousel", 20)], [9.0, B("Build Card Carousel", 20)], [11, B("Build Card Carousel", 60, 40)],
    ],
    events: [
      [0.6, "click"], [1.7, "tap"], [2.0, "select", S('[data-section="gen.uistagger"] select[aria-label="Order"]'), "leftRight"],
      [3.2, "click"], [3.3, "key", "Control+A"], [3.45, "type", "2"], [4.7, "click"],
      [5.8, "scroll", S('[data-section="gen.cardcarousel"]'), 0.9], [7.5, "click"],
    ],
  },
  "wt-interact": {
    tab: "generate",
    duration: 13,
    cursor: [
      [0, 330, 700], [0.5, B("UI Motion")], [0.9, B("UI Motion")], [2.0, B("Arrow")], [2.6, B("Add Cursor", 20)], [3.6, B("Add Cursor", 20)],
      [5.0, B("Add Hover", 20)], [6.2, B("Add Hover", 20)], [7.6, S('input[aria-label="Typed text"]', 40)],
      [10.2, S('input[aria-label="Typed text"]', 40)], [11.0, B("Add Input Bar", 20)], [12.2, B("Add Input Bar", 20)], [13, B("Add Input Bar", 60, 40)],
    ],
    events: [
      [0.6, "click"], [1.0, "scroll", S('[data-section="gen.cursor"]'), 0.8], [2.65, "click"],
      [3.8, "scroll", S('[data-section="gen.hover"]'), 0.8], [5.1, "click"],
      [6.3, "scroll", S('[data-section="gen.inputbar"]'), 0.8], [7.7, "click"], [7.8, "key", "Control+A"], ...typed(7.9, "Show signups by week", 12),
      [11.1, "click"],
    ],
  },
  "wt-text": {
    tab: "text",
    duration: 12,
    cursor: [
      [0, 330, 760], [0.6, S('[data-section="text.animate"]')], [1.2, B("Rise")], [1.8, B("Rise")], [2.1, B("Pop")], [2.7, B("Pop")],
      [3.0, B("Blur In")], [3.6, B("Blur In")], [3.9, B("Zoom Out")], [4.5, B("Zoom Out")], [4.9, B("Blur Rise")], [5.6, B("Blur Rise")],
      [6.2, B("In+Out")], [6.7, B("In+Out")], [7.1, B("Words")], [7.6, B("Words")], [8.6, B("Animate Text", 30)], [9.6, B("Animate Text", 30)],
      [12, B("Animate Text", 70, 40)],
    ],
    events: [
      [0.7, "scroll", S('[data-section="text.animate"]'), 0.6], [5.0, "click"], [6.3, "click"], [7.2, "click"], [8.7, "click"],
    ],
  },
  "wt-kinetic": {
    tab: "text",
    duration: 10,
    cursor: [
      [0, 330, 760], [1.4, S('input[aria-label="Phrase"]', 60)], [5.6, S('input[aria-label="Phrase"]', 60)], [6.2, B("Stack")], [6.6, B("Stack")],
      [7.0, B("Drift")], [7.4, B("Drift")], [8.2, B("Build Kinetic Title", 30)], [9.4, B("Build Kinetic Title", 30)], [10, B("Build Kinetic Title", 60, 40)],
    ],
    events: [
      [0.2, "scroll", S('[data-section="text.kinetic"]'), 0.9], [1.5, "click"], [1.6, "key", "Control+A"], ...typed(1.7, "Dashboards that *actually* *move*", 9),
      [6.3, "click"], [7.1, "click"], [8.3, "click"],
    ],
  },
  "wt-scene": {
    tab: "generate",
    duration: 15,
    cursor: [
      [0, 330, 700], [0.5, B("Scenes")], [0.9, B("Scenes")], [1.6, B("Drift")], [2.0, B("Drift")], [2.6, S('select[aria-label="Palette"]')], [3.4, S('select[aria-label="Palette"]')],
      [4.0, B("Add Backdrop", 20)], [4.8, B("Add Backdrop", 20)], [6.0, B("Add Dot Pulse", 20)], [6.8, B("Add Dot Pulse", 20)],
      [8.2, B("Make Glass", 20)], [9.0, B("Make Glass", 20)], [10.4, B("Wipe", 20)], [11.2, B("Wipe", 20)],
      [12.6, B("Build Title", 20)], [13.6, B("Build Title", 20)], [15, B("Build Title", 60, 40)],
    ],
    events: [
      [0.6, "click"], [1.7, "click"], [2.7, "tap"], [3.0, "select", S('select[aria-label="Palette"]'), "ember"], [4.1, "click"],
      [4.9, "scroll", S('[data-section="gen.dotpulse"]'), 0.8], [6.1, "click"],
      [6.9, "scroll", S('[data-section="gen.glass"]'), 0.8], [8.3, "click"],
      [9.1, "scroll", S('[data-section="gen.wipe"]'), 0.8], [10.5, "click"],
      [11.3, "scroll", S('[data-section="gen.codeglyphs"]'), 0.8], [12.7, "click"],
    ],
  },
  "wt-polish": {
    tab: "ease",
    duration: 15,
    cursor: [
      [0, 330, 760], [1.4, B("Add Elastic", 20)], [2.2, B("Add Elastic", 20)], [2.6, B("Add Bounce", 20)], [3.4, B("Add Bounce", 20)],
      [4.0, T("Tools")], [4.5, T("Tools")], [6.0, B("Follow", 20)], [6.8, B("Follow", 20)],
      [8.0, S(".kvfx-alignbar button:last-child")], [9.6, S(".kvfx-alignbar button:last-child")], [10.2, B("Align vertical centre")], [10.8, B("Align vertical centre")],
      [12.4, B("Even gaps horizontally")], [13.4, B("Even gaps horizontally")], [15, B("Even gaps horizontally", 50, 40)],
    ],
    events: [
      [0.2, "scroll", S('[data-section="ease.motion"]'), 0.9], [1.5, "click"], [2.7, "click"], [4.1, "click"],
      [4.6, "scroll", S('[data-section="tools.follow"]'), 0.9], [6.1, "click"],
      [8.1, "click"], [8.6, "click"], [9.1, "click"], [10.3, "click"],
      [10.9, "scroll", S('[data-section="tools.arrange"]'), 0.8], [12.5, "click"],
    ],
  },
  "wt-ship": {
    tab: "tools",
    duration: 18,
    cursor: [
      [0, 330, 760], [1.6, B("Analyse")], [2.4, B("Analyse")], [3.2, B("Cut Pauses")], [4.2, B("Cut Pauses")],
      [5.8, S('select[aria-label="Format"]')], [6.6, S('select[aria-label="Format"]')], [7.0, B("Fit")], [7.4, B("Fit")],
      [8.0, B("Resize Comps", 20)], [8.8, B("Resize Comps", 20)], [9.4, S(".kvfx-dialog__actions button:last-child")], [10.2, S(".kvfx-dialog__actions button:last-child")],
      [10.8, T("Library")], [11.3, T("Library")], [12.4, B("Find Missing")], [13.2, B("Find Missing")], [13.8, B("Search…")], [14.6, B("Search…")],
      [15.4, S('[data-section="library.relink"] .kvfx-primary', 20)], [16.0, S('[data-section="library.relink"] .kvfx-primary', 20)],
      [16.6, S(".kvfx-dialog__actions button:last-child")], [17.4, S(".kvfx-dialog__actions button:last-child")], [18, 200, 600],
    ],
    events: [
      [0.2, "scroll", S('[data-section="tools.silence"]'), 0.9], [1.7, "click"], [3.3, "click"],
      [4.3, "scroll", S('[data-section="tools.resize"]'), 0.8], [5.9, "tap"], [6.2, "select", S('select[aria-label="Format"]'), "vertical"],
      [7.1, "click"], [8.1, "click"], [9.5, "click"],
      [10.9, "click"], [11.4, "scroll", S('[data-section="library.relink"]'), 0.6], [12.5, "click"], [13.9, "click"], [15.5, "click"], [16.7, "click"],
    ],
  },
  "wt-tour": {
    tab: "tools",
    duration: 9,
    cursor: [
      [0, 330, 760], [0.5, T("Ease")], [1.2, T("Ease")], [1.4, T("Text")], [2.1, T("Text")], [2.3, T("FX")], [3.0, T("FX")],
      [3.2, T("Generate")], [3.9, T("Generate")], [4.1, T("Labels")], [4.8, T("Labels")], [5.0, T("Library")], [5.7, T("Library")],
      [5.9, T("Media")], [6.6, T("Media")], [6.8, B("Search commands")], [7.4, B("Search commands")], [9, 200, 420],
    ],
    events: [
      [0.6, "click"], [1.5, "click"], [2.4, "click"], [3.3, "click"], [4.2, "click"], [5.1, "click"], [6.0, "click"], [6.9, "click"],
      ...typed(7.6, "dup", 8),
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

/** Where a target is now: the centre of its box, plus its offset. */
async function locate(page, target) {
  const locator =
    target.sel !== undefined
      ? page.locator(target.sel).first()
      : target.tab !== undefined
        ? page.getByRole("tab", { name: target.tab, exact: true }).first()
        : page.getByRole("button", { name: target.button, exact: true }).first();
  const box = await locator.boundingBox({ timeout: 2000 }).catch(() => null);
  if (!box) {
    const shot = join(framesRoot, "missing-target.png");
    await page.screenshot({ path: shot });
    throw new Error(`Cannot find ${JSON.stringify(target)} (the page at that moment: ${shot})`);
  }
  return [box.x + box.width / 2 + (target.dx ?? 0), box.y + box.height / 2 + (target.dy ?? 0)];
}

/** The cursor follows its waypoints; a target is re-found every frame, so it tracks scrolling. */
function makeCursor(page, points) {
  let segment = -1;
  let from = null;
  let pos = null;
  // A target that closes (a dialog after its click) stays where it was last seen.
  const seen = new Map();
  const at = async (point) => {
    if (typeof point[1] !== "object") return [point[1], point[2]];
    const key = JSON.stringify(point[1]);
    try {
      const found = await locate(page, point[1]);
      seen.set(key, found);
      return found;
    } catch (cause) {
      if (seen.has(key)) return seen.get(key);
      throw cause;
    }
  };
  return async (t) => {
    if (!points || points.length === 0) return null;
    let i = points.findIndex((point) => t <= point[0]);
    if (i === -1) i = points.length - 1;
    const point = points[i];
    if (i === 0 || t > point[0]) {
      pos = await at(point);
      return pos;
    }
    if (i !== segment) {
      segment = i;
      from = pos ?? (await at(points[i - 1]));
    }
    const target = await at(point);
    const [t0] = points[i - 1];
    const k = point[0] === t0 ? 1 : smooth((t - t0) / (point[0] - t0));
    pos = [from[0] + (target[0] - from[0]) * k, from[1] + (target[1] - from[1]) * k];
    return pos;
  };
}

async function scrollTarget(page, target) {
  const handle =
    target.sel !== undefined
      ? page.locator(target.sel).first()
      : page.getByRole("button", { name: target.button, exact: true }).first();
  const element = await handle.elementHandle({ timeout: 2000 });
  if (!element) throw new Error(`Cannot scroll to ${JSON.stringify(target)}`);
  return element.evaluate((el) => {
    const view = el.ownerDocument.querySelector("main.kvfx-view");
    if (!view) return { from: 0, to: 0 };
    const top = el.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - 10;
    return { from: view.scrollTop, to: Math.max(0, Math.min(view.scrollHeight - view.clientHeight, top)) };
  });
}

/**
 * A screenshot, tried again if it stalls. The first one after some clicks can
 * wait on a compositor frame that never comes while the clock is paused; the
 * page has not changed, so a retry takes the same frame.
 */
async function shoot(page, path) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.screenshot({ path, timeout: 5000 });
      return;
    } catch (cause) {
      if (attempt >= 4) throw cause;
    }
  }
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
  const cursorAtTime = makeCursor(page, clip.cursor);
  let down = false;
  let lastClick = -1;
  let last = null;
  let scroll = null;
  for (let f = 0; f < total; f++) {
    const t = f / FPS;
    if (scroll) {
      const k = Math.min(1, (t - scroll.t0) / scroll.duration);
      await page.evaluate(`document.querySelector("main.kvfx-view").scrollTop = ${String(scroll.from + (scroll.to - scroll.from) * smooth(k))}`);
      if (k >= 1) scroll = null;
    }
    const pos = await cursorAtTime(t);
    if (pos && (!last || Math.abs(pos[0] - last[0]) + Math.abs(pos[1] - last[1]) > 0.2)) {
      await page.mouse.move(pos[0], pos[1]);
      last = pos;
    }
    while (pending.length > 0 && pending[0][0] <= t + 1e-6) {
      const [, kind, value, extra] = pending.shift();
      if (kind === "down") { await page.mouse.down(); down = true; }
      if (kind === "up") { await page.mouse.up(); down = false; }
      if (kind === "click") { await page.mouse.down(); await page.mouse.up(); lastClick = t; }
      // A drawn click only: a real one would open a native dropdown, which never renders here.
      if (kind === "tap") lastClick = t;
      if (kind === "key") await page.keyboard.press(value);
      if (kind === "type") await page.keyboard.type(value);
      if (kind === "scroll") scroll = { ...(await scrollTarget(page, value)), t0: t, duration: extra ?? 0.8 };
      if (kind === "select") await page.locator(value.sel).first().selectOption(extra);
    }
    await page.clock.runFor(1000 / FPS);
    const now = (f + 1) * (1000 / FPS);
    const age = lastClick < 0 ? -1 : (t - lastClick) * 1000;
    const [x, y] = pos ?? [0, 0];
    await page.evaluate(`window.__kvFrame(${String(now)}, ${String(x)}, ${String(y)}, ${String(pos !== null)}, ${String(down)}, ${String(age)})`);
    if (process.env["KVFX_CAPTURE_TRACE"] === "1") console.log(`${name} frame ${String(f)}`);
    if (!DRY) await shoot(page, join(frames, `f${String(f).padStart(4, "0")}.png`));
    else if (process.env["KVFX_CAPTURE_DEBUG"] === "1" && f % (FPS / 2) === 0) await page.screenshot({ path: join(frames, `debug-${String(f).padStart(4, "0")}.png`), scale: "css" });
  }
  await context.close();
  if (DRY) {
    console.log(`Walked ${name} (${String(total)} frames)`);
    return;
  }

  const target = join(name.startsWith("wt-") ? walkthroughDir : outDir, `${name}.mp4`);
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
await mkdir(walkthroughDir, { recursive: true });
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

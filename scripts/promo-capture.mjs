import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { repoRoot } from "./paths.mjs";
import { FEATURE_CLIPS } from "../promo/features/features.mjs";

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
 * promo/walkthrough/assets/clips instead; "tf-" clips are the Tools feature
 * videos' (promo/features/features.mjs) and go to promo/features/assets/clips,
 * each with a .json beside it: the cursor's path and the click times, which
 * the feature videos follow. --dry walks every clip without taking
 * screenshots, to check its targets resolve (and still writes the .json).
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
const featuresDir = join(repoRoot, "promo", "features", "assets", "clips");
const DRY = args.includes("--dry");
const framesRoot = join(repoRoot, "build", "promo-frames");

// ---------------------------------------------------------------------------
// Clips. Times in seconds; positions in CSS pixels of the 380 x 860 panel.
//   cursor: waypoints [t, x, y] or [t, target]; the cursor eases between them.
//           A target is { sel } (CSS), { button } (a button's exact text or
//           label) or { tab } (a tab's name), optionally with dx/dy; it is found when the cursor sets
//           off towards it, so it can follow a scroll.
//   events: [t, kind, ...] - down, up, click, tap (the ring only), key (a key name), type (one char),
//           scroll (target, seconds[, container]: brings it near the top of the view, or of
//           a scrolling list inside it given as a CSS selector),
//           select (target, value).
//   setup:  run once before the first frame (not recorded): fill or click.
// ---------------------------------------------------------------------------

/** Typing a string, one key event per character from t. */
function typed(t, text, perSecond = 14) {
  return [...text].map((c, i) => [t + i / perSecond, "type", c]);
}
const B = (button, dx = 0, dy = 0) => ({ button, dx, dy });
const S = (sel, dx = 0, dy = 0) => ({ sel, dx, dy });
const T = (tab) => ({ tab, dx: 0, dy: 0 });
/** The cursor resting on a target from t0 to t1. */
const stay = (t0, t1, target) => [[t0, target], [t1, target]];

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

  // Walkthrough: one continuous take per chapter, paced to its voiceover, so
  // every click happens once, as the voice names it. Between clicks the cursor
  // rests on what is being described. Times follow the caption estimates the
  // builder uses (walkthrough-script.jsxinc); WT_CLIP_CLICKS in
  // walkthrough-shots.jsxinc lists the clicks for the edit's sound and syncs.
  "wt-layouts": {
    tab: "generate",
    duration: 54,
    cursor: [
      [0, 330, 760],
      ...stay(2.6, 5.4, B("Layouts")),
      ...stay(6.6, 7.8, B("Chat Thread")),
      ...stay(8.4, 9.0, B("Notification")),
      ...stay(9.6, 10.2, B("Metric Cards")),
      ...stay(10.6, 11.0, B("Bar Chart")),
      ...stay(11.4, 12.1, B("Chat")),
      ...stay(12.6, 13.2, B("Chat Thread")),
      ...stay(13.6, 14.2, B("Data")),
      ...stay(14.7, 15.2, B("Metric Cards")),
      ...stay(15.6, 16.0, B("Bar Chart")),
      ...stay(16.4, 16.9, B("Cards")),
      ...stay(17.3, 17.9, B("Pricing Card")),
      ...stay(18.2, 18.6, B("Lists")),
      ...stay(18.9, 19.3, B("Kanban Board")),
      ...stay(19.6, 20.0, B("Frames")),
      ...stay(20.4, 20.9, B("Phone Frame")),
      ...stay(21.2, 21.7, B("Browser Window")),
      ...stay(22.1, 22.7, S('[data-section="gen.layouts"] .kvfx-filter[data-filter="All"]')),
      ...stay(23.4, 24.6, B("Line Chart")),
      ...stay(25.2, 26.4, B("Progress Ring")),
      ...stay(27.0, 28.2, B("Feature Card")),
      ...stay(28.8, 30.4, B("Card Stack")),
      ...stay(31.0, 31.8, B("Metric Cards")),
      ...stay(32.4, 34.9, S('input[aria-label="Labels"]', 60)),
      ...stay(35.5, 36.3, B("Dark")),
      ...stay(36.9, 37.8, S('[data-section="gen.layouts"] input[aria-label="Accent"]')),
      ...stay(39.2, 40.4, B("Build Layout", 40)),
      [42.5, B("Build Layout", 90, 60)],
      [54, B("Build Layout", 100, 70)],
    ],
    events: [
      [5.0, "click"], [11.7, "click"], [13.9, "click"], [16.6, "click"], [18.4, "click"], [19.8, "click"], [22.4, "click"],
      [31.4, "click"], [32.6, "click"], [32.7, "key", "Control+A"], ...typed(32.8, "Revenue, Signups, Conversion", 14),
      [35.9, "click"], [37.3, "tap"], [38.4, "scroll", B("Build Layout"), 0.7], [39.8, "click"],
    ],
  },
  "wt-motion": {
    tab: "generate",
    duration: 31,
    cursor: [
      [0, 330, 700],
      ...stay(2.6, 3.8, B("UI Motion")),
      ...stay(5.6, 9.2, S('[data-section="gen.uistagger"] select[aria-label="Style"]')),
      ...stay(9.6, 14.5, S('[data-section="gen.uistagger"] select[aria-label="Order"]')),
      ...stay(15.0, 16.4, S('[data-section="gen.uistagger"] input[aria-label="Stagger"]')),
      ...stay(16.9, 18.2, B("Stagger In", 30)),
      ...stay(21.6, 23.0, B("Build Card Carousel", 20)),
      ...stay(24.0, 25.4, S('[data-section="gen.cardcarousel"] input[aria-label="Side size"]')),
      ...stay(26.0, 27.6, S('[data-section="gen.cardcarousel"] input[aria-label="Side fade"]')),
      ...stay(28.4, 30.2, S('[data-section="gen.cardcarousel"] input[aria-label="Hold"]')),
      [31, S('[data-section="gen.cardcarousel"] input[aria-label="Hold"]', 30, 30)],
    ],
    events: [
      [3.2, "click"],
      [5.9, "tap"], [6.9, "select", S('[data-section="gen.uistagger"] select[aria-label="Style"]'), "pop"],
      [7.8, "select", S('[data-section="gen.uistagger"] select[aria-label="Style"]'), "slideLeft"],
      [8.6, "select", S('[data-section="gen.uistagger"] select[aria-label="Style"]'), "blur"],
      [9.9, "tap"], [10.4, "select", S('[data-section="gen.uistagger"] select[aria-label="Order"]'), "topDown"],
      [11.4, "select", S('[data-section="gen.uistagger"] select[aria-label="Order"]'), "leftRight"],
      [12.6, "select", S('[data-section="gen.uistagger"] select[aria-label="Order"]'), "centre"],
      [13.8, "select", S('[data-section="gen.uistagger"] select[aria-label="Order"]'), "random"],
      [14.4, "select", S('[data-section="gen.uistagger"] select[aria-label="Order"]'), "leftRight"],
      [14.4, "select", S('[data-section="gen.uistagger"] select[aria-label="Style"]'), "rise"],
      [15.2, "click"], [15.3, "key", "Control+A"], [15.5, "type", "2"],
      [17.3, "click"],
      [20.6, "scroll", S('[data-section="gen.cardcarousel"]'), 0.9], [22.4, "click"],
    ],
  },
  "wt-interact": {
    tab: "generate",
    duration: 39,
    cursor: [
      [0, 330, 700],
      ...stay(1.2, 2.2, B("UI Motion")),
      ...stay(4.2, 4.9, B("Arrow")),
      ...stay(5.3, 6.0, B("Hand")),
      ...stay(6.4, 7.1, B("Touch")),
      ...stay(7.6, 8.4, B("Arrow")),
      ...stay(9.0, 10.2, B("Add Cursor", 20)),
      ...stay(11.2, 12.8, S('[data-section="gen.cursor"] input[aria-label="Travel"]')),
      ...stay(13.6, 15.0, S('[data-section="gen.cursor"] input[aria-label="Arc"]')),
      ...stay(15.6, 16.8, S('[data-section="gen.cursor"] input[aria-label="Tilt"]')),
      ...stay(17.4, 18.4, B("Shadow")),
      ...stay(18.8, 19.8, B("Ripple")),
      ...stay(20.4, 22.2, B("Press")),
      ...stay(24.2, 25.6, B("Add Hover", 20)),
      ...stay(26.2, 27.0, S('[data-section="gen.hover"] input[aria-label="Grow"]')),
      ...stay(27.4, 28.4, S('[data-section="gen.hover"] input[aria-label="Lift"]')),
      ...stay(30.0, 32.4, S('input[aria-label="Typed text"]', 40)),
      ...stay(33.4, 34.6, B("Add Input Bar", 20)),
      [36, B("Add Input Bar", 60, 40)],
      [39, B("Add Input Bar", 70, 50)],
    ],
    events: [
      [1.6, "click"], [2.6, "scroll", S('[data-section="gen.cursor"]'), 0.8], [7.9, "click"], [9.6, "click"],
      [23.2, "scroll", S('[data-section="gen.hover"]'), 0.8], [24.8, "click"],
      [28.9, "scroll", S('[data-section="gen.inputbar"]'), 0.8], [30.2, "click"], [30.3, "key", "Control+A"], ...typed(30.4, "Show signups by week", 12),
      [33.9, "click"],
    ],
  },
  "wt-type": {
    tab: "text",
    duration: 39,
    cursor: [
      [0, 330, 760],
      ...stay(3.2, 4.2, B("Rise")),
      ...stay(4.4, 5.2, B("Pop")),
      ...stay(5.4, 6.2, B("Blur In")),
      ...stay(6.4, 7.2, B("Spin")),
      ...stay(7.4, 8.2, B("Zoom Out")),
      ...stay(8.4, 9.3, B("Bounce Drop")),
      ...stay(9.7, 10.0, B("Out")),
      ...stay(10.3, 11.4, B("In+Out")),
      ...stay(12.0, 12.5, B("Chars")),
      ...stay(12.9, 13.6, B("Words")),
      ...stay(14.0, 14.9, S('[data-section="text.animate"] select[aria-label="Order"]')),
      ...stay(15.2, 16.4, S('[data-section="text.animate"] select[aria-label="Ease"]')),
      ...stay(16.9, 17.6, B("Blur In")),
      ...stay(18.4, 19.6, B("Animate Text", 30)),
      ...stay(23.6, 28.4, S('input[aria-label="Phrase"]', 60)),
      ...stay(28.8, 29.4, B("Stack")),
      ...stay(29.8, 30.6, B("Drift")),
      ...stay(31.2, 32.4, B("Build Kinetic Title", 30)),
      ...stay(33.2, 36.0, S('[data-section="text.kinetic"] select[aria-label="Size"]')),
      [39, B("Build Kinetic Title", 70, 40)],
    ],
    events: [
      [10.6, "click"], [13.2, "click"], [17.2, "click"], [18.9, "click"],
      [22.4, "scroll", S('[data-section="text.kinetic"]'), 0.9],
      [24.0, "click"], [24.1, "key", "Control+A"], ...typed(24.2, "Dashboards that *actually* *move*", 9),
      [29.1, "click"], [30.2, "click"], [31.8, "click"],
      [33.6, "tap"], [34.2, "select", S('[data-section="text.kinetic"] select[aria-label="Size"]'), "9:16"],
    ],
  },
  "wt-scene": {
    tab: "generate",
    duration: 33,
    cursor: [
      [0, 330, 700],
      ...stay(1.2, 2.0, B("Scenes")),
      ...stay(4.9, 5.5, B("Drift")),
      ...stay(6.0, 6.6, B("Horizon")),
      ...stay(7.1, 7.8, B("Stars")),
      ...stay(8.3, 8.9, B("Drift")),
      ...stay(9.3, 10.3, S('select[aria-label="Palette"]')),
      ...stay(10.6, 11.0, B("Grain")),
      ...stay(11.3, 11.9, B("Add Backdrop", 20)),
      ...stay(13.0, 14.0, B("Add Dot Pulse", 20)),
      ...stay(14.4, 15.8, S('[data-section="gen.dotpulse"] input[aria-label="Spacing"]')),
      ...stay(17.2, 18.4, B("Make Glass", 20)),
      ...stay(18.8, 20.4, S('[data-section="gen.glass"] input[aria-label="Blur"]')),
      ...stay(21.8, 23.0, B("Wipe", 20)),
      ...stay(23.4, 24.8, S('[data-section="gen.wipe"] input[aria-label="Edge"]')),
      ...stay(26.0, 27.3, S('input[aria-label="Headline"]', 40)),
      ...stay(27.8, 29.0, B("Build Title", 20)),
      [33, B("Build Title", 60, 40)],
    ],
    events: [
      [1.6, "click"], [5.1, "click"], [6.2, "click"], [7.3, "click"], [8.5, "click"],
      [9.5, "tap"], [9.8, "select", S('select[aria-label="Palette"]'), "violet"], [10.1, "select", S('select[aria-label="Palette"]'), "ember"],
      [11.6, "click"],
      [12.1, "scroll", S('[data-section="gen.dotpulse"]'), 0.7], [13.4, "click"],
      [16.2, "scroll", S('[data-section="gen.glass"]'), 0.8], [17.6, "click"],
      [20.8, "scroll", S('[data-section="gen.wipe"]'), 0.8], [22.2, "click"],
      [25.2, "scroll", S('[data-section="gen.codeglyphs"]'), 0.6], [26.2, "click"], [26.3, "key", "Control+A"], ...typed(26.4, "KOVO API", 10),
      [28.2, "click"],
    ],
  },
  "wt-polish": {
    tab: "ease",
    duration: 36,
    // The align bar's reference starts on Auto; Grp is three clicks along,
    // made before recording so the viewer never sees one spot clicked thrice.
    setup: [["click", ".kvfx-cycle"], ["click", ".kvfx-cycle"], ["click", ".kvfx-cycle"]],
    cursor: [
      [0, 330, 620],
      [2.6, 250, 360], [4.4, 230, 330], [5.2, 163, 432],
      [5.6, 163, 432], [6.6, 136, 271], [6.8, 136, 271],
      [7.0, 217, 271], [7.1, 217, 271], [7.9, 158, 271], [8.2, 158, 271],
      ...stay(8.7, 9.5, B("Apply to Keys", 30)),
      ...stay(11.4, 12.2, B("Add Elastic", 20)),
      ...stay(12.6, 13.4, B("Add Bounce", 20)),
      ...stay(13.8, 14.3, T("Tools")),
      ...stay(15.6, 16.4, B("Top leads")),
      ...stay(16.8, 17.8, B("Follow", 20)),
      ...stay(18.4, 19.2, B("Rotation")),
      ...stay(19.6, 20.6, B("Scale")),
      ...stay(21.0, 22.6, B("Opacity")),
      ...stay(23.6, 24.6, S(".kvfx-cycle")),
      ...stay(25.0, 26.0, B("Align vertical centre")),
      ...stay(26.6, 28.8, B("Align horizontal centre")),
      ...stay(30.6, 31.4, S('[data-section="tools.arrange"] input[aria-label="Gap"]', 30)),
      ...stay(32.0, 33.2, B("Even gaps horizontally")),
      [36, B("Even gaps horizontally", 50, 40)],
    ],
    events: [
      [5.6, "down"], [6.7, "up"], [7.1, "down"], [8.0, "up"], [9.0, "click"],
      [10.6, "scroll", S('[data-section="ease.motion"]'), 0.7], [11.8, "click"], [13.0, "click"],
      [14.1, "click"], [14.6, "scroll", S('[data-section="tools.follow"]'), 0.8], [17.3, "click"],
      [25.4, "click"],
      [29.6, "scroll", S('[data-section="tools.arrange"]'), 0.8], [30.9, "click"], [31.0, "key", "Control+A"], ...typed(31.1, "60", 8),
      [32.5, "click"],
    ],
  },
  "wt-ship": {
    tab: "tools",
    duration: 33,
    cursor: [
      [0, 330, 760],
      ...stay(2.4, 3.6, S('[data-section="tools.silence"] canvas')),
      ...stay(4.0, 4.8, B("Analyse")),
      ...stay(5.4, 6.6, S('[data-section="tools.silence"] canvas')),
      ...stay(7.2, 8.6, S('input[aria-label="Padding"]')),
      ...stay(9.4, 10.2, B("Cut Pauses")),
      ...stay(10.7, 11.5, S(".kvfx-dialog__actions button:last-child")),
      ...stay(13.6, 14.4, S('select[aria-label="Format"]')),
      ...stay(15.0, 17.8, S('[data-section="tools.resize"] input[aria-label="H"]')),
      ...stay(18.3, 18.9, S('.kvfx-anchors--pick button[aria-label="topLeft"]')),
      ...stay(19.3, 20.4, S('.kvfx-anchors--pick button[aria-label="centre"]')),
      ...stay(20.9, 21.6, B("Resize Comps", 20)),
      ...stay(22.2, 23.0, S(".kvfx-dialog__actions button:last-child")),
      ...stay(23.9, 24.4, T("Library")),
      ...stay(25.5, 26.2, B("Find Missing")),
      ...stay(26.7, 27.4, B("Search…")),
      ...stay(27.9, 29.0, S('[data-section="library.relink"] .kvfx-list')),
      ...stay(29.4, 30.1, S('[data-section="library.relink"] .kvfx-primary', 20)),
      ...stay(30.4, 31.1, S(".kvfx-dialog__actions button:last-child")),
      [33, 200, 600],
    ],
    events: [
      [0.4, "scroll", S('[data-section="tools.silence"]'), 0.9], [4.4, "click"], [9.8, "click"], [11.1, "click"],
      [12.4, "scroll", S('[data-section="tools.resize"]'), 0.8], [13.9, "tap"],
      [14.2, "select", S('select[aria-label="Format"]'), "vertical"], [16.0, "select", S('select[aria-label="Format"]'), "square"],
      [17.0, "select", S('select[aria-label="Format"]'), "portrait"], [18.0, "select", S('select[aria-label="Format"]'), "vertical"],
      [21.3, "click"], [22.6, "click"],
      [24.2, "click"], [24.6, "scroll", S('[data-section="library.relink"]'), 0.5], [25.9, "click"], [27.1, "click"], [29.7, "click"], [30.7, "click"],
    ],
  },
  "wt-more": {
    tab: "tools",
    duration: 33,
    cursor: [
      [0, 330, 760],
      ...stay(1.0, 2.4, T("Tools")),
      ...stay(4.0, 5.6, B("Duplicate Comp + Nested Comps")),
      ...stay(7.4, 8.4, B("Precomp")),
      ...stay(8.8, 9.3, T("Text")),
      ...stay(10.2, 11.0, B("Explode Text", 20)),
      ...stay(12.2, 13.4, B("Scan Project Fonts", 20)),
      ...stay(14.0, 14.6, T("FX")),
      ...stay(15.0, 16.0, B("Scan Selected Layers", 20)),
      ...stay(16.3, 16.8, T("Generate")),
      ...stay(17.1, 17.6, B("Builders")),
      ...stay(18.2, 18.9, B("Create Counter", 20)),
      ...stay(19.5, 20.1, B("Build Carousel", 20)),
      ...stay(20.5, 21.1, B("Extrude", 20)),
      ...stay(21.5, 22.0, T("Labels")),
      [22.6, 200, 300], [23.4, 260, 320],
      ...stay(23.8, 24.2, T("Library")),
      ...stay(24.6, 25.4, B("Add Folder", 20)),
      ...stay(25.7, 26.2, T("Media")),
      ...stay(26.6, 27.8, S('[aria-label="Paste or drop media here"]')),
      ...stay(28.1, 28.8, B("Search commands")),
      [30, 200, 300], [33, 200, 320],
    ],
    events: [
      [2.9, "scroll", S('[data-section="tools.duplicate"]'), 0.7], [4.8, "click"], [6.8, "scroll", S('[data-section="tools.layer"]'), 0.5],
      [9.1, "click"], [9.4, "scroll", S('[data-section="text.explode"]'), 0.7], [11.2, "scroll", S('[data-section="text.fonts"]'), 0.6], [12.8, "click"],
      [14.3, "click"], [15.5, "click"], [16.6, "click"], [17.4, "click"], [17.7, "scroll", S('[data-section="gen.counter"]'), 0.4],
      [21.8, "click"], [24.0, "click"], [26.0, "click"], [28.5, "click"], ...typed(29.0, "unprecomp", 9), [31.4, "key", "Enter"],
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
  ...FEATURE_CLIPS,
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

async function scrollTarget(page, target, within = "main.kvfx-view") {
  const handle =
    target.sel !== undefined
      ? page.locator(target.sel).first()
      : page.getByRole("button", { name: target.button, exact: true }).first();
  const element = await handle.elementHandle({ timeout: 2000 });
  if (!element) throw new Error(`Cannot scroll to ${JSON.stringify(target)}`);
  const span = await element.evaluate((el, selector) => {
    const view = el.closest(selector) ?? el.ownerDocument.querySelector(selector);
    if (!view) return { from: 0, to: 0 };
    const top = el.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - 10;
    return { from: view.scrollTop, to: Math.max(0, Math.min(view.scrollHeight - view.clientHeight, top)) };
  }, within);
  return { ...span, within };
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
    if (step[0] === "click") {
      await page.locator(step[1]).first().click();
      await page.clock.runFor(200);
    }
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
  // The cursor's path and the clicks, for clips that are edited to follow them.
  const track = [];
  const clicks = [];
  for (let f = 0; f < total; f++) {
    const t = f / FPS;
    if (scroll) {
      const k = Math.min(1, (t - scroll.t0) / scroll.duration);
      await page.evaluate(`document.querySelector(${JSON.stringify(scroll.within)}).scrollTop = ${String(scroll.from + (scroll.to - scroll.from) * smooth(k))}`);
      if (k >= 1) scroll = null;
    }
    const pos = await cursorAtTime(t);
    if (pos && (!last || Math.abs(pos[0] - last[0]) + Math.abs(pos[1] - last[1]) > 0.2)) {
      await page.mouse.move(pos[0], pos[1]);
      last = pos;
    }
    while (pending.length > 0 && pending[0][0] <= t + 1e-6) {
      const [, kind, value, extra, within] = pending.shift();
      if (kind === "down") { await page.mouse.down(); down = true; }
      if (kind === "up") { await page.mouse.up(); down = false; }
      if (kind === "click") { await page.mouse.down(); await page.mouse.up(); lastClick = t; clicks.push(t); }
      // A drawn click only: a real one would open a native dropdown, which never renders here.
      if (kind === "tap") { lastClick = t; clicks.push(t); }
      if (kind === "key") await page.keyboard.press(value);
      if (kind === "type") await page.keyboard.type(value);
      if (kind === "scroll") scroll = { ...(await scrollTarget(page, value, within)), t0: t, duration: extra ?? 0.8 };
      if (kind === "select") await page.locator(value.sel).first().selectOption(extra);
    }
    await page.clock.runFor(1000 / FPS);
    const now = (f + 1) * (1000 / FPS);
    const age = lastClick < 0 ? -1 : (t - lastClick) * 1000;
    const [x, y] = pos ?? [0, 0];
    track.push(pos ? [Math.round(x * 10) / 10, Math.round(y * 10) / 10] : null);
    await page.evaluate(`window.__kvFrame(${String(now)}, ${String(x)}, ${String(y)}, ${String(pos !== null)}, ${String(down)}, ${String(age)})`);
    if (process.env["KVFX_CAPTURE_TRACE"] === "1") console.log(`${name} frame ${String(f)}`);
    if (!DRY) await shoot(page, join(frames, `f${String(f).padStart(4, "0")}.png`));
    else if (process.env["KVFX_CAPTURE_DEBUG"] === "1" && f % (FPS / 2) === 0) await page.screenshot({ path: join(frames, `debug-${String(f).padStart(4, "0")}.png`), scale: "css" });
  }
  await context.close();
  if (name.startsWith("tf-")) {
    await mkdir(featuresDir, { recursive: true });
    const sidecar = { fps: FPS, size: [VIEWPORT.width, VIEWPORT.height], clicks, cursor: track };
    await writeFile(join(featuresDir, `${name}.json`), JSON.stringify(sidecar) + "\n");
  }
  if (DRY) {
    console.log(`Walked ${name} (${String(total)} frames)`);
    return;
  }

  const target = join(name.startsWith("wt-") ? walkthroughDir : name.startsWith("tf-") ? featuresDir : outDir, `${name}.mp4`);
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

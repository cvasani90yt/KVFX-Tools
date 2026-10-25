// The feature-video studio: draws any frame of any feature video, at 16:9
// (panel left, comp right) or 9:16 (comp above, panel below), from the
// panel recording and its cursor track. scripts/feature-videos.mjs drives it
// frame by frame; opening studio.html?feature=follow&layout=16x9&t=12 shows
// one frame for a quick look.

import { FEATURES } from "./features.mjs";
import { C, FONT, SCENES, STAGE, clamp, io, out, rr, seg, text } from "./scenes.mjs";

const FPS = 30;
const INTRO = 2.6;
const OUTRO = 3.4;
const PANEL = { w: 380, h: 860 };

const LAYOUTS = {
  "16x9": {
    W: 1920,
    H: 1080,
    panel: { x: 60, y: 150, w: 560, h: 846 },
    stage: { x: 680, y: 150, w: 1180 },
    head: { x: 680, eyebrow: 62, title: 122, size: 46 },
    brand: { x: 60, y: 108 },
    caption: { x: 680, y: 1046, size: 31, w: 1180, lines: 1 },
    progress: "bottom",
  },
  "9x16": {
    W: 1080,
    H: 1920,
    panel: { x: 160, y: 1170, w: 760, h: 440 },
    stage: { x: 40, y: 425, w: 1000 },
    head: { x: 60, eyebrow: 176, title: 252, size: 60 },
    brand: { x: 60, y: 1690 },
    caption: { x: 60, y: 326, size: 40, w: 960, lines: 2 },
    progress: "top",
  },
};

const canvas = document.getElementById("frame");
const ctx = canvas.getContext("2d");

const state = {
  feature: null,
  index: 0,
  layout: LAYOUTS["16x9"],
  track: null,
  tops: null,
  duration: 0,
  frames: "",
  cache: new Map(),
};

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function fonts() {
  const faces = [
    `700 120px ${FONT.display}`,
    `600 60px ${FONT.display}`,
    `600 30px ${FONT.ui}`,
    `500 30px ${FONT.ui}`,
    `700 30px ${FONT.ui}`,
    `600 20px ${FONT.mono}`,
    `700 20px ${FONT.mono}`,
  ];
  await Promise.all(faces.map((f) => document.fonts.load(f, "KVFX Tools 0123 Aa").catch(() => [])));
  return document.fonts.check(`700 40px Unbounded`, "KVFX");
}

/**
 * Where the panel window looks, frame by frame: it follows the cursor with a
 * soft spring, a little ahead of it, and stays still while the cursor is
 * comfortably inside the window.
 */
function panelTops(track, visible) {
  const n = track.length;
  const ys = new Array(n);
  let last = PANEL.h / 2;
  for (let i = 0; i < n; i++) {
    const p = track[i];
    if (p) last = p[1];
    ys[i] = last;
  }
  const lead = Math.round(0.5 * FPS);
  const maxTop = PANEL.h - visible;
  const want = (i) => clamp(ys[Math.min(n - 1, i + lead)] - visible * 0.42, 0, maxTop);
  const tops = new Float32Array(n);
  // Start where the first rest is, so the opening frame doesn't pan.
  let top = want(Math.min(n - 1, Math.round(2.4 * FPS)));
  let v = 0;
  const omega = 5.5;
  const dt = 1 / FPS;
  for (let i = 0; i < n; i++) {
    const y = ys[Math.min(n - 1, i + lead)];
    const inside = y > top + visible * 0.18 && y < top + visible * 0.78;
    // Still while the cursor waits at its starting spot.
    const target = inside || i < 1.6 * FPS ? top : want(i);
    v += (omega * omega * (target - top) - 2 * omega * v) * dt;
    top += v * dt;
    tops[i] = clamp(top, 0, maxTop);
  }
  return tops;
}

async function load(id, layoutName = "16x9", framesBase = "") {
  state.index = FEATURES.findIndex((f) => f.id === id);
  if (state.index < 0) throw new Error(`Unknown feature ${id}`);
  state.feature = FEATURES[state.index];
  state.layout = LAYOUTS[layoutName];
  canvas.width = state.layout.W;
  canvas.height = state.layout.H;
  const response = await fetch(`./assets/clips/${state.feature.clip}.json`);
  state.track = await response.json();
  const visible = state.layout.panel.h / (state.layout.panel.w / PANEL.w);
  state.tops = panelTops(state.track.cursor, visible);
  state.duration = state.track.cursor.length / FPS;
  state.frames = framesBase;
  state.cache.clear();
  const fontsOk = await fonts();
  return { total: INTRO + state.duration + OUTRO, clicks: state.track.clicks.map((t) => t + INTRO), intro: INTRO, fontsOk };
}

async function panelFrame(c) {
  if (!state.frames) return null;
  const i = clamp(Math.round(c * FPS), 0, state.track.cursor.length - 1);
  if (state.cache.has(i)) return state.cache.get(i);
  const img = new Image();
  img.src = `${state.frames}/f${String(i + 1).padStart(4, "0")}.jpg`;
  try {
    await img.decode();
  } catch {
    return null;
  }
  if (state.cache.size > 8) state.cache.delete(state.cache.keys().next().value);
  state.cache.set(i, img);
  return img;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function wrap(s, font, width) {
  ctx.font = font;
  const words = s.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function background(L) {
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, L.W, L.H);
  ctx.fillStyle = "#15171c";
  for (let y = 20; y < L.H; y += 40) for (let x = 20; x < L.W; x += 40) ctx.fillRect(x - 1, y - 1, 2, 2);
  const sx = L.stage.x + L.stage.w / 2;
  const sy = L.stage.y + (STAGE.h * L.stage.w) / STAGE.w / 2;
  const g = ctx.createRadialGradient(sx, sy, 20, sx, sy, Math.max(L.W, L.H) * 0.55);
  g.addColorStop(0, "rgba(255,143,63,0.10)");
  g.addColorStop(1, "rgba(255,143,63,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L.W, L.H);
}

function mark(x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = C.amber;
  ctx.fillRect(-s / 2, -s / 2, s, s);
  ctx.fillStyle = C.ink;
  ctx.fillRect(-s / 5, -s / 5, (s * 2) / 5, (s * 2) / 5);
  ctx.restore();
}

const pad2 = (n) => String(n).padStart(2, "0");

function rise(t, delay = 0) {
  const k = out(seg(t, delay, delay + 0.55));
  return { a: k, dy: (1 - k) * 34 };
}

function titleCard(v, alpha) {
  if (alpha <= 0) return;
  const L = state.layout;
  const f = state.feature;
  const vertical = L.H > L.W;
  ctx.save();
  ctx.globalAlpha = alpha;
  const x = vertical ? 80 : 160;
  const width = vertical ? 920 : 1500;
  let y = vertical ? 700 : 300;
  const parts = [
    () => {
      const r = rise(v, -0.4);
      ctx.globalAlpha = alpha * r.a;
      mark(x + 14, y - 10 + r.dy, 22);
      text(ctx, "KVFX TOOLS  ·  TOP 10 TOOLS FEATURES", x + 44, y + r.dy, `700 ${vertical ? 26 : 24}px ${FONT.mono}`, C.amber);
      y += vertical ? 250 : 230;
    },
    () => {
      const r = rise(v, -0.32);
      ctx.globalAlpha = alpha * r.a;
      text(ctx, pad2(state.index + 1), x - 8, y + r.dy, `700 ${vertical ? 230 : 210}px ${FONT.display}`, C.amber);
      y += vertical ? 140 : 130;
    },
    () => {
      const r = rise(v, -0.24);
      ctx.globalAlpha = alpha * r.a;
      const font = `700 ${vertical ? 86 : 100}px ${FONT.display}`;
      const lines = wrap(f.title, font, width);
      lines.forEach((line, i) => text(ctx, line, x, y + r.dy + i * (vertical ? 100 : 112), font, C.fg));
      y += lines.length * (vertical ? 100 : 112) - (vertical ? 20 : 30) + 40;
    },
    () => {
      const r = rise(v, -0.16);
      ctx.globalAlpha = alpha * r.a;
      const font = `500 ${vertical ? 42 : 40}px ${FONT.ui}`;
      wrap(f.promise, font, width).forEach((line, i) => text(ctx, line, x, y + 12 + r.dy + i * 56, font, C.fg2));
    },
  ];
  for (const p of parts) p();
  ctx.restore();
}

function endCard(v, alpha) {
  if (alpha <= 0) return;
  const L = state.layout;
  const f = state.feature;
  const next = FEATURES[state.index + 1];
  const vertical = L.H > L.W;
  const t = v - (INTRO + state.duration);
  ctx.save();
  ctx.globalAlpha = alpha;
  const cx = L.W / 2;
  let y = vertical ? 760 : 380;
  let r = rise(t, 0.05);
  ctx.globalAlpha = alpha * r.a;
  ctx.font = `700 ${vertical ? 92 : 100}px ${FONT.display}`;
  const word = "KVFX Tools";
  const ww = ctx.measureText(word).width;
  mark(cx - ww / 2 - 46, y - 34 + r.dy, 44);
  text(ctx, word, cx + 30, y + r.dy, `700 ${vertical ? 92 : 100}px ${FONT.display}`, C.fg, "center");
  y += 74;
  r = rise(t, 0.15);
  ctx.globalAlpha = alpha * r.a;
  text(ctx, "for Adobe After Effects", cx, y + r.dy, `500 ${vertical ? 40 : 38}px ${FONT.ui}`, C.fg2, "center");
  y += vertical ? 130 : 110;
  r = rise(t, 0.25);
  ctx.globalAlpha = alpha * r.a;
  text(ctx, `${f.title}  ·  ${f.where}`, cx, y + r.dy, `700 ${vertical ? 30 : 30}px ${FONT.mono}`, C.amber, "center");
  y += vertical ? 120 : 100;
  r = rise(t, 0.35);
  ctx.globalAlpha = alpha * r.a;
  const label = next ? `Next  ·  ${pad2(state.index + 2)}  ${next.title}` : "That's the top ten. 100+ commands inside.";
  ctx.font = `600 ${vertical ? 34 : 32}px ${FONT.ui}`;
  const w = ctx.measureText(label).width + 64;
  rr(ctx, cx - w / 2, y - 40 + r.dy, w, 64, 32);
  ctx.strokeStyle = C.amber;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  text(ctx, label, cx, y - 8 + r.dy, `600 ${vertical ? 34 : 32}px ${FONT.ui}`, C.fg, "center", "middle");
  ctx.restore();
}

function header(alpha) {
  const L = state.layout;
  const f = state.feature;
  ctx.save();
  ctx.globalAlpha = alpha;
  text(ctx, `${pad2(state.index + 1)} / 10   ·   ${f.where.toUpperCase()}`, L.head.x, L.head.eyebrow, `700 ${L.H > L.W ? 26 : 20}px ${FONT.mono}`, C.amber);
  text(ctx, f.title, L.head.x - 2, L.head.title, `600 ${L.head.size}px ${FONT.display}`, C.fg);
  if (L.W > L.H) {
    mark(L.brand.x + 12, L.brand.y - 9, 20);
    text(ctx, "KVFX PANEL", L.brand.x + 34, L.brand.y, `700 20px ${FONT.mono}`, C.fg2);
  } else {
    mark(L.brand.x + 12, L.brand.y - 10, 22);
    text(ctx, "KVFX Tools for After Effects", L.brand.x + 38, L.brand.y, `600 30px ${FONT.ui}`, C.fg2);
  }
  ctx.restore();
}

function caption(c, alpha) {
  const L = state.layout;
  const caps = state.feature.captions;
  let i = -1;
  for (let k = 0; k < caps.length; k++) if (c >= caps[k][0]) i = k;
  if (i < 0) return;
  const [t0, s] = caps[i];
  const k = out(seg(c, t0, t0 + 0.3));
  const font = `600 ${L.caption.size}px ${FONT.ui}`;
  const lines = wrap(s, font, L.caption.w).slice(0, L.caption.lines);
  ctx.save();
  ctx.globalAlpha = alpha * k;
  const lh = L.caption.size * 1.25;
  lines.forEach((line, n) => text(ctx, line, L.caption.x, L.caption.y + (1 - k) * 14 + n * lh, font, C.fg));
  ctx.restore();
}

async function panelWindow(c, alpha, slide) {
  const L = state.layout;
  const P = L.panel;
  const s = P.w / PANEL.w;
  const visible = P.h / s;
  const i = clamp(Math.round(c * FPS), 0, state.tops.length - 1);
  const top = state.tops[i];
  const img = await panelFrame(c);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(0, slide);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 14;
  rr(ctx, P.x, P.y, P.w, P.h, 18);
  ctx.fillStyle = C.raised;
  ctx.fill();
  ctx.restore();
  ctx.save();
  rr(ctx, P.x, P.y, P.w, P.h, 18);
  ctx.clip();
  if (img) {
    const k = img.naturalWidth / PANEL.w;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, top * k, img.naturalWidth, visible * k, P.x, P.y, P.w, P.h);
  } else {
    text(ctx, "panel recording", P.x + P.w / 2, P.y + P.h / 2, `600 24px ${FONT.mono}`, C.mute, "center");
  }
  ctx.restore();
  rr(ctx, P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1, 18);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  // Where in the panel this is: a thin scroll indicator.
  const barH = (visible / PANEL.h) * (P.h - 24);
  const barY = P.y + 12 + (top / PANEL.h) * (P.h - 24);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  rr(ctx, P.x + P.w + 10, barY, 4, barH, 2);
  ctx.fill();
  ctx.restore();
}

function stage(c, alpha, slide) {
  const L = state.layout;
  const k = L.stage.w / STAGE.w;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(L.stage.x, L.stage.y + slide);
  ctx.scale(k, k);
  SCENES[state.feature.id](ctx, c, state.feature);
  ctx.restore();
}

function progress(v, total) {
  const L = state.layout;
  const y = L.progress === "bottom" ? L.H - 5 : 0;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, y, L.W, 5);
  ctx.fillStyle = C.amber;
  ctx.fillRect(0, y, L.W * clamp(v / total), 5);
}

async function renderAt(v) {
  const L = state.layout;
  const D = state.duration;
  const total = INTRO + D + OUTRO;
  const c = clamp(v - INTRO, 0, D);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  background(L);
  const inK = io(seg(v, INTRO - 0.55, INTRO + 0.15));
  const outK = io(seg(v, INTRO + D - 0.15, INTRO + D + 0.45));
  const main = inK * (1 - outK);
  titleCard(v, 1 - io(seg(v, INTRO - 0.6, INTRO - 0.05)));
  if (main > 0) {
    header(main);
    await panelWindow(c, main, (1 - inK) * 40 - outK * 30);
    stage(c, main, (1 - inK) * 60 - outK * 30);
    caption(c, main);
  }
  endCard(v, io(seg(v, INTRO + D - 0.05, INTRO + D + 0.5)));
  progress(v, total);
}

globalThis.studio = { load, renderAt, features: FEATURES.map((f) => f.id), INTRO, OUTRO, FPS };

// A single frame for a quick look: studio.html?feature=follow&layout=16x9&t=12&frames=/frames/tf-follow
const params = new URLSearchParams(location.search);
if (params.has("feature")) {
  load(params.get("feature"), params.get("layout") ?? "16x9", params.get("frames") ?? "").then(() =>
    renderAt(Number(params.get("t") ?? 8)).then(() => {
      document.body.dataset.ready = "1";
    }),
  );
}

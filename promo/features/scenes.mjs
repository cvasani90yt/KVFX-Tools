// The right-hand side of each feature video: an After Effects-style viewer
// that shows what the command does, timed to the clicks in the panel
// recording. Every scene is a pure function of time, so any frame can be
// drawn in any order.
//
// The geometry follows the shipped code: Even Gaps keeps the first layer and
// shares the span; Align as Group moves the selection's bounds; Sequence
// ranks centre-out as |i − mid|; Comp Resizer's Fit scales by the smaller
// ratio around the pinned spot; Follow adds the leader's change since the
// click, delayed; the anchor grid moves the anchor and compensates position.

export const C = {
  ink: "#0e0f12",
  raised: "#16181d",
  overlay: "#1d2026",
  hover: "#23262e",
  line: "#2a2e37",
  fg: "#e8eaed",
  fg2: "#9aa0ab",
  mute: "#79818e",
  amber: "#ff8f3f",
  amberHi: "#ffa45c",
  amberInk: "#241200",
  amberSoft: "rgba(255, 143, 63, 0.16)",
  ok: "#3fb950",
  red: "#f05c5c",
  blue: "#7fa8ff",
  teal: "#5ec8b0",
  yellow: "#e3c44a",
  violet: "#a78bfa",
  paste: "#191b20",
  comp: "#262a31",
  dots: "#30353f",
};

export const FONT = {
  display: 'Unbounded, "Inter Display", Inter, sans-serif',
  ui: 'Inter, system-ui, sans-serif',
  mono: '"JetBrains Mono", monospace',
};

// ---------------------------------------------------------------------------
// Maths and drawing helpers
// ---------------------------------------------------------------------------

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const seg = (t, a, b) => clamp((t - a) / (b - a));
export const io = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const out = (t) => 1 - Math.pow(1 - t, 3);
export const back = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const smooth = (u) => u * u * (3 - 2 * u);
const hash = (i) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function text(ctx, s, x, y, font, color, align = "left", base = "alphabetic") {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillText(s, x, y);
}

export function tcode(t) {
  const f = Math.max(0, Math.floor(t * 30 + 1e-6));
  const s = Math.floor(f / 30);
  return `0:00:${String(s).padStart(2, "0")}:${String(f % 30).padStart(2, "0")}`;
}

function pill(ctx, label, x, y, { fill = C.amber, ink = C.amberInk, size = 15, align = "left", border = null } = {}) {
  ctx.font = `700 ${size}px ${FONT.mono}`;
  const w = ctx.measureText(label).width + size * 1.4;
  const h = size * 1.75;
  const left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
  rr(ctx, left, y - h / 2, w, h, h / 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  text(ctx, label, left + w / 2, y + 1, `700 ${size}px ${FONT.mono}`, ink, "center", "middle");
  return w;
}

/** An After Effects-style selection box with corner handles, in comp units. */
function selBox(ctx, x, y, w, h, k, color = C.amber, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 / k;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = color;
  const s = 7 / k;
  for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]]) {
    ctx.fillRect(hx - s / 2, hy - s / 2, s, s);
  }
  ctx.restore();
}

/** After Effects' anchor point mark: a ring with a cross. */
function anchorMark(ctx, x, y, k, color = C.fg) {
  const r = 11 / k;
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 4 / k;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.moveTo(x - r * 1.7, y);
  ctx.lineTo(x + r * 1.7, y);
  ctx.moveTo(x, y - r * 1.7);
  ctx.lineTo(x, y + r * 1.7);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 / k;
  ctx.stroke();
  ctx.restore();
}

/** The two-ring handle After Effects draws for a ramp's start and end points. */
function rampHandle(ctx, x, y, k, color) {
  ctx.save();
  ctx.lineWidth = 2.4 / k;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.arc(x, y, 13 / k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 / k;
  ctx.beginPath();
  ctx.arc(x, y, 13 / k, 0, Math.PI * 2);
  ctx.moveTo(x - 20 / k, y);
  ctx.lineTo(x + 20 / k, y);
  ctx.moveTo(x, y - 20 / k);
  ctx.lineTo(x, y + 20 / k);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The stage: a viewer with a title bar, and a strip panel below it
// ---------------------------------------------------------------------------

export const STAGE = { w: 1200, h: 860 };
const BAR = 38;
const GAP = 12;

function frame(ctx, { title, tc = "", stripH = 140, stripTitle = "", stripRight = "", stripRightColor = C.amber }) {
  const vh = STAGE.h - (stripH > 0 ? GAP + stripH : 0);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 10;
  rr(ctx, 0, 0, STAGE.w, vh, 14);
  ctx.fillStyle = C.raised;
  ctx.fill();
  ctx.restore();
  ctx.save();
  rr(ctx, 0, 0, STAGE.w, vh, 14);
  ctx.clip();
  ctx.fillStyle = C.paste;
  ctx.fillRect(0, BAR, STAGE.w, vh - BAR);
  ctx.restore();
  rr(ctx, 0.5, 0.5, STAGE.w - 1, vh - 1, 14);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = C.line;
  ctx.fillRect(0, BAR, STAGE.w, 1.5);
  ctx.fillStyle = C.amber;
  ctx.fillRect(18, BAR / 2 - 5, 10, 10);
  text(ctx, title, 38, BAR / 2 + 1, `600 16px ${FONT.mono}`, C.fg, "left", "middle");
  if (tc) text(ctx, tc, STAGE.w - 18, BAR / 2 + 1, `600 16px ${FONT.mono}`, C.amber, "right", "middle");
  const area = { x: 0, y: BAR + 1.5, w: STAGE.w, h: vh - BAR - 1.5 };

  let strip = null;
  if (stripH > 0) {
    const y = vh + GAP;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 8;
    rr(ctx, 0, y, STAGE.w, stripH, 14);
    ctx.fillStyle = C.raised;
    ctx.fill();
    ctx.restore();
    rr(ctx, 0.5, y + 0.5, STAGE.w - 1, stripH - 1, 14);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    text(ctx, stripTitle.toUpperCase(), 20, y + 26, `700 14px ${FONT.mono}`, C.fg2);
    if (stripRight) text(ctx, stripRight, STAGE.w - 20, y + 26, `600 15px ${FONT.mono}`, stripRightColor, "right");
    strip = { x: 20, y: y + 44, w: STAGE.w - 40, h: stripH - 56 };
  }
  return { area, strip };
}

/** Fits a comp of cw × ch into the viewer area. */
function compView(area, cw, ch, margin = 26) {
  const k = Math.min((area.w - margin * 2) / cw, (area.h - margin * 2) / ch);
  return { x: area.x + (area.w - cw * k) / 2, y: area.y + (area.h - ch * k) / 2, k, w: cw, h: ch };
}

/** Enters comp space: draws the comp's background and clips to it. Call ctx.restore() after. */
function enterComp(ctx, cv, bg = C.comp, dots = true) {
  ctx.save();
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = bg;
  ctx.fillRect(cv.x, cv.y, cv.w * cv.k, cv.h * cv.k);
  ctx.restore();
  ctx.beginPath();
  ctx.rect(cv.x, cv.y, cv.w * cv.k, cv.h * cv.k);
  ctx.clip();
  ctx.translate(cv.x, cv.y);
  ctx.scale(cv.k, cv.k);
  if (dots) {
    ctx.fillStyle = C.dots;
    for (let y = 60; y < cv.h; y += 60) for (let x = 60; x < cv.w; x += 60) ctx.fillRect(x - 2, y - 2, 4, 4);
  }
}

/** A list of commands run, newest last: each is one undo step. */
function history(ctx, strip, entries, c) {
  const done = entries.filter(([t]) => c >= t);
  const shown = done.slice(-3);
  const rowH = 26;
  shown.forEach(([t, label], i) => {
    const y = strip.y + 8 + i * rowH;
    const fresh = i === shown.length - 1;
    const a = seg(c, t, t + 0.3);
    ctx.save();
    ctx.globalAlpha = fresh ? 0.35 + 0.65 * a : 0.55;
    ctx.fillStyle = fresh ? C.amber : C.mute;
    ctx.fillRect(strip.x, y - 6, 8, 8);
    text(ctx, label, strip.x + 20, y + 2, `600 17px ${FONT.ui}`, fresh ? C.fg : C.fg2);
    text(ctx, "1 undo step", strip.x + strip.w, y + 2, `500 14px ${FONT.mono}`, C.mute, "right");
    ctx.restore();
  });
  if (done.length === 0) text(ctx, "Nothing run yet", strip.x, strip.y + 10, `500 16px ${FONT.ui}`, C.mute);
}

// ---------------------------------------------------------------------------
// Shared artwork: the Kovo promo used by several scenes
// ---------------------------------------------------------------------------

function promoBackground(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
  g.addColorStop(0, "#251a2e");
  g.addColorStop(1, "#120f16");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * 0.78, h * 0.25, 10, w * 0.78, h * 0.25, Math.max(w, h) * 0.6);
  glow.addColorStop(0, "rgba(255, 143, 63, 0.38)");
  glow.addColorStop(1, "rgba(255, 143, 63, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 2;
  for (let x = 0; x <= w; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 120) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

/** The promo's layers, laid out in a 1920 × 1080 frame. `show` fades parts in by comp time. */
function promoContent(ctx, show = () => 1) {
  ctx.save();
  ctx.globalAlpha = show("logo");
  ctx.fillStyle = C.amber;
  ctx.save();
  ctx.translate(184, 150);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-20, -20, 40, 40);
  ctx.fillStyle = "#251a2e";
  ctx.fillRect(-8, -8, 16, 16);
  ctx.restore();
  text(ctx, "Kovo", 226, 166, `700 48px ${FONT.display}`, C.fg);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = show("title");
  text(ctx, "Ship faster.", 160, 470, `700 132px ${FONT.display}`, C.fg);
  text(ctx, "Plan, build and launch in one place.", 166, 560, `500 44px ${FONT.ui}`, "#c9c3cf");
  rr(ctx, 166, 630, 300, 92, 46);
  ctx.fillStyle = C.amber;
  ctx.fill();
  text(ctx, "Start free", 316, 678, `700 34px ${FONT.ui}`, C.amberInk, "center", "middle");
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = show("card");
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 20;
  rr(ctx, 1160, 300, 600, 470, 36);
  ctx.fillStyle = "#1d1a22";
  ctx.fill();
  ctx.restore();
  rr(ctx, 1160, 300, 600, 470, 36);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 3;
  ctx.stroke();
  text(ctx, "SIGNUPS · THIS WEEK", 1210, 370, `600 24px ${FONT.mono}`, C.fg2);
  text(ctx, "48,200", 1206, 470, `700 84px ${FONT.display}`, C.fg);
  text(ctx, "+12%", 1710, 370, `700 28px ${FONT.ui}`, C.ok, "right");
  const bars = [0.35, 0.5, 0.42, 0.66, 0.58, 0.8, 0.94];
  bars.forEach((v, i) => {
    const h = 200 * v;
    rr(ctx, 1210 + i * 74, 730 - h, 46, h, 10);
    ctx.fillStyle = i === bars.length - 1 ? C.amber : "rgba(255,143,63,0.35)";
    ctx.fill();
  });
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 1 · Comp Resizer
// ---------------------------------------------------------------------------

function resizeScene(ctx, c, { times: T }) {
  const m = io(seg(c, T.confirm + 0.2, T.confirm + 1.6));
  const cw = lerp(1920, 1080, m);
  const ch = lerp(1080, 1920, m);
  const resized = c >= T.confirm + 1.6;
  const { area, strip } = frame(ctx, {
    title: "Composition · MAIN_COMP",
    tc: tcode(c),
    stripH: 150,
    stripTitle: "Project",
    stripRight: resized ? "Resized: 1 comp" : "",
  });
  const cv = compView(area, cw, ch);
  enterComp(ctx, cv, "#120f16", false);
  promoBackground(ctx, cw, ch);
  ctx.save();
  const kf = lerp(1, 1080 / 1920, m);
  ctx.translate(cw / 2, ch / 2);
  ctx.scale(kf, kf);
  ctx.translate(-960, -540);
  promoContent(ctx);
  ctx.restore();
  ctx.restore();

  // The chosen format, previewed before the resize.
  const pv = seg(c, T.tap + 0.3, T.tap + 0.8) * (1 - seg(c, T.confirm, T.confirm + 0.3));
  if (pv > 0) {
    const fw = (1080 * 1080) / 1920;
    const x = cv.x + ((1920 - fw) / 2) * cv.k;
    ctx.save();
    ctx.globalAlpha = pv;
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x, cv.y, fw * cv.k, 1080 * cv.k);
    ctx.setLineDash([]);
    pill(ctx, "9:16", x + 12, cv.y + 24, { size: 16 });
    ctx.restore();
  }
  // The pinned spot.
  const pin = seg(c, 4.0, 4.4) * (1 - seg(c, T.confirm + 2.5, T.confirm + 3));
  if (pin > 0) {
    const px = cv.x + (cw / 2) * cv.k;
    const py = cv.y + (ch / 2) * cv.k;
    ctx.save();
    ctx.globalAlpha = pin;
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(px, py, 14, 0, Math.PI * 2);
    ctx.moveTo(px - 24, py);
    ctx.lineTo(px + 24, py);
    ctx.moveTo(px, py - 24);
    ctx.lineTo(px, py + 24);
    ctx.stroke();
    ctx.restore();
  }
  if (m > 0.98) {
    ctx.save();
    ctx.globalAlpha = seg(c, T.confirm + 1.6, T.confirm + 2.0);
    pill(ctx, "1080 × 1920", cv.x + cv.w * cv.k + 18, cv.y + 22, { size: 16, fill: C.overlay, ink: C.fg, border: C.line });
    pill(ctx, "Fit · centre", cv.x + cv.w * cv.k + 18, cv.y + 64, { size: 16, fill: C.amberSoft, ink: C.amberHi, border: C.amber });
    pill(ctx, "Background filled", cv.x + cv.w * cv.k + 18, cv.y + 106, { size: 16, fill: C.amberSoft, ink: C.amberHi, border: C.amber });
    ctx.restore();
  }

  // Project panel.
  const rows = [
    ["MAIN_COMP", resized ? "1080 × 1920 · 30 fps" : "1920 × 1080 · 30 fps", resized ? "resized" : ""],
    ["EDIT · uses MAIN_COMP", "1920 × 1080 · 30 fps", c >= 18 ? "fixed, nothing jumps" : ""],
  ];
  rows.forEach(([name, size, chip], i) => {
    const y = strip.y + 14 + i * 40;
    compIcon(ctx, strip.x, y - 12);
    text(ctx, name, strip.x + 32, y + 2, `600 18px ${FONT.ui}`, C.fg);
    text(ctx, size, strip.x + 470, y + 2, `500 16px ${FONT.mono}`, C.fg2);
    if (chip) {
      ctx.save();
      ctx.globalAlpha = seg(c, i === 0 ? T.confirm + 1.6 : 18, (i === 0 ? T.confirm + 1.6 : 18) + 0.3);
      pill(ctx, chip, strip.x + strip.w, y - 4, { size: 14, fill: C.amberSoft, ink: C.amberHi, border: C.amber, align: "right" });
      ctx.restore();
    }
  });
}

function compIcon(ctx, x, y, color = C.amber) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 2, 20, 16);
  ctx.fillStyle = color;
  ctx.fillRect(x + 5, y + 6, 12, 8);
  ctx.restore();
}

function footageIcon(ctx, x, y) {
  ctx.save();
  ctx.strokeStyle = C.fg2;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 2, 20, 16);
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 15);
  ctx.lineTo(x + 10, y + 8);
  ctx.lineTo(x + 18, y + 15);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 2 · Silence Remover
// ---------------------------------------------------------------------------

const VOICE = 24;
// Pauses as cut (padding already left on both sides): 0.6 + 0.9 + 0.7 + 1.0 + 0.7 = 3.9 s.
const PAUSES = [[3.1, 3.7], [7.4, 8.3], [11.6, 12.3], [15.9, 16.9], [20.2, 20.9]];
const PAD = 0.12;
const removedBefore = (t) => PAUSES.reduce((sum, [a, b]) => sum + clamp(t - a, 0, b - a), 0);
const loudness = (t) => {
  for (const [a, b] of PAUSES) if (t > a - PAD && t < b + PAD) return 0.03 + 0.02 * hash(t * 50);
  const word = 0.55 + 0.45 * Math.abs(Math.sin(t * 9.3) * Math.sin(t * 3.1 + 1));
  return clamp(word * (0.55 + 0.45 * hash(Math.floor(t * 24))), 0.05, 1);
};

function silenceScene(ctx, c, { times: T }) {
  const cut = io(seg(c, T.confirm + 0.2, T.confirm + 1.2));
  const done = c >= T.confirm + 1.2;
  const { area, strip } = frame(ctx, {
    title: "Timeline · MAIN_COMP",
    tc: tcode(c),
    stripH: 140,
    stripTitle: "Silence Remover",
    stripRight: done ? "0:24.0 → 0:20.1" : c >= T.analyse + 1 ? "5 pauses · 3.9 s" : "",
  });
  const x0 = 210;
  const x1 = area.w - 30;
  const sx = (x1 - x0) / VOICE;
  const toX = (t) => x0 + t * sx;
  const mapT = (t) => t - removedBefore(t) * cut;

  // Ruler.
  const ry = area.y + 40;
  ctx.fillStyle = C.line;
  ctx.fillRect(x0, ry + 10, x1 - x0, 1.5);
  for (let s = 0; s <= VOICE; s += 2) {
    ctx.fillRect(toX(s), ry + 4, 1.5, 6);
    text(ctx, `${s}s`, toX(s), ry - 4, `500 14px ${FONT.mono}`, C.mute, "center");
  }

  const tracks = [
    { name: "Voiceover", y: area.y + 112, h: 230, kind: "wave" },
    { name: "Screen recording", y: area.y + 390, h: 180, kind: "video" },
  ];
  for (const track of tracks) {
    ctx.fillStyle = C.raised;
    ctx.fillRect(0, track.y - 10, area.w, track.h + 20);
    text(ctx, track.name, 24, track.y + 26, `600 19px ${FONT.ui}`, C.fg);
    text(ctx, "selected", 24, track.y + 52, `500 14px ${FONT.mono}`, C.amber);
    // One clip until the cut; then the kept pieces, slid left as the pauses close.
    const pieces = [];
    if (cut <= 0) {
      pieces.push([0, VOICE]);
    } else {
      let from = 0;
      for (const [a, b] of PAUSES) {
        pieces.push([from, a]);
        from = b;
      }
      pieces.push([from, VOICE]);
    }
    pieces.forEach(([a, b], i) => {
      const xa = toX(mapT(a));
      const xb = toX(mapT(a) + (b - a));
      ctx.save();
      ctx.beginPath();
      ctx.rect(xa, track.y, xb - xa, track.h);
      ctx.clip();
      rr(ctx, xa, track.y, xb - xa, track.h, 6);
      ctx.fillStyle = track.kind === "wave" ? "#1e2a24" : "#202533";
      ctx.fill();
      if (track.kind === "wave") {
        ctx.fillStyle = "#6fd39a";
        const mid = track.y + track.h / 2;
        for (let t = a; t < b; t += 0.05) {
          const v = loudness(t) * (track.h / 2 - 10);
          const x = toX(mapT(a) + (t - a));
          ctx.fillRect(x, mid - v, Math.max(1.5, sx * 0.035), v * 2);
        }
      } else {
        for (let t = a; t < b; t += 1) {
          const x = toX(mapT(a) + (t - a));
          const w = sx * Math.min(1, b - t) - 3;
          rr(ctx, x + 1.5, track.y + 12, w, track.h - 24, 5);
          ctx.fillStyle = `hsl(${220 + 20 * hash(Math.floor(t))}, 18%, ${20 + 8 * hash(Math.floor(t) + 9)}%)`;
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.12)";
          ctx.fillRect(x + 10, track.y + 26, w * 0.5, 8);
          ctx.fillRect(x + 10, track.y + 44, w * 0.32, 8);
        }
      }
      ctx.restore();
      // A cut line where pieces meet.
      if (i > 0 && cut > 0) {
        ctx.fillStyle = `rgba(232,234,237,${cut})`;
        ctx.fillRect(xa - 1, track.y - 6, 2, track.h + 12);
      }
    });
    // The pauses, found by Analyse.
    PAUSES.forEach(([a, b]) => {
      const found = seg(c, T.analyse + 0.15 + (a / VOICE) * 0.9, T.analyse + 0.35 + (a / VOICE) * 0.9);
      if (found <= 0 || cut >= 1) return;
      const xa = toX(mapT(a));
      const w = (b - a) * sx * (1 - cut);
      ctx.save();
      ctx.globalAlpha = found * (1 - cut);
      ctx.fillStyle = "rgba(255,143,63,0.22)";
      ctx.fillRect(xa, track.y - 6, w, track.h + 12);
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 2;
      ctx.strokeRect(xa, track.y - 6, w, track.h + 12);
      if (track.kind === "wave") pill(ctx, `${(b - a).toFixed(1)} s`, xa + w / 2, track.y - 28, { size: 14, align: "center" });
      ctx.restore();
    });
  }
  // The scan.
  const scan = seg(c, T.analyse, T.analyse + 0.9);
  if (scan > 0 && scan < 1) {
    const x = toX(scan * VOICE);
    const g = ctx.createLinearGradient(x - 80, 0, x, 0);
    g.addColorStop(0, "rgba(255,143,63,0)");
    g.addColorStop(1, "rgba(255,143,63,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 80, area.y + 100, 80, 480);
    ctx.fillStyle = C.amber;
    ctx.fillRect(x - 1, area.y + 100, 2.5, 480);
  }
  // The end of the edit.
  const end = toX(mapT(VOICE));
  ctx.fillStyle = C.amber;
  ctx.fillRect(end - 1, area.y + 60, 2.5, 520);
  text(ctx, done ? "20.1 s" : "24.0 s", end - 8, area.y + 82, `700 16px ${FONT.mono}`, C.amber, "right");

  // Summary.
  const stats = [
    ["Pauses found", c >= T.analyse + 1 ? "5" : "–"],
    ["Removed", done ? "3.9 s" : "–"],
    ["Layers cut", done ? "2, in sync" : "–"],
    ["Deleted", done ? "nothing" : "–"],
  ];
  stats.forEach(([k, v], i) => {
    const x = strip.x + i * (strip.w / 4);
    text(ctx, k, x, strip.y + 18, `500 15px ${FONT.ui}`, C.fg2);
    text(ctx, v, x, strip.y + 56, `700 28px ${FONT.display}`, v === "–" ? C.mute : C.fg);
  });
}

// ---------------------------------------------------------------------------
// 3 · Follow Layer
// ---------------------------------------------------------------------------

const Z = 1.32;
const FOLLOW_KEYS = [
  { p: [520, 570], r: -6, s: 100 },
  { p: [1040, 340], r: 10, s: 116 },
  { p: [1300, 690], r: -12, s: 90 },
  { p: [780, 810], r: 6, s: 106 },
];
const cr = (a, b, c, d, u) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
function cardAt(t) {
  t = ((t % 4) + 4) % 4;
  const i = Math.floor(t);
  const u = smooth(t - i);
  const k = (j) => FOLLOW_KEYS[(i + j + 4) % 4];
  const [a, b, cc, d] = [k(-1), k(0), k(1), k(2)];
  return { p: [cr(a.p[0], b.p[0], cc.p[0], d.p[0], u), cr(a.p[1], b.p[1], cc.p[1], d.p[1], u)], r: lerp(b.r, cc.r, u), s: lerp(b.s, cc.s, u) };
}

function drawCard(ctx) {
  const w = 380;
  const h = 230;
  rr(ctx, -w / 2, -h / 2, w, h, 26);
  ctx.fillStyle = "#1b1e24";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#3a3f4a";
  ctx.stroke();
  text(ctx, "SIGNUPS · THIS WEEK", -w / 2 + 28, -h / 2 + 46, `600 17px ${FONT.mono}`, C.fg2);
  text(ctx, "+12%", w / 2 - 28, -h / 2 + 46, `600 20px ${FONT.ui}`, C.ok, "right");
  text(ctx, "48,200", -w / 2 + 26, -h / 2 + 122, `700 56px ${FONT.display}`, C.fg);
  const spark = [0.15, 0.35, 0.25, 0.5, 0.42, 0.68, 0.58, 0.82, 1];
  ctx.beginPath();
  spark.forEach((v, i) => {
    const x = -w / 2 + 28 + (i / (spark.length - 1)) * (w - 56);
    const y = h / 2 - 26 - v * 50;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = C.amber;
  ctx.stroke();
}

function drawTag(ctx) {
  rr(ctx, -118, -39, 236, 78, 39);
  ctx.fillStyle = C.amber;
  ctx.fill();
  text(ctx, "$49 / mo", 0, 2, `700 28px ${FONT.display}`, C.amberInk, "center", "middle");
}

function drawShadow(ctx, k) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 110 * k;
  rr(ctx, -190, -115, 380, 230, 26);
  ctx.fillStyle = "rgba(4,5,8,0.42)";
  ctx.fill();
  ctx.restore();
}

function place(ctx, v) {
  ctx.translate(v.p[0], v.p[1]);
  ctx.rotate((v.r * Math.PI) / 180);
  ctx.scale((v.s / 100) * Z, (v.s / 100) * Z);
}

function followScene(ctx, c, { times: T }) {
  const linked = c >= T.follow;
  const lag = 3 / 30;
  const base = cardAt(T.follow);
  const own = {
    tag: { p: [base.p[0] + 330 * Z, base.p[1] - 160 * Z], r: 0, s: 100 },
    shadow: { p: [base.p[0] + 26 * Z, base.p[1] + 38 * Z], r: base.r, s: base.s },
  };
  const lead = cardAt(c);
  const late = cardAt(c - lag);
  const shown = (o) =>
    linked
      ? { p: [o.p[0] + late.p[0] - base.p[0], o.p[1] + late.p[1] - base.p[1]], r: o.r + late.r - base.r, s: (o.s * late.s) / base.s }
      : o;
  const { area, strip } = frame(ctx, {
    title: "Composition · MAIN_COMP",
    tc: tcode(c),
    stripH: 150,
    stripTitle: "Effect Controls · Price tag",
    stripRight: linked ? "added by Follow" : "",
  });
  const cv = compView(area, 1920, 1080);
  enterComp(ctx, cv);
  // The card's motion path, as After Effects shows it for a selected layer.
  ctx.save();
  ctx.setLineDash([3 / cv.k, 9 / cv.k]);
  ctx.strokeStyle = "rgba(255,143,63,0.45)";
  ctx.lineWidth = 2 / cv.k;
  ctx.beginPath();
  for (let i = 0; i <= 160; i++) {
    const p = cardAt((i / 160) * 4).p;
    if (i) ctx.lineTo(p[0], p[1]);
    else ctx.moveTo(p[0], p[1]);
  }
  ctx.stroke();
  ctx.restore();
  const sh = shown(own.shadow);
  ctx.save();
  place(ctx, sh);
  drawShadow(ctx, cv.k);
  ctx.restore();
  const tg = shown(own.tag);
  ctx.save();
  place(ctx, tg);
  drawTag(ctx);
  ctx.restore();
  ctx.save();
  place(ctx, lead);
  drawCard(ctx);
  ctx.restore();
  // Labels.
  const label = (v, w, h, name, color, below = false) => {
    const t = (v.s / 100) * Z;
    const x = v.p[0] - (w / 2) * t;
    const y = below ? v.p[1] + (h / 2) * t + 30 : v.p[1] - (h / 2) * t - 14;
    text(ctx, name, x, y, `700 ${22}px ${FONT.mono}`, color);
  };
  label(lead, 380, 230, "Card · leader", C.amber);
  label(tg, 236, 78, linked ? "Price tag · follows" : "Price tag", C.yellow);
  label(sh, 380, 230, linked ? "Shadow · follows" : "Shadow", C.teal, true);
  ctx.restore();

  // Effect Controls.
  if (!linked) {
    text(ctx, "No effects yet.", strip.x, strip.y + 22, `500 18px ${FONT.ui}`, C.mute);
  } else {
    const a = seg(c, T.follow, T.follow + 0.4);
    ctx.save();
    ctx.globalAlpha = a;
    const rows = [
      ["KVFX Follow", "Layer", "1. Card"],
      ["KVFX Follow Delay", "Slider", "3 frames"],
    ];
    rows.forEach(([name, kind, value], i) => {
      const y = strip.y + 14 + i * 40;
      text(ctx, "fx", strip.x, y + 2, `700 17px ${FONT.mono}`, C.amber);
      text(ctx, name, strip.x + 36, y + 2, `600 19px ${FONT.ui}`, C.fg);
      text(ctx, kind, strip.x + 520, y + 2, `500 16px ${FONT.ui}`, C.mute);
      rr(ctx, strip.x + 620, y - 16, 200, 30, 6);
      ctx.fillStyle = C.ink;
      ctx.fill();
      ctx.strokeStyle = C.line;
      ctx.stroke();
      text(ctx, value, strip.x + 634, y + 4, `600 16px ${FONT.mono}`, C.fg);
    });
    text(ctx, "Position, Rotation, Scale: expression", strip.x + strip.w, strip.y + 34, `500 15px ${FONT.mono}`, C.amberHi, "right");
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Timeline rows, shared by Unprecompose and Sequence
// ---------------------------------------------------------------------------

function layerIcon(ctx, x, y, kind, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  if (kind === "precomp") {
    ctx.strokeRect(x + 1, y + 3, 18, 14);
    ctx.fillRect(x + 5, y + 7, 10, 6);
  } else if (kind === "text") {
    text(ctx, "T", x + 10, y + 16, `800 18px ${FONT.ui}`, color, "center");
  } else if (kind === "audio") {
    for (let i = 0; i < 4; i++) ctx.fillRect(x + 2 + i * 5, y + 10 - [3, 7, 5, 2][i], 3, [3, 7, 5, 2][i] * 2);
  } else {
    rr(ctx, x + 2, y + 3, 16, 14, 4);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 4 · Unprecompose (and Precompose Each)
// ---------------------------------------------------------------------------

function unprecompScene(ctx, c, { times: T }) {
  const out1 = io(seg(c, T.unprecomp + 0.1, T.unprecomp + 0.8));
  const pre = io(seg(c, T.precomp + 0.1, T.precomp + 0.6));
  const comp = 10;
  const ct = (c * 1.0) % comp;
  const { area, strip } = frame(ctx, {
    title: "Composition · MAIN_COMP",
    tc: tcode(ct),
    stripH: 330,
    stripTitle: "Timeline · MAIN_COMP",
    stripRight: c >= T.precomp + 0.6 ? "2 layers precomposed" : c >= T.unprecomp + 0.8 ? "4 layers released" : "",
  });
  const cv = compView(area, 1920, 1080, 20);
  enterComp(ctx, cv, "#120f16", false);
  promoBackground(ctx, 1920, 1080);
  // Same picture before and after: the timing inside the precomp is kept.
  const fade = (t0) => seg(ct, t0, t0 + 0.4);
  promoContent(ctx, (part) => ({ logo: fade(1.0), title: fade(1.5), card: fade(2.0) })[part] ?? 1);
  ctx.restore();

  // Timeline: name column, then a track 0–10 s.
  const nameW = 360;
  const tx0 = strip.x + nameW;
  const tx1 = strip.x + strip.w - 250;
  const toX = (t) => tx0 + (t / comp) * (tx1 - tx0);
  const rowH = 34;
  const layers = [
    { key: "title", name: "Title", kind: "text", from: 1.5, to: 8, color: C.yellow },
    { key: "logo", name: "Logo", kind: "shape", from: 1.0, to: 8, color: C.blue },
    { key: "card", name: "Card", kind: "shape", from: 2.0, to: 8, color: C.teal },
    { key: "bg", name: "BG", kind: "shape", from: 1.0, to: 8, color: C.violet },
  ];
  const rows = [];
  layers.forEach((l, i) => {
    const precomped = (l.key === "title" || l.key === "logo") && pre > 0.5;
    rows.push({ ...l, name: precomped ? `${l.name} Comp` : l.name, kind: precomped ? "precomp" : l.kind, appear: clamp(out1 * 1.6 - i * 0.15), selected: c >= 9.6 && (l.key === "title" || l.key === "logo") && c < T.precomp + 1.5 });
  });
  rows.push({ name: "Scene", kind: "precomp", from: 1.0, to: 8, color: C.amber, appear: 1, off: out1 > 0.5, selected: c < T.unprecomp + 0.8 });
  rows.push({ name: "Music", kind: "audio", from: 0, to: 10, color: C.ok, appear: 1 });

  // Ruler.
  for (let s = 0; s <= comp; s += 2) text(ctx, `${s}s`, toX(s), strip.y + 4, `500 13px ${FONT.mono}`, C.mute, "center");
  let y = strip.y + 16;
  rows.forEach((row) => {
    const h = rowH * row.appear;
    if (h < 1) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(strip.x - 10, y, strip.w - 240, h);
    ctx.clip();
    ctx.globalAlpha = row.appear;
    if (row.selected) {
      ctx.fillStyle = "rgba(255,143,63,0.10)";
      ctx.fillRect(strip.x - 10, y, strip.w - 240, rowH);
    }
    const mid = y + rowH / 2;
    // Eye: off for the switched-off precomp layer.
    ctx.strokeStyle = row.off ? C.mute : C.fg2;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(strip.x + 10, mid, 9, 5.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    if (!row.off) {
      ctx.fillStyle = C.fg2;
      ctx.beginPath();
      ctx.arc(strip.x + 10, mid, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(strip.x - 1, mid + 7);
      ctx.lineTo(strip.x + 21, mid - 7);
      ctx.stroke();
    }
    ctx.fillStyle = row.color;
    ctx.fillRect(strip.x + 34, mid - 6, 12, 12);
    layerIcon(ctx, strip.x + 58, mid - 10, row.kind, row.off ? C.mute : C.fg2);
    text(ctx, row.name, strip.x + 88, mid + 6, `600 18px ${FONT.ui}`, row.off ? C.mute : C.fg);
    if (row.off) text(ctx, "switched off", strip.x + 160, mid + 6, `500 14px ${FONT.mono}`, C.mute);
    rr(ctx, toX(row.from), mid - 10, toX(row.to) - toX(row.from), 20, 4);
    ctx.fillStyle = row.off ? "rgba(121,129,142,0.25)" : row.color;
    ctx.globalAlpha = row.appear * (row.off ? 1 : 0.55);
    ctx.fill();
    ctx.restore();
    y += h;
  });
  // Playhead.
  ctx.fillStyle = C.fg;
  ctx.fillRect(toX(ct) - 1, strip.y + 12, 2, y - strip.y - 12);

  // Project panel.
  const px = strip.x + strip.w - 220;
  rr(ctx, px, strip.y - 8, 230, strip.h + 2, 10);
  ctx.fillStyle = C.ink;
  ctx.fill();
  text(ctx, "PROJECT", px + 16, strip.y + 18, `700 13px ${FONT.mono}`, C.fg2);
  const items = [["MAIN_COMP", 0], ["Scene", 0], ["Title Comp", 1], ["Logo Comp", 1]];
  let iy = strip.y + 50;
  items.forEach(([name, fresh]) => {
    const a = fresh ? seg(c, T.precomp + 0.2, T.precomp + 0.6) : 1;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    compIcon(ctx, px + 16, iy - 14, fresh ? C.amber : C.fg2);
    text(ctx, name, px + 46, iy + 2, `600 17px ${FONT.ui}`, fresh ? C.amberHi : C.fg);
    ctx.restore();
    iy += 34;
  });
}

// ---------------------------------------------------------------------------
// 5 · Duplicate Comp + Nested Comps
// ---------------------------------------------------------------------------

function previewCard(ctx, x, y, w, headline, flag) {
  const h = (w * 9) / 16;
  ctx.save();
  rr(ctx, x, y, w, h, 10);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, "#2a1d33");
  g.addColorStop(1, "#151219");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const s = w / 640;
  text(ctx, headline, x + 36 * s, y + 160 * s, `700 ${40 * s}px ${FONT.display}`, C.fg);
  text(ctx, "Everything in the shop", x + 38 * s, y + 206 * s, `500 ${24 * s}px ${FONT.ui}`, "#c9c3cf");
  rr(ctx, x + 448 * s, y + 70 * s, 156 * s, 220 * s, 20 * s);
  ctx.fillStyle = "#ff8f3f";
  ctx.fill();
  text(ctx, "−30%", x + 526 * s, y + 196 * s, `700 ${38 * s}px ${FONT.display}`, C.amberInk, "center");
  ctx.restore();
  rr(ctx, x, y, w, h, 10);
  ctx.lineWidth = 2;
  ctx.strokeStyle = flag === "bad" ? C.red : flag === "good" ? C.ok : C.line;
  ctx.stroke();
}

function typedText(from, to, p) {
  // Deletes back to the shared prefix, then types the rest.
  let common = 0;
  while (common < from.length && from[common] === to[common]) common++;
  const del = from.length - common;
  const add = to.length - common;
  const steps = Math.round(p * (del + add));
  if (steps <= del) return from.slice(0, from.length - steps);
  return to.slice(0, common + (steps - del));
}

function duplicateScene(ctx, c, { times: T }) {
  const plainIn = seg(c, 0.6, 1.0) * (1 - seg(c, 6.0, 6.4));
  const editPlain = seg(c, 3.0, 3.8) * (1 - seg(c, 6.0, 6.4));
  const deepIn = seg(c, T.duplicate + 0.1, T.duplicate + 0.5);
  const editDeep = seg(c, 12.6, 13.4);
  const shared = seg(c, 16.6, 17.0);
  const { area, strip } = frame(ctx, {
    title: "Project · Kovo.aep",
    tc: "",
    stripH: 150,
    stripTitle: "What happened",
    stripRight: c >= T.duplicate + 0.5 ? "3 comps copied" : "",
  });

  // Project panel, left.
  const px = area.x + 26;
  const pw = 470;
  rr(ctx, px, area.y + 22, pw, area.h - 44, 12);
  ctx.fillStyle = C.raised;
  ctx.fill();
  text(ctx, "NAME", px + 20, area.y + 54, `700 13px ${FONT.mono}`, C.fg2);
  const items = [
    { id: "main", name: "MAIN_COMP", y: 0, kind: "comp" },
    { id: "a", name: "Scene A", y: 1, kind: "comp" },
    { id: "b", name: "Scene B", y: 2, kind: "comp" },
    { id: "main2", name: "MAIN_COMP 2", y: 3, kind: "comp", a: Math.max(plainIn, deepIn), fresh: true },
    { id: "a2", name: "Scene A 2", y: 4, kind: "comp", a: deepIn, fresh: true },
    { id: "b2", name: "Scene B 2", y: 5, kind: "comp", a: deepIn, fresh: true },
    { id: "logo", name: "logo.png", y: 6, kind: "footage" },
    { id: "video", name: "product.mp4", y: 7, kind: "footage" },
  ];
  const rowY = (i) => area.y + 92 + i * 58;
  const pos = {};
  for (const it of items) {
    const a = it.a ?? 1;
    pos[it.id] = { x: px + 30, y: rowY(it.y) };
    if (a <= 0) continue;
    ctx.save();
    ctx.globalAlpha = a;
    if (it.fresh) {
      rr(ctx, px + 10, rowY(it.y) - 22, pw - 20, 42, 8);
      ctx.fillStyle = "rgba(255,143,63,0.08)";
      ctx.fill();
    }
    if (it.kind === "comp") compIcon(ctx, px + 24, rowY(it.y) - 12, it.fresh ? C.amber : C.fg2);
    else footageIcon(ctx, px + 24, rowY(it.y) - 12);
    text(ctx, it.name, px + 58, rowY(it.y) + 4, `600 20px ${FONT.ui}`, it.fresh ? C.amberHi : C.fg);
    ctx.restore();
  }
  // "Uses" links, drawn to the right of the names.
  const link = (from, to, color, a, dx) => {
    if (a <= 0) return;
    const fy = pos[from].y - 4;
    const ty = pos[to].y - 4;
    const x = px + pw - 40 - dx;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px + 230, fy);
    ctx.bezierCurveTo(x, fy, x, ty, px + 200, ty);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px + 200, ty, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  };
  link("main", "a", C.fg2, 1, 60);
  link("main", "b", C.fg2, 1, 90);
  link("main2", "a", C.red, plainIn, 0);
  link("main2", "b", C.red, plainIn, 30);
  link("main2", "a2", C.amber, deepIn, 0);
  link("main2", "b2", C.amber, deepIn, 30);
  link("a", "logo", C.blue, shared, 120);
  link("a2", "logo", C.blue, shared, 150);

  // Previews, right.
  const colX = px + pw + 40;
  const colW = area.w - (colX - area.x) - 30;
  const vh = (area.h - 44 - 2 * 46) / 2;
  const vw = Math.min(colW, (vh * 16) / 9);
  const vx = colX + (colW - vw) / 2;
  const original = editPlain > 0 && c < 6.4 ? typedText("Spring sale", "Summer sale", clamp(editPlain * 1.4 - 0.4)) : "Spring sale";
  const copyText = c < 6.4 ? typedText("Spring sale", "Summer sale", editPlain) : typedText("Spring sale", "Summer sale", editDeep);
  text(ctx, "MAIN_COMP", vx, area.y + 54, `700 16px ${FONT.mono}`, C.fg2);
  previewCard(ctx, vx, area.y + 68, vw, original, editPlain > 0.9 && c < 6.4 ? "bad" : editDeep > 0.9 ? "good" : null);
  const copyA = Math.max(plainIn, deepIn);
  ctx.save();
  ctx.globalAlpha = copyA;
  const cy = area.y + 68 + (vw * 9) / 16 + 46;
  text(ctx, "MAIN_COMP 2", vx, cy - 14, `700 16px ${FONT.mono}`, C.amberHi);
  previewCard(ctx, vx, cy, vw, copyText, null);
  ctx.restore();
  if (editPlain > 0.9 && c < 6.4) pill(ctx, "Original changed too", vx + vw - 14, area.y + 96, { fill: C.red, ink: "#fff", size: 15, align: "right" });
  if (editDeep > 0.9) pill(ctx, "Original unchanged", vx + vw - 14, area.y + 96, { fill: C.ok, ink: "#04140a", size: 15, align: "right" });

  // What happened.
  const lines = [];
  if (c < 6.4) lines.push(["Edit ▸ Duplicate", "MAIN_COMP 2 still uses Scene A and Scene B", C.red]);
  if (c >= 6.0 && c < T.duplicate) lines.push(["Undo", "back to one comp", C.fg2]);
  if (c >= T.duplicate) lines.push(["Duplicate Comp + Nested Comps", "MAIN_COMP 2 uses Scene A 2 and Scene B 2", C.amber]);
  if (c >= 16.6) lines.push(["Footage", "logo.png and product.mp4 stay shared", C.blue]);
  lines.slice(-2).forEach(([a, b, color], i) => {
    const y = strip.y + 14 + i * 38;
    ctx.fillStyle = color;
    ctx.fillRect(strip.x, y - 8, 10, 10);
    text(ctx, a, strip.x + 24, y + 2, `700 19px ${FONT.ui}`, C.fg);
    ctx.font = `700 19px ${FONT.ui}`;
    text(ctx, b, strip.x + 34 + ctx.measureText(a).width, y + 2, `500 18px ${FONT.ui}`, C.fg2);
  });
}

// ---------------------------------------------------------------------------
// 6 · Sequence Layers
// ---------------------------------------------------------------------------

const SEQ_N = 7;
const SEQ_RANKS = {
  start: [0, 0, 0, 0, 0, 0, 0],
  forward: [0, 1, 2, 3, 4, 5, 6],
  centre: [3, 2, 1, 0, 1, 2, 3],
  random: [2, 5, 0, 6, 3, 1, 4],
};
const SEQ_VALUES = [0.42, 0.58, 0.5, 0.74, 0.66, 0.86, 1];
const SEQ_COLORS = [C.blue, C.teal, C.yellow, C.amber, C.violet, C.blue, C.teal];

function sequenceScene(ctx, c, { times: T }) {
  const runs = [
    [0.3, "start"],
    [T.first + 0.3, "forward"],
    [T.centre + 0.3, "centre"],
    [T.random + 0.3, "random"],
  ];
  let run = runs[0];
  let prev = runs[0];
  for (const r of runs) {
    if (c >= r[0]) {
      prev = run;
      run = r;
    }
  }
  const lt = c - run[0];
  const step = 5 / 30;
  const slide = io(seg(lt, -0.3, 0.2));
  const inPoint = (i) => lerp(SEQ_RANKS[prev[1]][i] * step, SEQ_RANKS[run[1]][i] * step, run === prev ? 1 : slide);
  const label = { start: "All at 0", forward: "Offset 5 fr · First → last", centre: "Offset 5 fr · Centre → out", random: "Offset 5 fr · Random" }[run[1]];
  const { area, strip } = frame(ctx, {
    title: "Composition · MAIN_COMP",
    tc: tcode(clamp(lt, 0, 3)),
    stripH: 300,
    stripTitle: "Timeline · MAIN_COMP",
    stripRight: label,
  });
  const cv = compView(area, 1920, 1080, 20);
  enterComp(ctx, cv);
  text(ctx, "Signups by day", 240, 190, `700 54px ${FONT.display}`, C.fg);
  const base = 900;
  const bw = 150;
  for (let i = 0; i < SEQ_N; i++) {
    const p = back(clamp((lt - SEQ_RANKS[run[1]][i] * step) / 0.45));
    const h = 560 * SEQ_VALUES[i] * Math.max(0, p);
    const x = 250 + i * 210;
    if (h > 0.5) {
      rr(ctx, x, base - h, bw, h, 18);
      ctx.fillStyle = SEQ_COLORS[i];
      ctx.fill();
      ctx.save();
      ctx.globalAlpha = clamp(p);
      text(ctx, String(Math.round(SEQ_VALUES[i] * 820)), x + bw / 2, base - h - 22, `700 34px ${FONT.display}`, C.fg, "center");
      ctx.restore();
    }
    text(ctx, ["M", "T", "W", "T", "F", "S", "S"][i], x + bw / 2, base + 56, `700 32px ${FONT.ui}`, C.fg2, "center");
  }
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(220, base, 1480, 3);
  ctx.restore();

  // Timeline.
  const nameW = 230;
  const tx0 = strip.x + nameW;
  const tx1 = strip.x + strip.w;
  const span = 2;
  const toX = (t) => tx0 + (t / span) * (tx1 - tx0);
  for (let f = 0; f <= 60; f += 10) text(ctx, `${f}f`, toX(f / 30), strip.y + 4, `500 13px ${FONT.mono}`, C.mute, "center");
  const rowH = 30;
  for (let i = 0; i < SEQ_N; i++) {
    const y = strip.y + 14 + i * rowH;
    ctx.fillStyle = SEQ_COLORS[i];
    ctx.fillRect(strip.x, y + 9, 12, 12);
    text(ctx, `${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]} bar`, strip.x + 26, y + 21, `600 17px ${FONT.ui}`, C.fg);
    const x = toX(inPoint(i));
    rr(ctx, x, y + 6, tx1 - x, rowH - 12, 4);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = SEQ_COLORS[i];
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = C.fg;
    ctx.fillRect(x, y + 6, 3, rowH - 12);
  }
  const ph = toX(clamp(lt, 0, span));
  ctx.fillStyle = C.amber;
  ctx.fillRect(ph - 1, strip.y + 10, 2.5, SEQ_N * rowH + 8);
}

// ---------------------------------------------------------------------------
// 7 · Align as Group
// ---------------------------------------------------------------------------

const TILES = [
  { w: 260, h: 260, color: C.amber, glyph: "bars" },
  { w: 200, h: 200, color: C.blue, glyph: "ring" },
  { w: 300, h: 220, color: C.teal, glyph: "line" },
  { w: 220, h: 280, color: C.yellow, glyph: "dot" },
];
const START = [[230, 330], [470, 560], [1100, 250], [1380, 500]];

function alignStates() {
  const s0 = START.map((p) => [...p]);
  // Align vertical centre to the selection's bounds.
  const top = Math.min(...s0.map((p, i) => p[1] - TILES[i].h / 2));
  const bottom = Math.max(...s0.map((p, i) => p[1] + TILES[i].h / 2));
  const cy = (top + bottom) / 2;
  const s1 = s0.map((p) => [p[0], cy]);
  // Distribute horizontally: centres evenly between the outer two.
  const xs = s1.map((p) => p[0]);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const order = [...s1.keys()].sort((a, b) => s1[a][0] - s1[b][0]);
  const s2 = s1.map((p) => [...p]);
  order.forEach((idx, rank) => {
    s2[idx][0] = lo + ((hi - lo) * rank) / (order.length - 1);
  });
  const bounds = (s) => ({
    l: Math.min(...s.map((p, i) => p[0] - TILES[i].w / 2)),
    r: Math.max(...s.map((p, i) => p[0] + TILES[i].w / 2)),
    t: Math.min(...s.map((p, i) => p[1] - TILES[i].h / 2)),
    b: Math.max(...s.map((p, i) => p[1] + TILES[i].h / 2)),
  });
  const b2 = bounds(s2);
  const dx = 960 - (b2.l + b2.r) / 2;
  const s3 = s2.map((p) => [p[0] + dx, p[1]]);
  const b3 = bounds(s3);
  const dy = 540 - (b3.t + b3.b) / 2;
  const s4 = s3.map((p) => [p[0], p[1] + dy]);
  return { s0, s1, s2, s3, s4, bounds };
}
const ALIGN_STATES = alignStates();

function tileGlyph(ctx, kind, w, h) {
  ctx.save();
  ctx.fillStyle = "rgba(14,15,18,0.82)";
  ctx.strokeStyle = "rgba(14,15,18,0.82)";
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  const s = Math.min(w, h) * 0.32;
  if (kind === "bars") for (let i = 0; i < 3; i++) ctx.fillRect(-s + i * s * 0.75, s - [0.9, 1.5, 2][i] * s * 0.75, s * 0.45, [0.9, 1.5, 2][i] * s * 0.75);
  if (kind === "ring") {
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.8, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (kind === "line") {
    ctx.beginPath();
    ctx.moveTo(-s, s * 0.5);
    ctx.lineTo(-s * 0.3, -s * 0.2);
    ctx.lineTo(s * 0.2, s * 0.2);
    ctx.lineTo(s, -s * 0.6);
    ctx.stroke();
  }
  if (kind === "dot") {
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function alignScene(ctx, c, { times: T }) {
  const S = ALIGN_STATES;
  const moves = [
    [T.centreY, S.s0, S.s1],
    [T.distribute, S.s1, S.s2],
    [T.groupX, S.s2, S.s3],
    [T.groupY, S.s3, S.s4],
  ];
  let cur = S.s0;
  for (const [t, from, to] of moves) {
    if (c >= t) {
      const k = io(seg(c, t + 0.05, t + 0.65));
      cur = from.map((p, i) => [lerp(p[0], to[i][0], k), lerp(p[1], to[i][1], k)]);
    }
  }
  const grp = c >= T.grp;
  const { area, strip } = frame(ctx, {
    title: "Composition · MAIN_COMP",
    tc: tcode(c),
    stripH: 150,
    stripTitle: "History",
    stripRight: `Align to: ${grp ? "GRP · one block" : "SEL · the selection"}`,
  });
  const cv = compView(area, 1920, 1080);
  enterComp(ctx, cv);
  // Comp centre guides while the group moves to it.
  const guides = seg(c, T.groupX - 0.4, T.groupX) * (1 - seg(c, T.groupY + 2.5, T.groupY + 3.2));
  if (guides > 0) {
    ctx.save();
    ctx.globalAlpha = guides;
    ctx.setLineDash([14, 10]);
    ctx.strokeStyle = C.blue;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(960, 0);
    ctx.lineTo(960, 1080);
    ctx.moveTo(0, 540);
    ctx.lineTo(1920, 540);
    ctx.stroke();
    ctx.restore();
  }
  cur.forEach((p, i) => {
    const t = TILES[i];
    ctx.save();
    ctx.translate(p[0], p[1]);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    rr(ctx, -t.w / 2, -t.h / 2, t.w, t.h, 40);
    ctx.fillStyle = t.color;
    ctx.fill();
    ctx.restore();
    tileGlyph(ctx, t.glyph, t.w, t.h);
    ctx.restore();
    selBox(ctx, p[0] - t.w / 2, p[1] - t.h / 2, t.w, t.h, cv.k, C.fg, 0.7);
  });
  const b = S.bounds(cur);
  ctx.save();
  ctx.setLineDash([16, 10]);
  ctx.strokeStyle = grp ? C.amber : "rgba(232,234,237,0.4)";
  ctx.lineWidth = grp ? 4 : 2.5;
  ctx.strokeRect(b.l - 24, b.t - 24, b.r - b.l + 48, b.b - b.t + 48);
  ctx.restore();
  if (grp) {
    ctx.save();
    ctx.globalAlpha = seg(c, T.grp, T.grp + 0.3);
    ctx.scale(1 / cv.k, 1 / cv.k);
    pill(ctx, "GRP", (b.l - 24) * cv.k, (b.t - 24) * cv.k - 22, { size: 16 });
    ctx.restore();
  }
  ctx.restore();

  history(
    ctx,
    strip,
    [
      [T.centreY, "Align Vertical Centre"],
      [T.distribute, "Distribute Horizontally"],
      [T.groupX, "Align Horizontal Centre as Group"],
      [T.groupY, "Align Vertical Centre as Group"],
    ],
    c,
  );
}

// ---------------------------------------------------------------------------
// 8 · Even Gaps
// ---------------------------------------------------------------------------

const GAP_CARDS = [
  { w: 240, title: "Revenue", value: "$84k" },
  { w: 360, title: "Active users", value: "12,480" },
  { w: 180, title: "NPS", value: "62" },
  { w: 300, title: "Churn", value: "1.8%" },
];
const GAP_LEFTS = [140, 470, 930, 1300];

function gapLayouts() {
  const widths = GAP_CARDS.map((g) => g.w);
  const span = GAP_LEFTS[3] + widths[3] - GAP_LEFTS[0];
  const total = widths.reduce((a, b) => a + b, 0);
  const even = (span - total) / 3;
  const place = (gap) => {
    const out = [];
    let x = GAP_LEFTS[0];
    widths.forEach((w) => {
      out.push(x);
      x += w + gap;
    });
    return out;
  };
  return { start: GAP_LEFTS, even: place(even), fixed: place(40) };
}
const GAP_LAYOUTS = gapLayouts();

function gapsScene(ctx, c, { times: T }) {
  const L = GAP_LAYOUTS;
  let lefts = L.start;
  if (c >= T.even) lefts = L.start.map((x, i) => lerp(x, L.even[i], io(seg(c, T.even + 0.05, T.even + 0.65))));
  if (c >= T.fixed) lefts = L.even.map((x, i) => lerp(x, L.fixed[i], io(seg(c, T.fixed + 0.05, T.fixed + 0.65))));
  const { area, strip } = frame(ctx, {
    title: "Composition · MAIN_COMP",
    tc: tcode(c),
    stripH: 150,
    stripTitle: "History",
    stripRight: c >= T.gapField + 0.4 ? "Gap: 40 px" : "Gap: even",
  });
  const cv = compView(area, 1920, 1080);
  enterComp(ctx, cv);
  const y0 = 330;
  const h = 230;
  // The third card is animated: it keeps bobbing wherever it is moved.
  const bob = (i) => (i === 2 ? Math.sin((c * Math.PI * 2) / 2.2) * 26 : 0);
  GAP_CARDS.forEach((g, i) => {
    const x = lefts[i];
    const y = y0 + bob(i);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    rr(ctx, x, y, g.w, h, 28);
    ctx.fillStyle = "#1b1e24";
    ctx.fill();
    ctx.restore();
    rr(ctx, x, y, g.w, h, 28);
    ctx.strokeStyle = "#3a3f4a";
    ctx.lineWidth = 3;
    ctx.stroke();
    text(ctx, g.title, x + 28, y + 62, `600 30px ${FONT.ui}`, C.fg2);
    text(ctx, g.value, x + 26, y + 150, `700 ${g.w < 200 ? 50 : 58}px ${FONT.display}`, C.fg);
    if (i === 2) text(ctx, "animated", x + 28, y + 200, `600 22px ${FONT.mono}`, C.amber);
    selBox(ctx, x, y, g.w, h, cv.k, C.fg, 0.6);
  });
  // Measured gaps between edges.
  for (let i = 0; i < 3; i++) {
    const a = lefts[i] + GAP_CARDS[i].w;
    const b = lefts[i + 1];
    const y = y0 + h + 90;
    ctx.strokeStyle = C.amber;
    ctx.fillStyle = C.amber;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(a, y);
    ctx.lineTo(b, y);
    ctx.moveTo(a, y - 18);
    ctx.lineTo(a, y + 18);
    ctx.moveTo(b, y - 18);
    ctx.lineTo(b, y + 18);
    ctx.stroke();
    ctx.save();
    ctx.scale(1 / cv.k, 1 / cv.k);
    pill(ctx, `${Math.round(b - a)} px`, ((a + b) / 2) * cv.k, (y + 50) * cv.k, { size: 17, align: "center" });
    ctx.restore();
  }
  ctx.restore();
  history(
    ctx,
    strip,
    [
      [T.even, "Even Gaps Horizontally"],
      [T.fixed, "Even Gaps Horizontally · 40 px"],
    ],
    c,
  );
}

// ---------------------------------------------------------------------------
// 9 · Anchor Point Grid
// ---------------------------------------------------------------------------

const BADGE = { w: 560, h: 320 };

function anchorScene(ctx, c, { times: T }) {
  const spots = [
    [0, [BADGE.w / 2, BADGE.h / 2]],
    [T.topLeft, [0, 0]],
    [T.bottomCentre, [BADGE.w / 2, BADGE.h]],
    [T.centre, [BADGE.w / 2, BADGE.h / 2]],
  ];
  let anchor = spots[0][1];
  for (let i = 1; i < spots.length; i++) {
    if (c >= spots[i][0]) {
      const k = io(seg(c, spots[i][0], spots[i][0] + 0.35));
      anchor = [lerp(spots[i - 1][1][0], spots[i][1][0], k), lerp(spots[i - 1][1][1], spots[i][1][1], k)];
    }
  }
  // The layer sits still while the anchor moves: position compensates.
  const corner = [960 - BADGE.w / 2, 540 - BADGE.h / 2];
  const position = [corner[0] + anchor[0], corner[1] + anchor[1]];
  let rot = 0;
  let scale = 100;
  if (c > 5.2 && c < 9.4) rot = 16 * Math.sin(((c - 5.2) * Math.PI * 2) / 2.1) * Math.sin(Math.PI * seg(c, 5.2, 9.4));
  if (c > 10.8 && c < 15.6) {
    const pop = (t0) => back(seg(c, t0, t0 + 0.7));
    if (c < 12.6) scale = 100 * pop(10.9);
    else if (c < 12.95) scale = 100 * (1 - io(seg(c, 12.6, 12.95)));
    else scale = 100 * pop(12.95);
  }
  if (c > 16.9) rot = 360 * io(seg(c, 16.9, 19.2));
  const { area, strip } = frame(ctx, {
    title: "Composition · MAIN_COMP",
    tc: tcode(c),
    stripH: 150,
    stripTitle: "Transform · Badge",
  });
  const cv = compView(area, 1920, 1080);
  enterComp(ctx, cv);
  // The floor line, for "grows from the floor".
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, corner[1] + BADGE.h, 1920, 3);
  ctx.save();
  ctx.translate(position[0], position[1]);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(scale / 100, scale / 100);
  ctx.translate(-anchor[0], -anchor[1]);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  rr(ctx, 0, 0, BADGE.w, BADGE.h, 44);
  const g = ctx.createLinearGradient(0, 0, BADGE.w, BADGE.h);
  g.addColorStop(0, "#ff9a4d");
  g.addColorStop(1, "#ff7a2a");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  text(ctx, "NEW", 48, 120, `700 44px ${FONT.mono}`, "rgba(36,18,0,0.7)");
  text(ctx, "Kovo 2.0", 46, 238, `700 92px ${FONT.display}`, C.amberInk);
  ctx.restore();
  // Selection box follows the layer; the anchor mark sits at the position.
  ctx.save();
  ctx.translate(position[0], position[1]);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(scale / 100 || 0.0001, scale / 100 || 0.0001);
  ctx.translate(-anchor[0], -anchor[1]);
  selBox(ctx, 0, 0, BADGE.w, BADGE.h, (cv.k * Math.max(0.05, scale)) / 100, C.fg, 0.75);
  ctx.restore();
  anchorMark(ctx, position[0], position[1], cv.k, C.fg);
  ctx.restore();

  const fields = [
    ["Anchor Point", `${Math.round(anchor[0])}, ${Math.round(anchor[1])}`],
    ["Position", `${Math.round(position[0])}, ${Math.round(position[1])}`],
    ["Rotation", `${Math.round(rot)}°`],
    ["Scale", `${Math.round(scale)}%`],
  ];
  fields.forEach(([k, v], i) => {
    const x = strip.x + i * (strip.w / 4);
    text(ctx, k, x, strip.y + 18, `500 16px ${FONT.ui}`, C.fg2);
    text(ctx, v, x, strip.y + 58, `700 28px ${FONT.mono}`, i < 2 ? C.amberHi : C.fg);
  });
}

// ---------------------------------------------------------------------------
// 10 · Gradient Lock
// ---------------------------------------------------------------------------

const FROM = "#ff8f3f";
const TO = "#1f1a1a";

function gradientScene(ctx, c, { times: T }) {
  const locked = seg(c, T.lock, T.lock + 0.4);
  const compare = seg(c, 13.6, 14.1);
  const { area, strip } = frame(ctx, {
    title: "Composition · MAIN_COMP",
    tc: tcode(c),
    stripH: 150,
    stripTitle: "Effect Controls · Bar",
    stripRight: locked > 0 ? "added by Gradient Lock" : "",
  });
  const cv = compView(area, 1920, 1080);
  enterComp(ctx, cv, "#2c3038");
  const x0 = 260;
  const width = lerp(420, 1400, 0.5 - 0.5 * Math.cos((c * Math.PI * 2) / 4.4));
  const bar = (y, h, mode, label, chip) => {
    text(ctx, label, x0, y - 34, `600 34px ${FONT.ui}`, C.fg);
    if (chip) {
      ctx.save();
      ctx.scale(1 / cv.k, 1 / cv.k);
      ctx.font = `600 34px ${FONT.ui}`;
      pill(ctx, chip[0], (x0 + ctx.measureText(label).width * 1 + 30) * cv.k, (y - 46) * cv.k, { size: 15, fill: chip[1], ink: chip[2] });
      ctx.restore();
    }
    rr(ctx, x0, y, 1400, h, h / 2);
    ctx.fillStyle = "#1a1d22";
    ctx.fill();
    let sx = x0;
    let ex = x0 + width;
    if (mode === "plain") {
      sx = x0;
      ex = x0 + 760;
    }
    ctx.save();
    rr(ctx, x0, y, width, h, h / 2);
    ctx.clip();
    if (mode === "flat") {
      ctx.fillStyle = FROM;
    } else {
      const g = ctx.createLinearGradient(sx, 0, ex, 0);
      g.addColorStop(0, FROM);
      g.addColorStop(1, TO);
      ctx.fillStyle = g;
    }
    ctx.fillRect(x0, y, width, h);
    if (mode === "lock" && locked < 1) {
      ctx.globalAlpha = 1 - locked;
      ctx.fillStyle = FROM;
      ctx.fillRect(x0, y, width, h);
    }
    ctx.restore();
    rr(ctx, x0, y, width, h, h / 2);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();
    if (mode !== "flat") {
      ctx.save();
      ctx.globalAlpha = mode === "lock" ? locked : 1;
      rampHandle(ctx, sx, y + h / 2, cv.k, C.fg);
      rampHandle(ctx, ex, y + h / 2, cv.k, mode === "lock" ? C.amber : C.fg2);
      ctx.restore();
    }
  };
  bar(330, 130, locked > 0 ? "lock" : "flat", "Signups this week", locked > 0 ? ["GRADIENT LOCK", C.amber, C.amberInk] : null);
  if (compare > 0) {
    ctx.save();
    ctx.globalAlpha = compare;
    bar(700, 130, "plain", "Same bar, plain Gradient Ramp", ["FIXED POINTS", "#3a3f4a", C.fg]);
    ctx.restore();
  }
  ctx.restore();

  if (locked <= 0) {
    text(ctx, "No effects yet.", strip.x, strip.y + 22, `500 18px ${FONT.ui}`, C.mute);
  } else {
    ctx.save();
    ctx.globalAlpha = locked;
    text(ctx, "fx", strip.x, strip.y + 16, `700 17px ${FONT.mono}`, C.amber);
    text(ctx, "KVFX Gradient Lock", strip.x + 36, strip.y + 16, `600 19px ${FONT.ui}`, C.fg);
    const rows = [["Start of Ramp", "expression: left edge"], ["End of Ramp", "expression: right edge"]];
    rows.forEach(([k, v], i) => {
      const y = strip.y + 56 + i * 0;
      const x = strip.x + 36 + i * 540;
      text(ctx, k, x, y, `500 16px ${FONT.ui}`, C.fg2);
      text(ctx, v, x + 150, y, `600 16px ${FONT.mono}`, C.amberHi);
    });
    ctx.fillStyle = FROM;
    ctx.fillRect(strip.x + strip.w - 120, strip.y + 2, 44, 22);
    ctx.fillStyle = TO;
    ctx.fillRect(strip.x + strip.w - 60, strip.y + 2, 44, 22);
    ctx.strokeStyle = C.line;
    ctx.strokeRect(strip.x + strip.w - 60, strip.y + 2, 44, 22);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Tour · Text Animate
// ---------------------------------------------------------------------------

const WORDS = ["Make", "every", "word", "land."];
/** Ease-out with overshoot, peaking about 30 % past the target. */
const overshoot = (p) => {
  const k = 3.2;
  return 1 + (k + 1) * Math.pow(p - 1, 3) + k * Math.pow(p - 1, 2);
};

function textScene(ctx, c, { times: T }) {
  const live = c >= T.animate;
  const lt = live ? (c - T.animate - 0.1) % 2.6 : 99;
  const step = 6 / 30;
  const each = 15 / 30;
  const { area, strip } = frame(ctx, {
    title: "Composition · MAIN_COMP",
    tc: tcode(live ? Math.max(0, lt) : c),
    stripH: 150,
    stripTitle: "Animate · Headline",
    stripRight: live ? "Still live text" : "",
  });
  const cv = compView(area, 1920, 1080);
  enterComp(ctx, cv);
  // Two lines, animated word by word in reading order.
  const font = `700 150px ${FONT.display}`;
  ctx.font = font;
  const space = 46;
  const lines = [WORDS.slice(0, 2), WORDS.slice(2)];
  const lineY = [470, 680];
  let index = 0;
  let widest = 0;
  lines.forEach((line, row) => {
    const widths = line.map((w) => ctx.measureText(w).width);
    const total = widths.reduce((a, b) => a + b, 0) + space * (line.length - 1);
    widest = Math.max(widest, total);
    let x = 960 - total / 2;
    line.forEach((w, i) => {
      const n = index++;
      const p = clamp((lt - n * step) / each);
      const scale = live ? Math.max(0, overshoot(p)) : 1;
      const cx = x + widths[i] / 2;
      ctx.save();
      ctx.globalAlpha = live ? clamp(p * 2.2) : 1;
      ctx.translate(cx, lineY[row] - 52);
      ctx.scale(scale, scale);
      text(ctx, w, 0, 52, font, n === WORDS.length - 1 ? C.amber : C.fg, "center");
      ctx.restore();
      x += widths[i] + space;
    });
  });
  // The text layer's selection box: it is one layer, still editable.
  selBox(ctx, 960 - widest / 2 - 40, lineY[0] - 150, widest + 80, lineY[1] - lineY[0] + 210, cv.k, C.fg, 0.55);
  ctx.restore();

  const preset = c >= T.pop ? "Pop" : "Rise";
  const unit = c >= T.words ? "Words" : "Chars";
  const stagger = c >= T.stagger + 0.4 ? "6 fr" : "2 fr";
  const stats = [["Preset", preset], ["Mode", "In"], ["By", unit], ["Stagger", stagger]];
  stats.forEach(([k, v], i) => {
    const sx = strip.x + i * (strip.w / 4);
    text(ctx, k, sx, strip.y + 18, `500 16px ${FONT.ui}`, C.fg2);
    text(ctx, v, sx, strip.y + 58, `700 28px ${FONT.display}`, C.fg);
  });
}

// ---------------------------------------------------------------------------
// Tour · Ease curve
// ---------------------------------------------------------------------------

/** The curve the recording drags out, as the panel shows it. */
const CURVE = [0.804, -0.002, 0.196, 0.998];
const bez = (p1, p2, t) => 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
const bezD = (p1, p2, t) => 3 * (1 - t) * (1 - t) * p1 + 6 * (1 - t) * t * (p2 - p1) + 3 * t * t * (1 - p2);
function curveParam(u) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bez(CURVE[0], CURVE[2], mid) < u) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
const eased = (u) => bez(CURVE[1], CURVE[3], curveParam(u));
function easedSpeed(u) {
  const t = curveParam(u);
  return bezD(CURVE[1], CURVE[3], t) / Math.max(1e-4, bezD(CURVE[0], CURVE[2], t));
}

function easeScene(ctx, c, { times: T }) {
  const easedOn = seg(c, T.apply + 0.1, T.apply + 0.5);
  const X0 = 380;
  const X1 = 1540;
  const Y = 470;
  const MOVE = 1.4;
  const HOLD = 0.45;
  const period = 2 * (MOVE + HOLD);
  const local = ((c % period) + period) % period;
  let u;
  if (local < MOVE) u = local / MOVE;
  else if (local < MOVE + HOLD) u = 1;
  else if (local < 2 * MOVE + HOLD) u = 1 - (local - MOVE - HOLD) / MOVE;
  else u = 0;
  const k = lerp(u, eased(u), easedOn);
  const { area, strip } = frame(ctx, {
    title: "Composition · MAIN_COMP",
    tc: tcode(local),
    stripH: 210,
    stripTitle: "Graph Editor · Position speed",
    stripRight: easedOn > 0.5 ? "Custom ease 0.80, 0, 0.20, 1" : "Linear",
  });
  const cv = compView(area, 1920, 1080);
  enterComp(ctx, cv);
  // The motion path, with a dot for every frame: their spacing is the speed.
  ctx.strokeStyle = "rgba(255,143,63,0.35)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(X0, Y);
  ctx.lineTo(X1, Y);
  ctx.stroke();
  const frames = Math.round(MOVE * 30);
  for (let f = 0; f <= frames; f++) {
    const a = f / frames;
    const px = lerp(X0, X1, lerp(a, eased(a), easedOn));
    ctx.fillStyle = "rgba(255,143,63,0.85)";
    ctx.beginPath();
    ctx.arc(px, Y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const kx of [X0, X1]) {
    ctx.fillStyle = C.fg;
    ctx.fillRect(kx - 9, Y - 9, 18, 18);
  }
  const bx = lerp(X0, X1, k);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  rr(ctx, bx - 90, Y + 60, 180, 180, 44);
  ctx.fillStyle = C.amber;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "rgba(14,15,18,0.85)";
  ctx.save();
  ctx.translate(bx, Y + 150);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-26, -26, 52, 52);
  ctx.restore();
  ctx.restore();

  // Speed over one move: flat when linear, a bell once eased.
  const gx0 = strip.x + 40;
  const gx1 = strip.x + strip.w - 20;
  const gy1 = strip.y + strip.h - 14;
  const gy0 = strip.y + 6;
  const maxSpeed = 4.4;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(gx0, gy0);
  ctx.lineTo(gx0, gy1);
  ctx.lineTo(gx1, gy1);
  ctx.stroke();
  text(ctx, "speed", gx0 - 8, gy0 + 12, `500 13px ${FONT.mono}`, C.mute, "right");
  ctx.beginPath();
  for (let i = 0; i <= 200; i++) {
    const a = i / 200;
    const v = lerp(1, easedSpeed(Math.min(0.999, Math.max(0.001, a))), easedOn);
    const x = lerp(gx0, gx1, a);
    const y = gy1 - (v / maxSpeed) * (gy1 - gy0);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.strokeStyle = C.amber;
  ctx.lineWidth = 3;
  ctx.stroke();
  // The playhead on the graph, during the forward move.
  if (local < MOVE) {
    const x = lerp(gx0, gx1, local / MOVE);
    ctx.fillStyle = C.fg;
    ctx.fillRect(x - 1, gy0, 2, gy1 - gy0);
  }
  for (const kx of [gx0, gx1]) {
    ctx.save();
    ctx.translate(kx, gy1);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = C.fg;
    ctx.fillRect(-6, -6, 12, 12);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Tour · Effects Manager
// ---------------------------------------------------------------------------

function fxScene(ctx, c, { times: T }) {
  // Each switch blends over a quarter second.
  const state = (changes, start) => {
    let v = start;
    let from = start;
    let at = -1;
    for (const [t, to] of changes) {
      if (c >= t) {
        from = v;
        v = to;
        at = t;
      }
    }
    return at < 0 ? v : lerp(from, v, seg(c, at, at + 0.25));
  };
  const glow = state([[T.glowOff, 0], [T.allOff, 0], [T.allOn, 1]], 1);
  const shadow = state([[T.shadowOn, 1], [T.allOff, 0], [T.allOn, 1]], 0);
  const grad = state([[T.allOff, 0], [T.allOn, 1]], 1);
  const scanned = c >= T.scan + 0.2;
  const { area, strip } = frame(ctx, {
    title: "Composition · MAIN_COMP",
    tc: tcode(c),
    stripH: 170,
    stripTitle: "Effect Controls · Title",
    stripRight: scanned ? "Scanned: 2 layers, 4 effects" : "",
  });
  const cv = compView(area, 1920, 1080);
  enterComp(ctx, cv, "#14161b", false);
  // Card BG: locked, with its own Gaussian Blur.
  ctx.save();
  ctx.filter = "blur(24px)";
  rr(ctx, 360, 250, 1200, 580, 80);
  const bg = ctx.createLinearGradient(360, 250, 1560, 830);
  bg.addColorStop(0, "#2a2140");
  bg.addColorStop(1, "#1a2a3a");
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.restore();
  const word = "KOVO";
  const font = `700 280px ${FONT.display}`;
  const y = 640;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const fill = () => {
    const g = ctx.createLinearGradient(0, y - 220, 0, y);
    g.addColorStop(0, "#ffb15c");
    g.addColorStop(1, "#ff4f6d");
    return g;
  };
  // Drop Shadow.
  if (shadow > 0) {
    ctx.save();
    ctx.globalAlpha = shadow;
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 30 * cv.k * 2;
    ctx.shadowOffsetX = 26 * cv.k * 2;
    ctx.shadowOffsetY = 30 * cv.k * 2;
    ctx.fillStyle = "#000";
    ctx.fillText(word, 960, y);
    ctx.restore();
  }
  // Glow.
  if (glow > 0) {
    ctx.save();
    ctx.globalAlpha = 0.9 * glow;
    ctx.shadowColor = "rgba(255,143,63,0.95)";
    ctx.shadowBlur = 90 * cv.k * 2;
    ctx.fillStyle = "rgba(255,143,63,0.55)";
    ctx.fillText(word, 960, y);
    ctx.restore();
  }
  // The text, with or without KVFX Gradient Lock.
  ctx.save();
  ctx.fillStyle = "#f2f2f4";
  ctx.fillText(word, 960, y);
  if (grad > 0) {
    ctx.globalAlpha = grad;
    ctx.fillStyle = fill();
    ctx.fillText(word, 960, y);
  }
  ctx.restore();
  ctx.restore();

  const rows = [
    ["Glow", glow],
    ["Drop Shadow", shadow],
    ["KVFX Gradient Lock", grad],
  ];
  rows.forEach(([name, on], i) => {
    const ry = strip.y + 10 + i * 36;
    const lit = on > 0.5;
    rr(ctx, strip.x, ry - 13, 40, 26, 6);
    ctx.fillStyle = lit ? C.amberSoft : C.ink;
    ctx.fill();
    ctx.strokeStyle = lit ? C.amber : C.line;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    text(ctx, "fx", strip.x + 20, ry + 1, `700 15px ${FONT.mono}`, lit ? C.amber : C.mute, "center", "middle");
    text(ctx, name, strip.x + 58, ry + 1, `600 19px ${FONT.ui}`, lit ? C.fg : C.mute, "left", "middle");
    if (!lit) {
      ctx.font = `600 19px ${FONT.ui}`;
      ctx.fillStyle = C.mute;
      ctx.fillRect(strip.x + 58, ry, ctx.measureText(name).width, 1.5);
    }
    text(ctx, lit ? "on" : "off", strip.x + 420, ry + 1, `600 16px ${FONT.mono}`, lit ? C.amberHi : C.mute, "left", "middle");
  });
  text(ctx, "Card BG · Gaussian Blur · locked, left alone", strip.x + strip.w, strip.y + 82, `500 15px ${FONT.mono}`, C.mute, "right", "middle");
}

// ---------------------------------------------------------------------------
// Tour · Layouts (Metric Cards)
// ---------------------------------------------------------------------------

const METRICS = [
  { label: "Revenue", value: 48200, prefix: "$", suffix: "", decimals: 0, change: "+12%" },
  { label: "Active users", value: 12840, prefix: "", suffix: "", decimals: 0, change: "+8%" },
  { label: "Conversion", value: 7.4, prefix: "", suffix: "%", decimals: 1, change: "+1.2%" },
];

function formatNumber(v, decimals) {
  const fixed = v.toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

function generateScene(ctx, c, { times: T }) {
  const built = c >= T.build;
  const lt = c - T.build - 0.1;
  const step = 5 / 30;
  const each = 16 / 30;
  const { area, strip } = frame(ctx, {
    title: "Composition · MAIN_COMP",
    tc: tcode(built ? Math.max(0, lt) : 0),
    stripH: 170,
    stripTitle: "Timeline · MAIN_COMP",
    stripRight: built ? "13 layers on one null" : "Empty",
  });
  const cv = compView(area, 1920, 1080);
  enterComp(ctx, cv);
  if (!built) {
    text(ctx, "Empty comp", 960, 560, `600 40px ${FONT.ui}`, "rgba(232,234,237,0.25)", "center", "middle");
  } else {
    const head = clamp(lt / each);
    ctx.save();
    ctx.globalAlpha = head;
    text(ctx, "Kovo · this week", 150, 300 + (1 - out(head)) * 40, `700 54px ${FONT.display}`, C.fg);
    ctx.restore();
    METRICS.forEach((m, i) => {
      const t0 = (i + 1) * step;
      const p = clamp((lt - t0) / each);
      if (p <= 0) return;
      const x = 150 + i * 560;
      const y = 380 + (1 - out(p)) * 60;
      ctx.save();
      ctx.globalAlpha = clamp(p * 1.6);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 16;
      rr(ctx, x, y, 520, 330, 40);
      ctx.fillStyle = "#1b1e24";
      ctx.fill();
      ctx.restore();
      rr(ctx, x, y, 520, 330, 40);
      ctx.strokeStyle = "#353a45";
      ctx.lineWidth = 3;
      ctx.stroke();
      text(ctx, m.label, x + 40, y + 70, `600 30px ${FONT.ui}`, C.fg2);
      const count = clamp((lt - t0 - 0.15) / 1.0);
      const v = m.value * out(count);
      text(ctx, `${m.prefix}${formatNumber(v, m.decimals)}${m.suffix}`, x + 38, y + 170, `700 76px ${FONT.display}`, C.fg);
      const chip = back(clamp((lt - t0 - 0.6) / 0.4));
      if (chip > 0) {
        ctx.save();
        ctx.translate(x + 40, y + 230);
        ctx.scale(chip, chip);
        rr(ctx, 0, -2, 130, 50, 25);
        ctx.fillStyle = "rgba(63,185,80,0.16)";
        ctx.fill();
        text(ctx, m.change, 65, 24, `700 26px ${FONT.ui}`, C.ok, "center", "middle");
        ctx.restore();
      }
      // Bars grow from their base.
      const bars = [0.4, 0.55, 0.48, 0.7, 0.62, 0.85, 1];
      bars.forEach((b, j) => {
        const g = out(clamp((lt - t0 - 0.3 - j * 0.05) / 0.5));
        const h = 110 * b * g;
        if (h < 1) return;
        rr(ctx, x + 250 + j * 34, y + 290 - h, 22, h, 6);
        ctx.fillStyle = j === bars.length - 1 ? C.amber : "rgba(255,143,63,0.35)";
        ctx.fill();
      });
      ctx.restore();
    });
  }
  ctx.restore();

  // Timeline: the null, then each card, staggered by 5 frames.
  const rows = [["KVFX Layout", "null", 0], ["Header", "text", 0], ...METRICS.map((m, i) => [`${m.label} card`, "shape", (i + 1) * step])];
  const nameW = 300;
  const tx0 = strip.x + nameW;
  const tx1 = strip.x + strip.w;
  const span = 3;
  const toX = (t) => tx0 + (t / span) * (tx1 - tx0);
  rows.forEach(([name, kind, inPoint], i) => {
    const ry = strip.y + 4 + i * 22;
    const a = built ? seg(c, T.build, T.build + 0.2) : 0;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    text(ctx, name, strip.x + (i > 0 ? 22 : 0), ry + 12, `600 15px ${FONT.ui}`, i === 0 ? C.amberHi : C.fg);
    if (i > 0) text(ctx, "↳", strip.x, ry + 12, `600 15px ${FONT.ui}`, C.mute);
    rr(ctx, toX(inPoint), ry, tx1 - toX(inPoint), 14, 3);
    ctx.fillStyle = kind === "null" ? "rgba(255,143,63,0.45)" : "rgba(127,168,255,0.4)";
    ctx.fill();
    ctx.restore();
  });
  if (built) {
    ctx.fillStyle = C.fg;
    ctx.fillRect(toX(clamp(lt, 0, span)) - 1, strip.y, 2, rows.length * 22 + 4);
  } else {
    text(ctx, "No layers yet.", strip.x, strip.y + 14, `500 17px ${FONT.ui}`, C.mute);
  }
}

export const SCENES = {
  resize: resizeScene,
  silence: silenceScene,
  follow: followScene,
  unprecomp: unprecompScene,
  duplicate: duplicateScene,
  sequence: sequenceScene,
  align: alignScene,
  gaps: gapsScene,
  anchor: anchorScene,
  gradient: gradientScene,
  text: textScene,
  ease: easeScene,
  fx: fxScene,
  generate: generateScene,
};

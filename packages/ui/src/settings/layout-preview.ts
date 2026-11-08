import type { PanelLayout } from "@kvfx/core";
import { visibleTabs } from "@kvfx/core";
import { drawIcon } from "../components/icons.js";

/**
 * Settings ▸ Layout's pictures of the panel.
 *
 * `drawLayout` sketches a whole panel in a given layout — header, anchor grid
 * and creators, tab bar with the real tab icons, sections, align bar — for the
 * preset cards. `LayoutStage` is the large, animated version: when the layout
 * it shows changes, the panel's parts glide to their new places (a tab bar
 * moving to the bottom, a bar folding away), and the active tab steps along
 * the bar so the order reads.
 */

/* eslint-disable no-magic-numbers -- drawing proportions and timings are the content */

export interface TabInfo {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where each part of the panel sits, for one layout at one size. */
interface Frame {
  readonly header: Box;
  readonly quick: Box;
  readonly tabs: Box;
  readonly content: Box;
  readonly align: Box;
  /** How much each optional part shows, 0–1, so parts can fold in and out. */
  readonly quickOn: number;
  readonly alignOn: number;
  /** 1 = labels showing, 0 = none; icons likewise. */
  readonly labels: number;
  readonly icons: number;
  /** 0 = tab bar on top, 1 = at the bottom: which edge the active line sits on. */
  readonly bottom: number;
  readonly compact: number;
}

const COLOURS = {
  base: "#0e0f12",
  raised: "#16181d",
  overlay: "#1d2026",
  border: "#2a2e37",
  text: "#e8eaed",
  muted: "#79818e",
  accent: "#ff8f3f",
};

function frameFor(layout: PanelLayout, w: number, h: number): Frame {
  const pad = Math.round(w * 0.02);
  const header = { x: 0, y: 0, w, h: h * 0.07 };
  const quickH = layout.quickBar ? h * (layout.compact ? 0.15 : 0.17) : 0;
  const tabsH = h * (layout.tabStyle === "both" ? 0.085 : layout.tabStyle === "icons" ? 0.065 : 0.055);
  const alignH = layout.alignBar ? h * 0.065 : 0;
  const quick = { x: 0, y: header.h, w, h: quickH };
  let y = header.h + quickH;
  const top = layout.tabPosition === "top";
  const tabsTop = { x: 0, y, w, h: tabsH };
  if (top) y += tabsH;
  const contentH = h - y - alignH - (top ? 0 : tabsH);
  const content = { x: pad, y, w: w - pad * 2, h: contentH };
  y += contentH;
  const tabs = top ? tabsTop : { x: 0, y, w, h: tabsH };
  if (!top) y += tabsH;
  const align = { x: 0, y, w, h: alignH };
  return {
    header,
    quick,
    tabs,
    content,
    align,
    quickOn: layout.quickBar ? 1 : 0,
    alignOn: layout.alignBar ? 1 : 0,
    labels: layout.tabStyle === "icons" ? 0 : 1,
    icons: layout.tabStyle === "labels" ? 0 : 1,
    bottom: top ? 0 : 1,
    compact: layout.compact ? 1 : 0,
  };
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixBox = (a: Box, b: Box, t: number): Box => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), w: mix(a.w, b.w, t), h: mix(a.h, b.h, t) });

function mixFrame(a: Frame, b: Frame, t: number): Frame {
  return {
    header: mixBox(a.header, b.header, t),
    quick: mixBox(a.quick, b.quick, t),
    tabs: mixBox(a.tabs, b.tabs, t),
    content: mixBox(a.content, b.content, t),
    align: mixBox(a.align, b.align, t),
    quickOn: mix(a.quickOn, b.quickOn, t),
    alignOn: mix(a.alignOn, b.alignOn, t),
    labels: mix(a.labels, b.labels, t),
    icons: mix(a.icons, b.icons, t),
    bottom: mix(a.bottom, b.bottom, t),
    compact: mix(a.compact, b.compact, t),
  };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + radius, y);
  g.arcTo(x + w, y, x + w, y + h, radius);
  g.arcTo(x + w, y + h, x, y + h, radius);
  g.arcTo(x, y + h, x, y, radius);
  g.arcTo(x, y, x + w, y, radius);
  g.closePath();
}

/** A small, stable pseudo-random number for tab `tab`, part `i`, so each tab's sections look their own. */
const shape = (tab: number, i: number): number => {
  const x = Math.sin((tab + 1) * 12.9898 + (i + 1) * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

interface Scene {
  readonly frame: Frame;
  readonly tabs: readonly TabInfo[];
  /** Fractional, so the active line glides between tabs. */
  readonly active: number;
  /** 0 → 1 after a tab change, to slide the new tab's sections in. */
  readonly enter: number;
  readonly scale: number;
}

function paint(g: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
  const { frame: f, tabs, scale: k } = scene;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.clearRect(0, 0, w, h);
  g.save();
  roundRect(g, 0.5, 0.5, w - 1, h - 1, 6 * k);
  g.fillStyle = COLOURS.base;
  g.fill();
  g.clip();

  // Header: the brand, the context line and two buttons.
  const hd = f.header;
  g.fillStyle = COLOURS.raised;
  g.fillRect(hd.x, hd.y, hd.w, hd.h);
  const cy = hd.y + hd.h / 2;
  const mark = hd.h * 0.26;
  g.fillStyle = COLOURS.accent;
  g.beginPath();
  g.moveTo(hd.h * 0.5, cy - mark);
  g.lineTo(hd.h * 0.5 + mark, cy);
  g.lineTo(hd.h * 0.5, cy + mark);
  g.lineTo(hd.h * 0.5 - mark, cy);
  g.closePath();
  g.fill();
  g.fillStyle = COLOURS.text;
  g.fillRect(hd.h * 0.95, cy - hd.h * 0.1, w * 0.13, hd.h * 0.2);
  g.fillStyle = COLOURS.muted;
  g.fillRect(hd.h * 0.95 + w * 0.17, cy - hd.h * 0.07, w * 0.26, hd.h * 0.14);
  for (const i of [1, 2]) {
    g.beginPath();
    g.arc(w - hd.h * 0.6 * i - hd.h * 0.05, cy, hd.h * 0.17, 0, Math.PI * 2);
    g.fill();
  }

  // Anchor grid and creators.
  if (f.quickOn > 0.01 && f.quick.h > 1) {
    const q = f.quick;
    g.save();
    g.beginPath();
    g.rect(q.x, q.y, q.w, q.h);
    g.clip();
    g.globalAlpha = f.quickOn;
    const side = q.h * 0.78;
    const gx = q.x + q.h * 0.12;
    const gy = q.y + q.h * 0.11;
    roundRect(g, gx, gy, side, side, 3 * k);
    g.strokeStyle = COLOURS.border;
    g.lineWidth = Math.max(1, k);
    g.stroke();
    g.fillStyle = COLOURS.muted;
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        g.beginPath();
        g.arc(gx + side * (0.2 + 0.3 * c), gy + side * (0.2 + 0.3 * r), side * 0.045, 0, Math.PI * 2);
        g.fill();
      }
    }
    const left = gx + side + q.h * 0.12;
    const pillW = (q.w - left - q.h * 0.12 - 2 * q.h * 0.08) / 3;
    const pillH = q.h * 0.3;
    for (let r = 0; r < 2; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        const px = left + c * (pillW + q.h * 0.08);
        const py = gy + r * (pillH + q.h * 0.14) + q.h * 0.04;
        roundRect(g, px, py, pillW, pillH, pillH / 2);
        g.strokeStyle = COLOURS.border;
        g.stroke();
        g.fillStyle = COLOURS.accent;
        g.fillRect(px + pillH * 0.45, py + pillH * 0.35, pillH * 0.3, pillH * 0.3);
        g.fillStyle = COLOURS.text;
        g.fillRect(px + pillH * 0.95, py + pillH * 0.42, pillW * 0.42, pillH * 0.16);
      }
    }
    g.restore();
  }

  // Sections of the active tab.
  const ct = f.content;
  const tabIndex = Math.round(scene.active);
  const gap = mix(ct.h * 0.03, ct.h * 0.018, f.compact);
  const headH = mix(ct.h * 0.075, ct.h * 0.06, f.compact);
  let y = ct.y + gap;
  g.save();
  g.beginPath();
  g.rect(ct.x, ct.y, ct.w, ct.h);
  g.clip();
  const slide = (1 - scene.enter) * ct.w * 0.08;
  g.globalAlpha = 0.35 + 0.65 * scene.enter;
  for (let i = 0; i < 8 && y < ct.y + ct.h; i += 1) {
    const rows = 1 + Math.floor(shape(tabIndex, i) * 3);
    const bodyH = rows * mix(ct.h * 0.07, ct.h * 0.055, f.compact) + gap;
    const cardH = headH + bodyH;
    const x = ct.x + slide;
    roundRect(g, x, y, ct.w, cardH, 4 * k);
    g.fillStyle = COLOURS.raised;
    g.fill();
    g.strokeStyle = COLOURS.border;
    g.lineWidth = Math.max(1, k * 0.8);
    g.stroke();
    g.fillStyle = COLOURS.text;
    g.fillRect(x + headH * 0.5, y + headH * 0.38, ct.w * (0.22 + 0.2 * shape(tabIndex, i + 9)), headH * 0.24);
    g.fillStyle = COLOURS.muted;
    g.fillRect(x + ct.w - headH * 0.5 - ct.w * 0.12, y + headH * 0.42, ct.w * 0.12, headH * 0.16);
    for (let r = 0; r < rows; r += 1) {
      const ry = y + headH + r * mix(ct.h * 0.07, ct.h * 0.055, f.compact);
      const cells = 2 + Math.floor(shape(tabIndex, i * 5 + r) * 3);
      const cw = (ct.w - headH - (cells - 1) * gap) / cells;
      for (let c = 0; c < cells; c += 1) {
        roundRect(g, x + headH * 0.5 + c * (cw + gap), ry, cw, mix(ct.h * 0.05, ct.h * 0.04, f.compact), 2 * k);
        g.fillStyle = r === 0 && c === 0 && i === 0 ? "rgba(255, 143, 63, 0.85)" : COLOURS.overlay;
        g.fill();
      }
    }
    y += cardH + gap;
  }
  g.restore();

  // Tab bar.
  const tb = f.tabs;
  g.fillStyle = COLOURS.raised;
  g.fillRect(tb.x, tb.y, tb.w, tb.h);
  g.fillStyle = COLOURS.border;
  g.fillRect(tb.x, f.bottom > 0.5 ? tb.y : tb.y + tb.h - Math.max(1, k), tb.w, Math.max(1, k));
  const n = Math.max(1, tabs.length);
  const cell = tb.w / n;
  const iconSize = Math.min(cell * 0.5, tb.h * 0.42);
  tabs.forEach((tab, i) => {
    const on = Math.max(0, 1 - Math.abs(scene.active - i));
    const colour = on > 0.5 ? COLOURS.accent : COLOURS.muted;
    const cx = tb.x + cell * (i + 0.5);
    const labelH = tb.h * 0.2 * f.labels;
    const iconH = iconSize * f.icons;
    const total = iconH + labelH + (f.icons > 0.5 && f.labels > 0.5 ? tb.h * 0.06 : 0);
    const top = tb.y + (tb.h - total) / 2;
    if (f.icons > 0.05) {
      g.globalAlpha = f.icons;
      drawIcon(g, tab.icon, cx - iconSize / 2, top, iconSize, colour);
      g.globalAlpha = 1;
    }
    if (f.labels > 0.05) {
      g.globalAlpha = f.labels;
      const text = tab.label.toUpperCase();
      const size = Math.min(labelH * 0.95 + 0.001, (cell * 0.92) / (text.length * 0.66));
      const ly = top + total - labelH / 2;
      if (size >= 6.5) {
        g.font = `650 ${size.toFixed(1)}px Inter, "Segoe UI", sans-serif`;
        g.fillStyle = colour;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(text, cx, ly);
        g.textAlign = "left";
      } else {
        // Too small to read: a bar the width the word would take.
        g.fillStyle = colour;
        g.fillRect(cx - cell * 0.3, ly - labelH * 0.2, cell * 0.6, Math.max(1, labelH * 0.4));
      }
      g.globalAlpha = 1;
    }
  });
  // The active line glides between tabs, on the edge facing the view.
  const lineH = Math.max(1.5, 2 * k);
  g.fillStyle = COLOURS.accent;
  g.fillRect(tb.x + cell * scene.active + cell * 0.12, f.bottom > 0.5 ? tb.y : tb.y + tb.h - lineH, cell * 0.76, lineH);

  // Align bar.
  if (f.alignOn > 0.01 && f.align.h > 1) {
    const a = f.align;
    g.save();
    g.beginPath();
    g.rect(a.x, a.y, a.w, a.h);
    g.clip();
    g.globalAlpha = f.alignOn;
    g.fillStyle = COLOURS.raised;
    g.fillRect(a.x, a.y, a.w, a.h);
    g.fillStyle = COLOURS.border;
    g.fillRect(a.x, a.y, a.w, Math.max(1, k));
    const size = a.h * 0.5;
    const names = ["align-left", "align-center-h", "align-right", "align-top", "align-center-v", "align-bottom", "distribute-h", "distribute-v"];
    names.forEach((name, i) => drawIcon(g, name, a.x + a.h * 0.3 + i * size * 1.45, a.y + (a.h - size) / 2, size, COLOURS.text));
    const pillW = a.w * 0.16;
    roundRect(g, a.x + a.w - pillW - a.h * 0.25, a.y + a.h * 0.22, pillW, a.h * 0.56, a.h * 0.28);
    g.strokeStyle = COLOURS.accent;
    g.lineWidth = Math.max(1, k);
    g.stroke();
    g.restore();
  }
  g.restore();
  g.strokeStyle = COLOURS.border;
  g.lineWidth = Math.max(1, k);
  roundRect(g, 0.5, 0.5, w - 1, h - 1, 6 * k);
  g.stroke();
}

function fit(canvas: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number; k: number } | undefined {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(24, Math.round(canvas.clientWidth * ratio));
  const h = Math.max(32, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext("2d");
  return g === null ? undefined : { g, w, h, k: ratio };
}

const shownTabs = (layout: PanelLayout, tabs: readonly TabInfo[]): TabInfo[] =>
  visibleTabs(
    layout,
    tabs.map((t) => t.id),
  ).flatMap((id) => tabs.filter((t) => t.id === id));

/** A still picture of the panel in `layout`, for a preset card. */
export function drawLayout(canvas: HTMLCanvasElement, layout: PanelLayout, tabs: readonly TabInfo[]): void {
  const surface = fit(canvas);
  if (surface === undefined) return;
  const { g, w, h, k } = surface;
  paint(g, w, h, { frame: frameFor(layout, w, h), tabs: shownTabs(layout, tabs), active: 0, enter: 1, scale: k });
}

const MORPH_MS = 480;
const STEP_MS = 1100;
const GLIDE_MS = 260;

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The large, animated picture: glides between layouts and steps through the tabs. */
export class LayoutStage {
  readonly #canvas: HTMLCanvasElement;
  readonly #tabs: () => readonly TabInfo[];
  #layout: PanelLayout | undefined;
  #from: Frame | undefined;
  #shown: Frame | undefined;
  #changed = 0;
  #started = 0;
  #frame = 0;

  constructor(canvas: HTMLCanvasElement, tabs: () => readonly TabInfo[]) {
    this.#canvas = canvas;
    this.#tabs = tabs;
  }

  /** Shows `layout`, gliding from whatever is on screen now. */
  show(layout: PanelLayout): void {
    if (this.#layout === layout) return;
    this.#from = this.#shown;
    this.#layout = layout;
    this.#changed = performance.now();
    if (this.#started === 0) this.#started = this.#changed;
    if (this.#frame === 0) this.#frame = requestAnimationFrame((now) => this.#tick(now));
  }

  /** Starts the animation again, e.g. when Settings opens. */
  wake(): void {
    if (this.#frame === 0 && this.#layout !== undefined) this.#frame = requestAnimationFrame((now) => this.#tick(now));
  }

  #tick(now: number): void {
    this.#frame = 0;
    const layout = this.#layout;
    if (layout === undefined || !this.#canvas.isConnected || document.hidden || this.#canvas.offsetParent === null) return;
    const surface = fit(this.#canvas);
    if (surface === undefined) return;
    const { g, w, h, k } = surface;
    const target = frameFor(layout, w, h);
    const t = ease(Math.min(1, (now - this.#changed) / MORPH_MS));
    const from = this.#from !== undefined && this.#from.header.w === w ? this.#from : target;
    const frame = mixFrame(from, target, t);
    this.#shown = frame;
    const tabs = shownTabs(layout, this.#tabs());
    // Step along the tabs, gliding the active line from one to the next.
    const elapsed = now - this.#started;
    const step = Math.floor(elapsed / STEP_MS);
    const into = elapsed - step * STEP_MS;
    const n = Math.max(1, tabs.length);
    const current = step % n;
    const previous = (step - 1 + n) % n;
    const glide = ease(Math.min(1, into / GLIDE_MS));
    const active = step === 0 ? 0 : current === 0 ? current : mix(previous, current, glide);
    paint(g, w, h, { frame, tabs, active, enter: step === 0 ? 1 : ease(Math.min(1, into / (GLIDE_MS * 1.4))), scale: k });
    this.#frame = requestAnimationFrame((next) => this.#tick(next));
  }
}

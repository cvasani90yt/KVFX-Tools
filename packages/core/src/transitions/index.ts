import { type Rgb } from "../color/index.js";
import type { JsonValue } from "../types/json.js";

/**
 * Transitions: one layer across a cut, built from After Effects' own effects.
 *
 * A move or optical transition is an adjustment layer over both clips; a
 * flash or light leak is a solid in Add or Screen mode; a graphic wipe is a
 * shape layer that covers the frame at the cut. Each runs on its layer's own
 * length, so trimming the layer retimes it, and a KVFX Strength slider on it
 * sets the amount.
 *
 * Every animated value is a *channel*: a number over the transition's
 * progress `t` (0 → 1, the cut at 0.5), its strength `s` (1 = 100%), the
 * frame `f` since it began, and the comp size `W` × `H`. A channel is written
 * twice, as TypeScript for the panel's preview and as expression source for
 * After Effects, and the tests hold the two to the same values.
 *
 * Moves pass the cut at full speed and land a whole frame away from where
 * they started — on a Motion Tile copy — so the incoming clip comes to rest
 * exactly where it belongs. Everything else peaks at the cut and returns to
 * nothing, so the first and last frames are untouched.
 */

/* eslint-disable no-magic-numbers -- each preset's amounts, timings and colours are the content */

export type TransitionGroup = "trend" | "move" | "optical" | "light" | "glitch" | "graphic";

export const TRANSITION_GROUPS: readonly { readonly id: TransitionGroup; readonly label: string }[] = [
  { id: "trend", label: "Trending" },
  { id: "move", label: "Moves" },
  { id: "optical", label: "Optical" },
  { id: "light", label: "Light" },
  { id: "glitch", label: "Glitch" },
  { id: "graphic", label: "Graphic" },
];

export interface ChannelVars {
  /** Progress through the transition, 0 → 1; the cut is at 0.5. */
  readonly t: number;
  /** Strength, 1 = 100%. */
  readonly s: number;
  /** Whole frames since the transition began. */
  readonly f: number;
  readonly W: number;
  readonly H: number;
  readonly seed: number;
}

export interface Channel {
  /** Expression source, in terms of t, s, f, W, H and the helpers below. */
  readonly src: string;
  readonly at: (v: ChannelVars) => number;
}

const ch = (src: string, at: (v: ChannelVars) => number): Channel => ({ src, at });
const k = (n: number): Channel => ch(String(n), () => n);

// ---------------------------------------------------------------------------
// The helpers, once in TypeScript and once as expression source.
// ---------------------------------------------------------------------------

export const cl = (u: number): number => Math.max(0, Math.min(1, u));
/** Quintic in-out: still at both ends, fastest at the cut. */
export const io = (u: number): number => (u < 0.5 ? 16 * u * u * u * u * u : 1 - Math.pow(2 - 2 * u, 5) / 2);
/** A peak at the cut: 0 at both ends, 1 at the middle, sharper as `p` grows. */
export const pk = (u: number, p: number): number => Math.pow(Math.max(0, 1 - Math.abs(2 * u - 1)), p);
export const ei = (u: number): number => u * u * u;
export const eo = (u: number): number => 1 - Math.pow(1 - u, 3);
/** A repeatable random number in 0–1 for frame `i`, different for every seed. */
export const rnd = (i: number, seed: number): number => {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
/** Glitch bursts: the peak, knocked back on random frames so it stutters. */
const gb = (v: ChannelVars): number => pk(v.t, 1.5) * (rnd(v.f + 1, v.seed) > 0.3 ? 1 : 0.2);

export const TRANSITION_STRENGTH = "KVFX Strength";
const TAG = "// KVFX Tools — transition";

/** The lines every transition expression starts with. */
export function transitionHead(seed: number): string {
  return [
    TAG,
    "var d = Math.max(thisComp.frameDuration, outPoint - inPoint);",
    "var t = Math.max(0, Math.min(1, (time - inPoint) / d));",
    `var s = effect("${TRANSITION_STRENGTH}")(1) / 100;`,
    "var f = Math.floor((time - inPoint) / thisComp.frameDuration + 0.001);",
    "var W = thisComp.width;",
    "var H = thisComp.height;",
    "function cl(u) { return Math.max(0, Math.min(1, u)); }",
    "function io(u) { return u < 0.5 ? 16 * u * u * u * u * u : 1 - Math.pow(2 - 2 * u, 5) / 2; }",
    "function pk(u, p) { return Math.pow(Math.max(0, 1 - Math.abs(2 * u - 1)), p); }",
    "function ei(u) { return u * u * u; }",
    "function eo(u) { return 1 - Math.pow(1 - u, 3); }",
    `function rnd(i) { var x = Math.sin(i * 12.9898 + ${String(seed)} * 78.233) * 43758.5453; return x - Math.floor(x); }`,
    "function gb() { return pk(t, 1.5) * (rnd(f + 1) > 0.3 ? 1 : 0.2); }",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// What a preset builds
// ---------------------------------------------------------------------------

export interface ParamDrive {
  /** The effect parameter's match name. */
  readonly param: string;
  readonly value?: JsonValue;
  readonly channel?: Channel;
  /** A point: x and y offsets from the layer's centre. */
  readonly point?: readonly [Channel, Channel];
}

export interface EffectSpec {
  readonly matchName: string;
  readonly name: string;
  readonly params: readonly ParamDrive[];
  /** Drives the effect's own opacity (Compositing Options), for effects with no "off" value. */
  readonly mix?: Channel;
}

export type BlendMode = "normal" | "add" | "screen";

export interface ShapeGroupSpec {
  readonly name: string;
  readonly item: { readonly type: "rect" | "ellipse"; readonly size: readonly [number, number] };
  /** Which of the three tones fills it; strokes draw an outline instead. */
  readonly tone: 0 | 1 | 2;
  readonly stroke?: number;
  readonly rotation?: number;
  /** Offsets from the comp's centre. */
  readonly position?: readonly [Channel, Channel];
  readonly scale?: readonly [Channel, Channel];
  readonly opacity?: Channel;
  /** Trim Paths start and end, in percent, for a stroked shape that wipes round like a clock hand. */
  readonly trim?: readonly [Channel, Channel];
}

export type TransitionBuild =
  | { readonly kind: "adjust"; readonly effects: readonly EffectSpec[] }
  | {
      readonly kind: "solid";
      readonly color: Rgb;
      readonly blend: BlendMode;
      readonly opacity: Channel;
      readonly effects: readonly EffectSpec[];
    }
  | { readonly kind: "shape"; readonly groups: (W: number, H: number) => readonly ShapeGroupSpec[] };

export interface TransitionPreset {
  readonly id: string;
  readonly name: string;
  readonly group: TransitionGroup;
  /** Length in frames, before the user changes it. */
  readonly frames: number;
  /** One line for the panel. */
  readonly about: string;
  readonly build: TransitionBuild;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** Motion Tile, so moves and distortions always have picture at the edges. */
function tile(out = 400): EffectSpec {
  return {
    matchName: "ADBE Tile",
    name: "KVFX Tile",
    params: [
      { param: "ADBE Tile-0004", value: out },
      { param: "ADBE Tile-0005", value: out },
    ],
  };
}

/** Motion blur on the Transform effect, longer with strength. */
const SHUTTER = ch("Math.min(720, 240 * s)", (v) => Math.min(720, 240 * v.s));

interface MoveSpec {
  readonly x?: Channel;
  readonly y?: Channel;
  readonly scale?: Channel;
  readonly width?: Channel;
  readonly height?: Channel;
  readonly rotation?: Channel;
}

/** The Transform effect, with its own motion blur so the comp's switch doesn't matter. */
function move(m: MoveSpec): EffectSpec {
  const params: ParamDrive[] = [];
  if (m.x !== undefined || m.y !== undefined) params.push({ param: "ADBE Geometry2-0002", point: [m.x ?? k(0), m.y ?? k(0)] });
  if (m.width !== undefined || m.height !== undefined) {
    params.push({ param: "ADBE Geometry2-0011", value: 0 });
    params.push({ param: "ADBE Geometry2-0003", channel: m.height ?? k(100) });
    params.push({ param: "ADBE Geometry2-0004", channel: m.width ?? k(100) });
  } else if (m.scale !== undefined) {
    params.push({ param: "ADBE Geometry2-0003", channel: m.scale });
  }
  if (m.rotation !== undefined) params.push({ param: "ADBE Geometry2-0007", channel: m.rotation });
  params.push({ param: "ADBE Geometry2-0009", value: 0 }, { param: "ADBE Geometry2-0010", channel: SHUTTER });
  return { matchName: "ADBE Geometry2", name: "KVFX Move", params };
}

/** A gentle push in at the cut, which also keeps distorted edges out of frame. */
const push = (amount: number, sharp = 2): Channel =>
  ch(`100 + ${String(amount)} * s * pk(t, ${String(sharp)})`, (v) => 100 + amount * v.s * pk(v.t, sharp));

const adjust = (...effects: EffectSpec[]): TransitionBuild => ({ kind: "adjust", effects });

// ---------------------------------------------------------------------------
// Graphic wipes: shapes that cover the frame at the cut
// ---------------------------------------------------------------------------

/**
 * How long, as a share of the transition, a wipe stays fully closed either
 * side of the cut. The cut falls between two frames, so the frame before it
 * and the frame after it must both be covered, or the switch shows.
 */
const HOLD = 0.08;

/**
 * Travel for something that arrives, covers through the cut and leaves:
 * −1 → 0 → 1, easing into place and away again, `lag` later than the first piece.
 */
const arriveLeave = (lag: number): Channel => {
  const span = String(0.5 - HOLD - lag);
  const l = String(lag);
  const leave = String(0.5 + HOLD + lag);
  return ch(
    `t < 0.5 ? -(1 - eo(cl((t - ${l}) / ${span}))) : ei(cl((t - ${leave}) / ${span}))`,
    (v) => (v.t < 0.5 ? -(1 - eo(cl((v.t - lag) / (0.5 - HOLD - lag)))) : ei(cl((v.t - (0.5 + HOLD + lag)) / (0.5 - HOLD - lag)))),
  );
};

const times = (c: Channel, by: number): Channel => ch(`(${c.src}) * ${String(by)}`, (v) => c.at(v) * by);

const scaled = (c: Channel, sym: "W" | "H", by = 1): Channel =>
  ch(`(${c.src}) * ${sym} * ${String(by)}`, (v) => c.at(v) * (sym === "W" ? v.W : v.H) * by);

/** 0 → 100 (covering through the cut) → 0, `lag` later than the first piece. */
const growShrink = (lag: number): Channel => {
  const span = String(0.5 - HOLD - lag);
  const l = String(lag);
  const leave = String(0.5 + HOLD + lag);
  return ch(
    `t < 0.5 ? 100 * eo(cl((t - ${l}) / ${span})) : 100 * (1 - ei(cl((t - ${leave}) / ${span})))`,
    (v) => (v.t < 0.5 ? 100 * eo(cl((v.t - lag) / (0.5 - HOLD - lag))) : 100 * (1 - ei(cl((v.t - (0.5 + HOLD + lag)) / (0.5 - HOLD - lag))))),
  );
};

function bars(W: number, H: number): ShapeGroupSpec[] {
  const count = 5;
  const band = H / count;
  return Array.from({ length: count }, (_, i) => {
    const travel = arriveLeave(i * 0.05);
    return {
      name: `Bar ${String(i + 1)}`,
      item: { type: "rect" as const, size: [Math.ceil(W * 1.02), Math.ceil(band + 2)] as const },
      tone: (i % 3) as 0 | 1 | 2,
      position: [scaled(travel, "W", 1.02), k(Math.round((i + 0.5) * band - H / 2))] as const,
    };
  });
}

function circle(W: number, H: number): ShapeGroupSpec[] {
  const cover = Math.ceil(Math.hypot(W, H) * 1.04);
  const span = 0.5 - HOLD;
  const grow = ch(`t < 0.5 ? 100 * ei(cl(t / ${String(span)})) : 100 * (1 - eo(cl((t - ${String(0.5 + HOLD)}) / ${String(span)})))`, (v) =>
    v.t < 0.5 ? 100 * ei(cl(v.t / span)) : 100 * (1 - eo(cl((v.t - (0.5 + HOLD)) / span))),
  );
  const ring = ch("125 * eo(cl((t - 0.5) / 0.5))", (v) => 125 * eo(cl((v.t - 0.5) / 0.5)));
  return [
    {
      name: "Ring",
      item: { type: "ellipse", size: [cover, cover] },
      tone: 1,
      stroke: Math.round(Math.min(W, H) * 0.03),
      scale: [ring, ring],
      opacity: ch("t > 0.5 ? 100 * (1 - cl((t - 0.5) / 0.5)) : 0", (v) => (v.t > 0.5 ? 100 * (1 - cl((v.t - 0.5) / 0.5)) : 0)),
    },
    { name: "Circle", item: { type: "ellipse", size: [cover, cover] }, tone: 0, scale: [grow, grow] },
  ];
}

function split(W: number, H: number): ShapeGroupSpec[] {
  const half: readonly [number, number] = [Math.ceil(W * 1.02), Math.ceil(H / 2 + 2)];
  const travel = arriveLeave(0);
  // Covering, each half sits a quarter frame from the centre; away, just past the frame's
  // edge it came from, so the panels part the way they closed.
  const top = ch(`-H / 4 - Math.abs(${travel.src}) * (H / 2 + 4)`, (v) => -v.H / 4 - Math.abs(travel.at(v)) * (v.H / 2 + 4));
  const bottom = ch(`H / 4 + Math.abs(${travel.src}) * (H / 2 + 4)`, (v) => v.H / 4 + Math.abs(travel.at(v)) * (v.H / 2 + 4));
  return [
    { name: "Top", item: { type: "rect", size: half }, tone: 0, position: [k(0), top] },
    { name: "Bottom", item: { type: "rect", size: half }, tone: 2, position: [k(0), bottom] },
  ];
}

function slash(W: number, H: number): ShapeGroupSpec[] {
  const angle = -24;
  const hyp = Math.hypot(W, H);
  const a = (angle * Math.PI) / 180;
  // Across the band, which is the way it travels.
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  const travel = arriveLeave(0);
  const reach = 1.2;
  const along = (by: number): readonly [Channel, Channel] => {
    const c = times(travel, reach * by);
    return [
      ch(`(${c.src}) * Math.sqrt(W * W + H * H) * ${nx.toFixed(4)}`, (v) => c.at(v) * Math.hypot(v.W, v.H) * Number(nx.toFixed(4))),
      ch(`(${c.src}) * Math.sqrt(W * W + H * H) * ${ny.toFixed(4)}`, (v) => c.at(v) * Math.hypot(v.W, v.H) * Number(ny.toFixed(4))),
    ];
  };
  return [
    { name: "Stripe", item: { type: "rect", size: [Math.ceil(hyp * 3), Math.ceil(hyp * 0.06)] }, tone: 1, rotation: angle, position: along(1.6) },
    { name: "Slash", item: { type: "rect", size: [Math.ceil(hyp * 3), Math.ceil(hyp * 1.15)] }, tone: 0, rotation: angle, position: along(1) },
  ];
}

function blinds(W: number, H: number): ShapeGroupSpec[] {
  const count = 8;
  const strip = W / count;
  return Array.from({ length: count }, (_, i) => {
    const grow = growShrink(i * 0.035);
    return {
      name: `Blind ${String(i + 1)}`,
      item: { type: "rect" as const, size: [Math.ceil(strip + 2), Math.ceil(H * 1.02)] as const },
      tone: (i % 2 === 0 ? 0 : 2),
      position: [k(Math.round((i + 0.5) * strip - W / 2)), k(0)] as const,
      scale: [grow, k(100)] as const,
    };
  });
}

const r4 = (n: number): number => Number(n.toFixed(4));

function diamond(W: number, H: number): ShapeGroupSpec[] {
  // A square turned 45° covers the frame once |x| + |y| ≤ (W + H) / 2 fits inside it.
  const side = Math.ceil(((W + H) / 2) * Math.SQRT2 * 1.04);
  const outer = growShrink(0);
  const inner = growShrink(0.06);
  return [
    { name: "Inner", item: { type: "rect", size: [Math.ceil(side * 0.55), Math.ceil(side * 0.55)] }, tone: 1, rotation: 45, scale: [inner, inner] },
    { name: "Diamond", item: { type: "rect", size: [side, side] }, tone: 0, rotation: 45, scale: [outer, outer] },
  ];
}

function stripes(W: number, H: number): ShapeGroupSpec[] {
  const count = 7;
  const angle = -30;
  const hyp = Math.hypot(W, H);
  const a = (angle * Math.PI) / 180;
  const thick = hyp / count;
  return Array.from({ length: count }, (_, i) => {
    // Side by side across the stripe, each sliding in along its length, alternately from either end.
    const offset = (i - (count - 1) / 2) * thick;
    const dir = i % 2 === 0 ? 1 : -1;
    const ox = r4(-Math.sin(a) * offset);
    const oy = r4(Math.cos(a) * offset);
    const ux = r4(Math.cos(a) * dir * 1.3);
    const uy = r4(Math.sin(a) * dir * 1.3);
    const travel = arriveLeave(i * 0.03);
    return {
      name: `Stripe ${String(i + 1)}`,
      item: { type: "rect" as const, size: [Math.ceil(hyp * 1.3), Math.ceil(thick + 3)] as const },
      tone: (i % 3) as 0 | 1 | 2,
      rotation: angle,
      position: [
        ch(`${String(ox)} + (${travel.src}) * ${String(ux)} * Math.sqrt(W * W + H * H)`, (v) => ox + travel.at(v) * ux * Math.hypot(v.W, v.H)),
        ch(`${String(oy)} + (${travel.src}) * ${String(uy)} * Math.sqrt(W * W + H * H)`, (v) => oy + travel.at(v) * uy * Math.hypot(v.W, v.H)),
      ] as const,
    };
  });
}

function bubbles(W: number, H: number): ShapeGroupSpec[] {
  const cols = 4;
  const rows = 3;
  const cw = W / cols;
  const chh = H / rows;
  // Each circle covers its own cell, so together they close the frame.
  const d = Math.ceil(Math.hypot(cw, chh) * 1.08);
  return Array.from({ length: cols * rows }, (_, i) => {
    const grow = growShrink(r4((((i * 5) % 12) / 12) * 0.14));
    return {
      name: `Bubble ${String(i + 1)}`,
      item: { type: "ellipse" as const, size: [d, d] as const },
      tone: (i % 3) as 0 | 1 | 2,
      position: [k(Math.round(((i % cols) + 0.5) * cw - W / 2)), k(Math.round((Math.floor(i / cols) + 0.5) * chh - H / 2))] as const,
      scale: [grow, grow] as const,
    };
  });
}

function clock(W: number, H: number): ShapeGroupSpec[] {
  // A ring as thick as its radius is a disc; trimming it sweeps it round like a hand.
  const d = Math.ceil(Math.hypot(W, H) * 1.04);
  const span = 0.5 - HOLD;
  const leave = 0.5 + HOLD;
  return [
    {
      name: "Clock",
      item: { type: "ellipse", size: [Math.ceil(d / 2), Math.ceil(d / 2)] },
      tone: 0,
      stroke: Math.ceil(d / 2) + 2,
      // Ellipse paths start at three o'clock; turned back a quarter, the hand starts at twelve.
      rotation: -90,
      trim: [
        ch(`t < 0.5 ? 0 : 100 * ei(cl((t - ${String(leave)}) / ${String(span)}))`, (v) => (v.t < 0.5 ? 0 : 100 * ei(cl((v.t - leave) / span)))),
        ch(`t < 0.5 ? 100 * eo(cl(t / ${String(span)})) : 100`, (v) => (v.t < 0.5 ? 100 * eo(cl(v.t / span)) : 100)),
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// The presets
// ---------------------------------------------------------------------------

const whip = (id: string, name: string, way: string, axis: "x" | "y", sign: 1 | -1): TransitionPreset => {
  const sym = axis === "x" ? "W" : "H";
  const c = ch(`${sign < 0 ? "-" : ""}${sym} * io(t)`, (v) => sign * (axis === "x" ? v.W : v.H) * io(v.t));
  return {
    id,
    name,
    group: "move",
    frames: 16,
    about: `A fast pan ${way} with motion blur, fastest on the cut.`,
    build: adjust(tile(), move(axis === "x" ? { x: c } : { y: c })),
  };
};

const shakeX = ch("(rnd(f) * 2 - 1) * 0.05 * W * s * pk(t, 1.5)", (v) => (rnd(v.f, v.seed) * 2 - 1) * 0.05 * v.W * v.s * pk(v.t, 1.5));
const shakeY = ch("(rnd(f + 31) * 2 - 1) * 0.05 * H * s * pk(t, 1.5)", (v) => (rnd(v.f + 31, v.seed) * 2 - 1) * 0.05 * v.H * v.s * pk(v.t, 1.5));
const shakeR = ch("(rnd(f + 57) * 2 - 1) * 4 * s * pk(t, 1.5)", (v) => (rnd(v.f + 57, v.seed) * 2 - 1) * 4 * v.s * pk(v.t, 1.5));

const WARM: Rgb = [1, 0.48, 0.1];
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [1, 1, 1];

/** Radial Blur: 1 spins round the centre, 2 zooms out from it. */
const radialBlur = (type: 1 | 2, amount: Channel): EffectSpec => ({
  matchName: "ADBE Radial Blur",
  name: type === 1 ? "KVFX Spin Blur" : "KVFX Zoom Blur",
  params: [
    { param: "ADBE Radial Blur-0001", channel: amount },
    { param: "ADBE Radial Blur-0003", value: type },
  ],
});

/** A short Gaussian bump centred on progress `c`: a beat. */
const beat = (c: number, w: number): Channel =>
  ch(`Math.exp(-Math.pow((t - ${String(c)}) / ${String(w)}, 2))`, (v) => Math.exp(-Math.pow((v.t - c) / w, 2)));
const PULSE = ((): Channel => {
  const a = beat(0.3, 0.045);
  const b = beat(0.5, 0.045);
  return ch(`(${a.src} + ${b.src})`, (v) => a.at(v) + b.at(v));
})();

export const TRANSITIONS: readonly TransitionPreset[] = [
  // --- Trending ----------------------------------------------------------------
  {
    id: "zoomShake",
    name: "Zoom Shake",
    group: "trend",
    frames: 14,
    about: "Punches in on the cut and shakes it off, made for beat drops.",
    build: adjust(
      tile(300),
      move({
        scale: ch("100 * (1 + 1.2 * s * pk(t, 2))", (v) => 100 * (1 + 1.2 * v.s * pk(v.t, 2))),
        x: ch("(rnd(f + 3) * 2 - 1) * 0.035 * W * s * pk(t, 1.2)", (v) => (rnd(v.f + 3, v.seed) * 2 - 1) * 0.035 * v.W * v.s * pk(v.t, 1.2)),
        y: ch("(rnd(f + 17) * 2 - 1) * 0.035 * H * s * pk(t, 1.2)", (v) => (rnd(v.f + 17, v.seed) * 2 - 1) * 0.035 * v.H * v.s * pk(v.t, 1.2)),
        rotation: ch("(rnd(f + 29) * 2 - 1) * 3 * s * pk(t, 1.2)", (v) => (rnd(v.f + 29, v.seed) * 2 - 1) * 3 * v.s * pk(v.t, 1.2)),
      }),
    ),
  },
  {
    id: "blurZoom",
    name: "Blur Zoom",
    group: "trend",
    frames: 14,
    about: "Rushes into the frame through a zoom blur and out the other side.",
    build: adjust(
      tile(300),
      move({ scale: ch("100 * (1 + 1.8 * s * pk(t, 3))", (v) => 100 * (1 + 1.8 * v.s * pk(v.t, 3))) }),
      radialBlur(2, ch("Math.min(100, 70 * s * pk(t, 2))", (v) => Math.min(100, 70 * v.s * pk(v.t, 2)))),
    ),
  },
  {
    id: "spinBlur",
    name: "Spin Blur",
    group: "trend",
    frames: 16,
    about: "A full turn smeared by a spin blur, fastest on the cut.",
    build: adjust(
      tile(300),
      move({ rotation: ch("360 * io(t)", (v) => 360 * io(v.t)), scale: push(20) }),
      radialBlur(1, ch("Math.min(100, 45 * s * pk(t, 2))", (v) => Math.min(100, 45 * v.s * pk(v.t, 2)))),
    ),
  },
  {
    id: "swipe",
    name: "Swipe",
    group: "trend",
    frames: 14,
    about: "Swipes left and stretches into a streak, like a thumb flick.",
    build: adjust(tile(), move({ x: ch("-W * io(t)", (v) => -v.W * io(v.t)), width: ch("100 + 240 * s * pk(t, 3)", (v) => 100 + 240 * v.s * pk(v.t, 3)) })),
  },
  {
    id: "beatPulse",
    name: "Beat Pulse",
    group: "trend",
    frames: 14,
    about: "Two quick pulses, the second on the cut: drop it on the beat.",
    build: adjust(
      tile(300),
      move({ scale: ch(`100 * (1 + 0.3 * s * ${PULSE.src})`, (v) => 100 * (1 + 0.3 * v.s * PULSE.at(v))) }),
      {
        matchName: "ADBE Brightness & Contrast 2",
        name: "KVFX Pulse Light",
        params: [{ param: "ADBE Brightness & Contrast 2-0001", channel: ch(`30 * s * ${PULSE.src}`, (v) => 30 * v.s * PULSE.at(v)) }],
      },
    ),
  },
  {
    id: "strobe",
    name: "Strobe",
    group: "trend",
    frames: 12,
    about: "White flicker frames either side of the cut.",
    build: {
      kind: "solid",
      color: WHITE,
      blend: "add",
      opacity: ch("pk(t, 1) > 0.25 && f % 2 === 0 ? 100 * Math.min(1, s) * Math.sqrt(pk(t, 1)) : 0", (v) =>
        pk(v.t, 1) > 0.25 && v.f % 2 === 0 ? 100 * Math.min(1, v.s) * Math.sqrt(pk(v.t, 1)) : 0,
      ),
      effects: [],
    },
  },
  {
    id: "chromaSplit",
    name: "Chroma Split",
    group: "trend",
    frames: 12,
    about: "Red and blue smear sideways off the picture, then snap back.",
    build: adjust(
      tile(200),
      {
        matchName: "ADBE Channel Blur",
        name: "KVFX Split",
        params: [
          { param: "ADBE Channel Blur-0001", channel: ch("90 * s * pk(t, 2)", (v) => 90 * v.s * pk(v.t, 2)) },
          { param: "ADBE Channel Blur-0003", channel: ch("45 * s * pk(t, 2)", (v) => 45 * v.s * pk(v.t, 2)) },
          { param: "ADBE Channel Blur-0005", value: 1 },
          { param: "ADBE Channel Blur-0006", value: 2 },
        ],
      },
      move({
        x: ch("(rnd(Math.floor(f / 2) + 41) * 2 - 1) * 0.025 * W * s * pk(t, 2)", (v) => (rnd(Math.floor(v.f / 2) + 41, v.seed) * 2 - 1) * 0.025 * v.W * v.s * pk(v.t, 2)),
        scale: push(6),
      }),
    ),
  },
  {
    id: "kaleido",
    name: "Kaleido",
    group: "trend",
    frames: 16,
    about: "Folds into a turning kaleidoscope through the cut.",
    build: adjust(
      tile(300),
      move({ rotation: ch("90 * s * Math.sin(Math.PI * t)", (v) => 90 * v.s * Math.sin(Math.PI * v.t)), scale: push(12) }),
      // Kaleida has no "off" setting, so it fades in and out through its own opacity.
      { matchName: "CC Kaleida", name: "KVFX Kaleido", params: [], mix: ch("100 * pk(t, 1.5)", (v) => 100 * pk(v.t, 1.5)) },
    ),
  },

  // --- Moves -------------------------------------------------------------------
  whip("whipLeft", "Whip Left", "to the left", "x", -1),
  whip("whipRight", "Whip Right", "to the right", "x", 1),
  whip("whipUp", "Whip Up", "upward", "y", -1),
  whip("whipDown", "Whip Down", "downward", "y", 1),
  {
    id: "zoomIn",
    name: "Zoom In",
    group: "move",
    frames: 14,
    about: "Punches in to the cut and settles back out, blurred by its own speed.",
    build: adjust(tile(), move({ scale: ch("100 * (1 + 2.5 * s * pk(t, 3))", (v) => 100 * (1 + 2.5 * v.s * pk(v.t, 3))) })),
  },
  {
    id: "zoomOut",
    name: "Zoom Out",
    group: "move",
    frames: 14,
    about: "Pulls back into a wall of tiles at the cut, then pushes in again.",
    build: adjust(tile(), move({ scale: ch("100 / (1 + 2.5 * s * pk(t, 3))", (v) => 100 / (1 + 2.5 * v.s * pk(v.t, 3))) })),
  },
  {
    id: "spin",
    name: "Spin",
    group: "move",
    frames: 18,
    about: "One full turn clockwise, fastest on the cut.",
    build: adjust(tile(), move({ rotation: ch("360 * io(t)", (v) => 360 * io(v.t)), scale: push(25) })),
  },
  {
    id: "roll",
    name: "Roll",
    group: "move",
    frames: 18,
    about: "A counter-clockwise turn with a deep zoom through the cut.",
    build: adjust(
      tile(),
      move({ rotation: ch("-360 * io(t)", (v) => -360 * io(v.t)), scale: ch("100 * (1 + 1.6 * s * pk(t, 3))", (v) => 100 * (1 + 1.6 * v.s * pk(v.t, 3))) }),
    ),
  },
  {
    id: "stretchH",
    name: "Stretch",
    group: "move",
    frames: 12,
    about: "Stretches sideways into a streak and snaps back.",
    build: adjust(move({ width: ch("100 + 600 * s * pk(t, 3)", (v) => 100 + 600 * v.s * pk(v.t, 3)) })),
  },
  {
    id: "stretchV",
    name: "Stretch Up",
    group: "move",
    frames: 12,
    about: "Stretches tall into a streak and snaps back.",
    build: adjust(move({ height: ch("100 + 600 * s * pk(t, 3)", (v) => 100 + 600 * v.s * pk(v.t, 3)) })),
  },
  {
    id: "shake",
    name: "Impact",
    group: "move",
    frames: 14,
    about: "A hit on the cut: a jolt, a shake and a punch in.",
    build: adjust(tile(), move({ x: shakeX, y: shakeY, rotation: shakeR, scale: push(14, 4) })),
  },
  {
    id: "swing",
    name: "Swing",
    group: "move",
    frames: 16,
    about: "Pans left while the frame swings like a pendulum through the cut.",
    build: adjust(tile(), move({ x: ch("-W * io(t)", (v) => -v.W * io(v.t)), rotation: ch("16 * s * Math.sin(2 * Math.PI * t)", (v) => 16 * v.s * Math.sin(2 * Math.PI * v.t)) })),
  },

  // --- Optical -----------------------------------------------------------------
  {
    id: "blur",
    name: "Blur",
    group: "optical",
    frames: 14,
    about: "Defocuses into the cut and back to sharp.",
    build: adjust(
      {
        matchName: "ADBE Gaussian Blur 2",
        name: "KVFX Blur",
        params: [
          { param: "ADBE Gaussian Blur 2-0001", channel: ch("140 * s * pk(t, 2)", (v) => 140 * v.s * pk(v.t, 2)) },
          { param: "ADBE Gaussian Blur 2-0003", value: 1 },
        ],
      },
      move({ scale: push(8) }),
    ),
  },
  {
    id: "lens",
    name: "Lens Warp",
    group: "optical",
    frames: 14,
    about: "Bends the frame like a wide lens as it punches through.",
    build: adjust(
      tile(300),
      {
        matchName: "ADBE Optics Compensation",
        name: "KVFX Lens",
        params: [{ param: "ADBE Optics Compensation-0001", channel: ch("Math.min(170, 150 * s * pk(t, 2))", (v) => Math.min(170, 150 * v.s * pk(v.t, 2))) }],
      },
      move({ scale: push(30, 3) }),
    ),
  },
  {
    id: "twist",
    name: "Twist",
    group: "optical",
    frames: 16,
    about: "Twirls the middle of the frame round and lets it go.",
    build: adjust(
      tile(300),
      {
        matchName: "ADBE Twirl",
        name: "KVFX Twist",
        params: [
          { param: "ADBE Twirl-0001", channel: ch("420 * s * pk(t, 2)", (v) => 420 * v.s * pk(v.t, 2)) },
          { param: "ADBE Twirl-0002", value: 70 },
        ],
      },
      move({ scale: push(10) }),
    ),
  },
  {
    id: "liquid",
    name: "Liquid",
    group: "optical",
    frames: 16,
    about: "Melts into a ripple of turbulence and pulls back together.",
    build: adjust(
      tile(300),
      {
        matchName: "ADBE Turbulent Displace",
        name: "KVFX Liquid",
        params: [
          { param: "ADBE Turbulent Displace-0002", channel: ch("140 * s * pk(t, 2)", (v) => 140 * v.s * pk(v.t, 2)) },
          { param: "ADBE Turbulent Displace-0003", value: 90 },
        ],
      },
      move({ scale: push(10) }),
    ),
  },
  {
    id: "pixelate",
    name: "Pixelate",
    group: "optical",
    frames: 12,
    about: "Breaks into big pixels at the cut and sharpens again.",
    build: adjust({
      matchName: "ADBE Mosaic",
      name: "KVFX Pixels",
      params: [
        { param: "ADBE Mosaic-0001", channel: ch("Math.max(2, Math.round(W / (1 + 70 * s * pk(t, 2))))", (v) => Math.max(2, Math.round(v.W / (1 + 70 * v.s * pk(v.t, 2))))) },
        { param: "ADBE Mosaic-0002", channel: ch("Math.max(2, Math.round(H / (1 + 70 * s * pk(t, 2))))", (v) => Math.max(2, Math.round(v.H / (1 + 70 * v.s * pk(v.t, 2))))) },
        { param: "ADBE Mosaic-0003", value: 1 },
      ],
      // Mosaic has no "off" block count, so the effect fades out at both ends.
      mix: ch("pk(t, 2) > 0.02 ? 100 : 0", (v) => (pk(v.t, 2) > 0.02 ? 100 : 0)),
    }),
  },
  {
    id: "wave",
    name: "Wave",
    group: "optical",
    frames: 16,
    about: "Ripples across the frame in a rising, falling wave.",
    build: adjust(
      tile(300),
      {
        matchName: "ADBE Wave Warp",
        name: "KVFX Wave",
        params: [
          { param: "ADBE Wave Warp-0001", value: 1 },
          { param: "ADBE Wave Warp-0002", channel: ch("90 * s * pk(t, 2)", (v) => 90 * v.s * pk(v.t, 2)) },
          { param: "ADBE Wave Warp-0003", value: 160 },
          { param: "ADBE Wave Warp-0005", value: 3 },
        ],
      },
      move({ scale: push(8) }),
    ),
  },

  // --- Light -------------------------------------------------------------------
  {
    id: "flash",
    name: "Flash",
    group: "light",
    frames: 10,
    about: "A white flash on the cut.",
    build: { kind: "solid", color: WHITE, blend: "add", opacity: ch("100 * Math.min(1, s) * Math.pow(pk(t, 1), 4)", (v) => 100 * Math.min(1, v.s) * Math.pow(pk(v.t, 1), 4)), effects: [] },
  },
  {
    id: "leak",
    name: "Light Leak",
    group: "light",
    frames: 30,
    about: "Warm film light sweeps across the frame and fades.",
    build: {
      kind: "solid",
      color: BLACK,
      blend: "screen",
      opacity: ch("100 * Math.min(1, 1.4 * s * pk(t, 1))", (v) => 100 * Math.min(1, 1.4 * v.s * pk(v.t, 1))),
      effects: [
        {
          matchName: "ADBE 4ColorGradient",
          name: "KVFX Light",
          params: [
            { param: "ADBE 4ColorGradient-0001", point: [ch("W * (-0.7 + 1.2 * t)", (v) => v.W * (-0.7 + 1.2 * v.t)), ch("-0.25 * H", (v) => -0.25 * v.H)] },
            { param: "ADBE 4ColorGradient-0002", value: [1, 0.48, 0.1, 1] },
            { param: "ADBE 4ColorGradient-0003", point: [ch("W * (0.6 - 0.9 * t)", (v) => v.W * (0.6 - 0.9 * v.t)), ch("0.35 * H", (v) => 0.35 * v.H)] },
            { param: "ADBE 4ColorGradient-0004", value: [1, 0.18, 0.33, 1] },
            { param: "ADBE 4ColorGradient-0005", point: [ch("W * (-0.3 + 0.6 * t)", (v) => v.W * (-0.3 + 0.6 * v.t)), ch("H * (-0.4 + 0.3 * t)", (v) => v.H * (-0.4 + 0.3 * v.t))] },
            { param: "ADBE 4ColorGradient-0006", value: [1, 0.82, 0.54, 1] },
            { param: "ADBE 4ColorGradient-0007", point: [ch("W * (0.2 - 0.4 * t)", (v) => v.W * (0.2 - 0.4 * v.t)), ch("0", () => 0)] },
            { param: "ADBE 4ColorGradient-0008", value: [0, 0, 0, 1] },
            { param: "ADBE 4ColorGradient-0009", value: 220 },
          ],
        },
      ],
    },
  },
  {
    id: "dip",
    name: "Dip to Black",
    group: "light",
    frames: 16,
    about: "Fades down to black on the cut and up again.",
    build: { kind: "solid", color: BLACK, blend: "normal", opacity: ch("100 * cl(1.6 * s * pk(t, 1))", (v) => 100 * cl(1.6 * v.s * pk(v.t, 1))), effects: [] },
  },

  {
    id: "lightBurst",
    name: "Light Burst",
    group: "light",
    frames: 14,
    about: "A bloom of light bursts out from the centre on the cut.",
    build: {
      kind: "solid",
      color: BLACK,
      blend: "add",
      opacity: ch("100 * Math.min(1, 1.3 * s * pk(t, 1.5))", (v) => 100 * Math.min(1, 1.3 * v.s * pk(v.t, 1.5))),
      effects: [
        {
          matchName: "ADBE Ramp",
          name: "KVFX Burst",
          params: [
            { param: "ADBE Ramp-0001", point: [k(0), k(0)] },
            { param: "ADBE Ramp-0002", value: [1, 0.96, 0.88, 1] },
            { param: "ADBE Ramp-0003", point: [ch("W * (0.1 + 0.8 * pk(t, 1))", (v) => v.W * (0.1 + 0.8 * pk(v.t, 1))), k(0)] },
            { param: "ADBE Ramp-0004", value: [0, 0, 0, 1] },
            { param: "ADBE Ramp-0005", value: 2 },
          ],
        },
      ],
    },
  },
  {
    id: "filmBurn",
    name: "Film Burn",
    group: "light",
    frames: 20,
    about: "Hot orange film burn flares and flickers over the cut.",
    build: {
      kind: "solid",
      color: BLACK,
      blend: "screen",
      opacity: ch("100 * Math.min(1, 1.5 * s * pk(t, 1)) * (0.7 + 0.3 * rnd(f + 5))", (v) => 100 * Math.min(1, 1.5 * v.s * pk(v.t, 1)) * (0.7 + 0.3 * rnd(v.f + 5, v.seed))),
      effects: [
        {
          matchName: "ADBE 4ColorGradient",
          name: "KVFX Burn",
          params: [
            {
              param: "ADBE 4ColorGradient-0001",
              point: [
                ch("W * (0.35 - 0.2 * t + 0.08 * (rnd(f + 1) - 0.5))", (v) => v.W * (0.35 - 0.2 * v.t + 0.08 * (rnd(v.f + 1, v.seed) - 0.5))),
                ch("H * (0.1 + 0.08 * (rnd(f + 2) - 0.5))", (v) => v.H * (0.1 + 0.08 * (rnd(v.f + 2, v.seed) - 0.5))),
              ],
            },
            { param: "ADBE 4ColorGradient-0002", value: [1, 0.25, 0.05, 1] },
            { param: "ADBE 4ColorGradient-0003", point: [ch("W * (-0.3 + 0.25 * t)", (v) => v.W * (-0.3 + 0.25 * v.t)), ch("-0.3 * H", (v) => -0.3 * v.H)] },
            { param: "ADBE 4ColorGradient-0004", value: [1, 0.62, 0.12, 1] },
            { param: "ADBE 4ColorGradient-0005", point: [ch("0.45 * W", (v) => 0.45 * v.W), ch("H * (0.35 - 0.3 * t)", (v) => v.H * (0.35 - 0.3 * v.t))] },
            { param: "ADBE 4ColorGradient-0006", value: [1, 0.92, 0.6, 1] },
            { param: "ADBE 4ColorGradient-0007", point: [ch("-0.35 * W", (v) => -0.35 * v.W), ch("0.4 * H", (v) => 0.4 * v.H)] },
            { param: "ADBE 4ColorGradient-0008", value: [0, 0, 0, 1] },
            { param: "ADBE 4ColorGradient-0009", value: 160 },
          ],
        },
      ],
    },
  },

  // --- Glitch ------------------------------------------------------------------
  {
    id: "glitch",
    name: "Glitch",
    group: "glitch",
    frames: 14,
    about: "Tears, jumps and colour fringes, different every time you add it.",
    build: adjust(
      tile(200),
      {
        matchName: "ADBE Wave Warp",
        name: "KVFX Tear",
        params: [
          { param: "ADBE Wave Warp-0001", value: 2 },
          { param: "ADBE Wave Warp-0002", channel: ch("gb() * 70 * s", (v) => gb(v) * 70 * v.s) },
          { param: "ADBE Wave Warp-0003", channel: ch("30 + 220 * rnd(f + 3)", (v) => 30 + 220 * rnd(v.f + 3, v.seed)) },
          { param: "ADBE Wave Warp-0005", value: 0 },
          { param: "ADBE Wave Warp-0007", channel: ch("rnd(f + 7) * 360", (v) => rnd(v.f + 7, v.seed) * 360) },
        ],
      },
      move({
        x: ch("(rnd(Math.floor(f / 2)) * 2 - 1) * gb() * 0.06 * W * s", (v) => (rnd(Math.floor(v.f / 2), v.seed) * 2 - 1) * gb(v) * 0.06 * v.W * v.s),
        scale: ch("100 + 6 * gb()", (v) => 100 + 6 * gb(v)),
      }),
      {
        matchName: "ADBE Channel Blur",
        name: "KVFX Fringe",
        params: [
          { param: "ADBE Channel Blur-0001", channel: ch("40 * gb() * s", (v) => 40 * gb(v) * v.s) },
          { param: "ADBE Channel Blur-0003", channel: ch("12 * gb() * s", (v) => 12 * gb(v) * v.s) },
          { param: "ADBE Channel Blur-0005", value: 1 },
        ],
      },
      {
        matchName: "ADBE Invert",
        name: "KVFX Invert",
        params: [{ param: "ADBE Invert-0002", channel: ch("rnd(f + 11) > 0.8 && gb() > 0.4 ? 0 : 100", (v) => (rnd(v.f + 11, v.seed) > 0.8 && gb(v) > 0.4 ? 0 : 100)) }],
      },
    ),
  },
  {
    id: "signal",
    name: "Signal Loss",
    group: "glitch",
    frames: 18,
    about: "A worn tape losing tracking: wobble, roll, noise and fringing.",
    build: adjust(
      tile(200),
      {
        matchName: "ADBE Wave Warp",
        name: "KVFX Wobble",
        params: [
          { param: "ADBE Wave Warp-0001", value: 9 },
          { param: "ADBE Wave Warp-0002", channel: ch("35 * s * pk(t, 1)", (v) => 35 * v.s * pk(v.t, 1)) },
          { param: "ADBE Wave Warp-0003", value: 260 },
          { param: "ADBE Wave Warp-0005", value: 6 },
        ],
      },
      move({
        y: ch("rnd(Math.floor(f / 3) + 5) > 0.6 ? (rnd(f + 9) * 2 - 1) * 0.25 * H * s * pk(t, 2) : 0", (v) =>
          rnd(Math.floor(v.f / 3) + 5, v.seed) > 0.6 ? (rnd(v.f + 9, v.seed) * 2 - 1) * 0.25 * v.H * v.s * pk(v.t, 2) : 0,
        ),
      }),
      {
        matchName: "ADBE Channel Blur",
        name: "KVFX Fringe",
        params: [
          { param: "ADBE Channel Blur-0001", channel: ch("25 * s * pk(t, 1)", (v) => 25 * v.s * pk(v.t, 1)) },
          { param: "ADBE Channel Blur-0005", value: 1 },
        ],
      },
      {
        matchName: "ADBE Noise",
        name: "KVFX Noise",
        params: [{ param: "ADBE Noise-0001", channel: ch("Math.min(100, 60 * s * pk(t, 1))", (v) => Math.min(100, 60 * v.s * pk(v.t, 1))) }],
      },
      {
        matchName: "ADBE Brightness & Contrast 2",
        name: "KVFX Tone",
        params: [
          { param: "ADBE Brightness & Contrast 2-0001", channel: ch("-25 * s * pk(t, 1)", (v) => -25 * v.s * pk(v.t, 1)) },
          { param: "ADBE Brightness & Contrast 2-0002", channel: ch("30 * s * pk(t, 1)", (v) => 30 * v.s * pk(v.t, 1)) },
        ],
      },
    ),
  },

  // --- Graphic -----------------------------------------------------------------
  { id: "bars", name: "Bars", group: "graphic", frames: 18, about: "Bands of colour sweep across, one after another, and on out.", build: { kind: "shape", groups: bars } },
  { id: "circle", name: "Circle", group: "graphic", frames: 16, about: "A circle bursts out to fill the frame and closes on the new shot.", build: { kind: "shape", groups: circle } },
  { id: "split", name: "Split", group: "graphic", frames: 16, about: "Two panels slam shut on the cut and part again.", build: { kind: "shape", groups: split } },
  { id: "slash", name: "Slash", group: "graphic", frames: 16, about: "A diagonal band slices across the frame.", build: { kind: "shape", groups: slash } },
  { id: "blinds", name: "Blinds", group: "graphic", frames: 16, about: "Vertical blinds close left to right and open again.", build: { kind: "shape", groups: blinds } },
  { id: "diamond", name: "Diamond", group: "graphic", frames: 16, about: "Two diamonds burst open over the cut and close on the new shot.", build: { kind: "shape", groups: diamond } },
  { id: "stripes", name: "Stripes", group: "graphic", frames: 18, about: "Diagonal stripes zip in from both ends and on out.", build: { kind: "shape", groups: stripes } },
  { id: "bubbles", name: "Bubbles", group: "graphic", frames: 16, about: "Circles pop up all over the frame, then pop away.", build: { kind: "shape", groups: bubbles } },
  { id: "clock", name: "Clock", group: "graphic", frames: 16, about: "Sweeps round like a clock hand to cover, and round again to reveal.", build: { kind: "shape", groups: clock } },
];

export function transitionById(id: unknown): TransitionPreset | undefined {
  return TRANSITIONS.find((p) => p.id === id);
}

/** The colour a graphic preset fills with, in three tones of one hue. */
export function transitionTones(base: Rgb): readonly [Rgb, Rgb, Rgb] {
  const mix = (to: number, amount: number): Rgb => [
    base[0] + (to - base[0]) * amount,
    base[1] + (to - base[1]) * amount,
    base[2] + (to - base[2]) * amount,
  ];
  return [base, mix(1, 0.3), mix(0, 0.25)];
}

export const DEFAULT_TRANSITION_COLOR: Rgb = WARM;

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export function scalarExpression(c: Channel, seed: number): string {
  return `${transitionHead(seed)}\n${c.src};`;
}

/** A point given as offsets from the layer's centre. */
export function centredPointExpression(x: Channel, y: Channel, seed: number): string {
  return `${transitionHead(seed)}\n[W / 2 + (${x.src}), H / 2 + (${y.src})];`;
}

/** A shape group's position or scale: a pair, already in the group's space. */
export function pairExpression(a: Channel, b: Channel, seed: number): string {
  return `${transitionHead(seed)}\n[${a.src}, ${b.src}];`;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export interface TransitionWindow {
  readonly start: number;
  readonly end: number;
  readonly cut: number;
  /** True when it moved onto a selected layer's in or out point. */
  readonly snapped: boolean;
}

/**
 * Where the layer goes: centred on the cut nearest the playhead — a selected
 * layer's in or out point within reach — or on the playhead itself, and kept
 * inside the comp.
 */
export function transitionWindow(options: {
  readonly time: number;
  readonly frame: number;
  readonly frames: number;
  readonly compDuration: number;
  readonly cuts: readonly number[];
  readonly snap: boolean;
}): TransitionWindow {
  const { time, frame, compDuration } = options;
  const length = Math.max(2, Math.round(options.frames)) * frame;
  const reach = Math.max(1, length);
  let cut = time;
  let snapped = false;
  if (options.snap) {
    let best = Infinity;
    for (const c of options.cuts) {
      const gap = Math.abs(c - time);
      if (gap <= reach && gap < best && c > 0 && c < compDuration) {
        best = gap;
        cut = c;
        snapped = true;
      }
    }
  }
  cut = Math.round(cut / frame) * frame;
  let start = cut - length / 2;
  let end = cut + length / 2;
  if (start < 0) {
    start = 0;
    end = Math.min(compDuration, length);
  }
  if (end > compDuration) {
    end = compDuration;
    start = Math.max(0, end - length);
  }
  return { start, end, cut, snapped };
}

// ---------------------------------------------------------------------------
// The preview's view of a preset at one moment
// ---------------------------------------------------------------------------

export interface ShapePose {
  readonly type: "rect" | "ellipse";
  readonly size: readonly [number, number];
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
  readonly opacity: number;
  readonly color: Rgb;
  readonly stroke?: number;
  /** Trim Paths start and end in percent, for shapes that sweep round. */
  readonly trim?: readonly [number, number];
}

export interface TransitionPose {
  readonly kind: TransitionBuild["kind"];
  /** Whether Motion Tile fills in around moved or shrunk picture. */
  readonly tiled: boolean;
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
  /** Effect amounts by effect match name and parameter, for the preview to approximate. */
  readonly amounts: Readonly<Record<string, number>>;
  readonly solid?: {
    readonly color: Rgb;
    readonly blend: BlendMode;
    readonly opacity: number;
    /** A 4-Color Gradient's four points, or a radial Gradient Ramp's start and end. */
    readonly gradient?: "four" | "ramp";
    readonly points?: readonly (readonly [number, number])[];
  };
  readonly shapes: readonly ShapePose[];
}

/**
 * The preset at progress `t`, evaluated with the same channels as its
 * expressions. Points are in comp pixels from the comp's centre.
 */
export function transitionPose(
  preset: TransitionPreset,
  t: number,
  options: { readonly s?: number; readonly seed?: number; readonly W?: number; readonly H?: number; readonly frames?: number; readonly color?: Rgb } = {},
): TransitionPose {
  const W = options.W ?? 1920;
  const H = options.H ?? 1080;
  const frames = options.frames ?? preset.frames;
  const v: ChannelVars = { t: cl(t), s: options.s ?? 1, f: Math.floor(cl(t) * frames), W, H, seed: options.seed ?? 1 };
  const amounts: Record<string, number> = {};
  let x = 0;
  let y = 0;
  let scaleX = 100;
  let scaleY = 100;
  let rotation = 0;
  let tiled = false;
  const effects = preset.build.kind === "shape" ? [] : preset.build.effects;
  for (const effect of effects) {
    if (effect.matchName === "ADBE Tile") tiled = true;
    for (const p of effect.params) {
      if (p.channel !== undefined) amounts[p.param] = p.channel.at(v);
      else if (typeof p.value === "number") amounts[p.param] = p.value;
    }
    if (effect.mix !== undefined) amounts[`${effect.matchName} mix`] = effect.mix.at(v);
    if (effect.matchName !== "ADBE Geometry2") continue;
    const position = effect.params.find((p) => p.param === "ADBE Geometry2-0002")?.point;
    if (position !== undefined) {
      x = position[0].at(v);
      y = position[1].at(v);
    }
    const uniform = amounts["ADBE Geometry2-0011"] !== 0;
    const height = amounts["ADBE Geometry2-0003"] ?? 100;
    scaleY = height;
    scaleX = uniform ? height : (amounts["ADBE Geometry2-0004"] ?? 100);
    rotation = amounts["ADBE Geometry2-0007"] ?? 0;
  }

  let solid: TransitionPose["solid"];
  if (preset.build.kind === "solid") {
    const gradient = preset.build.effects.find((e) => e.matchName === "ADBE 4ColorGradient" || e.matchName === "ADBE Ramp");
    const points = gradient?.params.filter((p) => p.point !== undefined).map((p) => [p.point![0].at(v), p.point![1].at(v)] as const);
    solid = {
      color: preset.build.color,
      blend: preset.build.blend,
      opacity: preset.build.opacity.at(v),
      ...(gradient === undefined || points === undefined ? {} : { gradient: gradient.matchName === "ADBE Ramp" ? ("ramp" as const) : ("four" as const), points }),
    };
  }

  const shapes: ShapePose[] = [];
  if (preset.build.kind === "shape") {
    const tones = transitionTones(options.color ?? DEFAULT_TRANSITION_COLOR);
    for (const g of preset.build.groups(W, H)) {
      shapes.push({
        type: g.item.type,
        size: g.item.size,
        x: g.position?.[0].at(v) ?? 0,
        y: g.position?.[1].at(v) ?? 0,
        scaleX: g.scale?.[0].at(v) ?? 100,
        scaleY: g.scale?.[1].at(v) ?? 100,
        rotation: g.rotation ?? 0,
        opacity: g.opacity?.at(v) ?? 100,
        color: tones[g.tone],
        ...(g.stroke === undefined ? {} : { stroke: g.stroke }),
        ...(g.trim === undefined ? {} : { trim: [g.trim[0].at(v), g.trim[1].at(v)] as const }),
      });
    }
  }

  return { kind: preset.build.kind, tiled, x, y, scaleX, scaleY, rotation, amounts, ...(solid === undefined ? {} : { solid }), shapes };
}

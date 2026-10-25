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

export type TransitionGroup = "move" | "optical" | "light" | "glitch" | "graphic";

export const TRANSITION_GROUPS: readonly { readonly id: TransitionGroup; readonly label: string }[] = [
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

export const TRANSITIONS: readonly TransitionPreset[] = [
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
  readonly solid?: { readonly color: Rgb; readonly blend: BlendMode; readonly opacity: number; readonly points?: readonly (readonly [number, number])[] };
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
    const gradient = preset.build.effects.find((e) => e.matchName === "ADBE 4ColorGradient");
    const points = gradient?.params.filter((p) => p.point !== undefined).map((p) => [p.point![0].at(v), p.point![1].at(v)] as const);
    solid = { color: preset.build.color, blend: preset.build.blend, opacity: preset.build.opacity.at(v), ...(points === undefined ? {} : { points }) };
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
      });
    }
  }

  return { kind: preset.build.kind, tiled, x, y, scaleX, scaleY, rotation, amounts, ...(solid === undefined ? {} : { solid }), shapes };
}

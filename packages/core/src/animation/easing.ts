/**
 * Easing curves as cubic beziers, in the CSS convention:
 * P0 = (0, 0), P1 = (x1, y1), P2 = (x2, y2), P3 = (1, 1).
 *
 * This is the representation the curve editor draws and the user edits. The
 * host turns it into After Effects' speed-and-influence ease per keyframe
 * (see `kvfx.op.keys.ease`); nothing here knows about keyframes.
 */

/* eslint-disable no-magic-numbers -- curve constants and cubic-bezier maths */

export type Bezier = readonly [number, number, number, number];

export interface EasePreset {
  readonly id: string;
  readonly name: string;
  readonly group: "Basic" | "In" | "Out" | "In-Out";
  readonly bezier: Bezier;
}

/**
 * The standard curve families. The numbers are the well-known Penner-style
 * approximations every motion tool uses; they are maths, not anyone's asset.
 */
export const EASE_PRESETS: readonly EasePreset[] = [
  { id: "linear", name: "Linear", group: "Basic", bezier: [0, 0, 1, 1] },
  { id: "easy", name: "Easy Ease", group: "Basic", bezier: [0.333, 0, 0.667, 1] },
  { id: "smooth", name: "Smooth", group: "Basic", bezier: [0.25, 0.1, 0.25, 1] },
  { id: "snap", name: "Snap", group: "Basic", bezier: [0.7, 0, 0.1, 1] },

  { id: "in-sine", name: "Sine", group: "In", bezier: [0.12, 0, 0.39, 0] },
  { id: "in-quad", name: "Quad", group: "In", bezier: [0.11, 0, 0.5, 0] },
  { id: "in-cubic", name: "Cubic", group: "In", bezier: [0.32, 0, 0.67, 0] },
  { id: "in-quart", name: "Quart", group: "In", bezier: [0.5, 0, 0.75, 0] },
  { id: "in-expo", name: "Expo", group: "In", bezier: [0.7, 0, 0.84, 0] },
  { id: "in-back", name: "Back", group: "In", bezier: [0.36, 0, 0.66, -0.56] },

  { id: "out-sine", name: "Sine", group: "Out", bezier: [0.61, 1, 0.88, 1] },
  { id: "out-quad", name: "Quad", group: "Out", bezier: [0.5, 1, 0.89, 1] },
  { id: "out-cubic", name: "Cubic", group: "Out", bezier: [0.33, 1, 0.68, 1] },
  { id: "out-quart", name: "Quart", group: "Out", bezier: [0.25, 1, 0.5, 1] },
  { id: "out-expo", name: "Expo", group: "Out", bezier: [0.16, 1, 0.3, 1] },
  { id: "out-back", name: "Back", group: "Out", bezier: [0.34, 1.56, 0.64, 1] },

  { id: "inout-sine", name: "Sine", group: "In-Out", bezier: [0.37, 0, 0.63, 1] },
  { id: "inout-quad", name: "Quad", group: "In-Out", bezier: [0.45, 0, 0.55, 1] },
  { id: "inout-cubic", name: "Cubic", group: "In-Out", bezier: [0.65, 0, 0.35, 1] },
  { id: "inout-quart", name: "Quart", group: "In-Out", bezier: [0.76, 0, 0.24, 1] },
  { id: "inout-expo", name: "Expo", group: "In-Out", bezier: [0.87, 0, 0.13, 1] },
  { id: "inout-back", name: "Back", group: "In-Out", bezier: [0.68, -0.6, 0.32, 1.6] },
];

/** After Effects' own Easy Ease: zero speed, one-third influence each side. */
export const DEFAULT_BEZIER: Bezier = [0.333, 0, 0.667, 1];

/** How far handles may leave the unit square vertically: enough for any overshoot people use. */
export const BEZIER_Y_MIN = -1;
export const BEZIER_Y_MAX = 2;

const DECIMALS = 3;
const SCALE = 10 ** DECIMALS;

function round(value: number): number {
  return Math.round(value * SCALE) / SCALE;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Brings a curve into the range After Effects can express: x within 0–1 (time
 * cannot run backwards), y within the overshoot band, rounded to the precision
 * the editor shows.
 */
export function normalizeBezier(value: readonly number[]): Bezier {
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = value.map((n) => (Number.isFinite(n) ? n : 0));
  return [
    round(clamp(x1, 0, 1)),
    round(clamp(y1, BEZIER_Y_MIN, BEZIER_Y_MAX)),
    round(clamp(x2, 0, 1)),
    round(clamp(y2, BEZIER_Y_MIN, BEZIER_Y_MAX)),
  ];
}

export function formatBezier(bezier: Bezier): string {
  return bezier.map((n) => String(round(n))).join(", ");
}

/**
 * Reads a curve from text: four numbers separated by commas or spaces, with
 * or without a `cubic-bezier( … )` wrapper — what people paste from the web.
 */
export function parseBezier(text: string): Bezier | undefined {
  const inner = text.trim().replace(/^cubic-bezier\s*\(/i, "").replace(/\)\s*$/, "");
  const parts = inner.split(/[\s,]+/).filter((p) => p.length > 0);
  if (parts.length !== 4) return undefined;
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isFinite(n))) return undefined;
  return normalizeBezier(numbers);
}

export function bezierEquals(a: Bezier, b: Bezier, tolerance = 1e-3): boolean {
  return a.every((n, i) => Math.abs(n - (b[i] ?? 0)) <= tolerance);
}

/** The preset a curve matches, if any — so the editor can name what it shows. */
export function matchPreset(bezier: Bezier): EasePreset | undefined {
  return EASE_PRESETS.find((preset) => bezierEquals(preset.bezier, bezier));
}

/** A point on the curve at parameter t, for drawing. */
export function bezierPoint(bezier: Bezier, t: number): { x: number; y: number } {
  const [x1, y1, x2, y2] = bezier;
  const u = 1 - t;
  const a = 3 * u * u * t;
  const b = 3 * u * t * t;
  const c = t * t * t;
  return { x: a * x1 + b * x2 + c, y: a * y1 + b * y2 + c };
}

/**
 * The curve's progress at a given fraction of time — what a preview dot uses.
 * Solves x(t) = time by bisection, which is exact enough for display and
 * never diverges the way Newton's method can on steep handles.
 */
export function easeAt(bezier: Bezier, time: number): number {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  let lo = 0;
  let hi = 1;
  const ITERATIONS = 32;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const mid = (lo + hi) / 2;
    if (bezierPoint(bezier, mid).x < time) lo = mid;
    else hi = mid;
  }
  return bezierPoint(bezier, (lo + hi) / 2).y;
}

/** Mirrors a curve in time: an ease-in becomes the matching ease-out. */
export function reverseBezier(bezier: Bezier): Bezier {
  const [x1, y1, x2, y2] = bezier;
  return normalizeBezier([1 - x2, 1 - y2, 1 - x1, 1 - y1]);
}

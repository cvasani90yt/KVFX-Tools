/**
 * Expression generators for motion applied to keyframed properties.
 *
 * Every expression here is written to run unchanged on both of After Effects'
 * expression engines. That rules out array arithmetic with `+` and `*` (only
 * the legacy engine overloads them), so vector maths goes through two small
 * helper functions defined inside each expression. The final value is always
 * a plain trailing expression statement, which both engines return.
 */

export interface ElasticOptions {
  /** Overshoot size as a fraction of the arriving velocity. */
  readonly amplitude: number;
  /** Oscillations per second. */
  readonly frequency: number;
  /** How quickly the oscillation dies away; higher settles sooner. */
  readonly decay: number;
}

export interface BounceOptions {
  /** Fraction of speed kept after each bounce, 0–1. */
  readonly elasticity: number;
  /** Pull back towards the resting value, in units per second squared. */
  readonly gravity: number;
  readonly maxBounces: number;
}

export const DEFAULT_ELASTIC: ElasticOptions = { amplitude: 0.05, frequency: 3, decay: 6 };
export const DEFAULT_BOUNCE: BounceOptions = { elasticity: 0.6, gravity: 5000, maxBounces: 6 };

/** Marker on the first line, so generated expressions are recognisable. */
const TAG = "// KVFX Tools";

function num(value: number, fallback: number): string {
  return String(Number.isFinite(value) ? value : fallback);
}

const VECTOR_HELPERS = [
  "function kvAdd(a, b) {",
  "  if (a instanceof Array) { var r = []; for (var i = 0; i < a.length; i++) r[i] = a[i] + b[i]; return r; }",
  "  return a + b;",
  "}",
  "function kvScale(a, s) {",
  "  if (a instanceof Array) { var r = []; for (var i = 0; i < a.length; i++) r[i] = a[i] * s; return r; }",
  "  return a * s;",
  "}",
];

/** Index of the last keyframe at or before the current time, or 0. */
const LAST_KEY = [
  "var kvN = 0;",
  "if (numKeys > 0) {",
  "  kvN = nearestKey(time).index;",
  "  if (key(kvN).time > time) kvN--;",
  "}",
];

/**
 * A damped overshoot after each keyframe, driven by the speed the property
 * arrives with — so it only moves where the animation actually moves.
 */
export function elasticExpression(options: ElasticOptions = DEFAULT_ELASTIC): string {
  return [
    `${TAG} — elastic`,
    `var amplitude = ${num(options.amplitude, DEFAULT_ELASTIC.amplitude)};`,
    `var frequency = ${num(options.frequency, DEFAULT_ELASTIC.frequency)};`,
    `var decay = ${num(options.decay, DEFAULT_ELASTIC.decay)};`,
    ...VECTOR_HELPERS,
    ...LAST_KEY,
    "var kvResult = value;",
    "if (kvN > 0) {",
    "  var kvT = time - key(kvN).time;",
    "  if (kvT > 0) {",
    "    var kvV = velocityAtTime(key(kvN).time - thisComp.frameDuration / 10);",
    "    var kvW = amplitude * Math.sin(frequency * kvT * 2 * Math.PI) / Math.exp(decay * kvT);",
    "    kvResult = kvAdd(value, kvScale(kvV, kvW));",
    "  }",
    "}",
    "kvResult;",
  ].join("\n");
}

/**
 * A physical bounce off each keyframe's value: the property rebounds with the
 * speed it arrived at, scaled by elasticity, and falls back under gravity
 * until the bounces are too small to see.
 */
export function bounceExpression(options: BounceOptions = DEFAULT_BOUNCE): string {
  return [
    `${TAG} — bounce`,
    `var elasticity = ${num(options.elasticity, DEFAULT_BOUNCE.elasticity)};`,
    `var gravity = ${num(options.gravity, DEFAULT_BOUNCE.gravity)};`,
    `var maxBounces = ${num(Math.round(options.maxBounces), DEFAULT_BOUNCE.maxBounces)};`,
    ...VECTOR_HELPERS,
    ...LAST_KEY,
    "var kvResult = value;",
    "if (kvN > 1) {",
    "  var kvT = time - key(kvN).time;",
    "  var kvV = velocityAtTime(key(kvN).time - thisComp.frameDuration / 10);",
    "  var kvSpeed = (kvV instanceof Array) ? length(kvV) : Math.abs(kvV);",
    "  if (kvT > 0 && kvSpeed > 0) {",
    "    var kvDir = (kvV instanceof Array) ? kvScale(kvV, -1 / kvSpeed) : (kvV > 0 ? -1 : 1);",
    "    var kvBounce = kvSpeed * elasticity;",
    "    var kvSpan = 2 * kvBounce / gravity;",
    "    var kvStart = 0;",
    "    var kvCount = 1;",
    "    while (kvStart + kvSpan < kvT && kvCount < maxBounces) {",
    "      kvStart += kvSpan;",
    "      kvBounce *= elasticity;",
    "      kvSpan *= elasticity;",
    "      kvCount++;",
    "    }",
    "    var kvD = kvT - kvStart;",
    "    if (kvD < kvSpan) {",
    "      kvResult = kvAdd(value, kvScale(kvDir, kvD * (kvBounce - gravity * kvD / 2)));",
    "    }",
    "  }",
    "}",
    "kvResult;",
  ].join("\n");
}

export type LoopKind = "cycle" | "pingpong" | "continue" | "offset";

export function loopExpression(kind: LoopKind): string {
  return `loopOut("${kind}");`;
}

const WIGGLE_FALLBACK = { frequency: 2, amplitude: 20 } as const;

export function wiggleExpression(frequency: number, amplitude: number): string {
  return `wiggle(${num(frequency, WIGGLE_FALLBACK.frequency)}, ${num(amplitude, WIGGLE_FALLBACK.amplitude)});`;
}

import type { Bezier } from "../animation/easing.js";
import { type StaggerOrder, rankExpression } from "../animation/order.js";
import type { Rgb } from "../color/index.js";
import type { JsonObject } from "../types/json.js";

/**
 * Text motion: how characters, words or lines arrive and leave.
 *
 * A preset says *what* a unit looks like while hidden — faded, lowered,
 * blurred, scrambled. The options say *how* the units take turns: in, out or
 * both; by character, word or line; in which order; with which ease, how far
 * apart and for how long.
 *
 * Two engines build the same motion in After Effects:
 *
 *   live  an expression selector computes each unit's progress every frame.
 *         Every option works, including overshoot and centre-out order, and
 *         the timing follows the text if it is edited later.
 *   keys  a range selector with keyframes, for people who want to see and
 *         drag keys. Overshooting eases are approximated by their curve.
 *
 * Both are written to run on either After Effects expression engine: no array
 * arithmetic, `var` only, a plain trailing expression as the result.
 */

/* eslint-disable no-magic-numbers -- easing maths and preset values are the content */

export type TextUnit = "characters" | "words" | "lines";
export type TextMode = "in" | "out" | "inOut";
export type TextEngine = "live" | "keys";
export type TextEase =
  | "preset"
  | "curve"
  | "soft"
  | "smooth"
  | "expo"
  | "back"
  | "elastic"
  | "bounce"
  | "snap"
  | "linear"
  | "step";

export type TextCategory = "Fade" | "Move" | "Scale" | "Blur" | "Rotate" | "Spacing" | "Colour" | "Code";

/** How a hidden unit looks. Unset fields are left as they are. */
export interface HiddenState {
  readonly opacity?: number;
  /** Pixels; positive x is right, positive y is down. */
  readonly x?: number;
  readonly y?: number;
  /** Percent, uniform. */
  readonly scale?: number;
  /** Percent per axis, for squash and stretch. */
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly rotation?: number;
  readonly blur?: number;
  /** Thousandths of an em. */
  readonly tracking?: number;
  readonly skew?: number;
}

export type MotionKind =
  /** Interpolates from the hidden state to the text's own look. */
  | "state"
  /** Shows shuffled characters until each settles. */
  | "scramble"
  /** Types the text out with a caret, rewriting Source Text by expression. */
  | "typing"
  /** Reveals each unit in the accent colour, which then fades to the text's own. */
  | "colorType"
  /** A band of accent colour passes across the text. */
  | "highlight";

export interface TextMotionPreset {
  readonly id: string;
  readonly name: string;
  readonly category: TextCategory;
  readonly kind: MotionKind;
  readonly hidden: HiddenState;
  /** The ease "Preset" stands for. */
  readonly ease: Exclude<TextEase, "preset" | "curve">;
}

const state = (
  id: string,
  name: string,
  category: TextCategory,
  hidden: HiddenState,
  ease: TextMotionPreset["ease"] = "soft",
): TextMotionPreset => ({ id, name, category, kind: "state", hidden, ease });

/**
 * The preset library. The first ten keep the ids of the original presets, so
 * a remembered choice still resolves.
 */
export const TEXT_MOTION_PRESETS: readonly TextMotionPreset[] = [
  state("typewriter", "Typewriter", "Fade", { opacity: 0 }, "step"),
  state("fade", "Fade In", "Fade", { opacity: 0 }, "smooth"),
  state("rise", "Rise", "Move", { opacity: 0, y: 40 }),
  state("drop", "Drop", "Move", { opacity: 0, y: -60 }),
  state("slide", "Slide", "Move", { opacity: 0, x: 80 }),
  state("pop", "Pop", "Scale", { opacity: 0, scale: 0 }, "back"),
  state("blur", "Blur In", "Blur", { opacity: 0, blur: 24 }),
  state("spin", "Spin", "Rotate", { opacity: 0, rotation: -90 }),
  state("track", "Track In", "Spacing", { opacity: 0, tracking: 300 }),
  state("zoom", "Zoom Out", "Scale", { opacity: 0, scale: 300 }, "expo"),

  state("rise-far", "Rise Far", "Move", { opacity: 0, y: 140 }, "expo"),
  state("drop-far", "Drop Far", "Move", { opacity: 0, y: -160 }, "expo"),
  state("slide-left", "Slide Left", "Move", { opacity: 0, x: -80 }),
  state("lift", "Lift", "Move", { opacity: 0, y: 24, scale: 80 }),
  state("sink", "Sink", "Move", { opacity: 0, y: -24, scale: 120 }),
  state("bounce-drop", "Bounce Drop", "Move", { opacity: 0, y: -220 }, "bounce"),
  state("whip", "Whip", "Move", { opacity: 0, x: 240, blur: 18 }, "expo"),

  state("grow", "Grow", "Scale", { scale: 0 }, "back"),
  state("pop-up", "Pop Up", "Scale", { opacity: 0, scale: 0, y: 30 }, "back"),
  state("elastic-pop", "Elastic Pop", "Scale", { scale: 0 }, "elastic"),
  state("slam", "Slam", "Scale", { opacity: 0, scale: 400, blur: 8 }, "expo"),
  state("squash", "Squash", "Scale", { opacity: 0, scaleX: 170, scaleY: 15 }, "back"),
  state("stretch", "Stretch", "Scale", { opacity: 0, scaleX: 15, scaleY: 190 }, "back"),
  state("ghost", "Ghost", "Scale", { opacity: 0, scale: 125, blur: 10 }, "smooth"),

  state("blur-rise", "Blur Rise", "Blur", { opacity: 0, blur: 20, y: 30 }),
  state("blur-slide", "Blur Slide", "Blur", { opacity: 0, blur: 30, x: 100 }, "expo"),
  state("zoom-blur", "Zoom Blur", "Blur", { opacity: 0, scale: 200, blur: 30 }, "expo"),
  state("focus", "Focus", "Blur", { blur: 40 }, "smooth"),

  state("spin-full", "Spin Full", "Rotate", { opacity: 0, rotation: 360 }, "expo"),
  state("tilt", "Tilt", "Rotate", { opacity: 0, rotation: 25, y: 20 }),
  state("swing", "Swing", "Rotate", { opacity: 0, rotation: -45, x: -30 }, "back"),
  state("rise-spin", "Rise Spin", "Rotate", { opacity: 0, y: 40, rotation: 30 }),
  state("fall-spin", "Fall Spin", "Rotate", { opacity: 0, y: -80, rotation: -60 }, "bounce"),
  state("skew", "Skew In", "Rotate", { opacity: 0, skew: 40, x: 60 }),

  state("track-tight", "Track Tight", "Spacing", { opacity: 0, tracking: -150 }, "expo"),
  state("track-wide", "Track Wide", "Spacing", { tracking: 600 }, "smooth"),

  { id: "color-type", name: "Colour Typing", category: "Colour", kind: "colorType", hidden: { opacity: 0 }, ease: "smooth" },
  { id: "highlight", name: "Highlight Sweep", category: "Colour", kind: "highlight", hidden: {}, ease: "smooth" },

  { id: "typing", name: "Typing", category: "Code", kind: "typing", hidden: {}, ease: "linear" },
  { id: "scramble", name: "Scramble", category: "Code", kind: "scramble", hidden: {}, ease: "linear" },
  { id: "decode", name: "Decode", category: "Code", kind: "scramble", hidden: { opacity: 0 }, ease: "linear" },
];

export const TEXT_CATEGORIES: readonly TextCategory[] = ["Fade", "Move", "Scale", "Blur", "Rotate", "Spacing", "Colour", "Code"];

export function textMotionPreset(id: string): TextMotionPreset | undefined {
  return TEXT_MOTION_PRESETS.find((preset) => preset.id === id);
}

export const TEXT_EASES: readonly { readonly id: TextEase; readonly label: string }[] = [
  { id: "preset", label: "Preset" },
  { id: "curve", label: "Ease tab curve" },
  { id: "soft", label: "Soft" },
  { id: "smooth", label: "Smooth" },
  { id: "expo", label: "Expo" },
  { id: "back", label: "Back" },
  { id: "elastic", label: "Elastic" },
  { id: "bounce", label: "Bounce" },
  { id: "snap", label: "Snap" },
  { id: "linear", label: "Linear" },
  { id: "step", label: "Step" },
];

export interface TextMotionOptions {
  readonly preset: TextMotionPreset;
  readonly mode: TextMode;
  readonly unit: TextUnit;
  readonly order: StaggerOrder;
  readonly seed: number;
  readonly ease: TextEase;
  /** The Ease tab's curve, for ease "curve". */
  readonly bezier: Bezier;
  /** Seconds between one unit starting and the next. */
  readonly stagger: number;
  /** Seconds each unit takes. */
  readonly duration: number;
  /** 0–100: how far Back and Elastic overshoot. */
  readonly overshoot: number;
  readonly engine: TextEngine;
  /** For colour presets. */
  readonly accent: Rgb;
}

// ---------------------------------------------------------------------------
// Easing — the same functions in TypeScript (preview) and expression source
// ---------------------------------------------------------------------------

export function resolveEase(options: Pick<TextMotionOptions, "ease" | "preset">): Exclude<TextEase, "preset"> {
  return options.ease === "preset" ? options.preset.ease : options.ease;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function bezierAt(b: Bezier, t: number): number {
  const [x1, y1, x2, y2] = b;
  let lo = 0;
  let hi = 1;
  let s = t;
  for (let k = 0; k < 24; k += 1) {
    const x = 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
    if (x < t) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
}

function bounceOut(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) {
    const u = t - 1.5 / d;
    return n * u * u + 0.75;
  }
  if (t < 2.5 / d) {
    const u = t - 2.25 / d;
    return n * u * u + 0.9375;
  }
  const u = t - 2.625 / d;
  return n * u * u + 0.984375;
}

/** Progress 0–1 → eased value; Back and Elastic may leave 0–1 on the way. */
export function easeValue(ease: Exclude<TextEase, "preset">, t: number, overshoot: number, bezier: Bezier): number {
  const x = clamp01(t);
  const k = Math.max(0, overshoot) / 100;
  switch (ease) {
    case "linear":
      return x;
    case "step":
      return t > 0 ? 1 : 0;
    case "smooth":
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case "expo":
      return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
    case "snap":
      return 1 - Math.pow(1 - x, 5);
    case "back": {
      const c1 = k * 5.67;
      const u = x - 1;
      return 1 + (c1 + 1) * u * u * u + c1 * u * u;
    }
    case "elastic": {
      const expo = x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
      const spring = 1 - Math.pow(2, -8 * x) * Math.cos(x * 4.5 * Math.PI) * (1 - x);
      return expo + (k / 0.3) * (spring - expo);
    }
    case "bounce":
      return bounceOut(x);
    case "curve":
      return bezierAt(bezier, x);
    default:
      return 1 - Math.pow(1 - x, 4);
  }
}

function n(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

/** Expression source defining `kvEase(t)` — the same maths as `easeValue`. */
export function easeExpression(ease: Exclude<TextEase, "preset">, overshoot: number, bezier: Bezier): string {
  const k = Math.max(0, overshoot) / 100;
  const head = "function kvEase(t) {\n  var x = t < 0 ? 0 : t > 1 ? 1 : t;\n";
  let body: string;
  switch (ease) {
    case "linear":
      body = "  return x;";
      break;
    case "step":
      body = "  return t > 0 ? 1 : 0;";
      break;
    case "smooth":
      body = "  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;";
      break;
    case "expo":
      body = "  return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);";
      break;
    case "snap":
      body = "  return 1 - Math.pow(1 - x, 5);";
      break;
    case "back":
      body = `  var c1 = ${n(k * 5.67)}, u = x - 1;\n  return 1 + (c1 + 1) * u * u * u + c1 * u * u;`;
      break;
    case "elastic":
      body = [
        "  var e = x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);",
        "  var s = 1 - Math.pow(2, -8 * x) * Math.cos(x * 4.5 * Math.PI) * (1 - x);",
        `  return e + ${n(k / 0.3)} * (s - e);`,
      ].join("\n");
      break;
    case "bounce":
      body = [
        "  var b = 7.5625, d = 2.75, u;",
        "  if (x < 1 / d) return b * x * x;",
        "  if (x < 2 / d) { u = x - 1.5 / d; return b * u * u + 0.75; }",
        "  if (x < 2.5 / d) { u = x - 2.25 / d; return b * u * u + 0.9375; }",
        "  u = x - 2.625 / d; return b * u * u + 0.984375;",
      ].join("\n");
      break;
    case "curve": {
      const [x1, y1, x2, y2] = bezier;
      body = [
        `  var x1 = ${n(x1)}, y1 = ${n(y1)}, x2 = ${n(x2)}, y2 = ${n(y2)}, lo = 0, hi = 1, s = x, k, q;`,
        "  for (k = 0; k < 24; k++) {",
        "    q = 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;",
        "    if (q < x) lo = s; else hi = s;",
        "    s = (lo + hi) / 2;",
        "  }",
        "  return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;",
      ].join("\n");
      break;
    }
    default:
      body = "  return 1 - Math.pow(1 - x, 4);";
  }
  return `${head}${body}\n}`;
}

/**
 * Bezier stand-ins for the keys engine, which can only ease keyframes with a
 * curve. Overshoots are clipped to what a keyframe ease can hold.
 */
export function easeBezier(ease: Exclude<TextEase, "preset">, bezier: Bezier): Bezier {
  switch (ease) {
    case "linear":
      return [0, 0, 1, 1];
    case "smooth":
      return [0.65, 0, 0.35, 1];
    case "expo":
      return [0.16, 1, 0.3, 1];
    case "snap":
      return [0.2, 1, 0.2, 1];
    case "back":
    case "elastic":
    case "bounce":
      return [0.34, 1, 0.64, 1];
    case "curve":
      return bezier;
    default:
      return [0.25, 1, 0.5, 1];
  }
}

// ---------------------------------------------------------------------------
// Animator specs for `kvfx.op.text.addAnimator`
// ---------------------------------------------------------------------------

const TAG = "// KVFX Tools — text";
/** Text 3D scale's depth stays at 100: characters are flat. */
const FLAT = 100;
const BASED_ON: Readonly<Record<TextUnit, string>> = { characters: "glyphs", words: "words", lines: "lines" };

function stateProperties(hidden: HiddenState): JsonObject[] {
  const properties: JsonObject[] = [];
  if (hidden.opacity !== undefined) properties.push({ matchName: "ADBE Text Opacity", value: hidden.opacity });
  if (hidden.x !== undefined || hidden.y !== undefined) {
    properties.push({ matchName: "ADBE Text Position 3D", value: [hidden.x ?? 0, hidden.y ?? 0, 0] });
  }
  if (hidden.scale !== undefined || hidden.scaleX !== undefined || hidden.scaleY !== undefined) {
    const sx = hidden.scaleX ?? hidden.scale ?? 100;
    const sy = hidden.scaleY ?? hidden.scale ?? 100;
    properties.push({ matchName: "ADBE Text Scale 3D", value: [sx, sy, FLAT] });
  }
  if (hidden.rotation !== undefined) properties.push({ matchName: "ADBE Text Rotation", value: hidden.rotation });
  if (hidden.skew !== undefined) properties.push({ matchName: "ADBE Text Skew", value: hidden.skew });
  if (hidden.blur !== undefined) properties.push({ matchName: "ADBE Text Blur", value: [hidden.blur, hidden.blur] });
  if (hidden.tracking !== undefined) properties.push({ matchName: "ADBE Text Tracking Amount", value: hidden.tracking });
  return properties;
}

/**
 * The shared head of every live selector: timing constants, order, ease, and
 * `kvPhase(t0)` — this unit's 0–1 progress through a phase starting at t0.
 */
function liveHead(options: TextMotionOptions): string {
  const ease = resolveEase(options);
  return [
    TAG,
    `var stagger = ${n(Math.max(0, options.stagger))};`,
    `var dur = ${n(Math.max(1e-3, options.duration))};`,
    "// The playhead when the animation was added.",
    "var start = __KVFX_NOW__;",
    rankExpression(options.order, options.seed),
    easeExpression(ease, options.overshoot, options.bezier),
    "var kvN = textTotal, kvI = textIndex - 1;",
    "var kvR = kvRank(kvI, kvN), kvTotal = kvMaxRank(kvN) * stagger + dur;",
    "function kvPhase(t0) { return (time - t0 - kvR * stagger) / dur; }",
  ].join("\n");
}

/** When the out phase begins: at the playhead alone, before the out point with In+Out. */
function outStart(mode: TextMode): string {
  return mode === "out" ? "start" : "outPoint - kvTotal";
}

/** Amount 100 = the hidden state, 0 = the text as it is. */
function stateAmountExpression(options: TextMotionOptions): string {
  const lines = [liveHead(options), "var amt = 0;"];
  if (options.mode !== "out") lines.push("if (time >= start) amt = 100 * (1 - kvEase(kvPhase(start))); else amt = 100;");
  if (options.mode !== "in") {
    lines.push(`var kvOut = ${outStart(options.mode)};`);
    lines.push("if (time >= kvOut) amt = 100 * kvEase(kvPhase(kvOut));");
  }
  lines.push("selectorValue * amt / 100;");
  return lines.join("\n");
}

/** Shuffles each unit until its turn, then lets it settle. */
function scrambleAmountExpression(options: TextMotionOptions): string {
  const lines = [
    liveHead(options),
    "var kvFrame = Math.floor(time / thisComp.frameDuration);",
    "seedRandom(textIndex * 7919 + kvFrame, true);",
    "var noisy = random(15, 100), amt = 0;",
  ];
  if (options.mode !== "out") lines.push("if (kvPhase(start) < 1) amt = noisy;");
  if (options.mode !== "in") lines.push(`var kvOut = ${outStart(options.mode)};`, "if (time >= kvOut && kvPhase(kvOut) > 0) amt = noisy;");
  lines.push("selectorValue * amt / 100;");
  return lines.join("\n");
}

/** Hidden until its turn, then visible — for Decode's fade and Colour Typing's reveal. */
function revealAmountExpression(options: TextMotionOptions): string {
  const lines = [liveHead(options), "var amt = 0;"];
  if (options.mode !== "out") lines.push("if (kvPhase(start) <= 0) amt = 100;");
  if (options.mode !== "in") lines.push(`var kvOut = ${outStart(options.mode)};`, "if (time >= kvOut && kvPhase(kvOut) > 0) amt = 100;");
  lines.push("selectorValue * amt / 100;");
  return lines.join("\n");
}

/** Full accent at a unit's reveal, easing back to its own colour. */
function accentFadeExpression(options: TextMotionOptions): string {
  return [
    liveHead(options),
    "var p = kvPhase(start), amt = 0;",
    "if (p > 0) amt = 100 * (1 - kvEase(p));",
    "selectorValue * amt / 100;",
  ].join("\n");
}

/** A band of accent colour that rises and falls as it passes each unit. */
function highlightExpression(options: TextMotionOptions): string {
  return [
    liveHead(options),
    "var p = kvPhase(start), amt = 0;",
    "if (p > 0 && p < 1) amt = 100 * Math.sin(Math.PI * kvEase(p));",
    "selectorValue * amt / 100;",
  ].join("\n");
}

/** Source Text typed out with a blinking caret. */
export function typingExpression(options: TextMotionOptions): string {
  const perChar = Math.max(1e-3, options.stagger > 0 ? options.stagger : options.duration / 10);
  const lines = [
    "// KVFX Tools — typing",
    `var perChar = ${n(perChar)};`,
    "var start = __KVFX_NOW__;",
    "var s = String(value), shown = s.length;",
    "var typed = Math.floor((time - start) / perChar);",
  ];
  if (options.mode !== "out") lines.push("shown = Math.max(0, Math.min(s.length, typed));");
  if (options.mode !== "in") {
    lines.push(
      options.mode === "out" ? "var kvOut = start;" : "var kvOut = outPoint - s.length * perChar;",
      "if (time >= kvOut) shown = Math.max(0, s.length - Math.floor((time - kvOut) / perChar));",
    );
  }
  lines.push(
    "var busy = shown > 0 && shown < s.length;",
    "var blink = Math.floor((time - start) * 2) % 2 === 0;",
    "s.substr(0, shown) + ((busy || blink) && time >= start ? \"|\" : \"\");",
  );
  return lines.join("\n");
}

function expressionSelector(options: TextMotionOptions, expression: string): JsonObject {
  return { type: "expression", basedOn: BASED_ON[options.unit], expression };
}

function opaqueAccent(accent: Rgb): number[] {
  return [accent[0], accent[1], accent[2], 1];
}

/** Animators for the live engine. Typing is a Source Text expression instead. */
export function liveAnimators(options: TextMotionOptions): JsonObject[] {
  const { preset } = options;
  switch (preset.kind) {
    case "scramble": {
      const animators: JsonObject[] = [
        {
          name: `KVFX ${preset.name}`,
          properties: [{ matchName: "ADBE Text Character Offset", value: 26 }],
          selectors: [expressionSelector(options, scrambleAmountExpression(options))],
        },
      ];
      if (preset.hidden.opacity !== undefined) {
        animators.push({
          name: `KVFX ${preset.name} Reveal`,
          properties: stateProperties({ opacity: preset.hidden.opacity }),
          selectors: [expressionSelector({ ...options, duration: options.duration * 0.25 }, stateAmountExpression(options))],
        });
      }
      return animators;
    }
    case "colorType":
      return [
        {
          name: `KVFX ${preset.name}`,
          properties: stateProperties({ opacity: 0 }),
          selectors: [expressionSelector(options, revealAmountExpression(options))],
        },
        {
          name: `KVFX ${preset.name} Accent`,
          properties: [{ matchName: "ADBE Text Fill Color", value: opaqueAccent(options.accent) }],
          selectors: [expressionSelector(options, accentFadeExpression(options))],
        },
      ];
    case "highlight":
      return [
        {
          name: `KVFX ${preset.name}`,
          properties: [{ matchName: "ADBE Text Fill Color", value: opaqueAccent(options.accent) }],
          selectors: [expressionSelector(options, highlightExpression(options))],
        },
      ];
    case "typing":
      return [];
    default:
      return [
        {
          name: `KVFX ${preset.name}`,
          properties: stateProperties(preset.hidden),
          selectors: [expressionSelector(options, stateAmountExpression(options))],
        },
      ];
  }
}

/**
 * Range-selector keys that reveal (or hide) units in an order.
 *
 * The animator's properties hold the hidden look, so whatever the selector
 * covers is hidden. Revealing shrinks the cover away from the units that go
 * first; hiding grows it over them. Orders that start in the middle or at
 * both ends need a cover with a hole in it, made by subtracting a second
 * range from a full one.
 */
function orderSelectors(order: StaggerOrder, reveal: boolean, seed: number, unit: TextUnit, smoothness: number): JsonObject[] {
  const base = { units: "percent", basedOn: BASED_ON[unit], smoothness };
  const ramp = (from: number, to: number): JsonObject[] => [
    { time: 0, value: from },
    { time: 1, value: to },
  ];
  /** A single cover over [start, end]. */
  const cover = (keys: JsonObject, extra: JsonObject = {}): JsonObject[] => [{ ...base, ...extra, keys }];
  /** Everything covered except a hole over [start, end]. */
  const hole = (keys: JsonObject): JsonObject[] => [
    { ...base, start: 0, end: 100 },
    { ...base, mode: "subtract", keys },
  ];
  const outward = { start: ramp(50, 0), end: ramp(50, 100) };
  const inward = { start: ramp(0, 50), end: ramp(100, 50) };

  switch (order) {
    case "reverse":
      return reveal ? cover({ end: ramp(100, 0) }, { start: 0 }) : cover({ start: ramp(100, 0) }, { end: 100 });
    case "centre":
      // Middle first: revealing opens a hole outwards; hiding grows a cover outwards.
      return reveal ? hole(outward) : cover(outward);
    case "edges":
      // Ends first: revealing shrinks the cover inwards; hiding shrinks a hole inwards.
      return reveal ? cover(inward) : hole(inward);
    case "random":
      return reveal
        ? cover({ start: ramp(0, 100) }, { end: 100, randomize: true, seed })
        : cover({ end: ramp(0, 100) }, { start: 0, randomize: true, seed });
    default:
      return reveal ? cover({ start: ramp(0, 100) }, { end: 100 }) : cover({ end: ramp(0, 100) }, { start: 0 });
  }
}

/** Animators for the keys engine: one per phase, each with its own timing. */
export function keyAnimators(options: TextMotionOptions): JsonObject[] {
  const { preset } = options;
  const ease = easeBezier(resolveEase(options), options.bezier);
  const step = resolveEase(options) === "step";
  const smoothness = step ? 0 : 100;
  const properties =
    preset.kind === "colorType" || preset.kind === "highlight"
      ? [{ matchName: "ADBE Text Fill Color", value: opaqueAccent(options.accent) }]
      : preset.kind === "scramble"
        ? [{ matchName: "ADBE Text Character Offset", value: 26 }, ...stateProperties(preset.hidden)]
        : stateProperties(preset.hidden);
  const timing = (anchor: "playhead" | "end"): JsonObject => ({
    unit: options.unit,
    stagger: options.stagger,
    duration: options.duration,
    anchor,
  });

  const phases: { reveal: boolean; anchor: "playhead" | "end"; suffix: string }[] = [];
  if (options.mode !== "out") phases.push({ reveal: true, anchor: "playhead", suffix: "" });
  if (options.mode !== "in") phases.push({ reveal: false, anchor: options.mode === "out" ? "playhead" : "end", suffix: " Out" });

  return phases.map((phase) => ({
    name: `KVFX ${preset.name}${phase.suffix}`,
    properties,
    selectors: orderSelectors(options.order, phase.reveal, options.seed, options.unit, smoothness),
    timing: timing(phase.anchor),
    ...(step ? {} : { ease: [...ease] }),
  }));
}

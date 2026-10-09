import { DEFAULT_BEZIER } from "../../animation/easing.js";
import { parseOrder } from "../../animation/order.js";
import type { Rgb } from "../../color/index.js";
import { type SplitMode, splitRanges } from "../../text/split.js";
import {
  TEXT_EASES,
  TEXT_MOTION_PRESETS,
  type TextEase,
  type TextMode,
  type TextMotionOptions,
  type TextUnit,
  keyAnimators,
  liveAnimators,
  textMotionPreset,
  typingExpression,
} from "../../text/motion.js";
import type { JsonObject, JsonValue } from "../../types/json.js";
import {
  NEEDS_LAYER,
  bezierParam,
  colorParam,
  measuredCommand,
  numberParam,
  simpleCommand,
  stringParam,
} from "../define.js";
import {
  AVAILABLE,
  type Command,
  type CommandAvailability,
  CommandCategory,
  type CommandContext,
  type PlanStep,
  unavailable,
} from "../types.js";

/**
 * Text commands: animate with a preset, explode into pieces, restyle.
 */

const SPEED = { min: 0.1, max: 10 } as const;
const STYLE = { maxSize: 5000, minTracking: -1000, maxTracking: 5000 } as const;

function hasText(ctx: CommandContext): CommandAvailability {
  return ctx.snapshot.layers.some((layer) => layer.kind === "text") ? AVAILABLE : unavailable("Select a text layer.");
}

/* eslint-disable no-magic-numbers -- the named defaults themselves */
const DEFAULT_ACCENT: Rgb = [1, 0.56, 0.25];
const FALLBACK_FRAME = 1 / 30;
const TIMING = { stagger: 2, duration: 15, maxFrames: 600, overshoot: 30, maxOvershoot: 100, seedMax: 100_000 } as const;
/* eslint-enable no-magic-numbers */

function textMode(value: unknown): TextMode {
  return value === "out" || value === "inOut" ? value : "in";
}

function textUnit(value: unknown): TextUnit {
  return value === "words" || value === "lines" ? value : "characters";
}

function textEase(value: unknown): TextEase {
  return TEXT_EASES.some((e) => e.id === value) ? (value as TextEase) : "preset";
}

/** The Animate section's settings, from a control or from what the user last chose. */
export function textMotionOptions(ctx: CommandContext): TextMotionOptions | undefined {
  const preset = textMotionPreset(stringParam(ctx, "preset", "rise")) ?? TEXT_MOTION_PRESETS[0];
  if (preset === undefined) return undefined;
  const frame = ctx.snapshot.comp?.frameDuration ?? FALLBACK_FRAME;
  // `speed` is the original control: it divides the preset's timing.
  const speed = numberParam(ctx, "speed", 1, SPEED.min, SPEED.max);
  const stagger = numberParam(ctx, "stagger", TIMING.stagger / speed, 0, TIMING.maxFrames) * frame;
  const duration = Math.max(frame, numberParam(ctx, "duration", TIMING.duration / speed, 0, TIMING.maxFrames) * frame);
  return {
    preset,
    mode: textMode(ctx.params?.["mode"]),
    unit: textUnit(ctx.params?.["unit"]),
    order: parseOrder(ctx.params?.["order"]),
    seed: numberParam(ctx, "seed", 1, 1, TIMING.seedMax),
    ease: textEase(ctx.params?.["ease"]),
    bezier: bezierParam(ctx, "bezier", DEFAULT_BEZIER),
    stagger,
    duration,
    overshoot: numberParam(ctx, "overshoot", TIMING.overshoot, 0, TIMING.maxOvershoot),
    engine: stringParam(ctx, "engine", "live") === "keys" ? "keys" : "live",
    accent: colorParam(ctx, "accent", DEFAULT_ACCENT),
  };
}

/** Plan steps for a text motion on the selected text layers. */
export function textMotionSteps(options: TextMotionOptions): PlanStep[] {
  if (options.preset.kind === "typing") {
    return [
      {
        op: "kvfx.op.prop.expression",
        args: {
          target: "selection",
          path: ["ADBE Text Properties", "ADBE Text Document"],
          expression: typingExpression(options),
          relative: true,
          keepExisting: true,
        },
      },
    ];
  }
  const animators = options.engine === "keys" ? keyAnimators(options) : liveAnimators(options);
  return [{ op: "kvfx.op.text.addAnimator", args: { target: "selection", relative: true, animators } }];
}

export const animateText = simpleCommand({
  id: "kvfx.text.animate",
  name: "Animate Text",
  description:
    "Animate the selected text layers in, out or both — by character, word or line, in any order, starting at the playhead",
  category: CommandCategory.Text,
  keywords: [
    "animate", "text", "reveal", "typewriter", "typing", "fade", "intro", "outro", "preset", "per character",
    "stagger", "words", "lines", "scramble", "decode", "kinetic", "highlight",
  ],
  icon: "text-animate",
  metadata: NEEDS_LAYER,
  check: hasText,
  defaultParams: (ui) => ({ bezier: [...ui.ease], ...(ui.toolParams["textAnimate"] ?? {}) }),
  steps: (ctx) => {
    const options = textMotionOptions(ctx);
    return options === undefined ? [] : textMotionSteps(options);
  },
});

/** A layer per character is slow in After Effects; the host caps pieces at 300. */
const EXPLODE_MAX_MS = 30_000;

function readText(measurement: JsonValue): { id: number; text: string } | undefined {
  if (typeof measurement !== "object" || measurement === null || Array.isArray(measurement)) return undefined;
  const id = measurement["id"];
  const text = measurement["text"];
  return typeof id === "number" && typeof text === "string" ? { id, text } : undefined;
}

function splitMode(ctx: CommandContext): SplitMode {
  const mode = stringParam(ctx, "mode", "characters");
  return mode === "words" || mode === "lines" ? mode : "characters";
}

export const explodeText = measuredCommand({
  id: "kvfx.text.explode",
  name: "Explode Text",
  description: "Split a text layer into one live-text layer per character, word or line",
  category: CommandCategory.Text,
  keywords: ["explode", "split", "break apart", "characters", "letters", "words", "lines", "separate"],
  icon: "explode",
  metadata: NEEDS_LAYER,
  check: hasText,
  defaultParams: (ui) => ui.toolParams["explode"] ?? {},
  probe: () => ({ op: "kvfx.op.text.read", args: {} }),
  // How many pieces there will be is only known after the probe, so the plan
  // carries the ceiling for the largest split the host accepts.
  budgetMs: EXPLODE_MAX_MS,
  steps: (ctx, measurement) => {
    const source = readText(measurement);
    if (source === undefined) return [];
    const ranges = splitRanges(source.text, splitMode(ctx));
    if (ranges.length === 0) return [];
    const json: JsonObject[] = ranges.map((r) => ({ start: r.start, end: r.end, name: r.name }));
    return [{ op: "kvfx.op.text.explode", args: { id: source.id, ranges: json } }];
  },
});

export const styleText = simpleCommand({
  id: "kvfx.text.style",
  name: "Style Text",
  description: "Apply the Text tab's font, size, colour and tracking to the selected text layers",
  category: CommandCategory.Text,
  keywords: ["font", "style", "size", "colour", "color", "tracking", "typeface"],
  icon: "text-style",
  metadata: NEEDS_LAYER,
  check: hasText,
  defaultParams: (ui) => ui.toolParams["textStyle"] ?? {},
  steps: (ctx) => {
    const args: JsonObject = { target: "selection" };
    const font = stringParam(ctx, "font", "");
    if (font.length > 0) args["font"] = font;
    const size = numberParam(ctx, "fontSize", 0, 0, STYLE.maxSize);
    if (size > 0) args["fontSize"] = size;
    if (typeof ctx.params?.["color"] === "string") args["fillColor"] = [...colorParam(ctx, "color", [1, 1, 1])];
    if (typeof ctx.params?.["tracking"] === "number") {
      args["tracking"] = numberParam(ctx, "tracking", 0, STYLE.minTracking, STYLE.maxTracking);
    }
    return [{ op: "kvfx.op.text.setStyle", args }];
  },
});

export const textCommands: readonly Command[] = [animateText, explodeText, styleText];

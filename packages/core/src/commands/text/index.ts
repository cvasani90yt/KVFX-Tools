import { type SplitMode, splitRanges } from "../../text/split.js";
import { TEXT_PRESETS, animatorFor, textPreset } from "../../text/presets.js";
import type { JsonObject, JsonValue } from "../../types/json.js";
import { NEEDS_LAYER, colorParam, measuredCommand, numberParam, simpleCommand, stringParam } from "../define.js";
import {
  AVAILABLE,
  type Command,
  type CommandAvailability,
  CommandCategory,
  type CommandContext,
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

export const animateText = simpleCommand({
  id: "kvfx.text.animate",
  name: "Animate Text",
  description: "Add the chosen text animation to the selected text layers, starting at the playhead",
  category: CommandCategory.Text,
  keywords: ["animate", "text", "reveal", "typewriter", "fade", "intro", "preset", "per character"],
  icon: "text-animate",
  metadata: NEEDS_LAYER,
  check: hasText,
  defaultParams: (ui) => ui.toolParams["textAnimate"] ?? {},
  steps: (ctx) => {
    const preset = textPreset(stringParam(ctx, "preset", "rise")) ?? TEXT_PRESETS[0];
    if (preset === undefined) return [];
    const speed = numberParam(ctx, "speed", 1, SPEED.min, SPEED.max);
    const timed = { ...preset, duration: preset.duration / speed };
    return [
      { op: "kvfx.op.text.addAnimator", args: { target: "selection", relative: true, animator: animatorFor(timed) } },
    ];
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

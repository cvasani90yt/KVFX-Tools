import {
  NEEDS_LAYER,
  SNAPSHOT_PROBE,
  boolParam,
  colorParam,
  measuredCommand,
  numberParam,
  probedLayers,
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
import type { Rgb } from "../../color/index.js";
import type { JsonObject } from "../../types/json.js";

/**
 * The Tools tab's layer utilities.
 */

/* eslint-disable no-magic-numbers -- the named defaults themselves */
const FALLBACK_FRAME = 1 / 30;
const SEQUENCE = { frames: 5, min: -1000, max: 1000 } as const;
/** Shifts smaller than this are rounding, not a request to move. */
const TIME_EPSILON = 1e-6;
const GRADIENT_FROM: Rgb = [1, 0.56, 0.25];
const GRADIENT_TO: Rgb = [0.12, 0.1, 0.1];
/* eslint-enable no-magic-numbers */

export const precomposeEach = simpleCommand({
  id: "kvfx.layer.precomposeeach",
  name: "Precompose Each",
  description: "Precompose every selected layer into its own composition, keeping effects and keyframes",
  category: CommandCategory.Layer,
  keywords: ["precompose", "precomp", "nest", "individually", "each", "separate"],
  icon: "precompose",
  metadata: NEEDS_LAYER,
  steps: () => [{ op: "kvfx.op.layer.precomposeEach", args: { target: "selection" } }],
});

export const splitLayers = simpleCommand({
  id: "kvfx.layer.split",
  name: "Split at Playhead",
  description: "Split the selected layers at the current time",
  category: CommandCategory.Layer,
  keywords: ["split", "cut", "razor", "playhead", "divide"],
  icon: "split",
  metadata: NEEDS_LAYER,
  steps: () => [{ op: "kvfx.op.layer.split", args: {} }],
});

function hasPrecomp(ctx: CommandContext): CommandAvailability {
  return ctx.snapshot.layers.some((layer) => layer.kind === "precomp")
    ? AVAILABLE
    : unavailable("Select a precomp layer.");
}

/**
 * Duplicates whole comps — the ones selected in the Project panel, or the open
 * one — with every comp nested inside them copied too. The host decides which
 * at the moment of the click, from After Effects' live selection.
 */
export const deepDuplicateComp = simpleCommand({
  id: "kvfx.comp.deepduplicatecomp",
  name: "Duplicate Comp (Deep)",
  description:
    "Duplicate the comps selected in the Project panel — or the open comp — together with every comp nested inside them, so editing the copy never changes the original",
  category: CommandCategory.Project,
  keywords: ["duplicate", "comp", "composition", "deep", "nested", "inside", "everything", "unique", "independent", "copy", "template", "version"],
  icon: "duplicate",
  metadata: { destructive: false, minLayers: 0, requiresComp: false },
  check: (ctx) =>
    ctx.snapshot.projectComps.length > 0 || ctx.snapshot.comp !== undefined
      ? AVAILABLE
      : unavailable("Select a comp in the Project panel, or open one."),
  steps: () => [{ op: "kvfx.op.comp.deepDuplicateComps", args: {} }],
});

export const deepDuplicate = simpleCommand({
  id: "kvfx.comp.deepduplicate",
  name: "Duplicate Precomp Layer (Deep)",
  description:
    "Duplicate the selected precomp layers in the timeline, each using its own copy of the comp and everything nested inside it",
  category: CommandCategory.Project,
  keywords: ["duplicate", "deep", "unique", "independent", "precomp", "nested", "template", "copy"],
  icon: "duplicate",
  metadata: NEEDS_LAYER,
  check: hasPrecomp,
  steps: () => [{ op: "kvfx.op.comp.deepDuplicate", args: { target: "selection" } }],
});

export const trimToWorkArea = simpleCommand({
  id: "kvfx.layer.trimworkarea",
  name: "Trim to Work Area",
  description: "Set the selected layers' in and out points to the work area",
  category: CommandCategory.Layer,
  keywords: ["trim", "work area", "in point", "out point", "cut", "length"],
  icon: "trim",
  metadata: NEEDS_LAYER,
  steps: (ctx) => {
    const comp = ctx.snapshot.comp;
    if (comp === undefined) return [];
    return [
      {
        op: "kvfx.op.layer.set",
        args: {
          target: "selection",
          inPoint: comp.workAreaStart,
          outPoint: comp.workAreaStart + comp.workAreaDuration,
        },
      },
    ];
  },
});

/**
 * Sequences the selected layers in stack order.
 *
 * "offset" staggers in-points by a fixed number of frames; "chain" places each
 * layer where the previous one ends, with the frame value as a gap (negative
 * overlaps). Layers are moved by their start time, so trims are kept.
 */
export const sequenceLayers = measuredCommand({
  id: "kvfx.layer.sequence",
  name: "Sequence Layers",
  description: "Stagger the selected layers in time, top to bottom",
  category: CommandCategory.Layer,
  keywords: ["sequence", "stagger", "offset", "cascade", "chain", "timing", "delay"],
  icon: "sequence",
  metadata: { destructive: false, minLayers: 2, requiresComp: true },
  defaultParams: (ui) => ui.toolParams["sequence"] ?? {},
  probe: () => SNAPSHOT_PROBE,
  steps: (ctx, measurement) => {
    const frameDuration = ctx.snapshot.comp?.frameDuration ?? FALLBACK_FRAME;
    const step = numberParam(ctx, "frames", SEQUENCE.frames, SEQUENCE.min, SEQUENCE.max) * frameDuration;
    const chain = stringParam(ctx, "mode", "offset") === "chain";
    const layers = probedLayers(measurement);
    if (boolParam(ctx, "reverse", false)) layers.reverse();
    if (layers.length < 2) return [];

    const steps: PlanStep[] = [];
    const first = layers[0];
    if (first === undefined) return [];
    let nextIn = first.inPoint;
    layers.forEach((layer, i) => {
      const targetIn = i === 0 ? layer.inPoint : nextIn;
      const shift = targetIn - layer.inPoint;
      if (Math.abs(shift) > TIME_EPSILON) {
        steps.push({ op: "kvfx.op.layer.set", args: { id: layer.id, startTime: layer.startTime + shift } });
      }
      nextIn = chain ? targetIn + (layer.outPoint - layer.inPoint) + step : targetIn + step;
    });
    return steps;
  },
});

const OPAQUE = 1;

export const fillColor = simpleCommand({
  id: "kvfx.fx.fill",
  name: "Fill with Colour",
  description: "Add a Fill effect in the chosen colour to the selected layers",
  category: CommandCategory.Fx,
  keywords: ["fill", "colour", "color", "tint", "flat", "silhouette"],
  icon: "fill",
  metadata: NEEDS_LAYER,
  defaultParams: (ui) => ({ color: ui.solidColor }),
  steps: (ctx) => {
    const [r, g, b] = colorParam(ctx, "color", [1, 1, 1]);
    return [
      {
        op: "kvfx.op.effect.add",
        args: {
          target: "selection",
          matchName: "ADBE Fill",
          name: "KVFX Fill",
          params: [{ path: [{ valueType: "color", nth: 1 }], value: [r, g, b, OPAQUE] }],
        },
      },
    ];
  },
});

type Direction = "vertical" | "horizontal" | "diagonal";

/** Gradient Ramp points that follow the layer's own bounds, in layer space. */
export function gradientLockExpressions(direction: Direction): { start: string; end: string } {
  const rect = "var r = sourceRectAtTime(time, false);";
  switch (direction) {
    case "horizontal":
      return { start: `${rect}\n[r.left, r.top + r.height / 2];`, end: `${rect}\n[r.left + r.width, r.top + r.height / 2];` };
    case "diagonal":
      return { start: `${rect}\n[r.left, r.top];`, end: `${rect}\n[r.left + r.width, r.top + r.height];` };
    default:
      return { start: `${rect}\n[r.left + r.width / 2, r.top];`, end: `${rect}\n[r.left + r.width / 2, r.top + r.height];` };
  }
}

export const gradientLock = simpleCommand({
  id: "kvfx.fx.gradientlock",
  name: "Gradient Lock",
  description: "Add a gradient whose ends stay pinned to the layer's edges as it changes size",
  category: CommandCategory.Fx,
  keywords: ["gradient", "ramp", "lock", "bounds", "fit", "auto"],
  icon: "gradient",
  metadata: NEEDS_LAYER,
  defaultParams: (ui) => ui.toolParams["gradient"] ?? {},
  steps: (ctx) => {
    const direction = stringParam(ctx, "direction", "vertical");
    const dir: Direction = direction === "horizontal" || direction === "diagonal" ? direction : "vertical";
    const expressions = gradientLockExpressions(dir);
    const [r1, g1, b1] = colorParam(ctx, "from", GRADIENT_FROM);
    const [r2, g2, b2] = colorParam(ctx, "to", GRADIENT_TO);
    const params: JsonObject[] = [
      { path: [{ valueType: "twoDSpatial", nth: 1 }], expression: expressions.start },
      { path: [{ valueType: "color", nth: 1 }], value: [r1, g1, b1, OPAQUE] },
      { path: [{ valueType: "twoDSpatial", nth: 2 }], expression: expressions.end },
      { path: [{ valueType: "color", nth: 2 }], value: [r2, g2, b2, OPAQUE] },
    ];
    return [
      {
        op: "kvfx.op.effect.add",
        args: { target: "selection", matchName: "ADBE Ramp", name: "KVFX Gradient Lock", params },
      },
    ];
  },
});

export const toolCommands: readonly Command[] = [
  precomposeEach,
  splitLayers,
  deepDuplicateComp,
  deepDuplicate,
  trimToWorkArea,
  sequenceLayers,
  fillColor,
  gradientLock,
];


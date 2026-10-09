import { AnchorSpot } from "../../geometry/index.js";
import type { JsonObject } from "../../types/json.js";
import { boolParam, numberParam, simpleCommand, stringParam } from "../define.js";
import { AVAILABLE, type Command, CommandCategory, unavailable } from "../types.js";

/**
 * Comp Resizer: new size, duration or frame rate for whole comps, with the
 * content pinned to a spot and optionally scaled to fit or fill.
 */

export interface CompPreset {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

/* eslint-disable no-magic-numbers -- the formats themselves */
export const COMP_PRESETS: readonly CompPreset[] = [
  { id: "hd", label: "16:9 · 1920×1080", width: 1920, height: 1080 },
  { id: "vertical", label: "9:16 · 1080×1920", width: 1080, height: 1920 },
  { id: "square", label: "1:1 · 1080×1080", width: 1080, height: 1080 },
  { id: "portrait", label: "4:5 · 1080×1350", width: 1080, height: 1350 },
  { id: "uhd", label: "4K · 3840×2160", width: 3840, height: 2160 },
  { id: "720", label: "720p · 1280×720", width: 1280, height: 720 },
  { id: "wide", label: "21:9 · 2560×1080", width: 2560, height: 1080 },
];

const ANCHOR_FRACTIONS: Readonly<Record<AnchorSpot, [number, number]>> = {
  topLeft: [0, 0],
  topCentre: [0.5, 0],
  topRight: [1, 0],
  middleLeft: [0, 0.5],
  centre: [0.5, 0.5],
  middleRight: [1, 0.5],
  bottomLeft: [0, 1],
  bottomCentre: [0.5, 1],
  bottomRight: [1, 1],
};

const LIMITS = { size: 30000, minSize: 4, percent: 1000, duration: 10800, fps: 999 } as const;
const FALLBACK = { width: 1920, height: 1080 } as const;
const CENTRE: [number, number] = [0.5, 0.5];
/* eslint-enable no-magic-numbers */

export function anchorFractionFor(spot: string): [number, number] {
  return ANCHOR_FRACTIONS[spot as AnchorSpot] ?? CENTRE;
}

export const resizeComps = simpleCommand({
  id: "kvfx.comp.resize",
  name: "Resize Comps",
  description:
    "Change the size, length or frame rate of the comps selected in the Project panel — or the open comp — keeping content pinned to an anchor, and fixing the comps that use them so nothing jumps",
  category: CommandCategory.Project,
  keywords: ["resize", "comp", "composition", "size", "aspect", "vertical", "square", "9:16", "4:5", "reframe", "duration", "fps", "frame rate", "batch"],
  icon: "resize",
  metadata: { destructive: true, minLayers: 0, requiresComp: false },
  defaultParams: (ui) => ui.toolParams["resize"] ?? {},
  check: (ctx) =>
    ctx.snapshot.projectComps.length > 0 || ctx.snapshot.comp !== undefined
      ? AVAILABLE
      : unavailable("Select comps in the Project panel, or open one."),
  steps: (ctx) => {
    const args: JsonObject = {
      fit: ((): string => {
        const fit = stringParam(ctx, "fit", "keep");
        return fit === "fit" || fit === "fill" ? fit : "keep";
      })(),
      anchor: anchorFractionFor(stringParam(ctx, "anchor", "centre")),
      swap: boolParam(ctx, "swap", false),
      extend: boolParam(ctx, "extend", true),
      fixParents: boolParam(ctx, "fixParents", true),
    };
    const percent = numberParam(ctx, "percent", 0, 0, LIMITS.percent);
    if (percent > 0) args["percent"] = percent;
    else {
      const comp = ctx.snapshot.comp;
      args["width"] = Math.round(numberParam(ctx, "width", comp?.width ?? FALLBACK.width, LIMITS.minSize, LIMITS.size));
      args["height"] = Math.round(numberParam(ctx, "height", comp?.height ?? FALLBACK.height, LIMITS.minSize, LIMITS.size));
    }
    const duration = numberParam(ctx, "duration", 0, 0, LIMITS.duration);
    if (duration > 0) args["duration"] = duration;
    const frameRate = numberParam(ctx, "frameRate", 0, 0, LIMITS.fps);
    if (frameRate > 0) args["frameRate"] = frameRate;
    return [{ op: "kvfx.op.comp.resize", args }];
  },
});

export const projectCommands: readonly Command[] = [resizeComps];

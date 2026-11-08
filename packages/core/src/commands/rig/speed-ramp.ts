import {
  SPEED_RAMPS,
  SPEED_RAMP_TAG,
  rampLengthChange,
  speedRampById,
  speedRampComment,
  speedRampExpression,
  speedRampWindow,
} from "../../speed/index.js";
import { decodeSnapshot } from "../decode.js";
import { NEEDS_LAYER, SNAPSHOT_PROBE, boolParam, measuredCommand, numberParam, stringParam } from "../define.js";
import { AVAILABLE, type Command, CommandCategory, type PlanStep, unavailable } from "../types.js";

/**
 * Speed Ramp: a speed curve on the selected clips, through Time Remapping.
 *
 * The presets live in `speed/`. The ramp is a layer marker whose key moment
 * lands on the playhead; the Time Remap expression reads it (and any other
 * ramp markers on the layer) every frame.
 */

/* eslint-disable no-magic-numbers -- limits and defaults read straight from the UI */
const FALLBACK_FRAME = 1 / 30;
const MAX_FRAMES = 600;

export const addSpeedRamp = measuredCommand({
  id: "kvfx.rig.speedRamp",
  name: "Add Speed Ramp",
  description: "Ramp the selected clips' speed around the playhead — slow motion, velocity edits, freezes, speed-ups and rewinds — through Time Remapping",
  category: CommandCategory.Rig,
  keywords: [
    "speed",
    "ramp",
    "speed ramp",
    "time remap",
    "time remapping",
    "slow motion",
    "slow mo",
    "velocity",
    "fast",
    "freeze",
    "rewind",
    "reverse",
    "retime",
    ...SPEED_RAMPS.map((p) => p.name.toLowerCase()),
  ],
  icon: "speed",
  metadata: NEEDS_LAYER,
  check: (ctx) =>
    ctx.snapshot.layers.some((l) => l.kind === "av" || l.kind === "precomp") ? AVAILABLE : unavailable("Select a video or precomp layer."),
  defaultParams: (ui) => ({ ...(ui.toolParams["speedRamp"] ?? {}) }),
  probe: () => SNAPSHOT_PROBE,
  steps: (ctx, measurement) => {
    const snapshot = decodeSnapshot(measurement);
    const comp = snapshot.comp ?? ctx.snapshot.comp;
    if (comp === undefined) return [];
    const preset = speedRampById(stringParam(ctx, "preset", "velocity")) ?? SPEED_RAMPS[0];
    if (preset === undefined) return [];
    const ids = snapshot.layers.filter((l) => l.kind === "av" || l.kind === "precomp").map((l) => l.id);
    if (ids.length === 0) return [];
    const frame = comp.frameDuration > 0 ? comp.frameDuration : FALLBACK_FRAME;
    const frames = Math.round(numberParam(ctx, "frames", preset.frames, 2, MAX_FRAMES));
    const strength = numberParam(ctx, "strength", 100, 10, 200);
    const window = speedRampWindow({ time: comp.time, frame, frames, hit: preset.hit });
    const fit = boolParam(ctx, "fit", true);
    const steps: PlanStep[] = [
      {
        op: "kvfx.op.layer.speedRamp",
        args: {
          ids,
          marker: { time: window.start, duration: window.duration, comment: speedRampComment(preset, strength) },
          expression: speedRampExpression(),
          tag: SPEED_RAMP_TAG,
          // Moves the out point so the clip still ends on its last frame.
          ...(fit ? { outShift: rampLengthChange(preset, window.duration, strength / 100) } : {}),
          frameBlending: boolParam(ctx, "blend", true),
        },
      },
    ];
    return steps;
  },
});

export const speedRampCommands: readonly Command[] = [addSpeedRamp];

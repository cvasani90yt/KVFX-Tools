import { hexToRgb } from "../../color/index.js";
import {
  DEFAULT_TRANSITION_COLOR,
  TRANSITIONS,
  TRANSITION_STRENGTH,
  type EffectSpec,
  centredPointExpression,
  pairExpression,
  scalarExpression,
  transitionById,
  transitionTones,
  transitionWindow,
} from "../../transitions/index.js";
import type { JsonObject, JsonValue } from "../../types/json.js";
import { decodeSnapshot } from "../decode.js";
import { NEEDS_COMP, SNAPSHOT_PROBE, boolParam, measuredCommand, numberParam, stringParam } from "../define.js";
import { type Command, CommandCategory, type PlanStep, ref } from "../types.js";

/**
 * Add Transition: one layer across the cut at the playhead.
 *
 * The presets live in `transitions/`; this turns one into plan steps. The
 * layer is centred on the cut — a selected layer's in or out point near the
 * playhead, or the playhead itself — sits above the selected clips, and runs
 * on its own length, so trimming it retimes the transition.
 */

/* eslint-disable no-magic-numbers -- limits and defaults read straight from the UI */
const BIND = "transition";
const FALLBACK_FRAME = 1 / 30;
const MAX_FRAMES = 600;
const MAX_SEED = 100_000;

function effectSteps(effect: EffectSpec, seed: number): PlanStep {
  const params: JsonObject[] = [];
  for (const p of effect.params) {
    if (p.point !== undefined) params.push({ path: [p.param], expression: centredPointExpression(p.point[0], p.point[1], seed) });
    else if (p.channel !== undefined) params.push({ path: [p.param], expression: scalarExpression(p.channel, seed) });
    else if (p.value !== undefined) params.push({ path: [p.param], value: p.value });
  }
  if (effect.mix !== undefined) {
    params.push({ path: ["ADBE Effect Built In Params", "ADBE Effect Mask Opacity"], expression: scalarExpression(effect.mix, seed) });
  }
  return { op: "kvfx.op.effect.add", args: { id: ref(BIND), matchName: effect.matchName, name: effect.name, params } };
}

export const addTransition = measuredCommand({
  id: "kvfx.rig.transition",
  name: "Add Transition",
  description: "Add a transition across the cut at the playhead — a whip, zoom, spin, blur, glitch, flash, light leak or graphic wipe — as one layer you trim to retime",
  category: CommandCategory.Rig,
  keywords: [
    "transition",
    "cut",
    "whip",
    "pan",
    "swish",
    "zoom",
    "spin",
    "stretch",
    "shake",
    "impact",
    "glitch",
    "vhs",
    "flash",
    "light leak",
    "dip to black",
    "pixelate",
    "blur",
    "wipe",
    "seamless",
    ...TRANSITIONS.map((p) => p.name.toLowerCase()),
  ],
  icon: "transition",
  metadata: NEEDS_COMP,
  defaultParams: (ui) => ({ ...(ui.toolParams["transition"] ?? {}) }),
  probe: () => SNAPSHOT_PROBE,
  steps: (ctx, measurement) => {
    const snapshot = decodeSnapshot(measurement);
    const comp = snapshot.comp ?? ctx.snapshot.comp;
    if (comp === undefined) return [];
    const preset = transitionById(stringParam(ctx, "preset", "whipLeft")) ?? TRANSITIONS[0];
    if (preset === undefined) return [];
    const frame = comp.frameDuration > 0 ? comp.frameDuration : FALLBACK_FRAME;
    const frames = Math.round(numberParam(ctx, "frames", preset.frames, 2, MAX_FRAMES));
    const strength = numberParam(ctx, "strength", 100, 0, 400);
    const seed = Math.round(numberParam(ctx, "seed", 7, 0, MAX_SEED));
    const layers = [...snapshot.layers].sort((a, b) => a.index - b.index);
    const window = transitionWindow({
      time: comp.time,
      frame,
      frames,
      compDuration: comp.duration,
      cuts: layers.flatMap((l) => [l.inPoint, l.outPoint]),
      snap: boolParam(ctx, "snap", true),
    });

    const build = preset.build;
    const name = `KVFX Transition · ${preset.name}`;
    const layer = { id: ref(BIND) };
    const steps: PlanStep[] = [];
    if (build.kind === "adjust") {
      steps.push({ op: "kvfx.op.layer.create", args: { kind: "adjustment", name }, bind: BIND });
    } else if (build.kind === "solid") {
      steps.push({ op: "kvfx.op.layer.create", args: { kind: "solid", name, color: [...build.color] }, bind: BIND });
    } else {
      steps.push({ op: "kvfx.op.layer.create", args: { kind: "shape", name }, bind: BIND });
    }
    const timing: JsonObject = { ...layer, inPoint: window.start, outPoint: window.end };
    if (build.kind === "solid" && build.blend !== "normal") timing["blendingMode"] = build.blend;
    steps.push({ op: "kvfx.op.layer.set", args: timing });
    // Above the selected clips, so it covers both sides of the cut.
    const top = layers[0];
    if (top !== undefined) steps.push({ op: "kvfx.op.layer.place", args: { ids: [ref(BIND)], above: top.id } });
    steps.push({
      op: "kvfx.op.effect.add",
      args: { ...layer, matchName: "ADBE Slider Control", name: TRANSITION_STRENGTH, params: [{ path: [1], value: strength }] },
    });

    if (build.kind === "shape") {
      const tones = transitionTones(hexToRgb(stringParam(ctx, "color", "")) ?? DEFAULT_TRANSITION_COLOR);
      const groups: JsonValue[] = build.groups(comp.width, comp.height).map((g) => {
        const expressions: JsonObject[] = [];
        if (g.position !== undefined) {
          expressions.push({ path: ["ADBE Vector Transform Group", "ADBE Vector Position"], expression: pairExpression(g.position[0], g.position[1], seed) });
        }
        if (g.scale !== undefined) {
          expressions.push({ path: ["ADBE Vector Transform Group", "ADBE Vector Scale"], expression: pairExpression(g.scale[0], g.scale[1], seed) });
        }
        if (g.opacity !== undefined) {
          expressions.push({ path: ["ADBE Vector Transform Group", "ADBE Vector Group Opacity"], expression: scalarExpression(g.opacity, seed) });
        }
        const color = [...tones[g.tone]];
        return {
          name: g.name,
          items: [
            { type: g.item.type, name: g.name, size: [...g.item.size] },
            g.stroke === undefined ? { type: "fill", name: "Fill", color } : { type: "stroke", name: "Stroke", color, width: g.stroke },
          ],
          ...(g.rotation === undefined ? {} : { transform: { rotation: g.rotation } }),
          expressions,
        };
      });
      steps.push({ op: "kvfx.op.shape.build", args: { ...layer, groups } });
      return steps;
    }

    for (const effect of build.effects) steps.push(effectSteps(effect, seed));
    if (build.kind === "solid") {
      steps.push({ op: "kvfx.op.prop.expression", args: { ...layer, path: ["ADBE Transform Group", "ADBE Opacity"], expression: scalarExpression(build.opacity, seed) } });
    }
    return steps;
  },
});

export const transitionCommands: readonly Command[] = [addTransition];

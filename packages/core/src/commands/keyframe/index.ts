import { DEFAULT_BEZIER } from "../../animation/easing.js";
import {
  DEFAULT_BOUNCE,
  DEFAULT_ELASTIC,
  bounceExpression,
  elasticExpression,
  loopExpression,
  wiggleExpression,
} from "../../expressions/motion.js";
import { NEEDS_COMP, bezierParam, numberParam, simpleCommand } from "../define.js";
import { type Command, CommandCategory } from "../types.js";

/**
 * Keyframe and motion commands.
 *
 * They act on the keyframes and properties selected in the timeline, which
 * the panel cannot see (After Effects reports no timeline selection to it).
 * The host checks and says "select keyframes first" when there are none, so
 * the only precondition here is an open composition.
 */

/* eslint-disable no-magic-numbers -- the named bounds themselves */
/** Bounds for parameters that arrive from text fields. */
const LIMITS = {
  amplitude: [0, 1],
  frequency: [0.1, 20],
  decay: [0.1, 50],
  elasticity: [0, 0.95],
  gravity: [100, 50_000],
  maxBounces: [1, 20],
  wiggleFrequency: [0, 100],
  wiggleAmplitude: [0, 100_000],
} as const;
const WIGGLE_DEFAULTS = { frequency: 2, amplitude: 20 } as const;
/* eslint-enable no-magic-numbers */

export const applyEase = simpleCommand({
  id: "kvfx.keys.ease",
  name: "Apply Ease",
  description: "Apply the easing editor's curve to the selected keyframes",
  category: CommandCategory.Keyframe,
  keywords: ["ease", "easing", "curve", "bezier", "velocity", "influence", "graph", "smooth"],
  icon: "ease",
  metadata: NEEDS_COMP,
  defaultParams: (ui) => ({ bezier: [...ui.ease] }),
  steps: (ctx) => [{ op: "kvfx.op.keys.ease", args: { bezier: [...bezierParam(ctx, "bezier", DEFAULT_BEZIER)] } }],
});

function interpolationCommand(type: "linear" | "hold" | "bezier", name: string, keywords: string[]): Command {
  return simpleCommand({
    id: `kvfx.keys.${type}`,
    name,
    description: `Set the selected keyframes to ${type} interpolation`,
    category: CommandCategory.Keyframe,
    keywords: ["keyframe", "interpolation", ...keywords],
    icon: `key-${type}`,
    metadata: NEEDS_COMP,
    steps: () => [{ op: "kvfx.op.keys.interpolation", args: { type } }],
  });
}

export const makeLinear = interpolationCommand("linear", "Linear Keyframes", ["linear", "constant", "robotic"]);
export const makeHold = interpolationCommand("hold", "Hold Keyframes", ["hold", "step", "toggle", "freeze"]);
export const makeBezier = interpolationCommand("bezier", "Bezier Keyframes", ["bezier", "curve", "smooth"]);

export const reverseKeys = simpleCommand({
  id: "kvfx.keys.reverse",
  name: "Reverse Keyframes",
  description: "Mirror the selected keyframes in time, easing included",
  category: CommandCategory.Keyframe,
  keywords: ["reverse", "flip", "backwards", "mirror", "invert", "time"],
  icon: "reverse",
  metadata: NEEDS_COMP,
  steps: () => [{ op: "kvfx.op.keys.reverse", args: {} }],
});

export const addElastic = simpleCommand({
  id: "kvfx.keys.elastic",
  name: "Add Elastic",
  description: "Overshoot and settle after each keyframe on the selected properties",
  category: CommandCategory.Keyframe,
  keywords: ["elastic", "overshoot", "inertia", "spring", "wobble", "settle", "expression"],
  icon: "elastic",
  metadata: NEEDS_COMP,
  defaultParams: (ui) => ui.toolParams["elastic"] ?? {},
  steps: (ctx) => [
    {
      op: "kvfx.op.prop.expressionOnSelected",
      args: {
        requireKeys: true,
        expression: elasticExpression({
          amplitude: numberParam(ctx, "amplitude", DEFAULT_ELASTIC.amplitude, ...LIMITS.amplitude),
          frequency: numberParam(ctx, "frequency", DEFAULT_ELASTIC.frequency, ...LIMITS.frequency),
          decay: numberParam(ctx, "decay", DEFAULT_ELASTIC.decay, ...LIMITS.decay),
        }),
      },
    },
  ],
});

export const addBounce = simpleCommand({
  id: "kvfx.keys.bounce",
  name: "Add Bounce",
  description: "Bounce back off each keyframe on the selected properties",
  category: CommandCategory.Keyframe,
  keywords: ["bounce", "physics", "gravity", "rebound", "drop", "expression"],
  icon: "bounce",
  metadata: NEEDS_COMP,
  defaultParams: (ui) => ui.toolParams["bounce"] ?? {},
  steps: (ctx) => [
    {
      op: "kvfx.op.prop.expressionOnSelected",
      args: {
        requireKeys: true,
        expression: bounceExpression({
          elasticity: numberParam(ctx, "elasticity", DEFAULT_BOUNCE.elasticity, ...LIMITS.elasticity),
          gravity: numberParam(ctx, "gravity", DEFAULT_BOUNCE.gravity, ...LIMITS.gravity),
          maxBounces: numberParam(ctx, "maxBounces", DEFAULT_BOUNCE.maxBounces, ...LIMITS.maxBounces),
        }),
      },
    },
  ],
});

function loopCommand(kind: "cycle" | "pingpong" | "continue", name: string, keywords: string[]): Command {
  return simpleCommand({
    id: `kvfx.keys.loop${kind}`,
    name,
    description: `Loop the selected properties' keyframes (${kind})`,
    category: CommandCategory.Keyframe,
    keywords: ["loop", "loopout", "repeat", "expression", ...keywords],
    icon: "loop",
    metadata: NEEDS_COMP,
    steps: () => [{ op: "kvfx.op.prop.expressionOnSelected", args: { requireKeys: true, expression: loopExpression(kind) } }],
  });
}

export const loopCycle = loopCommand("cycle", "Loop Cycle", ["cycle", "forever"]);
export const loopPingPong = loopCommand("pingpong", "Loop Ping-Pong", ["pingpong", "back and forth", "yoyo"]);
export const loopContinue = loopCommand("continue", "Loop Continue", ["continue", "extrapolate", "keep going"]);

export const addWiggle = simpleCommand({
  id: "kvfx.keys.wiggle",
  name: "Add Wiggle",
  description: "Add a wiggle expression to the selected properties",
  category: CommandCategory.Keyframe,
  keywords: ["wiggle", "shake", "random", "jitter", "noise", "expression"],
  icon: "wiggle",
  metadata: NEEDS_COMP,
  defaultParams: (ui) => ui.toolParams["wiggle"] ?? {},
  steps: (ctx) => [
    {
      op: "kvfx.op.prop.expressionOnSelected",
      args: {
        expression: wiggleExpression(
          numberParam(ctx, "frequency", WIGGLE_DEFAULTS.frequency, ...LIMITS.wiggleFrequency),
          numberParam(ctx, "amplitude", WIGGLE_DEFAULTS.amplitude, ...LIMITS.wiggleAmplitude),
        ),
      },
    },
  ],
});

export const clearExpressions = simpleCommand({
  id: "kvfx.keys.clearexpressions",
  name: "Remove Expressions",
  description: "Remove the expressions from the selected properties",
  category: CommandCategory.Keyframe,
  keywords: ["remove", "clear", "delete", "expression", "reset"],
  icon: "clear",
  metadata: NEEDS_COMP,
  steps: () => [{ op: "kvfx.op.prop.expressionOnSelected", args: { expression: "" } }],
});

export const keyframeCommands: readonly Command[] = [
  applyEase,
  makeLinear,
  makeHold,
  makeBezier,
  reverseKeys,
  addElastic,
  addBounce,
  loopCycle,
  loopPingPong,
  loopContinue,
  addWiggle,
  clearExpressions,
];

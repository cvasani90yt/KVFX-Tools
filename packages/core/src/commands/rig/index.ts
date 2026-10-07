import { DEFAULT_BEZIER } from "../../animation/easing.js";
import { COUNTER_EFFECT_NAME, counterExpression, formatCounter, normalizeCounter } from "../../expressions/counter.js";
import type { Rgb } from "../../color/index.js";
import type { JsonObject } from "../../types/json.js";
import {
  NEEDS_COMP,
  NEEDS_LAYER,
  SNAPSHOT_PROBE,
  bezierParam,
  colorParam,
  measuredCommand,
  numberParam,
  probedLayers,
  simpleCommand,
  stringParam,
} from "../define.js";
import { type Command, CommandCategory, type PlanStep, ref } from "../types.js";

/**
 * Generators: rigs built from several primitives in one undo step.
 *
 * Each rig is driven by expressions that find their controls through
 * `parent` or `effect(…)` on their own layer, never by a layer name — so
 * renaming or duplicating a rig cannot silently re-wire it to another.
 */

const TAG = "// KVFX Tools";

/* eslint-disable no-magic-numbers -- the named defaults themselves */
/** Defaults and bounds for parameters that arrive from text fields. */
const COUNTER = { to: 1000, maxDecimals: 6, minDuration: 0.04, maxDuration: 600, duration: 2 } as const;
const CAROUSEL = { radius: 600, minRadius: 10, maxRadius: 100_000, cards: 8 } as const;
const EXTRUDE = { slices: 16, depth: 40, maxDepth: 10_000 } as const;
const EXTRUDE_SIDE: Rgb = [0.35, 0.2, 0.1];
/* eslint-enable no-magic-numbers */
const TRANSFORM = "ADBE Transform Group";
const OPAQUE = 1;

// ---------------------------------------------------------------------------
// Number counter
// ---------------------------------------------------------------------------

export const numberCounter = simpleCommand({
  id: "kvfx.rig.counter",
  name: "Number Counter",
  description: "Create a text layer that counts between two numbers, with formatting",
  category: CommandCategory.Rig,
  keywords: ["counter", "count", "number", "numbers", "digits", "percent", "money", "ticker", "stats"],
  icon: "counter",
  metadata: NEEDS_COMP,
  defaultParams: (ui) => ui.toolParams["counter"] ?? {},
  steps: (ctx) => {
    const options = normalizeCounter({
      from: numberParam(ctx, "from", 0),
      to: numberParam(ctx, "to", COUNTER.to),
      decimals: numberParam(ctx, "decimals", 0, 0, COUNTER.maxDecimals),
      separator: stringParam(ctx, "separator", ","),
      decimalMark: stringParam(ctx, "decimalMark", "."),
      prefix: stringParam(ctx, "prefix", ""),
      suffix: stringParam(ctx, "suffix", ""),
      duration: numberParam(ctx, "duration", COUNTER.duration, COUNTER.minDuration, COUNTER.maxDuration),
    });
    const ease = bezierParam(ctx, "bezier", DEFAULT_BEZIER);
    return [
      { op: "kvfx.op.layer.create", args: { kind: "text", text: formatCounter(options, 1) }, bind: "counter" },
      { op: "kvfx.op.effect.add", args: { id: ref("counter"), matchName: "ADBE Slider Control", name: COUNTER_EFFECT_NAME } },
      {
        op: "kvfx.op.prop.keyframes",
        args: {
          id: ref("counter"),
          path: ["ADBE Effect Parade", COUNTER_EFFECT_NAME, 1],
          keys: [
            { time: 0, value: 0 },
            { time: options.duration, value: 100 },
          ],
          relative: true,
          bezier: [...ease],
        },
      },
      {
        op: "kvfx.op.prop.expression",
        args: {
          id: ref("counter"),
          path: ["ADBE Text Properties", "ADBE Text Document"],
          expression: counterExpression(options),
        },
      },
      { op: "kvfx.op.layer.set", args: { id: ref("counter"), name: "KVFX Counter" } },
    ];
  },
});

// ---------------------------------------------------------------------------
// Carousel
// ---------------------------------------------------------------------------

export function carouselPositionExpression(slot: number, count: number): string {
  return [
    `${TAG} — carousel`,
    `var count = ${String(count)};`,
    `var slot = ${String(slot)};`,
    'var radius = parent.effect("Radius")(1);',
    'var spin = parent.effect("Spin")(1);',
    "var a = degreesToRadians(spin + slot * 360 / count);",
    "var c = parent.anchorPoint;",
    "[c[0] + radius * Math.sin(a), c[1], c[2] - radius * Math.cos(a)];",
  ].join("\n");
}

/** Each card turns its back to the hub, so its face points outwards. */
export const CAROUSEL_ORIENTATION_EXPRESSION = `${TAG} — carousel\nlookAt(position, parent.anchorPoint);`;

const MIN_CARDS = 2;
const MAX_CARDS = 36;

export const carousel = measuredCommand({
  id: "kvfx.rig.carousel",
  name: "3D Carousel",
  description: "Arrange the selected layers — or copies of one — in a spinning 3D ring",
  category: CommandCategory.ThreeD,
  keywords: ["carousel", "ring", "circle", "3d", "orbit", "spin", "rotate", "cards", "gallery"],
  icon: "carousel",
  metadata: NEEDS_LAYER,
  defaultParams: (ui) => ui.toolParams["carousel"] ?? {},
  probe: () => SNAPSHOT_PROBE,
  steps: (ctx, measurement) => {
    const layers = probedLayers(measurement).filter((l) => l.isAV && l.kind !== "null");
    const first = layers[0];
    if (first === undefined) return [];
    const radius = numberParam(ctx, "radius", CAROUSEL.radius, CAROUSEL.minRadius, CAROUSEL.maxRadius);
    const single = layers.length === 1;
    const count = single
      ? Math.round(numberParam(ctx, "count", CAROUSEL.cards, MIN_CARDS, MAX_CARDS))
      : layers.length;
    const originals = single ? [first.id] : layers.map((l) => l.id);

    const steps: PlanStep[] = [
      { op: "kvfx.op.layer.create", args: { kind: "null", name: "KVFX Carousel" }, bind: "hub" },
      { op: "kvfx.op.layer.setFlag", args: { target: "ids", ids: [ref("hub")], flag: "threeD", value: true } },
      {
        op: "kvfx.op.effect.add",
        args: { id: ref("hub"), matchName: "ADBE Slider Control", name: "Radius", params: [{ path: [1], value: radius }] },
      },
      { op: "kvfx.op.effect.add", args: { id: ref("hub"), matchName: "ADBE Angle Control", name: "Spin" } },
    ];
    if (single) {
      steps.push({ op: "kvfx.op.layer.duplicate", args: { id: first.id, count: count - 1 }, bind: "copies" });
    }

    const groups: JsonObject[] = [{ ids: originals }];
    if (single) groups.push({ ids: ref("copies") });
    for (const group of groups) {
      steps.push({ op: "kvfx.op.layer.setFlag", args: { target: "ids", ...group, flag: "threeD", value: true } });
      steps.push({ op: "kvfx.op.layer.set", args: { ...group, parent: ref("hub") } });
      steps.push({
        op: "kvfx.op.prop.expression",
        args: { ...group, path: [TRANSFORM, "ADBE Orientation"], expression: CAROUSEL_ORIENTATION_EXPRESSION },
      });
    }

    for (let slot = 0; slot < count; slot += 1) {
      const target: JsonObject = single
        ? slot === 0
          ? { id: first.id }
          : { id: ref("copies", slot - 1) }
        : { id: originals[slot] ?? first.id };
      steps.push({
        op: "kvfx.op.prop.expression",
        args: { ...target, path: [TRANSFORM, "ADBE Position"], expression: carouselPositionExpression(slot, count) },
      });
    }
    return steps;
  },
});

// ---------------------------------------------------------------------------
// 3D extrusion
// ---------------------------------------------------------------------------

export const EXTRUDE_EFFECT_NAME = "KVFX Extrude";

export function extrusionPositionExpression(step: number, steps: number): string {
  return [
    `${TAG} — extrusion`,
    `var depth = parent.effect("${EXTRUDE_EFFECT_NAME}")(1);`,
    "var a = parent.anchorPoint;",
    `[a[0], a[1], a[2] + depth * ${String(step)} / ${String(steps)}];`,
  ].join("\n");
}

const MIN_SLICES = 2;
const MAX_SLICES = 60;

export const extrusion = measuredCommand({
  id: "kvfx.rig.extrude",
  name: "3D Extrude",
  description: "Give the selected layers depth with stacked, parented slices",
  category: CommandCategory.ThreeD,
  keywords: ["extrude", "extrusion", "depth", "3d", "thickness", "solid", "logo", "text"],
  icon: "extrude",
  metadata: NEEDS_LAYER,
  defaultParams: (ui) => ui.toolParams["extrude"] ?? {},
  budgetMs: 15_000,
  probe: () => SNAPSHOT_PROBE,
  steps: (ctx, measurement) => {
    const layers = probedLayers(measurement).filter((l) => l.isAV && l.kind !== "null");
    const slices = Math.round(numberParam(ctx, "slices", EXTRUDE.slices, MIN_SLICES, MAX_SLICES));
    const depth = numberParam(ctx, "depth", EXTRUDE.depth, 0, EXTRUDE.maxDepth);
    const [r, g, b] = colorParam(ctx, "color", EXTRUDE_SIDE);
    const steps: PlanStep[] = [];

    layers.forEach((layer, n) => {
      const copies = `slices${String(n)}`;
      const all = { ids: ref(copies) };
      steps.push(
        { op: "kvfx.op.layer.setFlag", args: { target: "ids", ids: [layer.id], flag: "threeD", value: true } },
        { op: "kvfx.op.layer.duplicate", args: { id: layer.id, count: slices }, bind: copies },
        { op: "kvfx.op.layer.set", args: { ...all, parent: layer.id } },
        {
          op: "kvfx.op.effect.add",
          args: {
            ...all,
            matchName: "ADBE Fill",
            name: "KVFX Extrude Side",
            params: [{ path: [{ valueType: "color", nth: 1 }], value: [r, g, b, OPAQUE] }],
          },
        },
        // Slices sit exactly behind their face: whatever transform the face
        // had is inherited through parenting, so their own is neutral.
        { op: "kvfx.op.prop.expression", args: { ...all, path: [TRANSFORM, "ADBE Scale"], expression: "[100, 100, 100];" } },
        { op: "kvfx.op.prop.expression", args: { ...all, path: [TRANSFORM, "ADBE Orientation"], expression: "[0, 0, 0];" } },
        { op: "kvfx.op.prop.expression", args: { ...all, path: [TRANSFORM, "ADBE Rotate X"], expression: "0;" } },
        { op: "kvfx.op.prop.expression", args: { ...all, path: [TRANSFORM, "ADBE Rotate Y"], expression: "0;" } },
        { op: "kvfx.op.prop.expression", args: { ...all, path: [TRANSFORM, "ADBE Rotate Z"], expression: "0;" } },
      );
      for (let s = 0; s < slices; s += 1) {
        steps.push({
          op: "kvfx.op.prop.expression",
          args: {
            id: ref(copies, s),
            path: [TRANSFORM, "ADBE Position"],
            expression: extrusionPositionExpression(s + 1, slices),
          },
        });
      }
      // Added last so the slices, duplicated earlier, do not carry it.
      steps.push({
        op: "kvfx.op.effect.add",
        args: {
          id: layer.id,
          matchName: "ADBE Slider Control",
          name: EXTRUDE_EFFECT_NAME,
          params: [{ path: [1], value: depth }],
        },
      });
    });
    return steps;
  },
});

export const rigCommands: readonly Command[] = [numberCounter, carousel, extrusion];

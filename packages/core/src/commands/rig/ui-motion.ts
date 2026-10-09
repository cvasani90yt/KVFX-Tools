import { type Bezier, DEFAULT_BEZIER } from "../../animation/easing.js";
import { seededPermutation } from "../../animation/order.js";
import { type Rgb, hexToRgb } from "../../color/index.js";
import {
  BACKDROP_SPEED,
  CARD_CONTROLS,
  CURSOR_PATHS,
  type CursorStyle,
  GLOW_PULSE_EXPRESSION,
  REVEAL_BLUR_EFFECT,
  REVEAL_EFFECT,
  REVEAL_STYLES,
  STAR_DRIFT_EXPRESSION,
  TAG_PLATE_POSITION,
  TAG_PLATE_SIZE,
  buttonPressExpression,
  cardIndexExpression,
  cardOpacityExpression,
  cardPositionExpression,
  cardScaleExpression,
  cursorArcExpression,
  cursorLiftExpression,
  cursorTiltExpression,
  driftPointExpression,
  parseRevealStyle,
  revealExpressions,
  rippleOpacityExpression,
  rippleScaleExpression,
  twinkleExpression,
} from "../../expressions/ui-motion.js";
import { type LayerBounds, measureSelection } from "../../geometry/index.js";
import { TEXT_EASES, type TextEase } from "../../text/motion.js";
import type { JsonObject, JsonValue } from "../../types/json.js";
import { decodeMeasurement, selectedMeasurements } from "../decode-measurement.js";
import {
  NEEDS_LAYER,
  SNAPSHOT_PROBE,
  bezierParam,
  boolParam,
  measuredCommand,
  numberParam,
  probedLayers,
  stringParam,
} from "../define.js";
import { type Command, CommandCategory, type CommandContext, type PlanStep, ref } from "../types.js";

/**
 * UI Motion: rigs for animating interfaces — staggered reveals, a cursor that
 * clicks through the selection, a focus carousel and animated backdrops.
 *
 * Each builds in one undo step, keeps the user's own layers intact (their
 * values, existing animation and any expression they wrote), and leaves its
 * timing on a control that can be retimed later.
 */

/* eslint-disable no-magic-numbers -- the named defaults and artwork sizes are the content */
const TRANSFORM = "ADBE Transform Group";
const FALLBACK_FRAME = 1 / 30;
const MEASURE = (): PlanStep => ({ op: "kvfx.op.layer.measure", args: { target: "selection" } });
const LIMITS = { frames: 600, distance: 5000, seconds: 60, seed: 100_000 } as const;

type OrderKey = "stack" | "reverse" | "topDown" | "bottomUp" | "leftRight" | "rightLeft" | "centre" | "random";

export const UI_ORDERS: readonly { readonly id: OrderKey; readonly label: string }[] = [
  { id: "topDown", label: "Top → bottom" },
  { id: "bottomUp", label: "Bottom → top" },
  { id: "leftRight", label: "Left → right" },
  { id: "rightLeft", label: "Right → left" },
  { id: "centre", label: "Centre → out" },
  { id: "stack", label: "Stack order" },
  { id: "reverse", label: "Stack, reversed" },
  { id: "random", label: "Random" },
];

function orderParam(ctx: CommandContext): OrderKey {
  const value = ctx.params?.["order"];
  return UI_ORDERS.some((o) => o.id === value) ? (value as OrderKey) : "topDown";
}

function easeParam(ctx: CommandContext, fallback: Exclude<TextEase, "preset" | "curve">): Exclude<TextEase, "preset"> {
  const value = ctx.params?.["ease"];
  if (value === "preset" || value === undefined) return fallback;
  return TEXT_EASES.some((e) => e.id === value) ? (value as Exclude<TextEase, "preset">) : fallback;
}

/**
 * Ranks layers by the chosen order. Screen orders use measured bounds; a
 * layer that cannot be measured (3D, a camera) keeps its stack position.
 */
function rankLayers(ids: readonly number[], bounds: ReadonlyMap<number, LayerBounds>, order: OrderKey, seed: number): Map<number, number> {
  const centre = (id: number): { x: number; y: number } | undefined => {
    const b = bounds.get(id)?.bounds;
    return b === undefined ? undefined : { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  };
  const stack = new Map(ids.map((id, i) => [id, i]));
  let sorted = [...ids];
  const by = (key: (id: number) => number): void => {
    sorted = [...ids].sort((a, b) => key(a) - key(b) || (stack.get(a) ?? 0) - (stack.get(b) ?? 0));
  };
  const placed = ids.map(centre).filter((c): c is { x: number; y: number } => c !== undefined);
  const mid = {
    x: placed.reduce((s, c) => s + c.x, 0) / Math.max(1, placed.length),
    y: placed.reduce((s, c) => s + c.y, 0) / Math.max(1, placed.length),
  };
  switch (order) {
    case "reverse":
      sorted = [...ids].reverse();
      break;
    case "topDown":
      by((id) => centre(id)?.y ?? stack.get(id) ?? 0);
      break;
    case "bottomUp":
      by((id) => -(centre(id)?.y ?? -(stack.get(id) ?? 0)));
      break;
    case "leftRight":
      by((id) => centre(id)?.x ?? stack.get(id) ?? 0);
      break;
    case "rightLeft":
      by((id) => -(centre(id)?.x ?? -(stack.get(id) ?? 0)));
      break;
    case "centre":
      by((id) => {
        const c = centre(id);
        return c === undefined ? Number.MAX_VALUE : Math.hypot(c.x - mid.x, c.y - mid.y);
      });
      break;
    case "random": {
      const permutation = seededPermutation(ids.length, seed);
      sorted = permutation.map((i) => ids[i] as number);
      break;
    }
    default:
      break;
  }
  return new Map(sorted.map((id, rank) => [id, rank]));
}

function boundsById(measurement: JsonValue): Map<number, LayerBounds> {
  const reply = decodeMeasurement(measurement);
  const measured = measureSelection(selectedMeasurements(reply), reply.layers);
  return new Map(measured.layers.map((l) => [l.id, l]));
}

// ---------------------------------------------------------------------------
// UI Stagger
// ---------------------------------------------------------------------------

export const uiStagger = measuredCommand({
  id: "kvfx.rig.uistagger",
  name: "UI Stagger",
  description:
    "Reveal the selected interface layers one after another — rise, slide, pop, blur or bounce — in screen order, from the playhead",
  category: CommandCategory.Rig,
  keywords: ["stagger", "ui", "reveal", "cascade", "interface", "saas", "cards", "build in", "animate in", "bounce", "pop", "rise"],
  icon: "ui-stagger",
  metadata: NEEDS_LAYER,
  defaultParams: (ui) => ({ bezier: [...ui.ease], ...(ui.toolParams["uiStagger"] ?? {}) }),
  probe: MEASURE,
  steps: (ctx, measurement) => {
    const reply = decodeMeasurement(measurement);
    const snapshot = new Map(ctx.snapshot.layers.map((l) => [l.id, l]));
    const ids = reply.selectedIds.filter((id) => reply.layers.find((l) => l.id === id)?.isAV !== false);
    if (ids.length === 0) return [];

    const frame = ctx.snapshot.comp?.frameDuration ?? FALLBACK_FRAME;
    const style = parseRevealStyle(ctx.params?.["style"]);
    const styleEase = REVEAL_STYLES.find((s) => s.id === style)?.ease ?? "expo";
    const ease = easeParam(ctx, styleEase);
    const stagger = numberParam(ctx, "stagger", 3, 0, LIMITS.frames) * frame;
    const duration = Math.max(frame, numberParam(ctx, "duration", 18, 1, LIMITS.frames) * frame);
    const distance = numberParam(ctx, "distance", 80, 0, LIMITS.distance);
    const overshoot = numberParam(ctx, "overshoot", 30, 0, 100);
    const bezier: Bezier = bezierParam(ctx, "bezier", DEFAULT_BEZIER);
    const mode = stringParam(ctx, "mode", "in");
    const seed = numberParam(ctx, "seed", 1, 1, LIMITS.seed);
    const ranks = rankLayers(ids, boundsById(measurement), orderParam(ctx), seed);
    const lastRank = Math.max(0, ...ranks.values());

    const all = { ids };
    const steps: PlanStep[] = [
      { op: "kvfx.op.effect.add", args: { ...all, matchName: "ADBE Slider Control", name: REVEAL_EFFECT, params: [{ path: [1], value: 100 }] } },
    ];
    const slider = ["ADBE Effect Parade", REVEAL_EFFECT, 1];
    for (const id of ids) {
      const rank = ranks.get(id) ?? 0;
      if (mode !== "out") {
        const delay = rank * stagger;
        steps.push({
          op: "kvfx.op.prop.keyframes",
          args: { id, path: slider, relative: true, keys: [{ time: delay, value: 0 }, { time: delay + duration, value: 100 }] },
        });
      }
      if (mode !== "in") {
        const layer = snapshot.get(id);
        const end = layer?.outPoint ?? ctx.snapshot.comp?.duration ?? 10;
        // In + Out leaves before the layer ends; Out alone leaves from the playhead.
        const keys =
          mode === "out"
            ? [{ time: rank * stagger, value: 100 }, { time: rank * stagger + duration, value: 0 }]
            : [
                { time: end - duration - (lastRank - rank) * stagger, value: 100 },
                { time: end - (lastRank - rank) * stagger, value: 0 },
              ];
        steps.push({ op: "kvfx.op.prop.keyframes", args: { id, path: slider, relative: mode === "out", keys } });
      }
    }

    const expressions = revealExpressions(style, distance, ease, overshoot, bezier);
    const channels: [string, string | undefined][] = [
      ["ADBE Position", expressions.position],
      ["ADBE Scale", expressions.scale],
      ["ADBE Opacity", expressions.opacity],
    ];
    for (const [matchName, expression] of channels) {
      if (expression === undefined) continue;
      steps.push({ op: "kvfx.op.prop.expression", args: { ...all, path: [TRANSFORM, matchName], expression, keepExisting: true } });
    }
    if (expressions.blur !== undefined) {
      steps.push({
        op: "kvfx.op.effect.add",
        args: {
          ...all,
          matchName: "ADBE Gaussian Blur 2",
          name: REVEAL_BLUR_EFFECT,
          params: [{ path: [{ valueType: "oneD", nth: 1 }], expression: expressions.blur }],
        },
      });
    }
    return steps;
  },
});

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

const DARK: Rgb = [0.07, 0.07, 0.08];
const WHITE: Rgb = [1, 1, 1];
const DEFAULT_ACCENT: Rgb = [1, 0.56, 0.25];

function cursorArtwork(style: CursorStyle, size: number): JsonObject[] {
  const k = size / 30;
  if (style === "touch") {
    return [
      {
        name: "Cursor",
        items: [
          { type: "ellipse", name: "Touch", size: [26 * k, 26 * k] },
          { type: "stroke", name: "Edge", color: [...DARK], width: 1.5 * k, opacity: 60 },
          { type: "fill", name: "Fill", color: [...WHITE], opacity: 70 },
        ],
      },
    ];
  }
  const points = CURSOR_PATHS[style].map(([x, y]) => [x * k, y * k]);
  return [
    {
      name: "Cursor",
      items: [
        { type: "path", name: "Outline", vertices: points, closed: true },
        { type: "stroke", name: "Edge", color: [...DARK], width: 1.6 * k },
        { type: "fill", name: "Fill", color: [...WHITE] },
      ],
    },
  ];
}

export interface CursorTimeline {
  /** Position keys, seconds from the playhead. */
  readonly keys: readonly { time: number; value: [number, number] }[];
  /** Seconds from the playhead at which each target is clicked. */
  readonly clicks: readonly number[];
  readonly points: readonly [number, number][];
}

/** Travel to each point, hold, click partway through the hold. */
export function cursorTimeline(
  points: readonly [number, number][],
  start: [number, number],
  travel: number,
  hold: number,
  clickAt: number,
): CursorTimeline {
  const keys: { time: number; value: [number, number] }[] = [{ time: 0, value: start }];
  const clicks: number[] = [];
  let t = 0;
  for (const point of points) {
    t += travel;
    keys.push({ time: t, value: point });
    clicks.push(t + hold * clickAt);
    t += hold;
    keys.push({ time: t, value: point });
  }
  return { keys, clicks, points };
}

export const cursorRig = measuredCommand({
  id: "kvfx.rig.cursor",
  name: "Cursor Rig",
  description:
    "Add a cursor that travels to each selected layer in turn and clicks it — with arcing paths, tilt, shadow, click ripples, a pressed button and an optional name tag",
  category: CommandCategory.Rig,
  keywords: ["cursor", "mouse", "pointer", "click", "tap", "touch", "demo", "ui", "saas", "walkthrough", "ripple", "name tag"],
  icon: "cursor",
  metadata: NEEDS_LAYER,
  defaultParams: (ui) => ({ bezier: [...ui.ease], ...(ui.toolParams["cursor"] ?? {}) }),
  probe: MEASURE,
  steps: (ctx, measurement) => {
    const reply = decodeMeasurement(measurement);
    const bounds = boundsById(measurement);
    const ids = reply.selectedIds.filter((id) => bounds.has(id));
    if (ids.length === 0) return [];
    const ranks = rankLayers(ids, bounds, orderParam(ctx), 1);
    const ordered = [...ids].sort((a, b) => (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0));
    const clickX = numberParam(ctx, "clickX", 50, 0, 100) / 100;
    const clickY = numberParam(ctx, "clickY", 50, 0, 100) / 100;
    const points = ordered.map((id): [number, number] => {
      const b = (bounds.get(id) as LayerBounds).bounds;
      return [b.left + b.width * clickX, b.top + b.height * clickY];
    });

    const w = reply.compWidth || 1920;
    const h = reply.compHeight || 1080;
    const travel = numberParam(ctx, "travel", 0.8, 0.05, LIMITS.seconds);
    const hold = numberParam(ctx, "hold", 0.6, 0, LIMITS.seconds);
    const size = numberParam(ctx, "size", 36, 6, 400);
    const style = ((): CursorStyle => {
      const value = ctx.params?.["style"];
      return value === "pointer" || value === "touch" ? value : "arrow";
    })();
    const timeline = cursorTimeline(points, [w * 0.92, h * 1.06], travel, hold, 0.45);
    const ease = bezierParam(ctx, "bezier", [0.45, 0, 0.2, 1]);
    const press = numberParam(ctx, "press", 15, 0, 90);

    const cursor = { id: ref("cursor") };
    const steps: PlanStep[] = [
      { op: "kvfx.op.layer.create", args: { kind: "shape", name: "KVFX Cursor" }, bind: "cursor" },
      { op: "kvfx.op.shape.build", args: { ...cursor, groups: cursorArtwork(style, size) } },
      { op: "kvfx.op.prop.set", args: { ...cursor, path: [TRANSFORM, "ADBE Anchor Point"], value: [0, 0, 0] } },
      {
        op: "kvfx.op.prop.keyframes",
        args: { ...cursor, path: [TRANSFORM, "ADBE Position"], relative: true, bezier: [...ease], keys: timeline.keys.map((k) => ({ time: k.time, value: [...k.value] })) },
      },
    ];

    if (press > 0) {
      const dip = 100 - press;
      const keys: JsonObject[] = [];
      for (const c of timeline.clicks) {
        keys.push({ time: Math.max(0, c - 0.06), value: [100, 100, 100] }, { time: c, value: [dip, dip, 100] }, { time: c + 0.14, value: [100, 100, 100] });
      }
      if (keys.length > 0) steps.push({ op: "kvfx.op.prop.keyframes", args: { ...cursor, path: [TRANSFORM, "ADBE Scale"], relative: true, keys } });
    }
    const arc = numberParam(ctx, "arc", 18, -100, 100) / 100;
    if (arc !== 0) steps.push({ op: "kvfx.op.prop.expression", args: { ...cursor, path: [TRANSFORM, "ADBE Position"], expression: cursorArcExpression(arc) } });
    const lift = numberParam(ctx, "lift", 8, 0, 100);
    if (lift > 0) steps.push({ op: "kvfx.op.prop.expression", args: { ...cursor, path: [TRANSFORM, "ADBE Scale"], expression: cursorLiftExpression(lift) } });
    const tilt = numberParam(ctx, "tilt", 12, 0, 60);
    if (tilt > 0) steps.push({ op: "kvfx.op.prop.expression", args: { ...cursor, path: [TRANSFORM, "ADBE Rotate Z"], expression: cursorTiltExpression(tilt) } });
    if (boolParam(ctx, "shadow", true)) {
      steps.push({
        op: "kvfx.op.effect.add",
        args: {
          ...cursor,
          matchName: "ADBE Drop Shadow",
          name: "KVFX Cursor Shadow",
          params: [
            { path: [{ valueType: "oneD", nth: 1 }], value: 90 },
            { path: [{ valueType: "oneD", nth: 3 }], value: 6 },
            { path: [{ valueType: "oneD", nth: 4 }], value: 12 },
          ],
        },
      });
    }

    const below: JsonValue[] = [];
    const accent = hexToRgb(stringParam(ctx, "color", "")) ?? DEFAULT_ACCENT;
    const tag = stringParam(ctx, "tag", "").trim();
    if (tag.length > 0) {
      steps.push(
        { op: "kvfx.op.layer.create", args: { kind: "text", text: tag.slice(0, 40), name: "KVFX Cursor Tag" }, bind: "tag" },
        { op: "kvfx.op.text.setStyle", args: { id: ref("tag"), fontSize: Math.max(10, size * 0.45), fillColor: [...DARK], justification: "left" } },
        { op: "kvfx.op.layer.create", args: { kind: "shape", name: "KVFX Cursor Tag Plate" }, bind: "plate" },
        {
          op: "kvfx.op.shape.build",
          args: {
            id: ref("plate"),
            groups: [{ name: "Plate", items: [{ type: "rect", name: "Box", size: [80, 30], roundness: size * 0.25 }, { type: "fill", name: "Fill", color: [...accent] }] }],
          },
        },
        { op: "kvfx.op.prop.expression", args: { id: ref("plate"), path: ["ADBE Root Vectors Group", 1, "ADBE Vectors Group", 1, "ADBE Vector Rect Size"], expression: TAG_PLATE_SIZE } },
        { op: "kvfx.op.prop.expression", args: { id: ref("plate"), path: ["ADBE Root Vectors Group", 1, "ADBE Vectors Group", 1, "ADBE Vector Rect Position"], expression: TAG_PLATE_POSITION } },
        // The plate shares the text's layer space; the text rides on the cursor.
        { op: "kvfx.op.layer.set", args: { id: ref("plate"), parent: ref("tag") } },
        { op: "kvfx.op.prop.set", args: { id: ref("plate"), path: [TRANSFORM, "ADBE Anchor Point"], value: [0, 0, 0] } },
        { op: "kvfx.op.prop.set", args: { id: ref("plate"), path: [TRANSFORM, "ADBE Position"], value: [0, 0, 0] } },
        { op: "kvfx.op.layer.set", args: { id: ref("tag"), parent: ref("cursor") } },
        { op: "kvfx.op.prop.set", args: { id: ref("tag"), path: [TRANSFORM, "ADBE Position"], value: [size * 0.75, size * 1.25, 0] } },
      );
      below.push(ref("tag"), ref("plate"));
    }

    if (boolParam(ctx, "ripple", true)) {
      const ring = Math.max(40, size * 1.6);
      steps.push(
        { op: "kvfx.op.layer.create", args: { kind: "shape", name: "KVFX Click Ripple" }, bind: "ripple" },
        {
          op: "kvfx.op.shape.build",
          args: {
            id: ref("ripple"),
            groups: [{ name: "Ring", items: [{ type: "ellipse", name: "Ring", size: [100, 100] }, { type: "stroke", name: "Edge", color: [...accent], width: 4 }] }],
          },
        },
        { op: "kvfx.op.prop.set", args: { id: ref("ripple"), path: [TRANSFORM, "ADBE Anchor Point"], value: [0, 0, 0] } },
        {
          op: "kvfx.op.prop.keyframes",
          args: {
            id: ref("ripple"),
            path: [TRANSFORM, "ADBE Position"],
            relative: true,
            interpolation: "hold",
            keys: timeline.clicks.map((c, i) => ({ time: c, value: [...(timeline.points[i] ?? [0, 0])] })),
          },
        },
        { op: "kvfx.op.prop.expression", args: { id: ref("ripple"), path: [TRANSFORM, "ADBE Scale"], expression: rippleScaleExpression(timeline.clicks, ring), relative: true } },
        { op: "kvfx.op.prop.expression", args: { id: ref("ripple"), path: [TRANSFORM, "ADBE Opacity"], expression: rippleOpacityExpression(timeline.clicks), relative: true } },
      );
      below.push(ref("ripple"));
    }
    if (below.length > 0) steps.push({ op: "kvfx.op.layer.place", args: { ids: below, below: ref("cursor") } });

    const depth = numberParam(ctx, "buttonPress", 6, 0, 50);
    if (depth > 0) {
      ordered.forEach((id, i) => {
        steps.push({
          op: "kvfx.op.prop.expression",
          args: { id, path: [TRANSFORM, "ADBE Scale"], expression: buttonPressExpression(timeline.clicks[i] ?? 0, depth), relative: true, keepExisting: true },
        });
      });
    }
    return steps;
  },
});

// ---------------------------------------------------------------------------
// Card carousel
// ---------------------------------------------------------------------------

export const cardCarousel = measuredCommand({
  id: "kvfx.rig.cardcarousel",
  name: "Card Carousel",
  description:
    "Line the selected layers up as a flat carousel: the focused card full size, its neighbours smaller and dimmer, advancing on its own",
  category: CommandCategory.Rig,
  keywords: ["carousel", "slider", "cards", "focus", "gallery", "swipe", "ui", "saas", "screens", "showcase"],
  icon: "card-carousel",
  metadata: { destructive: false, minLayers: 2, requiresComp: true },
  defaultParams: (ui) => ui.toolParams["cardCarousel"] ?? {},
  probe: MEASURE,
  steps: (ctx, measurement) => {
    const reply = decodeMeasurement(measurement);
    const bounds = boundsById(measurement);
    const ids = reply.selectedIds.filter((id) => bounds.has(id));
    if (ids.length < 2) return [];
    const ranks = rankLayers(ids, bounds, "leftRight", 1);
    const ordered = [...ids].sort((a, b) => (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0));
    const widest = Math.max(...ordered.map((id) => bounds.get(id)?.bounds.width ?? 0));
    const gap = numberParam(ctx, "gap", 60, -2000, LIMITS.distance);
    const c = CARD_CONTROLS;
    const slider = (name: string, value: number): PlanStep => ({
      op: "kvfx.op.effect.add",
      args: { id: ref("hub"), matchName: "ADBE Slider Control", name, params: [{ path: [1], value }] },
    });

    const steps: PlanStep[] = [
      { op: "kvfx.op.layer.create", args: { kind: "null", name: "KVFX Card Carousel" }, bind: "hub" },
      { op: "kvfx.op.prop.set", args: { id: ref("hub"), path: [TRANSFORM, "ADBE Position"], value: [(reply.compWidth || 1920) / 2, (reply.compHeight || 1080) / 2, 0] } },
      slider(c.index, 0),
      slider(c.spacing, widest + gap),
      slider(c.focus, numberParam(ctx, "focus", 100, 1, 400)),
      slider(c.side, numberParam(ctx, "side", 80, 1, 400)),
      slider(c.sideOpacity, numberParam(ctx, "sideOpacity", 45, 0, 100)),
      slider(c.hold, numberParam(ctx, "hold", 1.4, 0, LIMITS.seconds)),
      slider(c.move, numberParam(ctx, "move", 0.6, 0.01, LIMITS.seconds)),
      slider(c.visible, numberParam(ctx, "visible", 2, 0.5, 20)),
      {
        op: "kvfx.op.effect.add",
        args: { id: ref("hub"), matchName: "ADBE Checkbox Control", name: c.loop, params: [{ path: [1], value: boolParam(ctx, "loop", true) ? 1 : 0 }] },
      },
      {
        op: "kvfx.op.prop.expression",
        args: { id: ref("hub"), path: ["ADBE Effect Parade", c.index, 1], expression: cardIndexExpression(ordered.length), relative: true },
      },
      { op: "kvfx.op.layer.set", args: { ids: ordered, parent: ref("hub") } },
    ];
    ordered.forEach((id, slot) => {
      const n = ordered.length;
      for (const [matchName, expression] of [
        ["ADBE Position", cardPositionExpression(slot, n)],
        ["ADBE Scale", cardScaleExpression(slot, n)],
        ["ADBE Opacity", cardOpacityExpression(slot, n)],
      ] as const) {
        steps.push({ op: "kvfx.op.prop.expression", args: { id, path: [TRANSFORM, matchName], expression, keepExisting: true } });
      }
    });
    return steps;
  },
});

// ---------------------------------------------------------------------------
// Backdrops
// ---------------------------------------------------------------------------

export interface BackdropPalette {
  readonly id: string;
  readonly name: string;
  /** Darkest first: background, then three accents. */
  readonly colors: readonly [string, string, string, string];
}

const EMBER: BackdropPalette = { id: "ember", name: "Ember", colors: ["#120b08", "#ff8f3f", "#c2410c", "#fbbf24"] };

export const BACKDROP_PALETTES: readonly BackdropPalette[] = [
  EMBER,
  { id: "ocean", name: "Ocean", colors: ["#060d18", "#2563eb", "#06b6d4", "#1e3a8a"] },
  { id: "violet", name: "Violet", colors: ["#0d0718", "#7c3aed", "#db2777", "#4338ca"] },
  { id: "mint", name: "Mint", colors: ["#04120e", "#10b981", "#84cc16", "#0e7490"] },
  { id: "sunset", name: "Sunset", colors: ["#140812", "#f43f5e", "#f97316", "#a855f7"] },
  { id: "mono", name: "Mono", colors: ["#0a0a0b", "#e4e4e7", "#71717a", "#3f3f46"] },
];

export type BackdropStyle = "drift" | "horizon" | "stars";

function rgb(hex: string): number[] {
  const value = hexToRgb(hex) ?? [0, 0, 0];
  return [value[0], value[1], value[2]];
}

function opaque(hex: string): number[] {
  return [...rgb(hex), 1];
}

/** Seeded star positions across the frame, with size and twinkle per star. */
export function starField(count: number, width: number, height: number, seed: number): { x: number; y: number; r: number; phase: number; rate: number }[] {
  const order = seededPermutation(count * 5, seed);
  const unit = (i: number): number => ((order[i] ?? 0) + 0.5) / (count * 5);
  return Array.from({ length: count }, (_, i) => ({
    x: (unit(i * 5) - 0.5) * width * 1.1,
    y: (unit(i * 5 + 1) - 0.5) * height,
    r: 1.5 + unit(i * 5 + 2) * 3,
    phase: unit(i * 5 + 3) * Math.PI * 2,
    rate: 0.6 + unit(i * 5 + 4) * 1.8,
  }));
}

export const backdrop = measuredCommand({
  id: "kvfx.rig.backdrop",
  name: "Animated Backdrop",
  description:
    "Add a moving background — drifting gradient, glowing horizon or twinkling stars — in a palette, with optional film grain, behind everything or clipped to the selected layer",
  category: CommandCategory.Rig,
  keywords: ["background", "backdrop", "gradient", "mesh", "aurora", "stars", "grain", "horizon", "glow", "bg", "animated"],
  icon: "backdrop",
  metadata: { destructive: false, minLayers: 0, requiresComp: true },
  defaultParams: (ui) => ui.toolParams["backdrop"] ?? {},
  probe: () => SNAPSHOT_PROBE,
  steps: (ctx, measurement) => {
    const comp = ctx.snapshot.comp;
    const w = comp?.width ?? 1920;
    const h = comp?.height ?? 1080;
    const style = ((): BackdropStyle => {
      const value = ctx.params?.["style"];
      return value === "horizon" || value === "stars" ? value : "drift";
    })();
    const palette = BACKDROP_PALETTES.find((p) => p.id === ctx.params?.["palette"]) ?? EMBER;
    const [bg, a1, a2, a3] = palette.colors;
    const speed = numberParam(ctx, "speed", 1, 0, 20);
    const created: string[] = [];
    const steps: PlanStep[] = [
      { op: "kvfx.op.layer.create", args: { kind: "solid", name: "KVFX Backdrop", color: rgb(bg) }, bind: "bg" },
      { op: "kvfx.op.effect.add", args: { id: ref("bg"), matchName: "ADBE Slider Control", name: BACKDROP_SPEED, params: [{ path: [1], value: speed }] } },
    ];

    if (style === "drift") {
      const colors = [a1, a2, a3, bg];
      const params: JsonObject[] = [];
      colors.forEach((hex, i) => {
        params.push({ path: [{ valueType: "twoDSpatial", nth: i + 1 }], expression: driftPointExpression(i) });
        params.push({ path: [{ valueType: "color", nth: i + 1 }], value: opaque(hex) });
      });
      steps.push({ op: "kvfx.op.effect.add", args: { id: ref("bg"), matchName: "ADBE 4ColorGradient", name: "KVFX Drift", params } });
    } else {
      // A dark ramp from the top, tinted towards the palette at the bottom.
      steps.push({
        op: "kvfx.op.effect.add",
        args: {
          id: ref("bg"),
          matchName: "ADBE Ramp",
          name: "KVFX Backdrop Ramp",
          params: [
            { path: [{ valueType: "twoDSpatial", nth: 1 }], value: [w / 2, 0] },
            { path: [{ valueType: "color", nth: 1 }], value: opaque(bg) },
            { path: [{ valueType: "twoDSpatial", nth: 2 }], value: [w / 2, h] },
            { path: [{ valueType: "color", nth: 2 }], value: style === "stars" ? opaque(a3) : opaque(bg) },
          ],
        },
      });
    }

    if (style === "horizon") {
      steps.push(
        { op: "kvfx.op.layer.create", args: { kind: "shape", name: "KVFX Horizon Glow" }, bind: "glow" },
        {
          op: "kvfx.op.shape.build",
          args: {
            id: ref("glow"),
            groups: [
              { name: "Haze", items: [{ type: "ellipse", name: "Haze", size: [w * 1.4, h * 0.45] }, { type: "fill", name: "Fill", color: rgb(a1) }] },
              { name: "Core", items: [{ type: "ellipse", name: "Core", size: [w * 0.75, h * 0.1] }, { type: "fill", name: "Fill", color: rgb(a3) }] },
            ],
          },
        },
        { op: "kvfx.op.prop.set", args: { id: ref("glow"), path: [TRANSFORM, "ADBE Anchor Point"], value: [0, 0, 0] } },
        { op: "kvfx.op.prop.set", args: { id: ref("glow"), path: [TRANSFORM, "ADBE Position"], value: [w / 2, h * 0.92, 0] } },
        { op: "kvfx.op.effect.add", args: { id: ref("glow"), matchName: "ADBE Slider Control", name: BACKDROP_SPEED, params: [{ path: [1], value: speed }] } },
        { op: "kvfx.op.effect.add", args: { id: ref("glow"), matchName: "ADBE Gaussian Blur 2", name: "KVFX Glow Blur", params: [{ path: [{ valueType: "oneD", nth: 1 }], value: Math.round(h * 0.12) }] } },
        { op: "kvfx.op.prop.expression", args: { id: ref("glow"), path: [TRANSFORM, "ADBE Opacity"], expression: GLOW_PULSE_EXPRESSION } },
        { op: "kvfx.op.layer.set", args: { id: ref("glow"), blendingMode: "add" } },
      );
      created.push("glow");
    }

    if (style === "stars") {
      const stars = starField(70, w, h, numberParam(ctx, "seed", 7, 1, LIMITS.seed));
      steps.push(
        { op: "kvfx.op.layer.create", args: { kind: "shape", name: "KVFX Stars" }, bind: "stars" },
        {
          op: "kvfx.op.shape.build",
          args: {
            id: ref("stars"),
            groups: stars.map((s, i) => ({
              name: `Star ${String(i + 1)}`,
              items: [{ type: "ellipse", name: "Dot", size: [s.r, s.r] }, { type: "fill", name: "Fill", color: i % 7 === 0 ? rgb(a1) : [1, 1, 1] }],
              transform: { position: [s.x, s.y] },
            })),
          },
        },
        { op: "kvfx.op.prop.set", args: { id: ref("stars"), path: [TRANSFORM, "ADBE Anchor Point"], value: [0, 0, 0] } },
        { op: "kvfx.op.prop.set", args: { id: ref("stars"), path: [TRANSFORM, "ADBE Position"], value: [w / 2, h / 2, 0] } },
        { op: "kvfx.op.prop.expression", args: { id: ref("stars"), path: [TRANSFORM, "ADBE Position"], expression: STAR_DRIFT_EXPRESSION } },
      );
      stars.forEach((s, i) => {
        steps.push({
          op: "kvfx.op.prop.expression",
          args: {
            id: ref("stars"),
            path: ["ADBE Root Vectors Group", i + 1, "ADBE Vector Transform Group", "ADBE Vector Group Opacity"],
            expression: twinkleExpression(s.phase, s.rate),
          },
        });
      });
      created.push("stars");
    }

    if (boolParam(ctx, "grain", true)) {
      steps.push({
        op: "kvfx.op.effect.add",
        args: {
          id: ref("bg"),
          matchName: "ADBE Noise",
          name: "KVFX Grain",
          params: [
            { path: [{ valueType: "oneD", nth: 1 }], value: numberParam(ctx, "grainAmount", 6, 0, 100) },
            { path: [{ valueType: "oneD", nth: 2 }], value: 0 },
          ],
        },
      });
    }

    // Stack order, top first: extras above the base.
    const layers: JsonValue[] = [...created.map((name) => ref(name)), ref("bg")];
    const target = boolParam(ctx, "clip", false) ? probedLayers(measurement).find((l) => l.isAV && l.kind !== "null") : undefined;
    if (target === undefined) {
      steps.push({ op: "kvfx.op.layer.place", args: { ids: layers, below: "bottom" } });
      return steps;
    }

    // Clipped: each backdrop layer sits above the target, matted by its own
    // hidden copy of it, so the original layer itself is never changed.
    steps.push({ op: "kvfx.op.layer.place", args: { ids: layers, above: target.id } });
    [...created, "bg"].forEach((name, i) => {
      const matte = `matte${String(i)}`;
      steps.push(
        { op: "kvfx.op.layer.duplicate", args: { id: target.id, count: 1 }, bind: matte },
        { op: "kvfx.op.layer.set", args: { id: ref(matte, 0), name: "KVFX Backdrop Matte" } },
        { op: "kvfx.op.layer.setFlag", args: { target: "ids", ids: [ref(matte, 0)], flag: "enabled", value: false } },
        { op: "kvfx.op.layer.matte", args: { id: ref(name), matteId: ref(matte, 0), type: "alpha" } },
      );
    });
    return steps;
  },
});

export const uiMotionCommands: readonly Command[] = [uiStagger, cursorRig, cardCarousel, backdrop];

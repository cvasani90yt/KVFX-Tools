import { DEFAULT_BEZIER } from "../../animation/easing.js";
import { type Rgb, hexToRgb } from "../../color/index.js";
import {
  CODE_LINES,
  FLICKER_EXPRESSION,
  HOVER_CONTROLS,
  HOVER_LIFT_EXPRESSION,
  HOVER_SCALE_EXPRESSION,
  PLACEHOLDER_EXPRESSION,
  PULSE_CONTROLS,
  buttonPressExpression,
  codeLinesExpression,
  dotPulseExpression,
  glyphFieldExpression,
} from "../../expressions/ui-motion.js";
import { type LayerBounds, measureSelection } from "../../geometry/index.js";
import { liveAnimators, textMotionPreset, typingExpression, type TextMotionOptions } from "../../text/motion.js";
import type { JsonValue } from "../../types/json.js";
import { decodeMeasurement, selectedMeasurements } from "../decode-measurement.js";
import {
  NEEDS_COMP,
  NEEDS_LAYER,
  SNAPSHOT_PROBE,
  bezierParam,
  boolParam,
  measuredCommand,
  numberParam,
  probedLayers,
  simpleCommand,
  stringParam,
} from "../define.js";
import { type Command, CommandCategory, type CommandContext, type PlanStep, ref } from "../types.js";

/**
 * More interface rigs: hover, a halftone dot pulse, frosted glass, wipes,
 * a code-and-glyphs title and a typing input bar.
 */

/* eslint-disable no-magic-numbers -- the named defaults and layout proportions are the content */
const TRANSFORM = "ADBE Transform Group";
const FALLBACK_FRAME = 1 / 30;
const DEFAULT_ACCENT: Rgb = [1, 0.56, 0.25];
const DARK: Rgb = [0.07, 0.07, 0.09];
const WHITE: Rgb = [1, 1, 1];

function accentParam(ctx: CommandContext, key = "color"): Rgb {
  return hexToRgb(stringParam(ctx, key, "")) ?? DEFAULT_ACCENT;
}

function bounds(measurement: JsonValue): Map<number, LayerBounds> {
  const reply = decodeMeasurement(measurement);
  return new Map(measureSelection(selectedMeasurements(reply), reply.layers).layers.map((l) => [l.id, l]));
}

/** Steps that matte `layer` with a hidden copy of `target`, so `target` itself is untouched. */
function matteWithCopy(layer: string, target: number, bind: string, name: string): PlanStep[] {
  return [
    { op: "kvfx.op.layer.duplicate", args: { id: target, count: 1 }, bind },
    { op: "kvfx.op.layer.set", args: { id: ref(bind, 0), name } },
    { op: "kvfx.op.layer.setFlag", args: { target: "ids", ids: [ref(bind, 0)], flag: "enabled", value: false } },
    { op: "kvfx.op.layer.matte", args: { id: ref(layer), matteId: ref(bind, 0), type: "alpha" } },
  ];
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

export const hoverLift = measuredCommand({
  id: "kvfx.rig.hover",
  name: "Hover Lift",
  description:
    "Make the selected layers grow and lift as a cursor comes near — the cursor is a selected KVFX Cursor, or the top selected layer",
  category: CommandCategory.Rig,
  keywords: ["hover", "proximity", "cursor", "mouse over", "lift", "ui", "interactive", "react", "near"],
  icon: "hover",
  metadata: { destructive: false, minLayers: 2, requiresComp: true },
  defaultParams: (ui) => ui.toolParams["hover"] ?? {},
  probe: () => SNAPSHOT_PROBE,
  steps: (ctx, measurement) => {
    const layers = probedLayers(measurement).filter((l) => l.isAV);
    const cursor = layers.find((l) => /^KVFX Cursor$/.test(l.name)) ?? layers[0];
    if (cursor === undefined) return [];
    const ids = layers.filter((l) => l.id !== cursor.id).map((l) => l.id);
    if (ids.length === 0) return [];
    const all = { ids };
    const c = HOVER_CONTROLS;
    const slider = (name: string, value: number): PlanStep => ({
      op: "kvfx.op.effect.add",
      args: { ...all, matchName: "ADBE Slider Control", name, params: [{ path: [1], value }] },
    });
    return [
      { op: "kvfx.op.effect.add", args: { ...all, matchName: "ADBE Layer Control", name: c.cursor, params: [{ path: [1], value: cursor.index }] } },
      slider(c.radius, numberParam(ctx, "radius", 160, 1, 5000)),
      slider(c.scale, numberParam(ctx, "scale", 6, -90, 300)),
      slider(c.lift, numberParam(ctx, "lift", 10, -500, 500)),
      // A Transform effect scales around the layer's own centre and stacks
      // with whatever the layer's transform already does.
      {
        op: "kvfx.op.effect.add",
        args: {
          ...all,
          matchName: "ADBE Geometry2",
          name: c.transform,
          params: [
            { path: [{ valueType: "twoDSpatial", nth: 2 }], expression: HOVER_LIFT_EXPRESSION },
            { path: [{ valueType: "oneD", nth: 2 }], expression: HOVER_SCALE_EXPRESSION },
          ],
        },
      },
    ];
  },
});

// ---------------------------------------------------------------------------
// Dot pulse
// ---------------------------------------------------------------------------

const MAX_DOTS = 360;

/** A centred grid of dots over a region, thinned out until it fits the limit. */
export function dotGrid(width: number, height: number, spacing: number): { x: number; y: number; d: number }[] {
  let step = Math.max(4, spacing);
  let cols = Math.floor(width / step) + 1;
  let rows = Math.floor(height / step) + 1;
  while (cols * rows > MAX_DOTS) {
    step *= 1.1;
    cols = Math.floor(width / step) + 1;
    rows = Math.floor(height / step) + 1;
  }
  const reach = Math.hypot(((cols - 1) * step) / 2, ((rows - 1) * step) / 2) || 1;
  const dots: { x: number; y: number; d: number }[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = (c - (cols - 1) / 2) * step;
      const y = (r - (rows - 1) / 2) * step;
      dots.push({ x, y, d: Math.hypot(x, y) / reach });
    }
  }
  return dots;
}

export const dotPulse = measuredCommand({
  id: "kvfx.rig.dotpulse",
  name: "Dot Pulse",
  description:
    "A halftone grid of dots with a shockwave rippling out from the centre — over the comp, behind the selected layer, or inside its shape",
  category: CommandCategory.Rig,
  keywords: ["halftone", "dots", "pulse", "wave", "shockwave", "ripple", "grid", "background", "ui", "pattern"],
  icon: "dot-pulse",
  metadata: NEEDS_COMP,
  defaultParams: (ui) => ui.toolParams["dotPulse"] ?? {},
  probe: () => ({ op: "kvfx.op.layer.measure", args: { target: "selection" } }),
  steps: (ctx, measurement) => {
    const reply = decodeMeasurement(measurement);
    const measured = bounds(measurement);
    const target = reply.selectedIds.map((id) => measured.get(id)).find((b) => b !== undefined);
    const placement = stringParam(ctx, "placement", target === undefined ? "comp" : "behind");
    const w = reply.compWidth || ctx.snapshot.comp?.width || 1920;
    const h = reply.compHeight || ctx.snapshot.comp?.height || 1080;
    const region =
      target !== undefined && placement !== "comp"
        ? placement === "inside"
          ? target.bounds
          : {
              left: target.bounds.left - target.bounds.width * 0.15,
              top: target.bounds.top - target.bounds.height * 0.15,
              width: target.bounds.width * 1.3,
              height: target.bounds.height * 1.3,
            }
        : { left: 0, top: 0, width: w, height: h };
    const spacing = numberParam(ctx, "spacing", 28, 4, 400);
    const size = numberParam(ctx, "size", 9, 1, 200);
    const color = accentParam(ctx);
    const dots = dotGrid(region.width, region.height, spacing);
    const c = PULSE_CONTROLS;
    const slider = (name: string, value: number): PlanStep => ({
      op: "kvfx.op.effect.add",
      args: { id: ref("dots"), matchName: "ADBE Slider Control", name, params: [{ path: [1], value }] },
    });

    const steps: PlanStep[] = [
      { op: "kvfx.op.layer.create", args: { kind: "shape", name: "KVFX Dot Pulse" }, bind: "dots" },
      slider(c.speed, numberParam(ctx, "speed", 0.9, 0.01, 20)),
      slider(c.width, numberParam(ctx, "width", 18, 1, 100)),
      slider(c.every, numberParam(ctx, "every", 2.2, 0.1, 60)),
      slider(c.idle, numberParam(ctx, "idle", 30, 0, 100)),
      {
        op: "kvfx.op.shape.build",
        args: {
          id: ref("dots"),
          relative: true,
          groups: dots.map((dot, i) => ({
            name: `Dot ${String(i + 1)}`,
            items: [{ type: "ellipse", name: "Dot", size: [size, size] }, { type: "fill", name: "Fill", color: [...color] }],
            transform: { position: [dot.x, dot.y] },
            expressions: [{ path: ["ADBE Vector Transform Group", "ADBE Vector Scale"], expression: dotPulseExpression(dot.d) }],
          })),
        },
      },
      { op: "kvfx.op.prop.set", args: { id: ref("dots"), path: [TRANSFORM, "ADBE Anchor Point"], value: [0, 0, 0] } },
      {
        op: "kvfx.op.prop.set",
        args: { id: ref("dots"), path: [TRANSFORM, "ADBE Position"], value: [region.left + region.width / 2, region.top + region.height / 2, 0] },
      },
    ];
    if (target === undefined || placement === "comp") return steps;
    if (placement === "inside") {
      steps.push({ op: "kvfx.op.layer.place", args: { ids: [ref("dots")], above: target.id } }, ...matteWithCopy("dots", target.id, "matte", "KVFX Dot Pulse Matte"));
    } else {
      steps.push({ op: "kvfx.op.layer.place", args: { ids: [ref("dots")], below: target.id } });
    }
    return steps;
  },
  budgetMs: 20_000,
});

// ---------------------------------------------------------------------------
// Glass
// ---------------------------------------------------------------------------

export const glassPanel = measuredCommand({
  id: "kvfx.rig.glass",
  name: "Frosted Glass",
  description:
    "Blur and frost whatever is behind the selected layer, within its shape — a glass card — leaving the layer itself as it is unless you set its opacity",
  category: CommandCategory.Rig,
  keywords: ["glass", "frosted", "glassmorphism", "blur", "backdrop blur", "card", "ui", "panel", "acrylic"],
  icon: "glass",
  metadata: NEEDS_LAYER,
  defaultParams: (ui) => ui.toolParams["glass"] ?? {},
  probe: () => SNAPSHOT_PROBE,
  steps: (ctx, measurement) => {
    const target = probedLayers(measurement).find((l) => l.isAV && l.kind !== "null" && !l.adjustment);
    if (target === undefined) return [];
    const frost = hexToRgb(stringParam(ctx, "tint", "#ffffff")) ?? WHITE;
    const steps: PlanStep[] = [
      { op: "kvfx.op.layer.create", args: { kind: "adjustment", name: "KVFX Glass" }, bind: "glass" },
      {
        op: "kvfx.op.effect.add",
        args: {
          id: ref("glass"),
          matchName: "ADBE Fast Box Blur",
          name: "KVFX Glass Blur",
          params: [
            { path: [{ valueType: "oneD", nth: 1 }], value: numberParam(ctx, "blur", 28, 0, 500) },
            { path: [{ valueType: "oneD", nth: 2 }], value: 3 },
          ],
        },
      },
      {
        op: "kvfx.op.effect.add",
        args: {
          id: ref("glass"),
          matchName: "ADBE Fill",
          name: "KVFX Glass Frost",
          params: [
            { path: [{ valueType: "color", nth: 1 }], value: [frost[0], frost[1], frost[2], 1] },
            { path: [{ valueType: "oneD", nth: 6 }], value: numberParam(ctx, "frost", 12, 0, 100) / 100 },
          ],
        },
      },
      { op: "kvfx.op.layer.place", args: { ids: [ref("glass")], below: target.id } },
      ...matteWithCopy("glass", target.id, "matte", "KVFX Glass Matte"),
    ];
    const opacity = ctx.params?.["cardOpacity"];
    if (typeof opacity === "number" && Number.isFinite(opacity)) {
      steps.push({
        op: "kvfx.op.prop.set",
        args: { id: target.id, path: [TRANSFORM, "ADBE Opacity"], value: Math.max(0, Math.min(100, opacity)) },
      });
    }
    return steps;
  },
});

// ---------------------------------------------------------------------------
// Wipe
// ---------------------------------------------------------------------------

/** Linear Wipe angles. At 90° After Effects erases from the left as completion rises. */
const WIPE_ANGLES: Readonly<Record<string, number>> = { right: 270, left: 90, down: 0, up: 180 };

export const wipeReveal = measuredCommand({
  id: "kvfx.rig.wipe",
  name: "Wipe Reveal",
  description: "Wipe the selected layers in — or out — from the playhead, in a direction with a soft edge, one after another",
  category: CommandCategory.Rig,
  keywords: ["wipe", "reveal", "transition", "linear wipe", "mask", "swipe", "in", "out", "edge"],
  icon: "wipe",
  metadata: NEEDS_LAYER,
  defaultParams: (ui) => ({ bezier: [...ui.ease], ...(ui.toolParams["wipe"] ?? {}) }),
  probe: () => SNAPSHOT_PROBE,
  steps: (ctx, measurement) => {
    const layers = probedLayers(measurement).filter((l) => l.isAV && !l.adjustment);
    if (layers.length === 0) return [];
    const frame = ctx.snapshot.comp?.frameDuration ?? FALLBACK_FRAME;
    const duration = Math.max(frame, numberParam(ctx, "duration", 20, 1, 6000) * frame);
    const stagger = numberParam(ctx, "stagger", 4, 0, 6000) * frame;
    const out = stringParam(ctx, "mode", "in") === "out";
    const angle = WIPE_ANGLES[stringParam(ctx, "direction", "right")] ?? 270;
    const ease = bezierParam(ctx, "bezier", DEFAULT_BEZIER);
    const ids = layers.map((l) => l.id);
    const steps: PlanStep[] = [
      {
        op: "kvfx.op.effect.add",
        args: {
          ids,
          matchName: "ADBE Linear Wipe",
          name: "KVFX Wipe",
          params: [
            { path: [{ valueType: "oneD", nth: 2 }], value: angle },
            { path: [{ valueType: "oneD", nth: 3 }], value: numberParam(ctx, "feather", 60, 0, 5000) },
          ],
        },
      },
    ];
    layers.forEach((layer, i) => {
      const start = i * stagger;
      steps.push({
        op: "kvfx.op.prop.keyframes",
        args: {
          id: layer.id,
          path: ["ADBE Effect Parade", "KVFX Wipe", 1],
          relative: true,
          bezier: [...ease],
          keys: [
            { time: start, value: out ? 0 : 100 },
            { time: start + duration, value: out ? 100 : 0 },
          ],
        },
      });
    });
    return steps;
  },
});

// ---------------------------------------------------------------------------
// Code glyphs
// ---------------------------------------------------------------------------

function decodeOptions(ctx: CommandContext, accent: Rgb): TextMotionOptions | undefined {
  const preset = textMotionPreset("decode");
  if (preset === undefined) return undefined;
  const frame = ctx.snapshot.comp?.frameDuration ?? FALLBACK_FRAME;
  return {
    preset,
    mode: "in",
    unit: "characters",
    order: "random",
    seed: 3,
    ease: "linear",
    bezier: DEFAULT_BEZIER,
    stagger: 1.5 * frame,
    duration: 14 * frame,
    overshoot: 0,
    engine: "live",
    accent,
  };
}

export const codeGlyphs = simpleCommand({
  id: "kvfx.rig.codeglyphs",
  name: "Code Glyphs Title",
  description: "A decoding headline over scrolling code and a flickering field of glyphs, in your colour",
  category: CommandCategory.Rig,
  keywords: ["code", "glyphs", "matrix", "decode", "hacker", "terminal", "tech", "developer", "title", "scramble"],
  icon: "code",
  metadata: NEEDS_COMP,
  defaultParams: (ui) => ui.toolParams["codeGlyphs"] ?? {},
  steps: (ctx) => {
    const comp = ctx.snapshot.comp;
    const w = comp?.width ?? 1920;
    const h = comp?.height ?? 1080;
    const accent = accentParam(ctx);
    const headline = stringParam(ctx, "text", "Ship faster").trim() || "Ship faster";
    const size = Math.round(Math.min(w, h) * 0.09);
    const options = decodeOptions(ctx, accent);
    const steps: PlanStep[] = [];

    if (boolParam(ctx, "glyphs", true)) {
      const glyphSize = Math.round(size * 0.32);
      const columns = Math.max(8, Math.round(w / (glyphSize * 0.62)));
      const rows = Math.max(4, Math.round(h / (glyphSize * 1.25)));
      steps.push(
        { op: "kvfx.op.layer.create", args: { kind: "text", text: "0", name: "KVFX Glyph Field" }, bind: "glyphs" },
        { op: "kvfx.op.text.setStyle", args: { id: ref("glyphs"), fontSize: glyphSize, fillColor: [...accent], justification: "center", tracking: 200 } },
        {
          op: "kvfx.op.prop.expression",
          args: { id: ref("glyphs"), path: ["ADBE Text Properties", "ADBE Text Document"], expression: glyphFieldExpression(columns, rows, 10) },
        },
        { op: "kvfx.op.prop.set", args: { id: ref("glyphs"), path: [TRANSFORM, "ADBE Position"], value: [w / 2, glyphSize, 0] } },
        { op: "kvfx.op.prop.set", args: { id: ref("glyphs"), path: [TRANSFORM, "ADBE Opacity"], value: 14 } },
      );
    }
    if (boolParam(ctx, "lines", true)) {
      const lineSize = Math.round(size * 0.26);
      steps.push(
        { op: "kvfx.op.layer.create", args: { kind: "text", text: CODE_LINES[0] ?? "code", name: "KVFX Code Lines" }, bind: "lines" },
        { op: "kvfx.op.text.setStyle", args: { id: ref("lines"), fontSize: lineSize, fillColor: [...accent], justification: "left" } },
        {
          op: "kvfx.op.prop.expression",
          args: {
            id: ref("lines"),
            path: ["ADBE Text Properties", "ADBE Text Document"],
            expression: codeLinesExpression(numberParam(ctx, "rows", 6, 1, 30), numberParam(ctx, "speed", 1.6, 0.05, 30)),
            relative: true,
          },
        },
        { op: "kvfx.op.prop.set", args: { id: ref("lines"), path: [TRANSFORM, "ADBE Position"], value: [w * 0.08, h * 0.62, 0] } },
        { op: "kvfx.op.prop.set", args: { id: ref("lines"), path: [TRANSFORM, "ADBE Opacity"], value: 45 } },
      );
    }
    steps.push(
      { op: "kvfx.op.layer.create", args: { kind: "text", text: headline.slice(0, 120), name: "KVFX Code Headline" }, bind: "headline" },
      { op: "kvfx.op.text.setStyle", args: { id: ref("headline"), fontSize: size, fillColor: [...WHITE], justification: "center" } },
      { op: "kvfx.op.prop.set", args: { id: ref("headline"), path: [TRANSFORM, "ADBE Position"], value: [w / 2, h * 0.47, 0] } },
    );
    if (options !== undefined) {
      steps.push({ op: "kvfx.op.text.addAnimator", args: { id: ref("headline"), relative: true, animators: liveAnimators(options) } });
    }
    if (boolParam(ctx, "flicker", true)) {
      steps.push({ op: "kvfx.op.prop.expression", args: { id: ref("headline"), path: [TRANSFORM, "ADBE Opacity"], expression: FLICKER_EXPRESSION } });
    }
    return steps;
  },
});

// ---------------------------------------------------------------------------
// Input bar
// ---------------------------------------------------------------------------

/** A send arrow, pointing up, centred on the origin, for a 40 px button. */
const SEND_ARROW: readonly (readonly [number, number])[] = [
  [0, -11],
  [9, -1],
  [3.2, -1],
  [3.2, 10],
  [-3.2, 10],
  [-3.2, -1],
  [-9, -1],
];

export const inputBar = simpleCommand({
  id: "kvfx.rig.inputbar",
  name: "Input Bar",
  description: "A search or message bar that types your text with a caret, then presses its send button — on a control null you can move",
  category: CommandCategory.Rig,
  keywords: ["input", "search", "bar", "field", "typing", "prompt", "message", "chat", "send", "ui", "saas"],
  icon: "input-bar",
  metadata: NEEDS_COMP,
  defaultParams: (ui) => ui.toolParams["inputBar"] ?? {},
  steps: (ctx) => {
    const comp = ctx.snapshot.comp;
    const w = comp?.width ?? 1920;
    const h = comp?.height ?? 1080;
    const accent = accentParam(ctx);
    const dark = stringParam(ctx, "theme", "dark") !== "light";
    const width = numberParam(ctx, "width", Math.round(w * 0.5), 120, 20000);
    const height = Math.max(32, Math.round(width * 0.09));
    const text = stringParam(ctx, "text", "Make a launch video for my app").slice(0, 200);
    const placeholder = stringParam(ctx, "placeholder", "Search or type a message…").slice(0, 120);
    const perChar = 1 / numberParam(ctx, "speed", 18, 1, 200);
    const fontSize = Math.round(height * 0.36);
    const cx = w / 2;
    const cy = h / 2;
    const left = cx - width / 2 + height * 0.45;
    const baseline = cy + fontSize * 0.35;
    const button = height * 0.72;
    const typed = text.length * perChar;
    const typingPreset = textMotionPreset("typing");
    if (typingPreset === undefined) return [];
    const typing = typingExpression({
      preset: typingPreset,
      mode: "in",
      unit: "characters",
      order: "forward",
      seed: 1,
      ease: "linear",
      bezier: DEFAULT_BEZIER,
      stagger: perChar,
      duration: perChar,
      overshoot: 0,
      engine: "live",
      accent,
    });
    const textColor = dark ? WHITE : DARK;
    const muted: Rgb = dark ? [0.55, 0.56, 0.6] : [0.5, 0.5, 0.54];
    const box: Rgb = dark ? [0.09, 0.09, 0.11] : WHITE;
    const edge: Rgb = dark ? [0.22, 0.22, 0.26] : [0.85, 0.85, 0.88];
    const at = (id: string, x: number, y: number): PlanStep => ({
      op: "kvfx.op.prop.set",
      args: { id: ref(id), path: [TRANSFORM, "ADBE Position"], value: [x, y, 0] },
    });
    const anchorZero = (id: string): PlanStep => ({
      op: "kvfx.op.prop.set",
      args: { id: ref(id), path: [TRANSFORM, "ADBE Anchor Point"], value: [0, 0, 0] },
    });

    const steps: PlanStep[] = [
      { op: "kvfx.op.layer.create", args: { kind: "null", name: "KVFX Input Bar" }, bind: "bar" },
      at("bar", cx, cy),
      { op: "kvfx.op.layer.create", args: { kind: "shape", name: "KVFX Input Box" }, bind: "box" },
      {
        op: "kvfx.op.shape.build",
        args: {
          id: ref("box"),
          groups: [
            {
              name: "Box",
              items: [
                { type: "rect", name: "Box", size: [width, height], roundness: height / 2 },
                { type: "stroke", name: "Edge", color: [...edge], width: 2 },
                { type: "fill", name: "Fill", color: [...box] },
              ],
            },
          ],
        },
      },
      anchorZero("box"),
      at("box", cx, cy),
      {
        op: "kvfx.op.effect.add",
        args: {
          id: ref("box"),
          matchName: "ADBE Drop Shadow",
          name: "KVFX Input Shadow",
          params: [
            { path: [{ valueType: "oneD", nth: 1 }], value: 70 },
            { path: [{ valueType: "oneD", nth: 3 }], value: height * 0.18 },
            { path: [{ valueType: "oneD", nth: 4 }], value: height * 0.6 },
          ],
        },
      },
      { op: "kvfx.op.layer.create", args: { kind: "text", text: placeholder || " ", name: "KVFX Input Placeholder" }, bind: "placeholder" },
      { op: "kvfx.op.text.setStyle", args: { id: ref("placeholder"), fontSize, fillColor: [...muted], justification: "left" } },
      at("placeholder", left, baseline),
      {
        op: "kvfx.op.prop.expression",
        args: { id: ref("placeholder"), path: [TRANSFORM, "ADBE Opacity"], expression: PLACEHOLDER_EXPRESSION, relative: true },
      },
      { op: "kvfx.op.layer.create", args: { kind: "text", text: text || " ", name: "KVFX Input Text" }, bind: "typed" },
      { op: "kvfx.op.text.setStyle", args: { id: ref("typed"), fontSize, fillColor: [...textColor], justification: "left" } },
      at("typed", left, baseline),
      {
        op: "kvfx.op.prop.expression",
        args: { id: ref("typed"), path: ["ADBE Text Properties", "ADBE Text Document"], expression: typing, relative: true },
      },
      { op: "kvfx.op.layer.create", args: { kind: "shape", name: "KVFX Input Send" }, bind: "send" },
      {
        op: "kvfx.op.shape.build",
        args: {
          id: ref("send"),
          groups: [
            {
              name: "Arrow",
              items: [
                { type: "path", name: "Arrow", vertices: SEND_ARROW.map(([x, y]) => [(x * button) / 40, (y * button) / 40]), closed: true },
                { type: "fill", name: "Fill", color: [...(dark ? DARK : WHITE)] },
              ],
            },
            { name: "Button", items: [{ type: "ellipse", name: "Button", size: [button, button] }, { type: "fill", name: "Fill", color: [...accent] }] },
          ],
        },
      },
      anchorZero("send"),
      at("send", cx + width / 2 - height / 2, cy),
      {
        op: "kvfx.op.prop.expression",
        args: { id: ref("send"), path: [TRANSFORM, "ADBE Scale"], expression: buttonPressExpression(typed + 0.25, 14), relative: true },
      },
      { op: "kvfx.op.layer.set", args: { ids: [ref("box"), ref("placeholder"), ref("typed"), ref("send")], parent: ref("bar") } },
    ];
    return steps;
  },
});

export const uiKitCommands: readonly Command[] = [hoverLift, dotPulse, glassPanel, wipeReveal, codeGlyphs, inputBar];

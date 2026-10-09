import type { Bezier } from "../animation/easing.js";
import type { Rgb } from "../color/index.js";
import type { PlanStep } from "../commands/types.js";
import { ref } from "../commands/types.js";
import { COUNTER_EFFECT_NAME, counterExpression, normalizeCounter } from "../expressions/counter.js";
import {
  REVEAL_BLUR_EFFECT,
  REVEAL_EFFECT,
  type RevealStyle,
  growExpression,
  revealExpressions,
  trimDrawExpression,
  typingDotExpression,
} from "../expressions/ui-motion.js";
import type { TextEase } from "../text/motion.js";
import type { JsonObject, JsonValue } from "../types/json.js";
import { type LayoutElement, type LayoutReveal, type LayoutTheme, resolveColor } from "./elements.js";
import type { LayoutTemplate } from "./templates.js";

/**
 * Turns a layout template into one plan: a layer per part, scaled to fit
 * the comp, revealed in order, all parented to one control null.
 */

/* eslint-disable no-magic-numbers -- proportions of shadows, strokes and timing */

const TRANSFORM = "ADBE Transform Group";
const ROOT = "ADBE Root Vectors Group";
const CONTENTS = "ADBE Vectors Group";
/** How much of the comp a template may fill. */
const FILL = 0.86;

export interface LayoutStyle {
  readonly theme: LayoutTheme;
  readonly accent: Rgb;
  /** Multiplies every corner radius: 0 square, 1 as designed. */
  readonly roundness: number;
  readonly shadows: boolean;
}

export interface LayoutMotion {
  /** "auto" uses each part's own reveal. */
  readonly reveal: "auto" | "none" | RevealStyle;
  /** Seconds between one step of the order and the next. */
  readonly stagger: number;
  /** Seconds each part takes to arrive. */
  readonly duration: number;
  readonly ease: Exclude<TextEase, "preset">;
  readonly overshoot: number;
  readonly bezier: Bezier;
}

export interface LayoutTarget {
  readonly width: number;
  readonly height: number;
}

function rgb(color: Rgb): number[] {
  return [color[0], color[1], color[2]];
}

export function layoutScale(template: LayoutTemplate, target: LayoutTarget): number {
  const [w, h] = template.size;
  return Math.min((target.width * FILL) / w, (target.height * FILL) / h);
}

function revealFor(element: LayoutElement, motion: LayoutMotion): LayoutReveal {
  const own = element.reveal ?? "rise";
  if (motion.reveal === "auto") return own;
  if (motion.reveal === "none") return "none";
  // Bars still grow and lines still draw: those are what they are.
  return own === "growY" || own === "growX" || own === "draw" ? own : motion.reveal;
}

export function layoutSteps(
  template: LayoutTemplate,
  content: (key: string) => string,
  style: LayoutStyle,
  motion: LayoutMotion,
  target: LayoutTarget,
): PlanStep[] {
  const k = layoutScale(template, target);
  const cx = target.width / 2;
  const cy = target.height / 2;
  const at = (x: number, y: number): JsonValue => [cx + x * k, cy + y * k, 0];
  const color = (role: Parameters<typeof resolveColor>[0]): number[] => rgb(resolveColor(role, style.theme, style.accent));
  const elements = template.build(content);
  const steps: PlanStep[] = [];
  const binds: JsonValue[] = [];

  elements.forEach((element, index) => {
    const bind = `part${String(index)}`;
    const id = ref(bind);
    const name = `KVFX ${template.name} · ${element.name}`;
    const shape = (groups: JsonObject[], position: JsonValue, relative = false): void => {
      steps.push(
        { op: "kvfx.op.layer.create", args: { kind: "shape", name }, bind },
        { op: "kvfx.op.shape.build", args: { id, groups, ...(relative ? { relative: true } : {}) } },
        { op: "kvfx.op.prop.set", args: { id, path: [TRANSFORM, "ADBE Anchor Point"], value: [0, 0, 0] } },
        { op: "kvfx.op.prop.set", args: { id, path: [TRANSFORM, "ADBE Position"], value: position } },
      );
    };

    switch (element.kind) {
      case "card": {
        const items: JsonObject[] = [{ type: "rect", name: "Box", size: [element.w * k, element.h * k], roundness: element.radius * k * style.roundness }];
        if (element.stroke !== undefined) items.push({ type: "stroke", name: "Edge", color: color(element.stroke), width: Math.max(1, 2 * k) });
        items.push({ type: "fill", name: "Fill", color: color(element.fill) });
        shape([{ name: element.name, items }], at(element.x, element.y));
        if (element.shadow === true && style.shadows) {
          steps.push({
            op: "kvfx.op.effect.add",
            args: {
              id,
              matchName: "ADBE Drop Shadow",
              name: "KVFX Shadow",
              params: [
                { path: [{ valueType: "oneD", nth: 1 }], value: style.theme.id === "dark" ? 110 : 45 },
                { path: [{ valueType: "oneD", nth: 2 }], value: 180 },
                { path: [{ valueType: "oneD", nth: 3 }], value: 18 * k },
                { path: [{ valueType: "oneD", nth: 4 }], value: 60 * k },
              ],
            },
          });
        }
        break;
      }
      case "circle":
        shape([{ name: element.name, items: [{ type: "ellipse", name: "Dot", size: [element.d * k, element.d * k] }, { type: "fill", name: "Fill", color: color(element.fill) }] }], at(element.x, element.y));
        break;
      case "bar":
        shape(
          [
            {
              name: element.name,
              items: [
                { type: "rect", name: "Bar", size: [element.w * k, element.h * k], position: [0, (-element.h * k) / 2], roundness: Math.min(element.radius, element.w / 2) * k * style.roundness },
                { type: "fill", name: "Fill", color: color(element.fill) },
              ],
            },
          ],
          at(element.x, element.y),
        );
        break;
      case "ring":
        shape(
          [
            {
              name: "Ring",
              items: [
                { type: "ellipse", name: "Ring", size: [element.d * k, element.d * k] },
                { type: "trim", name: "Trim", end: element.progress * 100 },
                { type: "stroke", name: "Edge", color: color(element.color), width: element.width * k },
              ],
              transform: { rotation: -90 },
            },
            {
              name: "Track",
              items: [
                { type: "ellipse", name: "Track", size: [element.d * k, element.d * k] },
                { type: "stroke", name: "Edge", color: color(element.track), width: element.width * k },
              ],
            },
          ],
          at(element.x, element.y),
        );
        break;
      case "line": {
        const vertices = element.points.map(([x, y]) => [x * k, y * k]);
        shape(
          [
            {
              name: element.name,
              items: [
                { type: "path", name: "Line", vertices, closed: false },
                { type: "trim", name: "Trim", end: 100 },
                { type: "stroke", name: "Edge", color: color(element.color), width: element.width * k },
              ],
            },
          ],
          at(0, 0),
        );
        break;
      }
      case "dots":
        shape(
          [-1.6, 0, 1.6].map((offset, i) => ({
            name: `Dot ${String(i + 1)}`,
            items: [{ type: "ellipse", name: "Dot", size: [element.d * k, element.d * k] }, { type: "fill", name: "Fill", color: color(element.color) }],
            transform: { position: [offset * element.d * k, 0] },
            expressions: [{ path: ["ADBE Vector Transform Group", "ADBE Vector Position"], expression: typingDotExpression(i, element.d * k * 0.5) }],
          })),
          at(element.x, element.y),
        );
        break;
      case "text":
        steps.push(
          { op: "kvfx.op.layer.create", args: { kind: "text", text: element.text.length > 0 ? element.text : " ", name }, bind },
          { op: "kvfx.op.text.setStyle", args: { id, fontSize: Math.max(4, element.size * k), fillColor: color(element.color), justification: element.align } },
          { op: "kvfx.op.prop.set", args: { id, path: [TRANSFORM, "ADBE Position"], value: at(element.x, element.y) } },
        );
        if (element.counter !== undefined) {
          const options = normalizeCounter({ ...element.counter, separator: ",", decimalMark: ".", duration: Math.max(0.6, motion.duration * 2.5) });
          const start = element.order * motion.stagger;
          steps.push(
            { op: "kvfx.op.effect.add", args: { id, matchName: "ADBE Slider Control", name: COUNTER_EFFECT_NAME } },
            {
              op: "kvfx.op.prop.keyframes",
              args: {
                id,
                path: ["ADBE Effect Parade", COUNTER_EFFECT_NAME, 1],
                relative: true,
                bezier: [0.16, 1, 0.3, 1],
                keys: [
                  { time: start, value: 0 },
                  { time: start + options.duration, value: 100 },
                ],
              },
            },
            { op: "kvfx.op.prop.expression", args: { id, path: ["ADBE Text Properties", "ADBE Text Document"], expression: counterExpression(options) } },
          );
        }
        break;
    }
    if (element.rotation !== undefined && element.rotation !== 0) {
      steps.push({ op: "kvfx.op.prop.set", args: { id, path: [TRANSFORM, "ADBE Rotate Z"], value: element.rotation } });
    }

    const reveal = revealFor(element, motion);
    if (reveal !== "none") {
      const start = element.order * motion.stagger;
      steps.push(
        { op: "kvfx.op.effect.add", args: { id, matchName: "ADBE Slider Control", name: REVEAL_EFFECT, params: [{ path: [1], value: 100 }] } },
        {
          op: "kvfx.op.prop.keyframes",
          args: { id, path: ["ADBE Effect Parade", REVEAL_EFFECT, 1], relative: true, keys: [{ time: start, value: 0 }, { time: start + motion.duration, value: 100 }] },
        },
      );
      const { ease, overshoot, bezier } = motion;
      if (reveal === "growY" || reveal === "growX") {
        steps.push({ op: "kvfx.op.prop.expression", args: { id, path: [TRANSFORM, "ADBE Scale"], expression: growExpression(reveal === "growY" ? "y" : "x", ease, overshoot, bezier) } });
      } else if (reveal === "draw") {
        const end = element.kind === "ring" ? element.progress * 100 : 100;
        steps.push({
          op: "kvfx.op.prop.expression",
          args: { id, path: [ROOT, 1, CONTENTS, "Trim", "ADBE Vector Trim End"], expression: trimDrawExpression(end, ease, overshoot, bezier) },
        });
      } else {
        const expressions = revealExpressions(reveal, 50 * k, ease, overshoot, bezier);
        const channels: [string, string | undefined][] = [
          ["ADBE Position", expressions.position],
          ["ADBE Scale", expressions.scale],
          ["ADBE Opacity", expressions.opacity],
        ];
        for (const [matchName, expression] of channels) {
          if (expression !== undefined) steps.push({ op: "kvfx.op.prop.expression", args: { id, path: [TRANSFORM, matchName], expression } });
        }
        if (expressions.blur !== undefined) {
          steps.push({
            op: "kvfx.op.effect.add",
            args: { id, matchName: "ADBE Gaussian Blur 2", name: REVEAL_BLUR_EFFECT, params: [{ path: [{ valueType: "oneD", nth: 1 }], expression: expressions.blur }] },
          });
        }
      }
    }
    binds.push(id);
  });

  steps.push(
    { op: "kvfx.op.layer.create", args: { kind: "null", name: `KVFX Layout · ${template.name}` }, bind: "hub" },
    { op: "kvfx.op.prop.set", args: { id: ref("hub"), path: [TRANSFORM, "ADBE Position"], value: [cx, cy, 0] } },
    { op: "kvfx.op.layer.set", args: { ids: binds, parent: ref("hub") } },
  );
  return steps;
}

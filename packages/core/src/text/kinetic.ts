import { DEFAULT_BEZIER } from "../animation/easing.js";
import type { Rgb } from "../color/index.js";
import type { PlanStep } from "../commands/types.js";
import { ref } from "../commands/types.js";
import { driftPointExpression } from "../expressions/ui-motion.js";
import type { JsonObject, JsonValue } from "../types/json.js";
import { type TextMotionOptions, liveAnimators, textMotionPreset, typingExpression } from "./motion.js";

/**
 * Kinetic titles: a phrase set as big type, a line or a word at a time.
 *
 * Words between asterisks — "Make *videos* that *pop*" — are picked out in
 * the accent colours. Each line is one live text layer, so After Effects
 * still sets the type; the motion comes from the same text animators as the
 * Text tab, offset line by line.
 */

/* eslint-disable no-magic-numbers -- type proportions and timing are the design */

export type KineticStyle = "stack" | "punch" | "slide" | "pop" | "zoom" | "bounce" | "type" | "highlight";

export const KINETIC_STYLES: readonly { readonly id: KineticStyle; readonly label: string; readonly title: string }[] = [
  { id: "stack", label: "Stack", title: "Lines rise in word by word, one under another" },
  { id: "punch", label: "Punch", title: "One word at a time, full frame, with a punch-in" },
  { id: "slide", label: "Slide", title: "Lines slide in from alternate sides" },
  { id: "pop", label: "Pop", title: "Words pop up with a little overshoot" },
  { id: "zoom", label: "Zoom", title: "Words fly in from huge and blurred" },
  { id: "bounce", label: "Bounce", title: "Words drop in and bounce" },
  { id: "type", label: "Type", title: "Typed out line by line with a caret" },
  { id: "highlight", label: "Highlight", title: "Fades in, then a colour sweep runs through it" },
];

export type KineticAspect = "comp" | "16:9" | "9:16" | "1:1" | "4:5";

export const KINETIC_ASPECTS: readonly { readonly id: KineticAspect; readonly label: string; readonly size?: readonly [number, number] }[] = [
  { id: "comp", label: "This comp" },
  { id: "16:9", label: "16:9", size: [1920, 1080] },
  { id: "9:16", label: "9:16", size: [1080, 1920] },
  { id: "1:1", label: "1:1", size: [1080, 1080] },
  { id: "4:5", label: "4:5", size: [1080, 1350] },
];

export type KineticBackground = "none" | "solid" | "drift";

export interface KineticOptions {
  readonly text: string;
  readonly style: KineticStyle;
  /** Main type colour, then the accents starred words cycle through. */
  readonly color: Rgb;
  readonly accents: readonly Rgb[];
  readonly background: KineticBackground;
  readonly backgroundColor: Rgb;
  /** 1 is the designed pace; 2 twice as fast. */
  readonly speed: number;
  readonly width: number;
  readonly height: number;
}

export interface KineticWord {
  readonly text: string;
  readonly accent: boolean;
}

/** Splits a phrase into words, noting the *starred* ones. */
export function kineticWords(text: string): KineticWord[] {
  return text
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 40)
    .map((raw) => {
      const starred = /^\*.+\*[.,!?;:]*$/.test(raw) || /^\*[^*]+\*$/.test(raw);
      return { text: starred ? raw.replace(/\*/g, "") : raw.replace(/\*/g, ""), accent: starred };
    });
}

/** Breaks words into balanced lines of at most `limit` characters. */
export function kineticLines(words: readonly KineticWord[], limit: number): KineticWord[][] {
  const lines: KineticWord[][] = [];
  let line: KineticWord[] = [];
  let length = 0;
  for (const word of words) {
    const add = (line.length > 0 ? 1 : 0) + word.text.length;
    if (line.length > 0 && length + add > limit) {
      lines.push(line);
      line = [];
      length = 0;
    }
    line.push(word);
    length += (line.length > 1 ? 1 : 0) + word.text.length;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** Seconds the whole title takes to arrive, for sizing a new comp. */
export function kineticDuration(options: KineticOptions): number {
  const words = kineticWords(options.text);
  const pace = Math.max(0.1, options.speed);
  if (options.style === "punch") return (words.length * 0.5) / pace + 0.6;
  return (words.length * 0.12 + 1.4) / pace;
}

function rgb(color: Rgb): number[] {
  return [color[0], color[1], color[2]];
}

/** Fill Color animators for starred words: one per word, by word index. */
function accentAnimators(line: readonly KineticWord[], accents: readonly Rgb[], start: number): JsonObject[] {
  const out: JsonObject[] = [];
  let n = start;
  line.forEach((word, i) => {
    if (!word.accent) return;
    const accent = accents[n % Math.max(1, accents.length)] ?? [1, 0.56, 0.25];
    n += 1;
    out.push({
      name: `KVFX Accent ${word.text.slice(0, 20)}`,
      properties: [{ matchName: "ADBE Text Fill Color", value: [...rgb(accent), 1] }],
      selectors: [{ units: "index", basedOn: "words", start: i, end: i + 1 }],
    });
  });
  return out;
}

function motionFor(style: KineticStyle, index: number): { preset: string; unit: TextMotionOptions["unit"]; ease: TextMotionOptions["ease"] } {
  switch (style) {
    case "slide":
      return { preset: index % 2 === 0 ? "whip" : "slide-left", unit: "lines", ease: "expo" };
    case "pop":
      return { preset: "pop-up", unit: "words", ease: "back" };
    case "zoom":
      return { preset: "zoom-blur", unit: "words", ease: "expo" };
    case "bounce":
      return { preset: "bounce-drop", unit: "words", ease: "bounce" };
    case "highlight":
      return { preset: "fade", unit: "words", ease: "smooth" };
    default:
      return { preset: "rise", unit: "words", ease: "expo" };
  }
}

const TRANSFORM = "ADBE Transform Group";

export function kineticSteps(options: KineticOptions): PlanStep[] {
  const words = kineticWords(options.text);
  if (words.length === 0) return [];
  const { width: w, height: h } = options;
  const pace = Math.max(0.1, options.speed);
  const steps: PlanStep[] = [];

  if (options.background !== "none") {
    steps.push({ op: "kvfx.op.layer.create", args: { kind: "solid", name: "KVFX Kinetic Background", color: rgb(options.backgroundColor) }, bind: "bg" });
    if (options.background === "drift") {
      const colors = [...options.accents.slice(0, 2), options.backgroundColor, options.backgroundColor];
      const params: JsonObject[] = [];
      colors.forEach((color, i) => {
        params.push({ path: [{ valueType: "twoDSpatial", nth: i + 1 }], expression: driftPointExpression(i) });
        params.push({ path: [{ valueType: "color", nth: i + 1 }], value: [...rgb(color), 1] });
      });
      steps.push(
        { op: "kvfx.op.effect.add", args: { id: ref("bg"), matchName: "ADBE Slider Control", name: "Speed", params: [{ path: [1], value: 0.6 }] } },
        { op: "kvfx.op.effect.add", args: { id: ref("bg"), matchName: "ADBE 4ColorGradient", name: "KVFX Drift", params } },
      );
    }
    steps.push({ op: "kvfx.op.layer.place", args: { ids: [ref("bg")], below: "bottom" } });
  }

  if (options.style === "punch") {
    const longest = Math.max(...words.map((word) => word.text.length));
    const size = Math.round(Math.max(24, Math.min((w * 0.84) / (longest * 0.58), h * 0.32)));
    const hold = 0.5 / pace;
    let accentIndex = 0;
    words.forEach((word, i) => {
      const bind = `word${String(i)}`;
      const color = word.accent ? (options.accents[accentIndex++ % Math.max(1, options.accents.length)] ?? options.color) : options.color;
      const a = i * hold;
      steps.push(
        { op: "kvfx.op.layer.create", args: { kind: "text", text: word.text, name: `KVFX Kinetic · ${word.text.slice(0, 24)}` }, bind },
        { op: "kvfx.op.text.setStyle", args: { id: ref(bind), fontSize: size, fillColor: rgb(color), justification: "center" } },
        { op: "kvfx.op.prop.set", args: { id: ref(bind), path: [TRANSFORM, "ADBE Position"], value: [w / 2, h / 2 + size * 0.35, 0] } },
        {
          op: "kvfx.op.prop.expression",
          args: {
            id: ref(bind),
            path: [TRANSFORM, "ADBE Opacity"],
            relative: true,
            expression: [
              "// KVFX Tools — kinetic punch",
              `var t = time - (__KVFX_NOW__ + ${String(Math.round(a * 1e4) / 1e4)});`,
              `t >= 0 && (t < ${String(Math.round(hold * 1e4) / 1e4)} || ${String(i === words.length - 1)}) ? value : 0;`,
            ].join("\n"),
          },
        },
        {
          op: "kvfx.op.prop.expression",
          args: {
            id: ref(bind),
            path: [TRANSFORM, "ADBE Scale"],
            relative: true,
            expression: [
              "// KVFX Tools — kinetic punch",
              `var t = time - (__KVFX_NOW__ + ${String(Math.round(a * 1e4) / 1e4)});`,
              "var u = Math.max(0, Math.min(1, t / 0.2));",
              "var k = (138 - 38 * (1 - Math.pow(1 - u, 3))) / 100;",
              "var out = []; for (var i = 0; i < value.length; i++) out[i] = i < 2 ? value[i] * k : value[i];",
              "out;",
            ].join("\n"),
          },
        },
      );
    });
    return steps;
  }

  const portrait = h > w;
  const limit = portrait ? 12 : 20;
  const lines = kineticLines(words, limit);
  const longest = Math.max(...lines.map((line) => line.map((word) => word.text).join(" ").length));
  const size = Math.round(Math.max(20, Math.min((w * 0.84) / (longest * 0.56), (h * 0.7) / (lines.length * 1.18))));
  const leading = size * 1.16;
  const top = h / 2 - ((lines.length - 1) * leading) / 2 + size * 0.35;
  const perWord = 0.07 / pace;
  let delay = 0;
  let accentIndex = 0;

  lines.forEach((line, index) => {
    const bind = `line${String(index)}`;
    const text = line.map((word) => word.text).join(" ");
    const motion = motionFor(options.style, index);
    const typing = options.style === "type";
    const base: TextMotionOptions = {
      preset: textMotionPreset(typing ? "typing" : motion.preset) ?? (textMotionPreset("rise") as NonNullable<ReturnType<typeof textMotionPreset>>),
      mode: "in",
      unit: motion.unit,
      order: "forward",
      seed: 1,
      ease: motion.ease,
      bezier: DEFAULT_BEZIER,
      stagger: typing ? 0.045 / pace : perWord,
      duration: 0.5 / pace,
      overshoot: 30,
      engine: "live",
      accent: options.accents[0] ?? options.color,
      delay,
    };
    const animators: JsonValue[] = [...accentAnimators(line, options.accents, accentIndex)];
    accentIndex += line.filter((word) => word.accent).length;
    if (!typing) animators.push(...liveAnimators(base));
    if (options.style === "highlight") {
      const sweep = textMotionPreset("highlight");
      if (sweep !== undefined) animators.push(...liveAnimators({ ...base, preset: sweep, delay: delay + 0.8 / pace, duration: 0.6 / pace }));
    }

    steps.push(
      { op: "kvfx.op.layer.create", args: { kind: "text", text, name: `KVFX Kinetic · ${text.slice(0, 24)}` }, bind },
      { op: "kvfx.op.text.setStyle", args: { id: ref(bind), fontSize: size, fillColor: rgb(options.color), justification: "center" } },
      { op: "kvfx.op.prop.set", args: { id: ref(bind), path: [TRANSFORM, "ADBE Position"], value: [w / 2, top + index * leading, 0] } },
    );
    if (animators.length > 0) steps.push({ op: "kvfx.op.text.addAnimator", args: { id: ref(bind), relative: true, animators } });
    if (typing) {
      steps.push({
        op: "kvfx.op.prop.expression",
        args: { id: ref(bind), path: ["ADBE Text Properties", "ADBE Text Document"], expression: typingExpression(base), relative: true },
      });
      delay += text.length * base.stagger + 0.25 / pace;
    } else {
      delay += (motion.unit === "lines" ? 1 : line.length) * perWord + 0.18 / pace;
    }
  });
  return steps;
}

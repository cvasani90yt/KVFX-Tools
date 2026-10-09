import { DEFAULT_BEZIER } from "../../animation/easing.js";
import { type Rgb, hexToRgb } from "../../color/index.js";
import { parseRevealStyle } from "../../expressions/ui-motion.js";
import { LAYOUT_THEMES, type LayoutTheme } from "../../layouts/elements.js";
import { type LayoutMotion, layoutSteps } from "../../layouts/build.js";
import { LAYOUT_TEMPLATES, layoutTemplate } from "../../layouts/templates.js";
import { KINETIC_ASPECTS, KINETIC_STYLES, type KineticStyle, kineticDuration, kineticSteps } from "../../text/kinetic.js";
import { TEXT_EASES, type TextEase } from "../../text/motion.js";
import { bezierParam, boolParam, numberParam, simpleCommand, stringParam } from "../define.js";
import { AVAILABLE, type Command, CommandCategory, type CommandContext, type PlanStep, unavailable } from "../types.js";

/**
 * Templates: interface layouts and kinetic titles, built from your words in
 * one undo step.
 */

/* eslint-disable no-magic-numbers -- the named defaults themselves */
const DEFAULT_ACCENT: Rgb = [1, 0.56, 0.25];
const FALLBACK_FRAME = 1 / 30;
const MAX_FIELD = 400;

function color(ctx: CommandContext, key: string, fallback: Rgb): Rgb {
  return hexToRgb(stringParam(ctx, key, "")) ?? fallback;
}

export const buildLayout = simpleCommand({
  id: "kvfx.rig.layout",
  name: "Build Layout",
  description:
    "Build an interface scene — chat thread, metric cards, charts, pricing, kanban, phone or browser frame and more — from your text, animated in",
  category: CommandCategory.Rig,
  keywords: ["template", "layout", "ui", "mockup", "chat", "chart", "metrics", "pricing", "kanban", "phone", "browser", "card", "saas", "dashboard"],
  icon: "layout",
  metadata: { destructive: false, minLayers: 0, requiresComp: true },
  defaultParams: (ui) => ({ bezier: [...ui.ease], ...(ui.toolParams["layout"] ?? {}) }),
  budgetMs: 30_000,
  steps: (ctx) => {
    const template = layoutTemplate(stringParam(ctx, "template", "chat")) ?? LAYOUT_TEMPLATES[0];
    const comp = ctx.snapshot.comp;
    if (template === undefined || comp === undefined) return [];
    const content = ctx.params?.["content"];
    const get = (key: string): string => {
      const typed = typeof content === "object" && content !== null && !Array.isArray(content) ? content[key] : undefined;
      const fallback = template.fields.find((f) => f.key === key)?.value ?? "";
      return (typeof typed === "string" ? typed : fallback).slice(0, MAX_FIELD);
    };
    const theme: LayoutTheme = LAYOUT_THEMES.find((t) => t.id === stringParam(ctx, "theme", "dark")) ?? (LAYOUT_THEMES[0] as LayoutTheme);
    const frame = comp.frameDuration || FALLBACK_FRAME;
    const reveal = stringParam(ctx, "reveal", "auto");
    const easeName = stringParam(ctx, "ease", "expo");
    const motion: LayoutMotion = {
      reveal: reveal === "auto" || reveal === "none" ? reveal : parseRevealStyle(reveal),
      stagger: numberParam(ctx, "stagger", 5, 0, 600) * frame,
      duration: Math.max(frame, numberParam(ctx, "duration", 16, 1, 600) * frame),
      ease: TEXT_EASES.some((e) => e.id === easeName) && easeName !== "preset" ? (easeName as Exclude<TextEase, "preset">) : "expo",
      overshoot: numberParam(ctx, "overshoot", 30, 0, 100),
      bezier: bezierParam(ctx, "bezier", DEFAULT_BEZIER),
    };
    return layoutSteps(
      template,
      get,
      { theme, accent: color(ctx, "accent", DEFAULT_ACCENT), roundness: numberParam(ctx, "roundness", 100, 0, 300) / 100, shadows: boolParam(ctx, "shadows", true) },
      motion,
      { width: comp.width, height: comp.height },
    );
  },
});

export const kineticTitle = simpleCommand({
  id: "kvfx.rig.kinetic",
  name: "Kinetic Title",
  description:
    "Set a phrase as animated big type — stacked, punched word by word, sliding, popping or typed — with *starred* words in accent colours, in this comp or a new one",
  category: CommandCategory.Text,
  keywords: ["kinetic", "typography", "title", "words", "quote", "lyric", "punch", "stack", "big type", "reel", "shorts", "caption style"],
  icon: "kinetic",
  metadata: { destructive: false, minLayers: 0, requiresComp: false },
  defaultParams: (ui) => ui.toolParams["kinetic"] ?? {},
  budgetMs: 30_000,
  check: (ctx) => {
    const aspect = stringParam(ctx, "aspect", "comp");
    if (aspect === "comp" && ctx.snapshot.comp === undefined) return unavailable("Open a composition, or choose a size to make a new one.");
    return AVAILABLE;
  },
  steps: (ctx) => {
    const aspect = KINETIC_ASPECTS.find((a) => a.id === stringParam(ctx, "aspect", "comp")) ?? KINETIC_ASPECTS[0];
    const styleId = stringParam(ctx, "style", "stack");
    const style: KineticStyle = KINETIC_STYLES.some((s) => s.id === styleId) ? (styleId as KineticStyle) : "stack";
    const accents = ["accent", "accent2"].map((key) => color(ctx, key, DEFAULT_ACCENT));
    const comp = ctx.snapshot.comp;
    const size = aspect?.size ?? [comp?.width ?? 1920, comp?.height ?? 1080];
    const options = {
      text: stringParam(ctx, "text", "Make *videos* that *stop* the scroll").slice(0, MAX_FIELD),
      style,
      color: color(ctx, "color", [1, 1, 1]),
      accents,
      background: ((): "none" | "solid" | "drift" => {
        const value = stringParam(ctx, "background", "none");
        return value === "solid" || value === "drift" ? value : "none";
      })(),
      backgroundColor: color(ctx, "backgroundColor", [0.06, 0.06, 0.08]),
      speed: numberParam(ctx, "speed", 1, 0.1, 10),
      width: size[0],
      height: size[1],
    };
    const steps: PlanStep[] = [];
    if (aspect !== undefined && aspect.size !== undefined) {
      steps.push({
        op: "kvfx.op.comp.create",
        args: {
          name: `KVFX Kinetic ${aspect.label.replace(":", "x")}`,
          width: aspect.size[0],
          height: aspect.size[1],
          duration: Math.max(3, Math.ceil(kineticDuration(options) + 2)),
          frameRate: comp?.frameRate ?? 30,
        },
      });
    }
    return [...steps, ...kineticSteps(options)];
  },
});

export const templateCommands: readonly Command[] = [buildLayout, kineticTitle];

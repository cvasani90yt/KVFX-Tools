import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type JsonValue, LAYOUT_TEMPLATES, type OperationPlan } from "@kvfx/core";
import { createMockAe, type MockAe } from "./mock-ae.js";
import { MockComp, MockLayer, type MockProp, setNextMockId } from "./mock-dom.js";
import { execute, planFor } from "./run-command.js";

/**
 * The walkthrough video's demo scenes, as KVFX Tools itself builds them.
 *
 * Each stage is a comp the promo builder makes in After Effects. Its runs are
 * the plans real KVFX commands produce — taken from the shipped commands here,
 * against the mock — so the video shows the tools' actual output rather than a
 * look-alike. Layer ids differ between this mock and After Effects, so every
 * id in a plan is written as the layer's name ({"$layer": name}), which the
 * builder turns back into an id just before it sends the plan.
 *
 * The test proves that swap is lossless: it replays every recipe on a fresh
 * mock whose ids are in another range, resolving names as the builder does,
 * and requires the result to match the direct run property for property.
 *
 * It also keeps promo/walkthrough/walkthrough-recipes.jsxinc in step with the
 * commands: when a plan changes, this fails until the file is regenerated with
 *   KVFX_WRITE_RECIPES=1 npx vitest run packages/host/tests/walkthrough-recipes.test.ts
 */

const OUT = fileURLToPath(new URL("../../../promo/walkthrough/walkthrough-recipes.jsxinc", import.meta.url));
const WRITE = process.env["KVFX_WRITE_RECIPES"] === "1";
const FPS = 30;
const RUN_IDS = 7_000_000;
const REPLAY_IDS = 9_000_000;
const ID_SPAN = 1_000_000;

type Json = JsonValue;

interface Run {
  /** What the edit shows as the click, e.g. "Build Layout". */
  readonly label: string;
  /** The playhead when it runs, in seconds. */
  readonly at: number;
  /** Layer names to select first; "Prefix*" selects every layer starting with Prefix. */
  readonly select?: readonly string[];
  /** Properties to select first, for commands that act on selected properties. */
  readonly selectProps?: readonly { readonly layer: string; readonly path: readonly string[] }[];
  /** Properties whose every keyframe is selected first, for commands that act on selected keys. */
  readonly selectKeys?: readonly { readonly layer: string; readonly path: readonly string[] }[];
  /** A shipped KVFX command and its panel parameters… */
  readonly command?: string;
  readonly params?: Record<string, Json>;
  /** …or raw host steps that set the stage up. */
  readonly steps?: readonly Json[];
  /** The builder keyframes the change in instead of cutting to it. */
  readonly animate?: boolean;
}

interface StageProp {
  readonly name: string;
  /** Another stage, nested here as a precomp layer. */
  readonly stage: string;
  readonly position: [number, number];
  readonly scale: number;
}

interface Stage {
  readonly id: string;
  readonly duration: number;
  readonly width?: number;
  readonly height?: number;
  /** Comp background colour. */
  readonly bg?: string;
  readonly props?: readonly StageProp[];
  /** Layers the builder sets in its display font afterwards (the mock has no fonts). */
  readonly fonts?: readonly { readonly layer: string; readonly font: "display" | "ui" | "body" | "mono" }[];
  readonly runs: readonly Run[];
}

// ---------------------------------------------------------------------------
// Raw setup steps
// ---------------------------------------------------------------------------

const ref = (name: string): Json => ({ $ref: name });
const AMBER = "#ff8f3f";
const INK = "#0f1014";

function rgb(hex: string): number[] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => Math.round(v * 1000) / 1000);
}

function textLayer(bind: string, name: string, text: string, size: number, at: [number, number], color = "#ffffff", align = "center"): Json[] {
  return [
    { op: "kvfx.op.layer.create", args: { kind: "text", text, name }, bind },
    { op: "kvfx.op.text.setStyle", args: { id: ref(bind), fontSize: size, fillColor: rgb(color), justification: align } },
    { op: "kvfx.op.prop.set", args: { id: ref(bind), path: ["ADBE Transform Group", "ADBE Position"], value: at } },
  ];
}

function cardLayer(bind: string, name: string, size: [number, number], radius: number, color: string, at: [number, number], opacity = 100): Json[] {
  return [
    { op: "kvfx.op.layer.create", args: { kind: "shape", name }, bind },
    {
      op: "kvfx.op.shape.build",
      args: {
        id: ref(bind),
        groups: [{ name: "Card", items: [{ type: "rect", name: "Box", size, position: [0, 0], roundness: radius }, { type: "fill", name: "Fill", color: rgb(color), opacity }] }],
      },
    },
    { op: "kvfx.op.prop.set", args: { id: ref(bind), path: ["ADBE Transform Group", "ADBE Position"], value: at } },
  ];
}

function dotLayer(bind: string, name: string, size: number, color: string, at: [number, number]): Json[] {
  return [
    { op: "kvfx.op.layer.create", args: { kind: "shape", name }, bind },
    { op: "kvfx.op.shape.build", args: { id: ref(bind), groups: [{ name: "Dot", items: [{ type: "ellipse", name: "Disc", size: [size, size], position: [0, 0] }, { type: "fill", name: "Fill", color: rgb(color) }] }] } },
    { op: "kvfx.op.prop.set", args: { id: ref(bind), path: ["ADBE Transform Group", "ADBE Position"], value: at } },
  ];
}

function positionKeys(bind: string, keys: readonly [number, [number, number]][]): Json {
  return { op: "kvfx.op.prop.keyframes", args: { id: ref(bind), path: ["ADBE Transform Group", "ADBE Position"], keys: keys.map(([time, value]) => ({ time, value })) } };
}

const layout = (template: string, content: Record<string, string> = {}, extra: Record<string, Json> = {}): Record<string, Json> => ({
  template,
  theme: "dark",
  accent: AMBER,
  content,
  ...extra,
});

const KOVO_METRICS = {
  labels: "Revenue, Signups, Conversion",
  values: "48200, 12840, 7.4",
  prefixes: "$, , ",
  suffixes: ", , %",
  deltas: "+12%, +32%, +1.2%",
};

// ---------------------------------------------------------------------------
// The stages, in the order the video uses them
// ---------------------------------------------------------------------------

export const STAGES: readonly Stage[] = [
  // 1 · Start with a layout
  { id: "lay-chat", duration: 6, runs: [{ label: "Build Layout", at: 0.3, command: "kvfx.rig.layout", params: layout("chat", { name: "Kovo Support", m1: "Did the new dashboard ship?", m2: "It did! Numbers update live now.", m3: "Can we show it in the promo?", m4: "Already in. Rendering now!" }) }] },
  { id: "lay-notify", duration: 6, runs: [{ label: "Build Layout", at: 0.3, command: "kvfx.rig.layout", params: layout("toast", { title: "Kovo", body: "Signups are up 32% this week", time: "now" }) }] },
  { id: "lay-bars", duration: 6, runs: [{ label: "Build Layout", at: 0.3, command: "kvfx.rig.layout", params: layout("bars", { title: "Weekly signups" }) }] },
  { id: "lay-pricing", duration: 6, runs: [{ label: "Build Layout", at: 0.3, command: "kvfx.rig.layout", params: layout("pricing", { plan: "Kovo Pro", features: "Live dashboards, Unlimited seats, Priority support" }) }] },
  { id: "lay-phone", duration: 6, runs: [{ label: "Build Layout", at: 0.3, command: "kvfx.rig.layout", params: layout("phone", { time: "9:41" }) }] },
  { id: "lay-browser", duration: 6, runs: [{ label: "Build Layout", at: 0.3, command: "kvfx.rig.layout", params: layout("browser", { url: "kovo.app" }) }] },
  { id: "metrics", duration: 10, runs: [{ label: "Build Layout", at: 0.5, command: "kvfx.rig.layout", params: layout("metrics", KOVO_METRICS) }] },

  // 2 · Make it move
  {
    id: "stagger",
    duration: 8,
    runs: [
      { label: "Kanban Board", at: 0, command: "kvfx.rig.layout", params: layout("kanban", {}, { reveal: "none" }) },
      { label: "Stagger In", at: 0.5, select: ["KVFX Kanban Board · *"], command: "kvfx.rig.uistagger", params: { style: "rise", order: "leftRight", stagger: 2, duration: 16 } },
    ],
  },
  {
    id: "stagger-pop",
    duration: 6,
    runs: [
      { label: "Kanban Board", at: 0, command: "kvfx.rig.layout", params: layout("kanban", {}, { reveal: "none" }) },
      { label: "Stagger In", at: 0.3, select: ["KVFX Kanban Board · *"], command: "kvfx.rig.uistagger", params: { style: "pop", order: "centre", stagger: 2, duration: 14 } },
    ],
  },
  {
    id: "stagger-blur",
    duration: 6,
    runs: [
      { label: "Kanban Board", at: 0, command: "kvfx.rig.layout", params: layout("kanban", {}, { reveal: "none" }) },
      { label: "Stagger In", at: 0.3, select: ["KVFX Kanban Board · *"], command: "kvfx.rig.uistagger", params: { style: "blur", order: "random", stagger: 2, duration: 16 } },
    ],
  },
  {
    id: "stagger-slide",
    duration: 6,
    runs: [
      { label: "Kanban Board", at: 0, command: "kvfx.rig.layout", params: layout("kanban", {}, { reveal: "none" }) },
      { label: "Stagger In", at: 0.3, select: ["KVFX Kanban Board · *"], command: "kvfx.rig.uistagger", params: { style: "slideLeft", order: "topDown", stagger: 2, duration: 16 } },
    ],
  },
  {
    id: "carousel",
    duration: 12,
    props: [
      { name: "Card · Metrics", stage: "metrics", position: [960, 540], scale: 50 },
      { name: "Card · Chat", stage: "lay-chat", position: [960, 540], scale: 50 },
      { name: "Card · Notification", stage: "lay-notify", position: [960, 540], scale: 50 },
      { name: "Card · Bars", stage: "lay-bars", position: [960, 540], scale: 50 },
      { name: "Card · Pricing", stage: "lay-pricing", position: [960, 540], scale: 50 },
    ],
    runs: [{ label: "Build Card Carousel", at: 0, select: ["Card · *"], command: "kvfx.rig.cardcarousel", params: { hold: 1.2, move: 0.5 } }],
  },

  // 3 · Show how it's used
  {
    id: "cursor",
    duration: 8,
    runs: [
      { label: "Build Layout", at: 0, command: "kvfx.rig.layout", params: layout("pricing", { plan: "Kovo Pro", features: "Live dashboards, Unlimited seats, Priority support" }) },
      { label: "Add Cursor", at: 2, select: ["KVFX Pricing Card · Button"], command: "kvfx.rig.cursor", params: { style: "arrow", travel: 1.1, hold: 0.8 } },
    ],
  },
  {
    id: "hover",
    duration: 9,
    runs: [
      { label: "Build Layout", at: 0, command: "kvfx.rig.layout", params: layout("metrics", KOVO_METRICS) },
      { label: "Add Cursor", at: 1.6, select: ["KVFX Metric Cards · Card 1", "KVFX Metric Cards · Card 2", "KVFX Metric Cards · Card 3"], command: "kvfx.rig.cursor", params: { style: "arrow", travel: 0.9, hold: 0.7, press: false, ripple: false } },
      { label: "Add Hover", at: 1.6, select: ["KVFX Cursor*", "KVFX Metric Cards · Card 1", "KVFX Metric Cards · Card 2", "KVFX Metric Cards · Card 3"], command: "kvfx.rig.hover", params: { radius: 260, scale: 106, lift: 14 } },
    ],
  },
  { id: "inputbar", duration: 7, runs: [{ label: "Add Input Bar", at: 0.3, command: "kvfx.rig.inputbar", params: { theme: "dark", text: "Show signups by week", placeholder: "Ask Kovo anything" } }] },

  // 4 · Type that talks
  {
    id: "textanimate",
    duration: 6,
    fonts: [{ layer: "Headline", font: "display" }],
    runs: [
      { label: "Text", at: 0, steps: textLayer("t", "Headline", "Numbers that move.", 130, [960, 580]) },
      { label: "Animate In + Out", at: 0.4, select: ["Headline"], command: "kvfx.text.animate", params: { preset: "blur-rise", mode: "inOut", unit: "words", order: "forward" } },
    ],
  },
  { id: "kinetic", duration: 6, fonts: [{ layer: "KVFX Kinetic · *", font: "display" }], runs: [{ label: "Build Kinetic Title", at: 0.2, command: "kvfx.rig.kinetic", params: { text: "Dashboards that *actually* *move*", style: "stack", accent: AMBER, accent2: "#fbbf24", background: "drift", aspect: "comp" } }] },
  {
    id: "kinetic-vertical",
    duration: 6,
    width: 1080,
    height: 1920,
    fonts: [{ layer: "KVFX Kinetic · *", font: "display" }],
    runs: [{ label: "Build Kinetic Title", at: 0.2, command: "kvfx.rig.kinetic", params: { text: "Ship it *vertical*", style: "pop", accent: AMBER, accent2: "#fbbf24", background: "drift", aspect: "comp" } }],
  },
  { id: "kinetic-punch", duration: 4, fonts: [{ layer: "KVFX Kinetic · *", font: "display" }], runs: [{ label: "Build Kinetic Title", at: 0.1, command: "kvfx.rig.kinetic", params: { text: "Ship *faster*", style: "punch", accent: AMBER, background: "solid", backgroundColor: INK, aspect: "comp" } }] },

  // 5 · Set the scene
  {
    id: "backdrop",
    duration: 10,
    runs: [
      { label: "Build Layout", at: 0.6, command: "kvfx.rig.layout", params: layout("metrics", KOVO_METRICS) },
      { label: "Add Backdrop", at: 0, command: "kvfx.rig.backdrop", params: { style: "drift", palette: "ember", grain: true } },
    ],
  },
  {
    id: "horizon",
    duration: 8,
    runs: [
      { label: "Build Layout", at: 0.4, command: "kvfx.rig.layout", params: layout("toast", { title: "Kovo", body: "Signups are up 32% this week", time: "now" }) },
      { label: "Add Backdrop", at: 0, command: "kvfx.rig.backdrop", params: { style: "horizon", palette: "violet" } },
    ],
  },
  {
    id: "stars",
    duration: 8,
    fonts: [{ layer: "Headline", font: "display" }],
    runs: [
      { label: "Text", at: 0, steps: textLayer("t", "Headline", "Kovo", 200, [960, 600]) },
      { label: "Add Backdrop", at: 0, command: "kvfx.rig.backdrop", params: { style: "stars", palette: "ocean" } },
    ],
  },
  {
    id: "dotpulse",
    duration: 7,
    fonts: [{ layer: "Headline", font: "display" }],
    runs: [
      { label: "Text", at: 0, steps: textLayer("t", "Headline", "Live in 30 seconds", 110, [960, 580]) },
      { label: "Add Dot Pulse", at: 0.2, command: "kvfx.rig.dotpulse", params: { placement: "comp" } },
    ],
  },
  {
    id: "glass",
    duration: 8,
    runs: [
      { label: "Build Layout", at: 0.4, command: "kvfx.rig.layout", params: layout("toast", { title: "Kovo", body: "Your weekly report is ready", time: "9:41" }) },
      { label: "Add Backdrop", at: 0, command: "kvfx.rig.backdrop", params: { style: "drift", palette: "sunset" } },
      { label: "Card opacity", at: 0, steps: [{ op: "kvfx.op.prop.set", args: { id: { $name: "KVFX Notification · Toast" }, path: ["ADBE Transform Group", "ADBE Opacity"], value: 35 } }] },
      { label: "Make Glass", at: 0.4, select: ["KVFX Notification · Toast"], command: "kvfx.rig.glass", params: { blur: 40, frost: 20 } },
    ],
  },
  {
    id: "wipe",
    duration: 6,
    fonts: [
      { layer: "Plan", font: "display" },
      { layer: "Build", font: "display" },
      { layer: "Ship", font: "display" },
    ],
    runs: [
      { label: "Text", at: 0, steps: [...textLayer("a", "Plan", "Plan.", 150, [960, 380]), ...textLayer("b", "Build", "Build.", 150, [960, 580]), ...textLayer("c", "Ship", "Ship.", 150, [960, 780], AMBER)] },
      { label: "Wipe", at: 0.3, select: ["Plan", "Build", "Ship"], command: "kvfx.rig.wipe", params: { direction: "right", stagger: 6, duration: 18 } },
    ],
  },
  {
    id: "code",
    duration: 7,
    fonts: [
      { layer: "KVFX Code Headline", font: "display" },
      { layer: "KVFX Code Lines", font: "mono" },
      { layer: "KVFX Glyph Field", font: "mono" },
      { layer: "KVFX Decode*", font: "mono" },
    ],
    runs: [{ label: "Code", at: 0.2, command: "kvfx.rig.codeglyphs", params: { text: "KOVO API" } }] },

  // 6 · Polish
  {
    id: "ease",
    duration: 6,
    runs: [
      {
        label: "Card",
        at: 0,
        steps: [
          ...cardLayer("c", "Card", [300, 200], 28, AMBER, [520, 540]),
          positionKeys("c", [[0.6, [520, 540]], [1.4, [1400, 540]], [2.4, [1400, 540]], [3.2, [520, 540]], [4.2, [520, 540]], [5.0, [1400, 540]]]),
        ],
      },
      { label: "Apply to Keys", at: 0, selectKeys: [{ layer: "Card", path: ["ADBE Transform Group", "ADBE Position"] }], command: "kvfx.keys.ease", params: { bezier: [0.16, 1, 0.3, 1] } },
    ],
  },
  {
    id: "elastic",
    duration: 5,
    runs: [
      { label: "Card", at: 0, steps: [...cardLayer("c", "Card", [360, 220], 28, AMBER, [520, 540]), positionKeys("c", [[0.6, [520, 540]], [1.2, [1400, 540]]])] },
      { label: "Add Elastic", at: 0.6, selectProps: [{ layer: "Card", path: ["ADBE Transform Group", "ADBE Position"] }], command: "kvfx.keys.elastic", params: { amplitude: 0.06, frequency: 2.4, decay: 4 } },
    ],
  },
  {
    id: "bounce",
    duration: 5,
    runs: [
      { label: "Ball", at: 0, steps: [...dotLayer("b", "Ball", 160, AMBER, [960, 200]), positionKeys("b", [[0.5, [960, 200]], [1.1, [960, 820]]])] },
      { label: "Add Bounce", at: 0.5, selectProps: [{ layer: "Ball", path: ["ADBE Transform Group", "ADBE Position"] }], command: "kvfx.keys.bounce", params: {} },
    ],
  },
  {
    id: "follow",
    duration: 6,
    fonts: [{ layer: "Tag", font: "ui" }],
    runs: [
      {
        label: "Leader",
        at: 0,
        steps: [
          ...dotLayer("d", "Leader", 70, AMBER, [360, 700]),
          positionKeys("d", [[0.4, [360, 700]], [1.6, [960, 380]], [2.8, [1560, 700]], [4.0, [960, 560]]]),
          ...textLayer("t", "Tag", "Kovo Pro", 44, [360, 640]),
          ...cardLayer("s", "Shadow", [90, 24], 12, "#000000", [360, 770], 35),
        ],
      },
      { label: "Follow", at: 0, select: ["Leader", "Tag", "Shadow"], command: "kvfx.layer.follow", params: { leader: "top", delay: 0.12 } },
    ],
  },
  {
    id: "align",
    duration: 6,
    runs: [
      {
        label: "Cards",
        at: 0,
        steps: [
          ...cardLayer("a", "Card A", [300, 200], 24, "#262a33", [380, 300]),
          ...cardLayer("b", "Card B", [300, 260], 24, "#262a33", [820, 470]),
          ...cardLayer("c", "Card C", [300, 180], 24, "#262a33", [1150, 260]),
          ...cardLayer("d", "Card D", [300, 220], 24, AMBER, [1540, 430]),
        ],
      },
      { label: "Align as Group", at: 1, select: ["Card A", "Card B", "Card C", "Card D"], command: "kvfx.align.centrey.group", animate: true },
      { label: "Even gaps horizontally", at: 3, select: ["Card A", "Card B", "Card C", "Card D"], command: "kvfx.align.gaps.horizontal", params: { gap: 60 }, animate: true },
    ],
  },

  // 8 · Also inside
  { id: "counter", duration: 4, fonts: [{ layer: "KVFX Counter", font: "display" }], runs: [{ label: "Create Counter", at: 0.2, command: "kvfx.rig.counter", params: { from: 0, to: 48200, prefix: "$", duration: 2 } }] },
  {
    id: "carousel3d",
    duration: 6,
    props: [
      { name: "Panel · Metrics", stage: "metrics", position: [960, 540], scale: 34 },
      { name: "Panel · Chat", stage: "lay-chat", position: [960, 540], scale: 34 },
      { name: "Panel · Bars", stage: "lay-bars", position: [960, 540], scale: 34 },
      { name: "Panel · Pricing", stage: "lay-pricing", position: [960, 540], scale: 34 },
      { name: "Panel · Notification", stage: "lay-notify", position: [960, 540], scale: 34 },
    ],
    runs: [{ label: "Build Carousel", at: 0, select: ["Panel · *"], command: "kvfx.rig.carousel", params: { radius: 900 } }],
  },
  {
    id: "explode",
    duration: 4,
    fonts: [{ layer: "Word", font: "display" }],
    runs: [
      { label: "Text", at: 0, steps: textLayer("w", "Word", "KOVO", 260, [960, 640], AMBER) },
      { label: "Explode", at: 0, select: ["Word"], command: "kvfx.text.explode", params: { mode: "characters" } },
      { label: "Stagger In", at: 0.3, select: ["Word*"], command: "kvfx.rig.uistagger", params: { style: "pop", order: "random", stagger: 3, duration: 14 } },
    ],
  },
];

/** Comp Resizer, as the builder runs it on a copy of the finished promo. */
const RESIZE: Run = { label: "Resize Comps", at: 0, command: "kvfx.comp.resize", params: { width: 1080, height: 1920, fit: "fit", anchor: "centre", fixParents: false } };

// ---------------------------------------------------------------------------
// Running a stage
// ---------------------------------------------------------------------------

interface RecipeRun {
  label: string;
  at: number;
  select: string[];
  selectProps: { layer: string; path: string[] }[];
  selectKeys: { layer: string; path: string[] }[];
  undo: string;
  budgetMs: number;
  animate: boolean;
  steps: Json[];
}

interface Recipe {
  id: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  bg: string;
  props: StageProp[];
  fonts: { layer: string; font: string }[];
  runs: RecipeRun[];
}

function stageAe(stage: Stage): MockAe {
  const ae = createMockAe({ comp: { name: `WT ${stage.id}`, width: stage.width ?? 1920, height: stage.height ?? 1080, frameRate: FPS, duration: stage.duration, layers: [] } });
  for (const prop of stage.props ?? []) {
    const source = STAGES.find((s) => s.id === prop.stage);
    if (source === undefined) throw new Error(`${stage.id}: no stage ${prop.stage}`);
    const inner = new MockComp(ae.project!, `WT ${source.id}`, source.width ?? 1920, source.height ?? 1080, FPS, source.duration);
    ae.project!.items.push(inner);
    const layer = ae.comp!.addLayer({ name: prop.name, kind: "precomp", source: inner });
    layer.transform("ADBE Position").setValue([...prop.position, 0]);
    layer.transform("ADBE Scale").setValue([prop.scale, prop.scale, 100]);
  }
  return ae;
}

function names(ae: MockAe, patterns: readonly string[]): string[] {
  const out: string[] = [];
  for (const pattern of patterns) {
    const matches = pattern.endsWith("*") ? ae.stack().filter((n) => n.startsWith(pattern.slice(0, -1))) : ae.stack().filter((n) => n === pattern);
    if (matches.length === 0) throw new Error(`Nothing named ${pattern}`);
    for (const name of matches) if (!out.includes(name)) out.push(name);
  }
  return out;
}

function propAt(ae: MockAe, layer: string, path: readonly string[]): MockProp {
  let prop: MockProp | null = ae.raw(layer).root;
  for (const step of path) prop = prop?.property(step) ?? null;
  if (prop === null) throw new Error(`No property ${path.join(" > ")} on ${layer}`);
  return prop;
}

function selectProps(ae: MockAe, wanted: readonly { layer: string; path: readonly string[] }[], keys: readonly { layer: string; path: readonly string[] }[] = []): void {
  for (const layer of ae.comp!.stack) {
    const walk = (p: MockProp): void => {
      p.selected = false;
      for (const c of p.children) walk(c);
    };
    walk(layer.root);
  }
  for (const { layer, path } of wanted) propAt(ae, layer, path).selected = true;
  for (const { layer, path } of keys) {
    const prop = propAt(ae, layer, path);
    prop.selected = true;
    for (const key of prop.keys) key.selected = true;
  }
}

/** Swaps every id this run could know for the name of what it points at. */
function symbolic(value: Json, ae: MockAe, base: number): Json {
  if (typeof value === "number" && value >= base && value < base + ID_SPAN) {
    const layer = ae.comp!.stack.find((l) => l.id === value);
    if (layer !== undefined) return { $layer: layer.name };
    const item = ae.project!.items.find((i) => i.id === value);
    if (item !== undefined) return { $item: item.name };
    throw new Error(`A plan refers to id ${String(value)}, which is neither a layer nor an item`);
  }
  if (Array.isArray(value)) return value.map((v) => symbolic(v, ae, base));
  if (value !== null && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) out[k] = symbolic(v, ae, base);
    return out;
  }
  return value;
}

/** What the builder does: names back to this comp's ids. */
function concrete(value: Json, ae: MockAe): Json {
  if (Array.isArray(value)) return value.map((v) => concrete(v, ae));
  if (value !== null && typeof value === "object") {
    const bag = value as Record<string, Json>;
    if (typeof bag["$layer"] === "string" || typeof bag["$name"] === "string") return ae.idOf((bag["$layer"] ?? bag["$name"]) as string);
    if (typeof bag["$item"] === "string") return ae.project!.items.find((i) => i.name === bag["$item"])?.id ?? -1;
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(bag)) out[k] = concrete(v, ae);
    return out;
  }
  return value;
}

type PropRef = { layer: string; path: string[] };

function prepare(ae: MockAe, run: Run): { select: string[]; props: PropRef[]; keys: PropRef[] } {
  ae.comp!.time = run.at;
  const select = names(ae, run.select ?? []);
  ae.select(...select);
  const props = (run.selectProps ?? []).map((p) => ({ layer: p.layer, path: [...p.path] }));
  const keys = (run.selectKeys ?? []).map((p) => ({ layer: p.layer, path: [...p.path] }));
  selectProps(ae, props, keys);
  return { select, props, keys };
}

function generate(stage: Stage): { recipe: Recipe; state: Json } {
  setNextMockId(RUN_IDS);
  const ae = stageAe(stage);
  const runs: RecipeRun[] = [];
  for (const run of stage.runs) {
    const template = run.command === "kvfx.rig.layout" ? run.params?.["template"] : undefined;
    if (template !== undefined && !LAYOUT_TEMPLATES.some((t) => t.id === template)) throw new Error(`${stage.id}: no layout template ${JSON.stringify(template)}`);
    const { select, props, keys } = prepare(ae, run);
    const plan: OperationPlan =
      run.command !== undefined
        ? planFor(ae, run.command, run.params ?? {})
        : { undoGroup: `KVFX Walkthrough — ${run.label}`, steps: concrete([...(run.steps ?? [])], ae) as unknown as OperationPlan["steps"] };
    const steps = symbolic(plan.steps as unknown as Json, ae, RUN_IDS) as Json[];
    const reply = execute(ae, plan);
    if (!reply.ok) throw new Error(`${stage.id} · ${run.label}: ${reply.error?.message ?? "failed"}`);
    runs.push({ label: run.label, at: run.at, select, selectProps: props, selectKeys: keys, undo: plan.undoGroup, budgetMs: plan.budgetMs ?? 5000, animate: run.animate === true, steps });
  }
  const recipe: Recipe = {
    id: stage.id,
    width: stage.width ?? 1920,
    height: stage.height ?? 1080,
    duration: stage.duration,
    fps: FPS,
    bg: stage.bg ?? INK,
    props: [...(stage.props ?? [])],
    fonts: [...(stage.fonts ?? [])],
    runs,
  };
  return { recipe, state: dump(ae) };
}

function replay(recipe: Recipe, stage: Stage): Json {
  setNextMockId(REPLAY_IDS);
  const ae = stageAe(stage);
  for (const run of recipe.runs) {
    ae.comp!.time = run.at;
    ae.select(...run.select);
    selectProps(ae, run.selectProps, run.selectKeys);
    const reply = execute(ae, { undoGroup: run.undo, budgetMs: run.budgetMs, steps: concrete(run.steps, ae) as unknown as OperationPlan["steps"] });
    if (!reply.ok) throw new Error(`replay ${recipe.id} · ${run.label}: ${reply.error?.message ?? "failed"}`);
  }
  return dump(ae);
}

// ---------------------------------------------------------------------------
// Comparing results
// ---------------------------------------------------------------------------

function plain(value: unknown): Json {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return Math.round(value * 1e6) / 1e6;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(plain);
  if (value instanceof MockLayer) return { layer: value.name };
  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) if (typeof v !== "function") out[k] = plain(v);
    return out;
  }
  return null;
}

function dumpProp(p: MockProp): Json {
  if (p.isGroup) return { m: p.matchName, n: p.name, e: p.enabled, c: p.children.map(dumpProp) };
  return {
    m: p.matchName,
    n: p.name,
    v: plain(p.keys.length > 0 ? null : p.value),
    x: p.expression,
    xe: p.expressionEnabled,
    k: p.keys.map((k) => plain({ t: k.time, v: k.value, i: k.inType, o: k.outType, ie: k.inEase, oe: k.outEase })),
  };
}

function dump(ae: MockAe): Json {
  return ae.comp!.stack.map((l) =>
    plain({
      name: l.name,
      kind: l.kind,
      parent: l.parent?.name ?? null,
      in: l.inPoint,
      out: l.outPoint,
      start: l.startTime,
      enabled: l.enabled,
      threeD: l.threeDLayer ?? false,
      matte: l.trackMatteLayer?.name ?? null,
      matteType: l.trackMatteType,
      blend: l.blendingMode,
      props: dumpProp(l.root),
    }),
  );
}

// ---------------------------------------------------------------------------
// The file the builder reads
// ---------------------------------------------------------------------------

function ascii(json: string): string {
  return json.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function render(recipes: Recipe[], resize: RecipeRun): string {
  const lines = [
    "// KVFX Tools walkthrough: demo scenes, as KVFX Tools builds them.",
    "//",
    "// GENERATED by packages/host/tests/walkthrough-recipes.test.ts from the shipped",
    "// commands. Do not edit by hand; regenerate with",
    "//   KVFX_WRITE_RECIPES=1 npx vitest run packages/host/tests/walkthrough-recipes.test.ts",
    "//",
    "// Each run is a plan for the KVFX host. {\"$layer\": name} stands for that layer's",
    "// id in the stage comp, filled in by the builder just before it sends the plan.",
    "",
    "var WT_RECIPES = [",
    recipes.map((recipe) => ascii(JSON.stringify(recipe))).join(",\n"),
    "];",
    "",
    `var WT_RESIZE = ${ascii(JSON.stringify(resize))};`,
    "",
  ];
  return lines.join("\n");
}

describe("walkthrough recipes", () => {
  const generated = new Map<string, { recipe: Recipe; state: Json }>();

  beforeAll(() => {
    MockLayer.realisticBounds = true;
  });
  afterAll(() => {
    MockLayer.realisticBounds = false;
  });

  for (const stage of STAGES) {
    it(`${stage.id}: plans run, and replay identically from names`, () => {
      const result = generate(stage);
      generated.set(stage.id, result);
      expect(replay(result.recipe, stage)).toEqual(result.state);
      // Nothing in the recipe may still carry a raw id from the run.
      expect(JSON.stringify(result.recipe.runs)).not.toMatch(/\b7\d{6}\b/);
    });
  }

  it("the committed file matches the shipped commands", () => {
    setNextMockId(RUN_IDS);
    const ae = createMockAe({ comp: { name: "WT Promo", width: 1920, height: 1080, frameRate: FPS, duration: 20, layers: [] } });
    const plan = planFor(ae, RESIZE.command!, RESIZE.params ?? {});
    const resize: RecipeRun = { label: RESIZE.label, at: 0, select: [], selectProps: [], selectKeys: [], undo: plan.undoGroup, budgetMs: plan.budgetMs ?? 5000, animate: false, steps: symbolic(plan.steps as unknown as Json, ae, RUN_IDS) as Json[] };
    expect(execute(ae, plan).ok).toBe(true);

    const recipes = STAGES.map((stage) => generated.get(stage.id)?.recipe ?? generate(stage).recipe);
    const text = render(recipes, resize);
    if (WRITE) writeFileSync(OUT, text);
    expect(existsSync(OUT), "run with KVFX_WRITE_RECIPES=1 to create the recipes file").toBe(true);
    expect(readFileSync(OUT, "utf8"), "recipes are stale: regenerate with KVFX_WRITE_RECIPES=1").toBe(text);
  });
});

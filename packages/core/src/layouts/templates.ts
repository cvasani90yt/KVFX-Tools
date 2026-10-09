import { type CounterSpec, type LayoutElement, wrapText } from "./elements.js";

/**
 * The layout library: interface scenes built from cards, text, circles,
 * bars, rings and lines. Every template is drawn here from scratch, in
 * design units around its centre, with its words in editable fields.
 */

/* eslint-disable no-magic-numbers -- a layout's coordinates are its design */

export type LayoutCategory = "Chat" | "Data" | "Cards" | "Frames" | "Lists";

export interface LayoutField {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

export interface LayoutTemplate {
  readonly id: string;
  readonly name: string;
  readonly category: LayoutCategory;
  /** The design's bounding box, for fitting it to the comp. */
  readonly size: readonly [number, number];
  readonly fields: readonly LayoutField[];
  build(get: (key: string) => string): LayoutElement[];
}

export const LAYOUT_CATEGORIES: readonly LayoutCategory[] = ["Chat", "Data", "Cards", "Frames", "Lists"];

/** A comma-separated field as trimmed items. */
export function listOf(value: string): string[] {
  return value.split(",").map((s) => s.trim());
}

/** A counter for a number written as text: "48,200" → 48200, "7.4" → one decimal. */
export function counterFor(value: string, prefix = "", suffix = ""): CounterSpec {
  const clean = value.replace(/[^0-9.-]/g, "");
  const to = Number.parseFloat(clean);
  const dot = clean.indexOf(".");
  return { from: 0, to: Number.isFinite(to) ? to : 0, decimals: dot >= 0 ? Math.min(3, clean.length - dot - 1) : 0, prefix, suffix };
}

/** Roughly how wide text sets, in design units, for sizing bubbles around it. */
function textWidth(text: string, size: number): number {
  const longest = Math.max(...text.split("\r").map((line) => line.length));
  return longest * size * 0.52;
}

// ---------------------------------------------------------------------------

const chat: LayoutTemplate = {
  id: "chat",
  name: "Chat Thread",
  category: "Chat",
  size: [1100, 820],
  fields: [
    { key: "name", label: "Contact", value: "Alex" },
    { key: "m1", label: "Message 1", value: "Hey! Is the launch video ready?" },
    { key: "m2", label: "Reply 1", value: "Almost — rendering the final cut now." },
    { key: "m3", label: "Message 2", value: "Can we add the new pricing?" },
    { key: "m4", label: "Reply 2", value: "Already in. Sending it over!" },
  ],
  build: (get) => {
    const out: LayoutElement[] = [];
    const size = 30;
    let top = -330;
    out.push({ kind: "text", name: "Contact", order: 0, x: -380, y: top - 20, text: get("name"), size: 22, color: "muted", align: "left", reveal: "fade" });
    ["m1", "m2", "m3", "m4"].forEach((key, i) => {
      const mine = i % 2 === 1;
      const text = wrapText(get(key), 26);
      const lines = text.split("\r").length;
      const w = Math.min(680, 60 + textWidth(text, size));
      const h = 40 + lines * 40;
      const left = mine ? 450 - w : -380;
      const order = i + 1;
      const reveal = mine ? "slideRight" : "slideLeft";
      out.push({ kind: "card", name: `Bubble ${String(i + 1)}`, order, x: left + w / 2, y: top + h / 2, w, h, radius: 26, fill: mine ? "accent" : "raised", reveal });
      out.push({ kind: "text", name: `Text ${String(i + 1)}`, order, x: left + 30, y: top + 50, text, size, color: mine ? "onAccent" : "text", align: "left", reveal });
      if (!mine) out.push({ kind: "circle", name: `Avatar ${String(i + 1)}`, order, x: -440, y: top + h - 28, d: 56, fill: "muted", reveal: "pop" });
      top += h + 28;
    });
    out.push({ kind: "card", name: "Typing", order: 5, x: -320, y: top + 32, w: 120, h: 64, radius: 32, fill: "raised", reveal: "pop" });
    out.push({ kind: "dots", name: "Typing Dots", order: 5, x: -320, y: top + 32, d: 12, color: "muted", reveal: "fade" });
    return out;
  },
};

const toast: LayoutTemplate = {
  id: "toast",
  name: "Notification",
  category: "Cards",
  size: [900, 220],
  fields: [
    { key: "title", label: "Title", value: "New sign-up" },
    { key: "body", label: "Message", value: "Jordan just joined the Pro plan" },
    { key: "time", label: "Time", value: "now" },
  ],
  build: (get) => [
    { kind: "card", name: "Toast", order: 0, x: 0, y: 0, w: 820, h: 160, radius: 32, fill: "surface", stroke: "edge", shadow: true, reveal: "drop" },
    { kind: "circle", name: "Icon", order: 1, x: -330, y: 0, d: 76, fill: "accent", reveal: "pop" },
    { kind: "circle", name: "Icon Dot", order: 1, x: -330, y: 0, d: 24, fill: "onAccent", reveal: "pop" },
    { kind: "text", name: "Title", order: 1, x: -262, y: -10, text: get("title"), size: 32, color: "text", align: "left", reveal: "drop" },
    { kind: "text", name: "Message", order: 2, x: -262, y: 34, text: get("body"), size: 25, color: "muted", align: "left", reveal: "drop" },
    { kind: "text", name: "Time", order: 2, x: 370, y: -10, text: get("time"), size: 21, color: "muted", align: "right", reveal: "fade" },
  ],
};

const metrics: LayoutTemplate = {
  id: "metrics",
  name: "Metric Cards",
  category: "Data",
  size: [1380, 300],
  fields: [
    { key: "labels", label: "Labels", value: "Revenue, Active users, Conversion" },
    { key: "values", label: "Values", value: "48200, 12840, 7.4" },
    { key: "prefixes", label: "Prefixes", value: "$, , " },
    { key: "suffixes", label: "Suffixes", value: ", , %" },
    { key: "deltas", label: "Changes", value: "+12%, +8%, +1.2%" },
  ],
  build: (get) => {
    const labels = listOf(get("labels"));
    const values = listOf(get("values"));
    const prefixes = listOf(get("prefixes"));
    const suffixes = listOf(get("suffixes"));
    const deltas = listOf(get("deltas"));
    const out: LayoutElement[] = [];
    [-450, 0, 450].forEach((x, i) => {
      out.push({ kind: "card", name: `Card ${String(i + 1)}`, order: i, x, y: 0, w: 420, h: 260, radius: 28, fill: "surface", stroke: "edge", shadow: true, reveal: "rise" });
      out.push({ kind: "text", name: `Label ${String(i + 1)}`, order: i, x: x - 176, y: -62, text: labels[i] ?? "", size: 24, color: "muted", align: "left", reveal: "rise" });
      out.push({
        kind: "text",
        name: `Value ${String(i + 1)}`,
        order: i + 0.5,
        x: x - 176,
        y: 30,
        text: values[i] ?? "0",
        size: 70,
        color: "text",
        align: "left",
        reveal: "rise",
        counter: counterFor(values[i] ?? "0", prefixes[i] ?? "", suffixes[i] ?? ""),
      });
      out.push({ kind: "card", name: `Change ${String(i + 1)}`, order: i + 1, x: x - 116, y: 82, w: 120, h: 40, radius: 20, fill: "raised", reveal: "pop" });
      out.push({ kind: "text", name: `Change Text ${String(i + 1)}`, order: i + 1, x: x - 116, y: 90, text: deltas[i] ?? "", size: 21, color: "good", align: "center", reveal: "pop" });
    });
    return out;
  },
};

function chartFrame(title: string): LayoutElement[] {
  return [
    { kind: "card", name: "Panel", order: 0, x: 0, y: 0, w: 960, h: 600, radius: 32, fill: "surface", stroke: "edge", shadow: true, reveal: "fade" },
    { kind: "text", name: "Title", order: 0.5, x: -420, y: -226, text: title, size: 34, color: "text", align: "left", reveal: "rise" },
    ...[0, 1, 2].map(
      (i): LayoutElement => ({ kind: "card", name: `Grid ${String(i + 1)}`, order: 0.5, x: 0, y: 190 - (i + 1) * 110, w: 840, h: 2, radius: 0, fill: "edge", reveal: "growX" }),
    ),
    { kind: "card", name: "Axis", order: 0.5, x: 0, y: 190, w: 840, h: 3, radius: 0, fill: "edge", reveal: "growX" },
  ];
}

function numbers(value: string): number[] {
  return listOf(value).map((v) => Number.parseFloat(v)).filter((v) => Number.isFinite(v));
}

const barChart: LayoutTemplate = {
  id: "bars",
  name: "Bar Chart",
  category: "Data",
  size: [1000, 640],
  fields: [
    { key: "title", label: "Title", value: "Weekly sign-ups" },
    { key: "values", label: "Values", value: "40, 65, 52, 80, 70, 96" },
    { key: "labels", label: "Labels", value: "Mon, Tue, Wed, Thu, Fri, Sat" },
  ],
  build: (get) => {
    const values = numbers(get("values")).slice(0, 12);
    const labels = listOf(get("labels"));
    const max = Math.max(1, ...values);
    const count = Math.max(1, values.length);
    const slot = 760 / count;
    const out = chartFrame(get("title"));
    values.forEach((value, i) => {
      const x = -380 + slot * (i + 0.5);
      out.push({ kind: "bar", name: `Bar ${String(i + 1)}`, order: 1 + i * 0.5, x, y: 190, w: Math.min(80, slot * 0.6), h: (value / max) * 320, radius: 12, fill: "accent", reveal: "growY" });
      out.push({ kind: "text", name: `Label ${String(i + 1)}`, order: 1 + i * 0.5, x, y: 238, text: labels[i] ?? "", size: 22, color: "muted", align: "center", reveal: "fade" });
    });
    return out;
  },
};

const lineChart: LayoutTemplate = {
  id: "line",
  name: "Line Chart",
  category: "Data",
  size: [1000, 640],
  fields: [
    { key: "title", label: "Title", value: "Monthly growth" },
    { key: "values", label: "Values", value: "12, 18, 15, 26, 31, 29, 42, 55" },
  ],
  build: (get) => {
    const values = numbers(get("values")).slice(0, 24);
    const max = Math.max(1, ...values);
    const min = Math.min(0, ...values);
    const points = values.map((v, i): [number, number] => [-400 + (800 * i) / Math.max(1, values.length - 1), 180 - ((v - min) / (max - min || 1)) * 320]);
    const last = points[points.length - 1] ?? [0, 0];
    return [
      ...chartFrame(get("title")),
      { kind: "line", name: "Line", order: 1, points, width: 8, color: "accent", reveal: "draw" },
      { kind: "circle", name: "End Dot", order: 3, x: last[0], y: last[1], d: 26, fill: "accent", reveal: "pop" },
    ];
  },
};

const ring: LayoutTemplate = {
  id: "ring",
  name: "Progress Ring",
  category: "Data",
  size: [600, 640],
  fields: [
    { key: "percent", label: "Percent", value: "72" },
    { key: "label", label: "Label", value: "Goal reached" },
  ],
  build: (get) => {
    const percent = Math.max(0, Math.min(100, Number.parseFloat(get("percent")) || 0));
    return [
      { kind: "ring", name: "Ring", order: 0, x: 0, y: -30, d: 400, width: 32, color: "accent", track: "track", progress: percent / 100, reveal: "draw" },
      { kind: "text", name: "Percent", order: 0, x: 0, y: 4, text: `${String(percent)}%`, size: 96, color: "text", align: "center", reveal: "scale", counter: { from: 0, to: percent, decimals: 0, prefix: "", suffix: "%" } },
      { kind: "text", name: "Label", order: 2, x: 0, y: 270, text: get("label"), size: 30, color: "muted", align: "center", reveal: "rise" },
    ];
  },
};

const feature: LayoutTemplate = {
  id: "feature",
  name: "Feature Card",
  category: "Cards",
  size: [620, 560],
  fields: [
    { key: "title", label: "Title", value: "Instant previews" },
    { key: "body", label: "Text", value: "See every change the moment you make it, right in your timeline." },
    { key: "button", label: "Button", value: "Learn more" },
  ],
  build: (get) => [
    { kind: "card", name: "Card", order: 0, x: 0, y: 0, w: 560, h: 500, radius: 36, fill: "surface", stroke: "edge", shadow: true, reveal: "rise" },
    { kind: "card", name: "Icon", order: 1, x: -180, y: -150, w: 96, h: 96, radius: 26, fill: "accent", reveal: "pop" },
    { kind: "circle", name: "Icon Mark", order: 1, x: -180, y: -150, d: 30, fill: "onAccent", reveal: "pop" },
    { kind: "text", name: "Title", order: 2, x: -228, y: -40, text: get("title"), size: 40, color: "text", align: "left", reveal: "rise" },
    { kind: "text", name: "Text", order: 2.5, x: -228, y: 10, text: wrapText(get("body"), 30), size: 26, color: "muted", align: "left", reveal: "rise" },
    { kind: "card", name: "Button", order: 3.5, x: -128, y: 180, w: 200, h: 64, radius: 32, fill: "accent", reveal: "pop" },
    { kind: "text", name: "Button Text", order: 3.5, x: -128, y: 188, text: get("button"), size: 24, color: "onAccent", align: "center", reveal: "pop" },
  ],
};

const kanban: LayoutTemplate = {
  id: "kanban",
  name: "Kanban Board",
  category: "Lists",
  size: [1260, 720],
  fields: [
    { key: "columns", label: "Columns", value: "To do, In progress, Done" },
    { key: "c1", label: "To do", value: "Write script, Pick music, Storyboard" },
    { key: "c2", label: "In progress", value: "Animate intro, Colour grade" },
    { key: "c3", label: "Done", value: "Record voice, Brand kit" },
  ],
  build: (get) => {
    const columns = listOf(get("columns"));
    const out: LayoutElement[] = [];
    [-410, 0, 410].forEach((x, c) => {
      const tasks = listOf(get(`c${String(c + 1)}`)).filter((t) => t.length > 0).slice(0, 4);
      out.push({ kind: "card", name: `Column ${String(c + 1)}`, order: c * 0.5, x, y: 0, w: 380, h: 660, radius: 28, fill: "raised", reveal: "rise" });
      out.push({ kind: "text", name: `Column Title ${String(c + 1)}`, order: c * 0.5, x: x - 160, y: -278, text: columns[c] ?? "", size: 28, color: "text", align: "left", reveal: "rise" });
      out.push({ kind: "text", name: `Count ${String(c + 1)}`, order: c * 0.5, x: x + 160, y: -278, text: String(tasks.length), size: 24, color: "muted", align: "right", reveal: "fade" });
      tasks.forEach((task, t) => {
        const y = -190 + t * 136;
        const order = 1 + c * 0.5 + t * 0.5;
        out.push({ kind: "card", name: `Task ${String(c + 1)}.${String(t + 1)}`, order, x, y, w: 340, h: 116, radius: 18, fill: "surface", stroke: "edge", reveal: "rise" });
        out.push({ kind: "text", name: `Task Text ${String(c + 1)}.${String(t + 1)}`, order, x: x - 146, y: y - 6, text: task, size: 25, color: "text", align: "left", reveal: "rise" });
        out.push({ kind: "card", name: `Tag ${String(c + 1)}.${String(t + 1)}`, order, x: x - 106, y: y + 32, w: 80, h: 12, radius: 6, fill: c === 2 ? "good" : "accent", reveal: "growX" });
      });
    });
    return out;
  },
};

const phone: LayoutTemplate = {
  id: "phone",
  name: "Phone Frame",
  category: "Frames",
  size: [480, 920],
  fields: [{ key: "time", label: "Clock", value: "9:41" }],
  build: (get) => [
    { kind: "card", name: "Body", order: 0, x: 0, y: 0, w: 440, h: 900, radius: 72, fill: "ink", stroke: "edge", shadow: true, reveal: "rise" },
    { kind: "card", name: "Screen", order: 0, x: 0, y: 0, w: 404, h: 864, radius: 56, fill: "raised", reveal: "rise" },
    { kind: "card", name: "Notch", order: 0.5, x: 0, y: -398, w: 130, h: 34, radius: 17, fill: "ink", reveal: "fade" },
    { kind: "text", name: "Clock", order: 0.5, x: -150, y: -390, text: get("time"), size: 22, color: "text", align: "left", reveal: "fade" },
    { kind: "card", name: "Side Button", order: 0, x: 224, y: -200, w: 8, h: 96, radius: 4, fill: "ink", reveal: "rise" },
    { kind: "card", name: "Home Bar", order: 1, x: 0, y: 410, w: 150, h: 8, radius: 4, fill: "muted", reveal: "fade" },
  ],
};

const browser: LayoutTemplate = {
  id: "browser",
  name: "Browser Window",
  category: "Frames",
  size: [1320, 800],
  fields: [{ key: "url", label: "Address", value: "yourproduct.app" }],
  build: (get) => [
    { kind: "card", name: "Window", order: 0, x: 0, y: 0, w: 1280, h: 760, radius: 22, fill: "surface", stroke: "edge", shadow: true, reveal: "rise" },
    { kind: "card", name: "Toolbar", order: 0, x: 0, y: -346, w: 1280, h: 68, radius: 22, fill: "raised", reveal: "rise" },
    { kind: "card", name: "Toolbar Edge", order: 0, x: 0, y: -312, w: 1280, h: 2, radius: 0, fill: "edge", reveal: "growX" },
    ...[0, 1, 2].map((i): LayoutElement => ({ kind: "circle", name: `Dot ${String(i + 1)}`, order: 0.5 + i * 0.2, x: -596 + i * 30, y: -346, d: 16, fill: "muted", reveal: "pop" })),
    { kind: "card", name: "Address Bar", order: 1, x: 0, y: -346, w: 560, h: 38, radius: 19, fill: "surface", reveal: "growX" },
    { kind: "text", name: "Address", order: 1.5, x: 0, y: -339, text: get("url"), size: 20, color: "muted", align: "center", reveal: "fade" },
  ],
};

const stack: LayoutTemplate = {
  id: "stack",
  name: "Card Stack",
  category: "Cards",
  size: [900, 620],
  fields: [
    { key: "title", label: "Title", value: "Your projects" },
    { key: "body", label: "Text", value: "Three ideas, one place." },
  ],
  build: (get) => [
    { kind: "card", name: "Back", order: 0, x: -70, y: -40, w: 540, h: 330, radius: 34, fill: "raised", rotation: -9, reveal: "scale" },
    { kind: "card", name: "Middle", order: 0.5, x: 70, y: -10, w: 540, h: 330, radius: 34, fill: "raised", stroke: "edge", rotation: 6, reveal: "scale" },
    { kind: "card", name: "Front", order: 1, x: 0, y: 40, w: 540, h: 330, radius: 34, fill: "surface", stroke: "edge", shadow: true, reveal: "rise" },
    { kind: "card", name: "Front Accent", order: 1.5, x: -170, y: -50, w: 140, h: 14, radius: 7, fill: "accent", reveal: "growX" },
    { kind: "text", name: "Title", order: 1.5, x: -238, y: 30, text: get("title"), size: 42, color: "text", align: "left", reveal: "rise" },
    { kind: "text", name: "Text", order: 2, x: -238, y: 82, text: get("body"), size: 26, color: "muted", align: "left", reveal: "rise" },
  ],
};

const pricing: LayoutTemplate = {
  id: "pricing",
  name: "Pricing Card",
  category: "Cards",
  size: [600, 760],
  fields: [
    { key: "plan", label: "Plan", value: "Pro" },
    { key: "price", label: "Price", value: "29" },
    { key: "currency", label: "Currency", value: "$" },
    { key: "period", label: "Period", value: "per month" },
    { key: "features", label: "Features", value: "Unlimited projects, 4K export, Priority support" },
    { key: "button", label: "Button", value: "Get started" },
  ],
  build: (get) => {
    const features = listOf(get("features")).filter((f) => f.length > 0).slice(0, 5);
    const out: LayoutElement[] = [
      { kind: "card", name: "Card", order: 0, x: 0, y: 0, w: 540, h: 700, radius: 36, fill: "surface", stroke: "edge", shadow: true, reveal: "rise" },
      { kind: "text", name: "Plan", order: 1, x: -220, y: -262, text: get("plan"), size: 28, color: "accent", align: "left", reveal: "rise" },
      { kind: "text", name: "Price", order: 1.5, x: -220, y: -160, text: `${get("currency")}${get("price")}`, size: 92, color: "text", align: "left", reveal: "rise", counter: counterFor(get("price"), get("currency")) },
      { kind: "text", name: "Period", order: 2, x: -220, y: -116, text: get("period"), size: 24, color: "muted", align: "left", reveal: "fade" },
      { kind: "card", name: "Divider", order: 2, x: 0, y: -76, w: 460, h: 2, radius: 0, fill: "edge", reveal: "growX" },
    ];
    features.forEach((feature, i) => {
      const y = -20 + i * 62;
      out.push({ kind: "circle", name: `Check ${String(i + 1)}`, order: 2.5 + i * 0.5, x: -208, y: y - 8, d: 28, fill: "good", reveal: "pop" });
      out.push({ kind: "text", name: `Feature ${String(i + 1)}`, order: 2.5 + i * 0.5, x: -176, y, text: feature, size: 26, color: "text", align: "left", reveal: "rise" });
    });
    out.push(
      { kind: "card", name: "Button", order: 4, x: 0, y: 270, w: 460, h: 76, radius: 38, fill: "accent", reveal: "pop" },
      { kind: "text", name: "Button Text", order: 4, x: 0, y: 279, text: get("button"), size: 27, color: "onAccent", align: "center", reveal: "pop" },
    );
    return out;
  },
};

const list: LayoutTemplate = {
  id: "list",
  name: "Team List",
  category: "Lists",
  size: [900, 620],
  fields: [
    { key: "title", label: "Title", value: "Team" },
    { key: "names", label: "Names", value: "Ava Chen, Leo Park, Mia Ross, Sam Lee" },
    { key: "roles", label: "Roles", value: "Design, Engineering, Marketing, Support" },
    { key: "statuses", label: "Statuses", value: "Online, Away, Online, Busy" },
  ],
  build: (get) => {
    const names = listOf(get("names")).slice(0, 5);
    const roles = listOf(get("roles"));
    const statuses = listOf(get("statuses"));
    const out: LayoutElement[] = [
      { kind: "card", name: "Panel", order: 0, x: 0, y: 0, w: 860, h: 580, radius: 32, fill: "surface", stroke: "edge", shadow: true, reveal: "fade" },
      { kind: "text", name: "Title", order: 0.5, x: -380, y: -222, text: get("title"), size: 32, color: "text", align: "left", reveal: "rise" },
    ];
    names.forEach((name, i) => {
      const y = -130 + i * 98;
      const order = 1 + i * 0.6;
      out.push({ kind: "circle", name: `Avatar ${String(i + 1)}`, order, x: -350, y, d: 58, fill: i % 2 === 0 ? "accent" : "muted", reveal: "pop" });
      out.push({ kind: "text", name: `Name ${String(i + 1)}`, order, x: -302, y: y - 4, text: name, size: 27, color: "text", align: "left", reveal: "rise" });
      out.push({ kind: "text", name: `Role ${String(i + 1)}`, order, x: -302, y: y + 26, text: roles[i] ?? "", size: 21, color: "muted", align: "left", reveal: "rise" });
      out.push({ kind: "card", name: `Status ${String(i + 1)}`, order: order + 0.3, x: 320, y, w: 130, h: 40, radius: 20, fill: "raised", reveal: "pop" });
      out.push({ kind: "text", name: `Status Text ${String(i + 1)}`, order: order + 0.3, x: 320, y: y + 8, text: statuses[i] ?? "", size: 20, color: statuses[i] === "Online" ? "good" : "muted", align: "center", reveal: "pop" });
      if (i < names.length - 1) out.push({ kind: "card", name: `Divider ${String(i + 1)}`, order, x: 0, y: y + 49, w: 780, h: 2, radius: 0, fill: "edge", reveal: "growX" });
    });
    return out;
  },
};

const quote: LayoutTemplate = {
  id: "quote",
  name: "Testimonial",
  category: "Cards",
  size: [1000, 460],
  fields: [
    { key: "quote", label: "Quote", value: "We shipped our launch video in a day. The whole team was blown away." },
    { key: "name", label: "Name", value: "Priya Nair" },
    { key: "role", label: "Role", value: "Head of Marketing" },
  ],
  build: (get) => [
    { kind: "card", name: "Card", order: 0, x: 0, y: 0, w: 940, h: 400, radius: 36, fill: "surface", stroke: "edge", shadow: true, reveal: "rise" },
    { kind: "text", name: "Mark", order: 1, x: -400, y: -40, text: "“", size: 150, color: "accent", align: "left", reveal: "pop" },
    { kind: "text", name: "Quote", order: 1.5, x: -320, y: -80, text: wrapText(get("quote"), 40), size: 34, color: "text", align: "left", reveal: "rise" },
    { kind: "circle", name: "Avatar", order: 2.5, x: -290, y: 124, d: 64, fill: "accent", reveal: "pop" },
    { kind: "text", name: "Name", order: 2.5, x: -242, y: 118, text: get("name"), size: 28, color: "text", align: "left", reveal: "rise" },
    { kind: "text", name: "Role", order: 3, x: -242, y: 150, text: get("role"), size: 22, color: "muted", align: "left", reveal: "rise" },
  ],
};

export const LAYOUT_TEMPLATES: readonly LayoutTemplate[] = [
  chat,
  toast,
  metrics,
  barChart,
  lineChart,
  ring,
  feature,
  stack,
  pricing,
  quote,
  kanban,
  list,
  phone,
  browser,
];

export function layoutTemplate(id: string): LayoutTemplate | undefined {
  return LAYOUT_TEMPLATES.find((t) => t.id === id);
}

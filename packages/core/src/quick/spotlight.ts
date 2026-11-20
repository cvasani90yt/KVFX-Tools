import type { QuickColours } from "../storage/settings.js";
import { type QuickGroup, type QuickTool, QUICK_GROUPS, quickToolsOf } from "./index.js";

/**
 * The Quick tab's Spotlight layout: what leads, and in what colours.
 *
 *   hero    the panel colour, as a strip that glows in it, with the other
 *           colour tools beside it (From Comp, Fill, Text Colour…)
 *   pinned  up to four tools the user starred, as large tiles
 *   cards   tools that open a screen of presets and can show the one they'll
 *           use (Transition, Speed Ramp), as cards with a live preview
 *   grid    everything else, as compact tiles
 *
 * Every tool stays one click away; the zones only decide how much room each
 * gets. Within a zone, tools keep the order the user arranged.
 */

export const MAX_QUICK_PINS = 4;
/** Tools beside the colour in the hero strip; any more go to the grid. */
export const MAX_HERO_TOOLS = 3;
/** Tools shown as live cards when they aren't pinned. */
export const QUICK_CARDS: readonly string[] = ["kvfx.rig.transition", "kvfx.rig.speedRamp"];

export interface SpotlightZones {
  /** The colour widget leads, when the list has it. */
  readonly hero: boolean;
  readonly heroTools: readonly QuickTool[];
  readonly pinned: readonly QuickTool[];
  readonly cards: readonly QuickTool[];
  readonly grid: readonly QuickTool[];
}

export function spotlightZones(ids: readonly string[], pins: readonly string[]): SpotlightZones {
  const tools = quickToolsOf(ids);
  const pinSet = new Set(pins.filter((id) => id !== "colour").slice(0, MAX_QUICK_PINS));
  const hero = tools.some((t) => t.widget === "colour");
  const heroTools: QuickTool[] = [];
  const pinned: QuickTool[] = [];
  const cards: QuickTool[] = [];
  const grid: QuickTool[] = [];
  for (const tool of tools) {
    if (tool.widget === "colour") continue;
    if (pinSet.has(tool.id)) pinned.push(tool);
    else if (hero && tool.group === "colour" && heroTools.length < MAX_HERO_TOOLS) heroTools.push(tool);
    else if (QUICK_CARDS.includes(tool.id)) cards.push(tool);
    else grid.push(tool);
  }
  return { hero, heroTools, pinned, cards, grid };
}

/** Stars a tool, or unstars it; a fifth star replaces the oldest. */
export function togglePin(pins: readonly string[], id: string): string[] {
  if (pins.includes(id)) return pins.filter((p) => p !== id);
  if (id === "colour") return [...pins];
  return [...pins, id].slice(-MAX_QUICK_PINS);
}

/** One line under a pinned tool's name. */
const HINTS: Readonly<Record<string, string>> = {
  pickComp: "Colour from the frame",
  "kvfx.fx.fill": "Fill with the colour",
  "kvfx.text.color": "Recolour text",
  "kvfx.comp.deepduplicatecomp": "With nested comps",
  "kvfx.comp.deepduplicate": "Own copies of its comps",
  "kvfx.layer.precomposeeach": "Each layer on its own",
  "kvfx.layer.unprecompose": "Layers back out",
  "kvfx.layer.nullparent": "Linked to a new null",
  "kvfx.layer.split": "At the playhead",
  "kvfx.layer.trimworkarea": "To the work area",
  "kvfx.layer.sequence": "Stagger in time",
  "kvfx.layer.follow": "Without parenting",
  "kvfx.label.selectsame": "By label colour",
  "kvfx.layer.unlockall": "Every layer",
  "kvfx.keys.ease": "The Ease tab's curve",
  "kvfx.keys.wiggle": "Organic motion",
  "kvfx.fx.add.shadow": "Drop shadow",
  "kvfx.fx.add.glow": "Soft glow",
  "kvfx.rig.transition": "At the cut",
  "kvfx.rig.speedRamp": "Ramp the clip",
  "kvfx.text.animate": "Text in or out",
  "kvfx.layer.createnull": "Linked to the selection",
  "kvfx.layer.createsolid": "In the panel colour",
  "kvfx.layer.createtext": "New text layer",
  "kvfx.layer.createshape": "New shape layer",
  "kvfx.layer.createadjustment": "Full-size adjustment",
  "kvfx.layer.createcamera": "Centred on the comp",
};

export function quickHint(tool: QuickTool): string {
  return HINTS[tool.id] ?? QUICK_GROUPS.find((g) => g.id === tool.group)?.label ?? "";
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

export const QUICK_COLOUR_SCHEMES: readonly { readonly id: QuickColours; readonly label: string; readonly about: string }[] = [
  { id: "sections", label: "Sections", about: "A colour for each section" },
  { id: "ember", label: "Ember", about: "Every icon in KVFX orange" },
  { id: "spectrum", label: "Spectrum", about: "Warm steps from gold to violet" },
  { id: "panel", label: "Your colour", about: "Follows the panel colour" },
];

const EMBER = "#ff8f3f";

/** Each scheme's nine colours, at a similar brightness so no section shouts. */
const SCHEMES: Readonly<Record<Exclude<QuickColours, "panel">, Readonly<Record<QuickGroup, string>>>> = {
  sections: { colour: EMBER, comp: "#f5b94a", organize: "#4cc9a6", switches: "#9aaccc", keys: "#b794ff", text: "#ff85b3", fx: "#57c7ee", generate: "#ff6e61", create: "#86d96b" },
  ember: { colour: EMBER, comp: EMBER, organize: EMBER, switches: EMBER, keys: EMBER, text: EMBER, fx: EMBER, generate: EMBER, create: EMBER },
  spectrum: { colour: EMBER, comp: "#ffb347", organize: "#ff7348", switches: "#ff5f5f", keys: "#ff5c84", text: "#f062a6", fx: "#d86cc9", generate: "#b77ff0", create: "#ffd25e" },
};

/* eslint-disable no-magic-numbers -- colour arithmetic */

function channels(hex: string): [number, number, number] {
  const n = parseInt(/^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? "ff8f3f", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** "rgba(r, g, b, a)": the panel's engine can't mix colours in CSS, so tints are made here. */
export function rgbaOf(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}

/**
 * The same hue, lightened or saturated as needed to read as an icon on the
 * panel's dark tiles: a near-black or a grey panel colour still gives a
 * visible accent.
 */
export function readableAccent(hex: string): string {
  const [r, g, b] = channels(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const L = Math.min(0.78, Math.max(0.6, l));
  const S = d > 0 ? Math.max(s, 0.45) : 0;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[R, G, B].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/* eslint-enable no-magic-numbers */

/** The nine section colours for a scheme; "panel" follows the panel colour. */
export function quickColours(scheme: QuickColours, panelColour: string): Readonly<Record<QuickGroup, string>> {
  if (scheme !== "panel") return SCHEMES[scheme];
  const accent = readableAccent(panelColour);
  return Object.fromEntries(QUICK_GROUPS.map((g) => [g.id, accent])) as Record<QuickGroup, string>;
}

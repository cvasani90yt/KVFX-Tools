import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUICK_PINS,
  DEFAULT_QUICK_TOOLS,
  MAX_QUICK_PINS,
  QUICK_GROUPS,
  defaultSettings,
  migrateSettings,
  quickColours,
  quickHint,
  quickToolById,
  readableAccent,
  rgbaOf,
  spotlightZones,
  togglePin,
} from "../src/index.js";

/** The Quick tab's Spotlight layout: what leads, and in what colours. */

const ids = (tools: readonly { id: string }[]): string[] => tools.map((t) => t.id);

describe("Spotlight zones", () => {
  it("ships with the colour leading, two pins, two live cards and an even grid", () => {
    const zones = spotlightZones(DEFAULT_QUICK_TOOLS, DEFAULT_QUICK_PINS);
    expect(zones.hero).toBe(true);
    expect(ids(zones.heroTools)).toEqual(["pickComp", "kvfx.fx.fill", "kvfx.text.color"]);
    expect(ids(zones.pinned)).toEqual(["kvfx.comp.deepduplicatecomp", "kvfx.layer.precomposeeach"]);
    expect(ids(zones.cards)).toEqual(["kvfx.rig.transition", "kvfx.rig.speedRamp"]);
    // Twelve fill rows of two, three, four or six columns with no gap.
    expect(zones.grid).toHaveLength(12);
    expect(ids(zones.grid)).not.toContain("kvfx.layer.nullparent");
  });

  it("keeps the user's order inside each zone, and every tool exactly once", () => {
    const list = ["kvfx.layer.split", "colour", "kvfx.fx.fill", "kvfx.rig.speedRamp", "kvfx.keys.ease", "kvfx.rig.transition"];
    const zones = spotlightZones(list, ["kvfx.keys.ease"]);
    expect(ids(zones.cards)).toEqual(["kvfx.rig.speedRamp", "kvfx.rig.transition"]);
    const all = [...zones.heroTools, ...zones.pinned, ...zones.cards, ...zones.grid].map((t) => t.id);
    expect(all.sort()).toEqual(list.filter((id) => id !== "colour").sort());
  });

  it("puts colour tools in the grid when the colour itself isn't on the tab", () => {
    const zones = spotlightZones(["kvfx.fx.fill", "pickComp"], []);
    expect(zones.hero).toBe(false);
    expect(ids(zones.grid)).toEqual(["kvfx.fx.fill", "pickComp"]);
  });

  it("sends a fourth colour tool to the grid, and a pinned card becomes a large tile", () => {
    const zones = spotlightZones(["colour", "pickComp", "kvfx.fx.fill", "kvfx.text.color", "kvfx.fx.gradientlock", "kvfx.rig.transition"], ["kvfx.rig.transition"]);
    expect(zones.heroTools).toHaveLength(3);
    expect(ids(zones.grid)).toEqual(["kvfx.fx.gradientlock"]);
    expect(ids(zones.pinned)).toEqual(["kvfx.rig.transition"]);
    expect(zones.cards).toEqual([]);
  });

  it("ignores pins for tools that aren't on the tab", () => {
    expect(spotlightZones(["kvfx.layer.split"], ["kvfx.comp.deepduplicatecomp"]).pinned).toEqual([]);
  });
});

describe("pinning", () => {
  it("stars and unstars, never the colour, and a fifth star replaces the oldest", () => {
    expect(togglePin(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePin(["a", "b"], "a")).toEqual(["b"]);
    expect(togglePin([], "colour")).toEqual([]);
    expect(togglePin(["a", "b", "c", "d"], "e")).toEqual(["b", "c", "d", "e"]);
    expect(MAX_QUICK_PINS).toBe(4);
  });

  it("gives every pinned tool a line under its name", () => {
    expect(quickHint(quickToolById("kvfx.comp.deepduplicatecomp")!)).toBe("With nested comps");
    expect(quickHint(quickToolById("kvfx.layer.createnull")!)).toBe("Linked to the selection");
    // A tool without its own line gets its section's name.
    expect(quickHint(quickToolById("kvfx.keys.bounce")!)).toBe("Keyframes");
  });
});

describe("Quick colour schemes", () => {
  it("gives Sections a distinct colour for each section, and Ember one orange", () => {
    const sections = Object.values(quickColours("sections", "#ffffff"));
    expect(new Set(sections).size).toBe(QUICK_GROUPS.length);
    expect(new Set(Object.values(quickColours("ember", "#ffffff")))).toEqual(new Set(["#ff8f3f"]));
    for (const scheme of ["sections", "ember", "spectrum"] as const) expect(quickColours(scheme, "#000000").colour).toBe("#ff8f3f");
  });

  it("follows the panel colour, made readable on dark tiles", () => {
    const panel = quickColours("panel", "#0a1f66");
    expect(new Set(Object.values(panel)).size).toBe(1);
    const accent = panel.comp;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16) / 255) as [number, number, number];
    expect((Math.max(r, g, b) + Math.min(r, g, b)) / 2).toBeGreaterThanOrEqual(0.59);
    expect(b).toBeGreaterThan(r);
    // Black becomes a visible grey; a colour already readable stays close to itself.
    expect(readableAccent("#000000")).toBe("#999999");
    expect(readableAccent("#ff8f3f")).toBe("#ff8f3f");
  });

  it("makes CSS tints the panel's engine can use without color-mix()", () => {
    expect(rgbaOf("#ff8f3f", 0.16)).toBe("rgba(255, 143, 63, 0.16)");
  });
});

describe("Spotlight settings", () => {
  it("default to Sections colours, icon wells and the two shipped pins", () => {
    const ui = defaultSettings().ui;
    expect([ui.quickColours, ui.quickTiles, ui.quickPins]).toEqual(["sections", "well", DEFAULT_QUICK_PINS]);
  });

  it("read back what was saved, and fall back on anything unknown", () => {
    const ui = migrateSettings({ schemaVersion: 4, ui: { quickColours: "spectrum", quickTiles: "soft", quickPins: ["kvfx.layer.split"] } }).settings.ui;
    expect([ui.quickColours, ui.quickTiles, ui.quickPins]).toEqual(["spectrum", "soft", ["kvfx.layer.split"]]);
    const bad = migrateSettings({ schemaVersion: 4, ui: { quickColours: "neon", quickTiles: 3, quickPins: "x" } }).settings.ui;
    expect([bad.quickColours, bad.quickTiles, bad.quickPins]).toEqual(["sections", "well", DEFAULT_QUICK_PINS]);
    expect(migrateSettings({ schemaVersion: 4, ui: { quickPins: [] } }).settings.ui.quickPins).toEqual([]);
  });

  it("bring back the anchor grid and align bar for a panel left in the old Quick-only layout", () => {
    const others = ["tools", "ease", "text", "fx", "generate", "labels", "library", "media"];
    const quickOnly = migrateSettings({ schemaVersion: 3, ui: { hiddenTabs: others, quickBar: false, alignBar: false } }).settings.ui;
    expect([quickOnly.quickBar, quickOnly.alignBar]).toEqual([true, true]);
    // Someone who turned the bars off on a fuller panel keeps their choice.
    const chosen = migrateSettings({ schemaVersion: 3, ui: { hiddenTabs: ["media"], quickBar: false, alignBar: false } }).settings.ui;
    expect([chosen.quickBar, chosen.alignBar]).toEqual([false, false]);
    // And a file already at version 4 is left as it is.
    const current = migrateSettings({ schemaVersion: 4, ui: { hiddenTabs: others, quickBar: false, alignBar: false } }).settings.ui;
    expect([current.quickBar, current.alignBar]).toEqual([false, false]);
  });
});

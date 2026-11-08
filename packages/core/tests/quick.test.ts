import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUICK_TOOLS,
  QUICK_GROUPS,
  QUICK_TOOLS,
  addQuickTool,
  createProductionCommandRegistry,
  defaultSettings,
  migrateSettings,
  moveQuickTool,
  quickToolById,
  quickToolsOf,
  removeQuickTool,
} from "../src/index.js";

describe("Quick tab catalog", () => {
  it("only offers commands that exist, each once, in a known group", () => {
    const registry = createProductionCommandRegistry();
    expect(new Set(QUICK_TOOLS.map((t) => t.id)).size).toBe(QUICK_TOOLS.length);
    const groups = new Set(QUICK_GROUPS.map((g) => g.id));
    for (const tool of QUICK_TOOLS) {
      expect(groups.has(tool.group), tool.id).toBe(true);
      if (tool.widget === undefined) {
        expect(tool.command, tool.id).toBe(tool.id);
        expect(registry.get(tool.id), tool.id).toBeDefined();
      }
    }
  });

  it("keeps labels short enough for a small tile", () => {
    for (const tool of QUICK_TOOLS) expect(tool.label.length, tool.id).toBeLessThanOrEqual(12);
  });

  it("leaves out tools that need their own screen to be safe, like Resize Comps", () => {
    expect(quickToolById("kvfx.comp.resize")).toBeUndefined();
  });

  it("ships with the colour picker, Duplicate Comp and the organize tools first", () => {
    for (const id of DEFAULT_QUICK_TOOLS) expect(quickToolById(id), id).toBeDefined();
    expect(DEFAULT_QUICK_TOOLS.slice(0, 3)).toEqual(["colour", "pickComp", "pickScreen"]);
    expect(DEFAULT_QUICK_TOOLS).toContain("kvfx.comp.deepduplicatecomp");
    expect(DEFAULT_QUICK_TOOLS).toContain("kvfx.layer.sequence");
    expect(defaultSettings().ui.quickTools).toEqual(DEFAULT_QUICK_TOOLS);
  });
});

describe("arranging the Quick tab", () => {
  const ids = ["colour", "kvfx.fx.fill", "kvfx.layer.split"];

  it("adds a tool once, at the end, and never one that doesn't exist", () => {
    expect(addQuickTool(ids, "kvfx.keys.bounce")).toEqual([...ids, "kvfx.keys.bounce"]);
    expect(addQuickTool(ids, "kvfx.fx.fill")).toEqual(ids);
    expect(addQuickTool(ids, "kvfx.nothing")).toEqual(ids);
  });

  it("removes and moves tools", () => {
    expect(removeQuickTool(ids, "kvfx.fx.fill")).toEqual(["colour", "kvfx.layer.split"]);
    expect(moveQuickTool(ids, "kvfx.layer.split", 0)).toEqual(["kvfx.layer.split", "colour", "kvfx.fx.fill"]);
    expect(moveQuickTool(ids, "colour", 9)).toEqual(["kvfx.fx.fill", "kvfx.layer.split", "colour"]);
    expect(moveQuickTool(ids, "missing", 0)).toEqual(ids);
  });

  it("skips saved ids this build doesn't have, and duplicates", () => {
    expect(quickToolsOf(["kvfx.fx.fill", "kvfx.gone", "kvfx.fx.fill", "colour"]).map((t) => t.id)).toEqual(["kvfx.fx.fill", "colour"]);
  });
});

describe("Quick tab settings", () => {
  it("open on Quick, with labels, unless the user chose otherwise", () => {
    const ui = defaultSettings().ui;
    expect([ui.startTab, ui.quickLabels]).toEqual(["quick", true]);
    const read = migrateSettings({ schemaVersion: 3, ui: { startTab: "last", quickLabels: false, quickTools: ["kvfx.fx.fill"] } }).settings.ui;
    expect([read.startTab, read.quickLabels, read.quickTools]).toEqual(["last", false, ["kvfx.fx.fill"]]);
  });

  it("give a file from before the Quick tab the shipped tools, but keep a list the user emptied", () => {
    expect(migrateSettings({ schemaVersion: 2, ui: {} }).settings.ui.quickTools).toEqual(DEFAULT_QUICK_TOOLS);
    expect(migrateSettings({ schemaVersion: 3, ui: { quickTools: [] } }).settings.ui.quickTools).toEqual([]);
  });

  it("put Quick first in a tab order, and in saved layouts, written before it existed", () => {
    const ui = migrateSettings({
      schemaVersion: 2,
      ui: {
        tabOrder: ["generate", "tools"],
        customLayouts: [{ name: "Edit", layout: { tabOrder: ["media", "fx"] } }, { name: "Plain", layout: { tabOrder: [] } }],
      },
    }).settings.ui;
    expect(ui.tabOrder).toEqual(["quick", "generate", "tools"]);
    expect(ui.customLayouts.map((l) => l.layout.tabOrder)).toEqual([["quick", "media", "fx"], []]);
    expect(migrateSettings({ schemaVersion: 2, ui: {} }).settings.ui.tabOrder).toEqual([]);
    expect(migrateSettings({ schemaVersion: 3, ui: { tabOrder: ["tools", "quick"] } }).settings.ui.tabOrder).toEqual(["tools", "quick"]);
  });
});

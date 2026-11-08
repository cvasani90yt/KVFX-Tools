import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAB_ORDER,
  MAX_CUSTOM_LAYOUTS,
  PANEL_LAYOUTS,
  applyLayout,
  currentLayout,
  defaultSettings,
  deleteLayout,
  migrateSettings,
  moveTab,
  orderTabs,
  panelLayoutById,
  sameLayout,
  saveLayout,
  visibleTabs,
} from "../src/index.js";

const TABS = DEFAULT_TAB_ORDER;

describe("panel layout presets", () => {
  it("has six, with unique ids, and Full is the panel as it ships", () => {
    expect(PANEL_LAYOUTS.length).toBe(6);
    expect(new Set(PANEL_LAYOUTS.map((p) => p.id)).size).toBe(PANEL_LAYOUTS.length);
    expect(sameLayout(panelLayoutById("full")!.layout, currentLayout(defaultSettings().ui), TABS)).toBe(true);
  });

  it("each looks different from every other", () => {
    for (const a of PANEL_LAYOUTS) {
      for (const b of PANEL_LAYOUTS) {
        if (a !== b) expect(sameLayout(a.layout, b.layout, TABS), `${a.id} vs ${b.id}`).toBe(false);
      }
    }
  });

  it("only name tabs the panel has, and always leave some showing", () => {
    for (const preset of PANEL_LAYOUTS) {
      for (const id of [...preset.layout.tabOrder, ...preset.layout.hiddenTabs]) expect(TABS, preset.id).toContain(id);
      expect(visibleTabs(preset.layout, TABS).length, preset.id).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("tab order", () => {
  it("puts listed tabs first in their order and the rest after in theirs", () => {
    expect(orderTabs(["a", "b", "c", "d"], ["c", "a"])).toEqual(["c", "a", "b", "d"]);
    expect(orderTabs(["a", "b"], ["z", "b"])).toEqual(["b", "a"]);
  });

  it("moves a tab one place and keeps the whole order", () => {
    let settings = moveTab(defaultSettings(), TABS, "generate", -1);
    expect(settings.ui.tabOrder).toEqual(["tools", "ease", "text", "generate", "fx", "labels", "library", "media"]);
    settings = moveTab(settings, TABS, "tools", -1);
    expect(settings.ui.tabOrder[0]).toBe("tools");
    settings = moveTab(settings, TABS, "media", 1);
    expect(settings.ui.tabOrder[settings.ui.tabOrder.length - 1]).toBe("media");
  });

  it("a tab added in a later version arrives at the end, not missing", () => {
    const shown = visibleTabs({ ...currentLayout(defaultSettings().ui), tabOrder: ["media", "tools"] }, [...TABS, "new"]);
    expect(shown[shown.length - 1]).toBe("new");
  });
});

describe("applying, saving and deleting layouts", () => {
  it("applies every part of a preset", () => {
    const editor = panelLayoutById("editor")!.layout;
    const ui = applyLayout(defaultSettings(), editor, TABS).ui;
    expect(ui.tabOrder.slice(0, 2)).toEqual(["generate", "media"]);
    expect(ui.hiddenTabs).toEqual(["ease"]);
    expect([ui.tabPosition, ui.quickBar, ui.alignBar, ui.tabStyle, ui.compact]).toEqual(["bottom", false, false, "both", false]);
    expect(sameLayout(currentLayout(ui), editor, TABS)).toBe(true);
  });

  it("never hides every tab", () => {
    const layout = { ...currentLayout(defaultSettings().ui), hiddenTabs: [...TABS] };
    const ui = applyLayout(defaultSettings(), layout, TABS).ui;
    expect(visibleTabs(currentLayout(ui), TABS)).toEqual(["tools"]);
    expect(ui.hiddenTabs).not.toContain("tools");
  });

  it("leaves everything else alone — sections, tooltips, favourites", () => {
    const before = { ...defaultSettings(), favourites: ["kvfx.layer.createnull"], ui: { ...defaultSettings().ui, hiddenSections: ["gen.counter"], tooltips: false } };
    const after = applyLayout(before, panelLayoutById("minimal")!.layout, TABS);
    expect(after.favourites).toEqual(["kvfx.layer.createnull"]);
    expect(after.ui.hiddenSections).toEqual(["gen.counter"]);
    expect(after.ui.tooltips).toBe(false);
  });

  it("saves the current layout by name, replacing one with the same name", () => {
    let settings = applyLayout(defaultSettings(), panelLayoutById("motion")!.layout, TABS);
    settings = saveLayout(settings, "  My motion  ", TABS);
    settings = saveLayout(settings, "   ", TABS);
    expect(settings.ui.customLayouts.map((l) => l.name)).toEqual(["My motion"]);
    expect(sameLayout(settings.ui.customLayouts[0]!.layout, panelLayoutById("motion")!.layout, TABS)).toBe(true);
    settings = applyLayout(settings, panelLayoutById("compact")!.layout, TABS);
    settings = saveLayout(settings, "My motion", TABS);
    expect(settings.ui.customLayouts).toHaveLength(1);
    expect(settings.ui.customLayouts[0]!.layout.compact).toBe(true);
    expect(deleteLayout(settings, "My motion").ui.customLayouts).toEqual([]);
  });

  it("keeps at most a dozen saved layouts, dropping the oldest", () => {
    let settings = defaultSettings();
    for (let i = 0; i < MAX_CUSTOM_LAYOUTS + 3; i += 1) settings = saveLayout(settings, `L${String(i)}`, TABS);
    expect(settings.ui.customLayouts).toHaveLength(MAX_CUSTOM_LAYOUTS);
    expect(settings.ui.customLayouts[0]!.name).toBe("L3");
  });
});

describe("layout settings on disk", () => {
  it("default to the full layout", () => {
    const ui = defaultSettings().ui;
    expect([ui.tabOrder, ui.tabStyle, ui.tabPosition, ui.quickBar, ui.alignBar, ui.customLayouts]).toEqual([[], "both", "top", true, true, []]);
  });

  it("read what they understand and repair the rest", () => {
    const ui = migrateSettings({
      schemaVersion: 1,
      ui: {
        tabOrder: ["media", 3, "tools", "media"],
        tabStyle: "sideways",
        tabPosition: "bottom",
        quickBar: false,
        alignBar: "no",
        customLayouts: [
          { name: "Edit", layout: { tabOrder: ["generate"], tabStyle: "icons", compact: true } },
          { name: "Edit", layout: {} },
          { name: "", layout: {} },
          { name: "Broken" },
          "nonsense",
        ],
      },
    }).settings.ui;
    expect(ui.tabOrder).toEqual(["media", "tools"]);
    expect(ui.tabStyle).toBe("both");
    expect(ui.tabPosition).toBe("bottom");
    expect(ui.quickBar).toBe(false);
    expect(ui.alignBar).toBe(true);
    expect(ui.customLayouts).toEqual([
      { name: "Edit", layout: { tabOrder: ["generate"], hiddenTabs: [], tabStyle: "icons", tabPosition: "top", quickBar: true, alignBar: true, compact: true } },
    ]);
  });
});

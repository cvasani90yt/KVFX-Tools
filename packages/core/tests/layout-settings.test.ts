import { describe, expect, it } from "vitest";
import { CURRENT_SETTINGS_VERSION, defaultSettings, migrateSettings, moveSection, resetSectionOrder } from "../src/index.js";

describe("display, section and save-reminder settings", () => {
  it("defaults to tooltips on, normal spacing, every section shown, a 20-minute reminder", () => {
    const ui = defaultSettings().ui;
    expect([ui.tooltips, ui.compact, ui.hiddenSections, ui.sectionOrder, ui.saveReminder]).toEqual([true, false, [], [], 20]);
  });

  it("reads what it understands and repairs the rest", () => {
    const ui = migrateSettings({ schemaVersion: 1, ui: { tooltips: false, compact: true, hiddenSections: ["tools.layer", 4], saveReminder: 7 } }).settings.ui;
    expect(ui.tooltips).toBe(false);
    expect(ui.compact).toBe(true);
    expect(ui.hiddenSections).toEqual(["tools.layer"]);
    expect(ui.saveReminder).toBe(20);
  });

  it("moves a section among its siblings and remembers the whole order", () => {
    const siblings = ["a", "b", "c"];
    let settings = moveSection(defaultSettings(), siblings, "c", -1);
    expect(settings.ui.sectionOrder).toEqual(["a", "c", "b"]);
    settings = moveSection(settings, ["a", "c", "b"], "a", -1);
    expect(settings.ui.sectionOrder).toEqual(["a", "c", "b"]);
    settings = moveSection(settings, ["x", "y"], "x", 1);
    expect(settings.ui.sectionOrder).toEqual(["a", "c", "b", "y", "x"]);
  });

  it("puts a tab's sections back in their built-in order, leaving other tabs' orders alone", () => {
    let settings = moveSection(defaultSettings(), ["tools.a", "tools.b"], "tools.b", -1);
    settings = moveSection(settings, ["gen.x", "gen.y"], "gen.y", -1);
    settings = resetSectionOrder(settings, ["tools.a", "tools.b"]);
    expect(settings.ui.sectionOrder).toEqual(["gen.y", "gen.x"]);
  });
});

describe("settings from earlier builds", () => {
  it("move Colour to the top of a Tools order saved before it led the tab", () => {
    const order = ["gen.y", "tools.layer", "tools.duplicate", "tools.resize", "tools.colour", "tools.silence"];
    for (const schemaVersion of [1, undefined]) {
      const ui = migrateSettings({ schemaVersion, ui: { sectionOrder: order } }).settings.ui;
      expect(ui.sectionOrder).toEqual(["gen.y", "tools.colour", "tools.layer", "tools.duplicate", "tools.resize", "tools.silence"]);
    }
  });

  it("leave orders saved by this build, and orders without Colour, as they are", () => {
    const mine = ["tools.layer", "tools.colour"];
    expect(migrateSettings({ schemaVersion: CURRENT_SETTINGS_VERSION, ui: { sectionOrder: mine } }).settings.ui.sectionOrder).toEqual(mine);
    expect(migrateSettings({ schemaVersion: 1, ui: { sectionOrder: ["gen.a", "tools.layer"] } }).settings.ui.sectionOrder).toEqual(["gen.a", "tools.layer"]);
    expect(migrateSettings({ schemaVersion: 1, ui: { sectionOrder: ["tools.colour", "tools.layer"] } }).settings.ui.sectionOrder).toEqual(["tools.colour", "tools.layer"]);
  });
});

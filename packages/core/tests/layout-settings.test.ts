import { describe, expect, it } from "vitest";
import { defaultSettings, migrateSettings, moveSection } from "../src/index.js";

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
});

import { describe, expect, it } from "vitest";
import {
  CURRENT_SETTINGS_VERSION,
  MAX_RECENTS,
  defaultSettings,
  migrateSettings,
  pruneUnknownCommands,
  recordUsage,
  setShortcut,
  toggleFavourite,
} from "../src/storage/settings.js";

describe("migrateSettings — loading what is actually on disk", () => {
  it("returns defaults when there is no file", () => {
    const result = migrateSettings(undefined);
    expect(result.settings).toEqual(defaultSettings());
    expect(result.writable).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("returns defaults when the file is not an object", () => {
    for (const raw of ["garbage", 42, [], null]) {
      expect(migrateSettings(raw).settings.favourites).toEqual([]);
    }
    expect(migrateSettings("garbage").warnings.length).toBe(1);
  });

  it("reads a well-formed file", () => {
    const result = migrateSettings({
      schemaVersion: CURRENT_SETTINGS_VERSION,
      favourites: ["kvfx.layer.solo"],
      recents: ["kvfx.layer.moveup"],
      usage: { "kvfx.layer.solo": { count: 3, lastUsedMs: 1000 } },
      shortcuts: { "kvfx.layer.solo": "Ctrl+1" },
    });

    expect(result.settings.favourites).toEqual(["kvfx.layer.solo"]);
    expect(result.settings.usage["kvfx.layer.solo"]).toEqual({ count: 3, lastUsedMs: 1000 });
    expect(result.settings.shortcuts["kvfx.layer.solo"]).toBe("Ctrl+1");
    expect(result.warnings).toEqual([]);
  });

  it("refuses to overwrite settings written by a newer version", () => {
    // Overwriting would silently discard settings the user made in that build,
    // which they could never get back.
    const result = migrateSettings({
      schemaVersion: CURRENT_SETTINGS_VERSION + 5,
      favourites: ["kvfx.layer.solo"],
    });

    expect(result.writable).toBe(false);
    expect(result.settings.favourites).toEqual(["kvfx.layer.solo"]);
    expect(result.settings.schemaVersion).toBe(CURRENT_SETTINGS_VERSION + 5);
    expect(result.warnings[0]).toMatch(/newer version/);
  });

  it("treats a missing schema version as the oldest format and says so", () => {
    const result = migrateSettings({ favourites: ["kvfx.layer.solo"] });
    expect(result.writable).toBe(true);
    expect(result.settings.schemaVersion).toBe(CURRENT_SETTINGS_VERSION);
    expect(result.warnings[0]).toMatch(/no schema version/);
  });
});

describe("migrateSettings — one bad field does not cost the others", () => {
  it("keeps valid fields when another is corrupt", () => {
    const result = migrateSettings({
      schemaVersion: 1,
      favourites: ["kvfx.layer.solo"],
      shortcuts: "not-a-map",
      usage: [1, 2, 3],
    });

    expect(result.settings.favourites).toEqual(["kvfx.layer.solo"]);
    expect(result.settings.shortcuts).toEqual({});
    expect(result.settings.usage).toEqual({});
  });

  it("drops non-string entries from lists", () => {
    const result = migrateSettings({ schemaVersion: 1, favourites: ["ok", 5, null, { a: 1 }] });
    expect(result.settings.favourites).toEqual(["ok"]);
  });

  it("de-duplicates lists", () => {
    const result = migrateSettings({ schemaVersion: 1, favourites: ["a", "a", "b"] });
    expect(result.settings.favourites).toEqual(["a", "b"]);
  });

  it("caps recents at the limit", () => {
    const many = Array.from({ length: MAX_RECENTS + 10 }, (_, i) => `cmd${String(i)}`);
    expect(migrateSettings({ schemaVersion: 1, recents: many }).settings.recents).toHaveLength(
      MAX_RECENTS,
    );
  });

  it("rejects malformed usage entries individually", () => {
    const result = migrateSettings({
      schemaVersion: 1,
      usage: {
        good: { count: 2, lastUsedMs: 10 },
        negative: { count: -1, lastUsedMs: 10 },
        notANumber: { count: "many", lastUsedMs: 10 },
        missingTime: { count: 4 },
      },
    });

    expect(Object.keys(result.settings.usage).sort()).toEqual(["good", "missingTime"]);
    expect(result.settings.usage["missingTime"]).toEqual({ count: 4, lastUsedMs: 0 });
  });

  it("floors a fractional usage count", () => {
    const result = migrateSettings({ schemaVersion: 1, usage: { a: { count: 2.7, lastUsedMs: 1 } } });
    expect(result.settings.usage["a"]?.count).toBe(2);
  });
});

describe("recordUsage", () => {
  it("counts the first use and puts it at the front of recents", () => {
    const next = recordUsage(defaultSettings(), "kvfx.layer.solo", 5000);
    expect(next.usage["kvfx.layer.solo"]).toEqual({ count: 1, lastUsedMs: 5000 });
    expect(next.recents).toEqual(["kvfx.layer.solo"]);
  });

  it("increments on reuse without duplicating the recents entry", () => {
    let settings = recordUsage(defaultSettings(), "a", 1000);
    settings = recordUsage(settings, "b", 2000);
    settings = recordUsage(settings, "a", 3000);

    expect(settings.usage["a"]).toEqual({ count: 2, lastUsedMs: 3000 });
    expect(settings.recents).toEqual(["a", "b"]);
  });

  it("caps recents", () => {
    let settings = defaultSettings();
    for (let i = 0; i < MAX_RECENTS + 5; i += 1) {
      settings = recordUsage(settings, `cmd${String(i)}`, i);
    }
    expect(settings.recents).toHaveLength(MAX_RECENTS);
    expect(settings.recents[0]).toBe(`cmd${String(MAX_RECENTS + 4)}`);
  });

  it("does not mutate the input", () => {
    const original = defaultSettings();
    recordUsage(original, "a", 1);
    expect(original.recents).toEqual([]);
  });
});

describe("toggleFavourite", () => {
  it("adds then removes", () => {
    const added = toggleFavourite(defaultSettings(), "a");
    expect(added.favourites).toEqual(["a"]);
    expect(toggleFavourite(added, "a").favourites).toEqual([]);
  });

  it("preserves the order favourites were added in", () => {
    let settings = toggleFavourite(defaultSettings(), "a");
    settings = toggleFavourite(settings, "b");
    expect(settings.favourites).toEqual(["a", "b"]);
  });
});

describe("setShortcut", () => {
  it("sets and clears a binding", () => {
    const set = setShortcut(defaultSettings(), "a", "Ctrl+1");
    expect(set.shortcuts["a"]).toBe("Ctrl+1");
    expect(setShortcut(set, "a", undefined).shortcuts["a"]).toBeUndefined();
    expect(setShortcut(set, "a", "").shortcuts["a"]).toBeUndefined();
  });
});

describe("pruneUnknownCommands", () => {
  it("drops references to commands that no longer exist", () => {
    // Without this, a renamed command leaves a permanent orphan the user cannot
    // see or remove.
    const settings = migrateSettings({
      schemaVersion: 1,
      favourites: ["alive", "dead"],
      recents: ["dead", "alive"],
      usage: { alive: { count: 1, lastUsedMs: 1 }, dead: { count: 9, lastUsedMs: 9 } },
      shortcuts: { alive: "Ctrl+1", dead: "Ctrl+2" },
    }).settings;

    const pruned = pruneUnknownCommands(settings, new Set(["alive"]));

    expect(pruned.favourites).toEqual(["alive"]);
    expect(pruned.recents).toEqual(["alive"]);
    expect(Object.keys(pruned.usage)).toEqual(["alive"]);
    expect(Object.keys(pruned.shortcuts)).toEqual(["alive"]);
  });

  it("leaves everything alone when all ids are known", () => {
    const settings = recordUsage(toggleFavourite(defaultSettings(), "a"), "a", 1);
    expect(pruneUnknownCommands(settings, new Set(["a"]))).toEqual(settings);
  });
});

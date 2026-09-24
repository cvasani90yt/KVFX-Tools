import { describe, expect, it } from "vitest";
import {
  type CommandContext,
  EMPTY_SNAPSHOT,
  buildPalette,
  createProductionCommandRegistry,
  defaultSettings,
  recordUsage,
  toggleFavourite,
  type KvfxSettings,
  type SelectedLayer,
} from "../src/index.js";

const registry = createProductionCommandRegistry();
const NOW = 10_000_000;

function layer(): SelectedLayer {
  return {
    id: 10,
    name: "Layer 1",
    index: 1,
    enabled: true,
    locked: false,
    shy: false,
    isAV: true,
    solo: false,
    threeD: false,
    guide: false,
    adjustment: false,
  };
}

function ctx(withSelection = true): CommandContext {
  return {
    aeVersion: "26.0.1x45",
    snapshot: {
      ...EMPTY_SNAPSHOT,
      hasProject: true,
      comp: {
        id: 1,
        name: "Comp 1",
        width: 1920,
        height: 1080,
        frameRate: 25,
        duration: 10,
        time: 0,
        layerCount: 1,
      },
      layers: withSelection ? [layer()] : [],
    },
  };
}

function names(query: string, settings: KvfxSettings = defaultSettings(), withSelection = true): string[] {
  return buildPalette({
    registry,
    context: ctx(withSelection),
    settings,
    query,
    nowMs: NOW,
  }).map((entry) => entry.command.name);
}

describe("buildPalette — searching", () => {
  it("puts the obvious result first for a plain word", () => {
    expect(names("null")[0]).toBe("Create Null");
    expect(names("solo")[0]).toBe("Toggle Solo");
    expect(names("adjustment")[0]).toBe("Create Adjustment Layer");
  });

  it("finds ordering commands by their full name", () => {
    expect(names("move to top")[0]).toBe("Move to Top");
    expect(names("move to bottom")[0]).toBe("Move to Bottom");
  });

  it("breaks a keyword tie by how well the name matched", () => {
    // "top" is claimed as a keyword by Align Top, Move to Top and three anchor
    // spots, so all five score identically. Alphabetical order would bury the
    // two commands a user typing "top" most likely wants.
    const ranked = names("top");
    expect(ranked.slice(0, 2)).toEqual(["Align Top", "Move to Top"]);
    expect(ranked.indexOf("Move to Top")).toBeLessThan(ranked.indexOf("Anchor to Top Left"));
  });

  it("finds alignment commands", () => {
    expect(names("align left")[0]).toBe("Align Left");
    expect(names("anchor centre")[0]).toBe("Anchor to Centre");
    // The two distribute commands tie exactly; both must be immediately visible.
    expect(names("distribute").slice(0, 2).sort()).toEqual([
      "Distribute Horizontally",
      "Distribute Vertically",
    ]);
  });

  it("matches an acronym", () => {
    expect(names("mtt")[0]).toBe("Move to Top");
  });

  it("matches on keywords the user is likely to type instead of the name", () => {
    // Nobody searches "Toggle Visibility" when they mean the eyeball.
    expect(names("eye")[0]).toBe("Toggle Visibility");
    expect(names("hide").length).toBeGreaterThan(0);
    expect(names("controller")[0]).toBe("Create Null");
    expect(names("3d")[0]).toBe("Toggle 3D");
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(names("zzzzqqq")).toEqual([]);
  });

  it("narrows as the query grows", () => {
    const short = names("c").length;
    const long = names("crea").length;
    expect(long).toBeLessThanOrEqual(short);
    expect(long).toBeGreaterThan(0);
  });

  it("ignores surrounding whitespace", () => {
    expect(names("  null  ")[0]).toBe("Create Null");
  });

  it("respects a limit", () => {
    const limited = buildPalette({
      registry,
      context: ctx(),
      settings: defaultSettings(),
      query: "",
      nowMs: NOW,
      limit: 3,
    });
    expect(limited).toHaveLength(3);
  });
});

describe("buildPalette — availability", () => {
  it("lists every visible command when browsing with no query", () => {
    const visible = registry.all().filter((command) => command.metadata.hidden !== true);
    expect(names("")).toHaveLength(visible.length);
  });

  it("keeps hidden variants out of the palette but still invokable", () => {
    // The align grid's reference toggle drives explicit "to Composition" and
    // "to Selection" variants. Showing all three in the palette would list the
    // same action three times.
    const hidden = registry.all().filter((command) => command.metadata.hidden === true);
    expect(hidden.length).toBeGreaterThan(0);

    const listed = names("");
    for (const command of hidden) {
      expect(listed).not.toContain(command.name);
      expect(registry.get(command.id)).toBeDefined();
    }
  });

  it("ranks unavailable commands last rather than hiding them", () => {
    // Hiding teaches the user nothing; showing the reason teaches it once.
    const entries = buildPalette({
      registry,
      context: ctx(false),
      settings: defaultSettings(),
      query: "",
      nowMs: NOW,
    });

    const firstUnavailable = entries.findIndex((entry) => !entry.available);
    const lastAvailable = entries.map((entry) => entry.available).lastIndexOf(true);

    expect(firstUnavailable).toBeGreaterThan(-1);
    expect(firstUnavailable).toBeGreaterThan(lastAvailable);
  });

  it("carries the reason a command is unavailable", () => {
    const entry = buildPalette({
      registry,
      context: ctx(false),
      settings: defaultSettings(),
      query: "solo",
      nowMs: NOW,
    })[0];

    expect(entry?.available).toBe(false);
    expect(entry?.reason).toBe("Select a layer first.");
  });

  it("keeps creation commands available with nothing selected", () => {
    expect(names("null", defaultSettings(), false)[0]).toBe("Create Null");
  });
});

describe("buildPalette — personal weighting", () => {
  it("shows favourites first when browsing", () => {
    const settings = toggleFavourite(defaultSettings(), "kvfx.layer.movedown");
    expect(names("", settings)[0]).toBe("Move Down");
  });

  it("shows recents after favourites when browsing", () => {
    let settings = toggleFavourite(defaultSettings(), "kvfx.layer.movedown");
    settings = recordUsage(settings, "kvfx.layer.shy", NOW - 1000);
    const list = names("", settings);

    expect(list[0]).toBe("Move Down");
    expect(list[1]).toBe("Toggle Shy");
  });

  it("orders favourites by when they were pinned", () => {
    let settings = toggleFavourite(defaultSettings(), "kvfx.layer.shy");
    settings = toggleFavourite(settings, "kvfx.layer.movedown");
    expect(names("", settings).slice(0, 2)).toEqual(["Toggle Shy", "Move Down"]);
  });

  it("breaks a tie in favour of a pinned command", () => {
    const plain = names("create");
    const settings = toggleFavourite(defaultSettings(), "kvfx.layer.createadjustment");
    const pinned = names("create", settings);

    expect(plain[0]).toBe("Create Null");
    expect(pinned[0]).toBe("Create Adjustment Layer");
  });

  it("never lets weighting beat a clearly better textual match", () => {
    // This is the property that keeps the first result trustworthy: pinning and
    // heavy use can win a close race, never an unrelated one.
    let settings = toggleFavourite(defaultSettings(), "kvfx.layer.movedown");
    for (let i = 0; i < 50; i += 1) settings = recordUsage(settings, "kvfx.layer.movedown", NOW - 60);

    expect(names("null", settings)[0]).toBe("Create Null");
    expect(names("solo", settings)[0]).toBe("Toggle Solo");
  });

  it("marks favourites on the entries", () => {
    const settings = toggleFavourite(defaultSettings(), "kvfx.layer.solo");
    const entry = buildPalette({
      registry,
      context: ctx(),
      settings,
      query: "solo",
      nowMs: NOW,
    })[0];
    expect(entry?.isFavourite).toBe(true);
  });

  it("prefers a recently used command over an equally-matching stale one", () => {
    const stale = recordUsage(defaultSettings(), "kvfx.layer.createadjustment", NOW - 1000 * 60 * 60 * 24 * 90);
    const fresh = recordUsage(stale, "kvfx.layer.createadjustment", NOW - 60);
    expect(names("create", fresh)[0]).toBe("Create Adjustment Layer");
  });
});

describe("buildPalette — highlighting and shortcuts", () => {
  it("reports positions in the name so the UI can highlight them", () => {
    const entry = buildPalette({
      registry,
      context: ctx(),
      settings: defaultSettings(),
      query: "create",
      nowMs: NOW,
    })[0];

    expect(entry?.matchedOn).toBe("name");
    expect(entry?.positions).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("reports which keyword matched, and no name positions", () => {
    const entry = buildPalette({
      registry,
      context: ctx(),
      settings: defaultSettings(),
      query: "eye",
      nowMs: NOW,
    })[0];

    expect(entry?.matchedOn).toBe("keyword");
    expect(entry?.matchedKeyword).toBe("eye");
    expect(entry?.positions).toEqual([]);
  });

  it("prefers a user override to the command default", () => {
    const settings = { ...defaultSettings(), shortcuts: { "kvfx.layer.solo": "Ctrl+9" } };
    const entry = buildPalette({
      registry,
      context: ctx(),
      settings,
      query: "solo",
      nowMs: NOW,
    })[0];
    expect(entry?.shortcut).toBe("Ctrl+9");
  });
});

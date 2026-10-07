import { describe, expect, it } from "vitest";
import {
  ACTIVE_COMP_DEFAULTS,
  EASE_PRESETS,
  EMPTY_SNAPSHOT,
  LABEL_COLORS,
  SELECTED_LAYER_DEFAULTS,
  TEXT_PRESETS,
  animatorFor,
  bounceExpression,
  counterExpression,
  createProductionCommandRegistry,
  defaultSettings,
  easeAt,
  elasticExpression,
  formatBezier,
  formatCounter,
  hexToRgb,
  labelKey,
  matchPreset,
  migrateSettings,
  normalizeBezier,
  parseBezier,
  quote,
  reverseBezier,
  rgbToHex,
  saveEase,
  setToolParams,
  splitRanges,
  type CommandContext,
  type JsonValue,
} from "../src/index.js";

describe("easing curves", () => {
  it("keeps every preset inside the range After Effects accepts", () => {
    for (const preset of EASE_PRESETS) {
      expect(normalizeBezier(preset.bezier), preset.id).toEqual(preset.bezier);
    }
  });

  it("clamps time handles to 0–1 and rounds for display", () => {
    expect(normalizeBezier([1.4, 0.123456, -0.2, 3])).toEqual([1, 0.123, 0, 2]);
  });

  it("parses what people paste from the web", () => {
    expect(parseBezier("cubic-bezier(0.25, 1, 0.5, 1)")).toEqual([0.25, 1, 0.5, 1]);
    expect(parseBezier(".42 0 .58 1")).toEqual([0.42, 0, 0.58, 1]);
    expect(parseBezier("0.4, 0, 1")).toBeUndefined();
    expect(parseBezier("a, b, c, d")).toBeUndefined();
  });

  it("formats and recognises presets", () => {
    expect(formatBezier([0.333, 0, 0.667, 1])).toBe("0.333, 0, 0.667, 1");
    expect(matchPreset([0.333, 0, 0.667, 1])?.name).toBe("Easy Ease");
    expect(matchPreset([0.1, 0.2, 0.3, 0.4])).toBeUndefined();
  });

  it("evaluates progress along the curve", () => {
    expect(easeAt([0, 0, 1, 1], 0.5)).toBeCloseTo(0.5, 3);
    expect(easeAt([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 3);
    // An ease-out is ahead of linear early on.
    expect(easeAt([0.16, 1, 0.3, 1], 0.25)).toBeGreaterThan(0.8);
    expect(easeAt([0.16, 1, 0.3, 1], 0)).toBe(0);
    expect(easeAt([0.16, 1, 0.3, 1], 1)).toBe(1);
  });

  it("reverses an ease-in into the matching ease-out", () => {
    const easeIn = EASE_PRESETS.find((p) => p.id === "in-cubic")!.bezier;
    const easeOut = EASE_PRESETS.find((p) => p.id === "out-cubic")!.bezier;
    expect(reverseBezier(easeIn)).toEqual(easeOut);
  });
});

describe("motion expressions", () => {
  it("never relies on array operators only the legacy engine supports", () => {
    for (const source of [elasticExpression(), bounceExpression()]) {
      // value + something / value * something would break on the JavaScript engine.
      expect(source).not.toMatch(/\bvalue\s*[+*-]/);
      expect(source).toContain("kvAdd(value");
      expect(source.trim().endsWith("kvResult;")).toBe(true);
    }
  });

  it("writes the parameters it was given", () => {
    expect(elasticExpression({ amplitude: 0.1, frequency: 2, decay: 4 })).toContain("var frequency = 2;");
    expect(bounceExpression({ elasticity: 0.5, gravity: 3000, maxBounces: 3 })).toContain("var maxBounces = 3;");
  });

  it("falls back on non-finite parameters instead of writing NaN into a project", () => {
    expect(elasticExpression({ amplitude: Number.NaN, frequency: 3, decay: 6 })).not.toContain("NaN");
  });
});

describe("number counter", () => {
  it("formats with grouping, decimals, prefix and suffix", () => {
    const options = { from: 0, to: 1234567.891, decimals: 2, prefix: "$", suffix: " USD" };
    expect(formatCounter(options, 1)).toBe("$1,234,567.89 USD");
    expect(formatCounter(options, 0)).toBe("$0.00 USD");
  });

  it("supports European formatting", () => {
    expect(formatCounter({ to: 1234.5, decimals: 1, separator: ".", decimalMark: "," }, 1)).toBe("1.234,5");
  });

  it("never shows negative zero", () => {
    expect(formatCounter({ from: -0.001, to: 0, decimals: 0 }, 0)).toBe("0");
    expect(formatCounter({ from: -5, to: 0, decimals: 0 }, 0)).toBe("-5");
  });

  it("escapes user text inside the expression", () => {
    expect(quote('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
    const source = counterExpression({ prefix: '"; app.quit(); "' });
    expect(source).toContain('var prefix = "\\"; app.quit(); \\"";');
  });

  it("reads the slider by index, which survives localisation", () => {
    expect(counterExpression({})).toContain('effect("KVFX Counter")(1)');
  });
});

describe("text splitting", () => {
  it("splits characters, skipping whitespace", () => {
    expect(splitRanges("Hi you", "characters").map((r) => [r.start, r.end, r.name])).toEqual([
      [0, 1, "H"],
      [1, 2, "i"],
      [3, 4, "y"],
      [4, 5, "o"],
      [5, 6, "u"],
    ]);
  });

  it("splits words across spaces and line breaks", () => {
    expect(splitRanges("One two\rthree", "words").map((r) => r.name)).toEqual(["One", "two", "three"]);
    expect(splitRanges("One two\rthree", "words")[2]).toEqual({ start: 8, end: 13, name: "three" });
  });

  it("splits lines and drops blank ones", () => {
    expect(splitRanges("First line\r   \rSecond", "lines").map((r) => r.name)).toEqual(["First line", "Second"]);
  });

  it("counts an emoji as one character", () => {
    expect(splitRanges("a😀b", "characters").map((r) => [r.start, r.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(splitRanges("   ", "words")).toEqual([]);
  });
});

describe("text presets", () => {
  it("each preset animates the selector start from 0 to 100", () => {
    for (const preset of TEXT_PRESETS) {
      const spec = animatorFor(preset) as { selectors: { keys: { start: { time: number; value: number }[] } }[] };
      expect(spec.selectors[0]!.keys.start.map((k) => k.value), preset.id).toEqual([0, 100]);
      expect(spec.selectors[0]!.keys.start[1]!.time).toBe(preset.duration);
    }
  });

  it("maps character state onto animator properties", () => {
    const rise = TEXT_PRESETS.find((p) => p.id === "rise")!;
    const spec = animatorFor(rise) as { properties: { matchName: string; value: JsonValue }[] };
    expect(spec.properties).toEqual([
      { matchName: "ADBE Text Opacity", value: 0 },
      { matchName: "ADBE Text Position 3D", value: [0, 40, 0] },
    ]);
  });
});

describe("colour", () => {
  it("round-trips hex", () => {
    expect(hexToRgb("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb("fff")).toEqual([1, 1, 1]);
    expect(hexToRgb("#zzzzzz")).toBeUndefined();
    expect(rgbToHex([1, 0.5, 0])).toBe("#ff8000");
  });

  it("lists the sixteen labels with unique ids", () => {
    expect(LABEL_COLORS).toHaveLength(16);
    expect(new Set(LABEL_COLORS.map((l) => labelKey(l.name))).size).toBe(16);
    expect(labelKey("Sea Foam")).toBe("seaFoam");
  });
});

describe("settings for the rebuilt panel", () => {
  it("defaults every new field", () => {
    const ui = defaultSettings().ui;
    expect(ui.ease).toEqual([0.333, 0, 0.667, 1]);
    expect(ui.mediaTarget).toBe("project");
    expect(ui.toolParams).toEqual({});
  });

  it("drops malformed values instead of trusting them", () => {
    const { settings } = migrateSettings({
      schemaVersion: 1,
      ui: {
        solidColor: "red",
        ease: [2, 0, 0.5, 1],
        customEases: [{ name: "ok", bezier: [0.1, 0, 0.9, 1] }, { name: "bad", bezier: [5] }],
        mediaTarget: "desktop",
        toolParams: { counter: { to: 10 }, junk: 4 },
      },
    });
    expect(settings.ui.solidColor).toBe("#ffffff");
    expect(settings.ui.ease).toEqual([0.333, 0, 0.667, 1]);
    expect(settings.ui.customEases.map((e) => e.name)).toEqual(["ok"]);
    expect(settings.ui.mediaTarget).toBe("project");
    expect(settings.ui.toolParams).toEqual({ counter: { to: 10 } });
  });

  it("merges tool parameters and replaces saved curves by name", () => {
    let settings = setToolParams(defaultSettings(), "counter", { from: 1 });
    settings = setToolParams(settings, "counter", { to: 9 });
    expect(settings.ui.toolParams["counter"]).toEqual({ from: 1, to: 9 });

    settings = saveEase(settings, "Mine", [0.1, 0, 0.9, 1]);
    settings = saveEase(settings, "Mine", [0.2, 0, 0.8, 1]);
    expect(settings.ui.customEases).toEqual([{ name: "Mine", bezier: [0.2, 0, 0.8, 1] }]);
  });
});

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

const registry = createProductionCommandRegistry();

function ctx(params: Record<string, JsonValue> = {}): CommandContext {
  return {
    aeVersion: "26.0",
    params,
    snapshot: {
      ...EMPTY_SNAPSHOT,
      hasProject: true,
      comp: { ...ACTIVE_COMP_DEFAULTS, frameRate: 25, frameDuration: 0.04, workAreaStart: 1, workAreaDuration: 4 },
      layers: [{ ...SELECTED_LAYER_DEFAULTS, id: 1, kind: "text", label: 4 }],
    },
  };
}

function measurement(layers: Record<string, JsonValue>[]): JsonValue {
  return { hasProject: true, comp: null, layers: layers.map((l) => ({ ...l })) };
}

describe("command plans", () => {
  it("sequence offset staggers in-points from the first layer", () => {
    const command = registry.get("kvfx.layer.sequence")!;
    if (command.kind !== "measured") throw new Error("expected measured");
    const plan = command.plan(
      ctx({ frames: 10 }),
      measurement([
        { id: 1, index: 1, inPoint: 0, outPoint: 2, startTime: 0 },
        { id: 2, index: 2, inPoint: 0, outPoint: 2, startTime: 0 },
        { id: 3, index: 3, inPoint: 1, outPoint: 3, startTime: 1 },
      ]),
    );
    expect(plan.steps.map((s) => [s.args["id"], s.args["startTime"]])).toEqual([
      [2, 0.4],
      [3, 0.8],
    ]);
  });

  it("sequence chain butts each layer against the previous one's end", () => {
    const command = registry.get("kvfx.layer.sequence")!;
    if (command.kind !== "measured") throw new Error("expected measured");
    const plan = command.plan(
      ctx({ frames: 0, mode: "chain" }),
      measurement([
        { id: 1, index: 1, inPoint: 0, outPoint: 2, startTime: 0 },
        { id: 2, index: 2, inPoint: 0, outPoint: 3, startTime: 0 },
        { id: 3, index: 3, inPoint: 0, outPoint: 1, startTime: 0 },
      ]),
    );
    expect(plan.steps.map((s) => s.args["startTime"])).toEqual([2, 5]);
  });

  it("trim to work area uses the comp's work area", () => {
    const plan = registry.get("kvfx.layer.trimWorkArea".toLowerCase())!;
    if (plan.kind !== "simple") throw new Error("expected simple");
    expect(plan.plan(ctx()).steps[0]!.args).toMatchObject({ inPoint: 1, outPoint: 5 });
  });

  it("apply ease falls back to the editor's curve from settings", () => {
    const command = registry.get("kvfx.keys.ease")!;
    if (command.kind !== "simple") throw new Error("expected simple");
    const params = command.defaultParams!({ ...defaultSettings().ui, ease: [0.1, 0.2, 0.3, 0.4] });
    expect(command.plan(ctx(params)).steps[0]!.args["bezier"]).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("select same label uses the first selected layer's label", () => {
    const command = registry.get("kvfx.label.selectsame")!;
    if (command.kind !== "simple") throw new Error("expected simple");
    expect(command.plan(ctx()).steps[0]!.args).toEqual({ label: 4 });
  });

  it("text commands are unavailable without a text layer", () => {
    const command = registry.get("kvfx.text.animate")!;
    const base = ctx();
    const noText: CommandContext = {
      ...base,
      snapshot: { ...base.snapshot, layers: [{ ...SELECTED_LAYER_DEFAULTS, id: 2, kind: "av" }] },
    };
    expect(command.canExecute(noText)).toEqual({ available: false, reason: "Select a text layer." });
    expect(command.canExecute(base).available).toBe(true);
  });
});

describe("outcome messages", () => {
  it("passes host refusals through and hides raw exceptions", async () => {
    const { userMessage, summarizeResult } = await import("../src/index.js");
    expect(userMessage({ code: "precondition_failed", message: "Select a text layer." })).toBe("Select a text layer.");
    const hidden = userMessage({ code: "host_exception", message: "TypeError: undefined is not an object" });
    expect(hidden).not.toContain("TypeError");

    expect(summarizeResult({ steps: [{ result: { changedCount: 2, skipped: [] } }] })).toBe("Done");
    expect(
      summarizeResult({
        steps: [
          { result: { skipped: [{ id: 1, name: "A", reason: "Layer is locked" }] } },
          { result: { skipped: [{ id: 2, name: "B", reason: "Layer is locked" }], missingIds: [9] } },
        ],
      }),
    ).toBe("Done · 2 skipped — Layer is locked · 1 no longer exist");
  });
});

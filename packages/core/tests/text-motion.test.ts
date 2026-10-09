import { describe, expect, it } from "vitest";
import {
  TEXT_EASES,
  TEXT_MOTION_PRESETS,
  type TextEase,
  type TextMotionOptions,
  easeExpression,
  easeValue,
  keyAnimators,
  liveAnimators,
  textMotionPreset,
  typingExpression,
} from "../src/index.js";

/**
 * The text motion engine. Generated expressions are executed here as plain
 * JavaScript with the few After Effects globals they read, so the maths the
 * composition runs is the maths under test.
 */

const OPTIONS: TextMotionOptions = {
  preset: textMotionPreset("rise")!,
  mode: "in",
  unit: "characters",
  order: "forward",
  seed: 1,
  ease: "preset",
  bezier: [0.25, 0.1, 0.25, 1],
  stagger: 0.1,
  duration: 0.5,
  overshoot: 30,
  engine: "live",
  accent: [1, 0.5, 0],
};

interface Globals {
  time: number;
  textIndex: number;
  textTotal: number;
  outPoint?: number;
  value?: string;
}

/** Runs expression source and returns its last statement's value. */
function evaluate(source: string, now: number, globals: Globals): unknown {
  const code = source.split("__KVFX_NOW__").join(String(now));
  const env = {
    selectorValue: 100,
    outPoint: 10,
    value: "",
    thisComp: { frameDuration: 1 / 25 },
    seedRandom: () => undefined,
    random: (a: number, b: number) => (a + b) / 2,
    ...globals,
  };
  const names = Object.keys(env);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- executing generated expression source under test
  const run = new Function(...names, "src", "return eval(src);") as (...args: unknown[]) => unknown;
  return run(...names.map((k) => (env as Record<string, unknown>)[k]), code);
}

function amountAt(options: TextMotionOptions, time: number, index: number, total = 5): number {
  const animator = liveAnimators(options)[0] as { selectors: { expression: string }[] };
  return evaluate(animator.selectors[0]!.expression, 1, { time, textIndex: index, textTotal: total }) as number;
}

describe("text motion — easing", () => {
  const eases = TEXT_EASES.map((e) => e.id).filter((id): id is Exclude<TextEase, "preset"> => id !== "preset");

  it("the expression and the preview compute the same curve for every ease", () => {
    for (const ease of eases) {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- executing generated expression source under test
      const make = new Function(`${easeExpression(ease, 40, [0.3, 0, 0.2, 1])}\nreturn kvEase;`) as () => (t: number) => number;
      const kvEase = make();
      for (const t of [0, 0.1, 0.33, 0.5, 0.8, 1]) {
        expect(kvEase(t), `${ease} at ${String(t)}`).toBeCloseTo(easeValue(ease, t, 40, [0.3, 0, 0.2, 1]), 6);
      }
    }
  });

  it("starts at 0 and lands on 1", () => {
    for (const ease of eases) {
      if (ease === "step") continue;
      expect(easeValue(ease, 0, 30, [0.42, 0, 0.58, 1]), ease).toBeCloseTo(0, 6);
      expect(easeValue(ease, 1, 30, [0.42, 0, 0.58, 1]), ease).toBeCloseTo(1, 6);
    }
  });

  it("overshoots with Back in proportion to the setting, and not at all at 0", () => {
    const peak = (overshoot: number): number =>
      Math.max(...Array.from({ length: 101 }, (_, i) => easeValue("back", i / 100, overshoot, [0, 0, 1, 1])));
    expect(peak(0)).toBeCloseTo(1, 3);
    expect(peak(30)).toBeGreaterThan(1.05);
    expect(peak(80)).toBeGreaterThan(peak(30));
  });
});

describe("text motion — live selector", () => {
  it("hides every unit before the playhead and reveals them in turn", () => {
    expect(amountAt(OPTIONS, 0.5, 1)).toBe(100);
    // Unit 1 is fully in at start + duration; unit 3 has not started yet.
    expect(amountAt(OPTIONS, 1.5, 1)).toBeCloseTo(0, 6);
    expect(amountAt(OPTIONS, 1.15, 3)).toBe(100);
    const midway = amountAt(OPTIONS, 1.25, 1);
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(100);
  });

  it("centre-out starts the middle unit first", () => {
    const options = { ...OPTIONS, order: "centre" as const };
    expect(amountAt(options, 1.05, 3)).toBeLessThan(100);
    expect(amountAt(options, 1.05, 1)).toBe(100);
    expect(amountAt(options, 1.05, 5)).toBe(100);
  });

  it("In + Out hides again so the last unit leaves at the layer's out point", () => {
    const options = { ...OPTIONS, mode: "inOut" as const };
    expect(amountAt(options, 5, 2)).toBeCloseTo(0, 6);
    expect(amountAt(options, 10, 5)).toBeCloseTo(100, 6);
    // Total = 4 × 0.1 + 0.5 = 0.9 s, so the out phase starts at 9.1.
    expect(amountAt(options, 9.05, 1)).toBeCloseTo(0, 6);
  });

  it("Out alone leaves from the playhead", () => {
    const options = { ...OPTIONS, mode: "out" as const };
    expect(amountAt(options, 0.5, 1)).toBeCloseTo(0, 6);
    expect(amountAt(options, 3, 1)).toBeCloseTo(100, 6);
  });

  it("works by words and lines through the selector's Based On", () => {
    const words = liveAnimators({ ...OPTIONS, unit: "words" })[0] as { selectors: { basedOn: string }[] };
    expect(words.selectors[0]!.basedOn).toBe("words");
    const lines = liveAnimators({ ...OPTIONS, unit: "lines" })[0] as { selectors: { basedOn: string }[] };
    expect(lines.selectors[0]!.basedOn).toBe("lines");
  });

  it("builds two animators for Colour Typing: a reveal and an accent that fades", () => {
    const animators = liveAnimators({ ...OPTIONS, preset: textMotionPreset("color-type")! }) as {
      properties: { matchName: string; value: unknown }[];
    }[];
    expect(animators).toHaveLength(2);
    expect(animators[1]!.properties[0]).toEqual({ matchName: "ADBE Text Fill Color", value: [1, 0.5, 0, 1] });
  });

  it("every preset produces something to apply", () => {
    for (const preset of TEXT_MOTION_PRESETS) {
      const options = { ...OPTIONS, preset };
      const built = preset.kind === "typing" ? [typingExpression(options)] : liveAnimators(options);
      expect(built.length, preset.id).toBeGreaterThan(0);
      expect(keyAnimators(options).length, preset.id).toBeGreaterThan(0);
    }
  });
});

describe("text motion — typing", () => {
  const typing = { ...OPTIONS, preset: textMotionPreset("typing")!, stagger: 0.1 };

  it("types one character per step with a caret, from the playhead", () => {
    const at = (time: number): unknown => evaluate(typingExpression(typing), 1, { time, textIndex: 1, textTotal: 1, value: "Hello" });
    expect(at(0.5)).toBe("");
    expect(at(1.21)).toBe("He|");
    expect(at(3.0)).toMatch(/^Hello\|?$/);
  });

  it("deletes back to nothing before the out point with In + Out", () => {
    const options = { ...typing, mode: "inOut" as const };
    const at = (time: number): unknown =>
      evaluate(typingExpression(options), 0, { time, textIndex: 1, textTotal: 1, value: "Hello", outPoint: 4 });
    // Five characters at 0.1 s each: deleting starts at 3.5.
    expect(at(3.2)).toMatch(/^Hello\|?$/);
    expect(at(3.71)).toMatch(/^Hel\|?$/);
    expect(String(at(4))).toMatch(/^\|?$/);
  });
});

describe("text motion — keys engine", () => {
  it("one animator per phase, with normalised keys the host stretches to the text", () => {
    const animators = keyAnimators({ ...OPTIONS, mode: "inOut", engine: "keys" }) as {
      name: string;
      timing: { anchor: string; stagger: number; duration: number };
      selectors: { keys: Record<string, { time: number; value: number }[]> }[];
    }[];
    expect(animators.map((a) => a.timing.anchor)).toEqual(["playhead", "end"]);
    expect(animators[0]!.selectors[0]!.keys["start"]).toEqual([
      { time: 0, value: 0 },
      { time: 1, value: 100 },
    ]);
    expect(animators[1]!.name).toContain("Out");
  });

  it("centre-out reveals by subtracting a widening hole from a full cover", () => {
    const [animator] = keyAnimators({ ...OPTIONS, order: "centre", engine: "keys" }) as {
      selectors: { mode?: string; keys?: Record<string, unknown> }[];
    }[];
    expect(animator!.selectors).toHaveLength(2);
    expect(animator!.selectors[1]!.mode).toBe("subtract");
  });
});

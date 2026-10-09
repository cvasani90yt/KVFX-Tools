import { describe, expect, it } from "vitest";
import { KINETIC_STYLES, LAYOUT_TEMPLATES, kineticLines, kineticWords, wrapText } from "@kvfx/core";
import { createMockAe, type MockAe } from "./mock-ae.js";
import { runCommand } from "./run-command.js";

/**
 * Layout templates and kinetic titles, end to end.
 */

function blank(width = 1920, height = 1080): MockAe {
  const ae = createMockAe({ comp: { width, height, frameRate: 30, layers: [{ name: "Existing" }] } });
  ae.comp!.time = 0.5;
  return ae;
}

describe("layout templates", () => {
  for (const template of LAYOUT_TEMPLATES) {
    it(`${template.name} builds, parented to one control null`, () => {
      const ae = blank();
      runCommand(ae, "kvfx.rig.layout", { template: template.id });
      const hub = ae.raw(`KVFX Layout · ${template.name}`);
      const parts = ae.comp!.stack.filter((l) => l.parent === hub);
      expect(parts.length).toBe(template.build((key) => template.fields.find((f) => f.key === key)?.value ?? "").length);
      expect(ae.raw("Existing").parent).toBeNull();
    });
  }

  it("fits the design to the comp: a vertical comp gets a smaller, centred chat", () => {
    const ae = blank(1080, 1920);
    runCommand(ae, "kvfx.rig.layout", { template: "chat", theme: "light", content: { m1: "Hello there" } });
    const text = ae.raw("KVFX Chat Thread · Text 1");
    const document = text.property("ADBE Text Properties")!.property("ADBE Text Document")!.value as { text: string };
    expect(document.text).toBe("Hello there");
    const hub = ae.raw("KVFX Layout · Chat Thread");
    expect(hub.transform("ADBE Position").value).toEqual([540, 960, 0]);
  });

  it("bars grow from their base and counters count, timed in order from the playhead", () => {
    const ae = blank();
    runCommand(ae, "kvfx.rig.layout", { template: "bars", stagger: 6, duration: 12 });
    const bar = ae.raw("KVFX Bar Chart · Bar 1");
    expect(bar.transform("ADBE Scale").expression).toContain("out[1] = value[1]");
    const reveal = bar.effects.property("KVFX Reveal")!.property(1)!;
    // Bar 1 has order 1: one stagger (6 frames at 30 fps) after the playhead.
    expect(reveal.keyTime(1)).toBeCloseTo(0.7);

    const metrics = blank();
    runCommand(metrics, "kvfx.rig.layout", { template: "metrics" });
    const value = metrics.raw("KVFX Metric Cards · Value 1");
    expect(value.property("ADBE Text Properties")!.property("ADBE Text Document")!.expression).toContain("var to = 48200;");
  });

  it("the progress ring draws on to its percentage", () => {
    const ae = blank();
    runCommand(ae, "kvfx.rig.layout", { template: "ring", content: { percent: "64" } });
    const ring = ae.raw("KVFX Progress Ring · Ring");
    const trim = ring.property("ADBE Root Vectors Group")!.property(1)!.property("ADBE Vectors Group")!.property("Trim")!;
    expect(trim.property("ADBE Vector Trim End")!.expression).toContain("64 * Math.max(0, Math.min(1, e));");
  });

  it("wraps long text at spaces", () => {
    expect(wrapText("one two three four five", 9)).toBe("one two\rthree\rfour five");
  });
});

describe("kinetic titles", () => {
  it("finds starred words and balances lines", () => {
    const words = kineticWords("Make *videos* that *pop*");
    expect(words.filter((w) => w.accent).map((w) => w.text)).toEqual(["videos", "pop"]);
    expect(kineticLines(words, 12).map((line) => line.map((w) => w.text).join(" "))).toEqual(["Make videos", "that pop"]);
  });

  for (const style of KINETIC_STYLES) {
    it(`${style.label} builds in this comp`, () => {
      const ae = blank();
      runCommand(ae, "kvfx.rig.kinetic", { text: "Ship *faster* with less", style: style.id });
      expect(ae.stack().some((name) => name.startsWith("KVFX Kinetic · "))).toBe(true);
    });
  }

  it("a new 9:16 comp with a drifting background, accents coloured by word", () => {
    const ae = blank();
    const before = ae.comp!;
    runCommand(ae, "kvfx.rig.kinetic", { text: "Make *videos* that *pop*", style: "stack", aspect: "9:16", background: "drift" });
    const made = ae.project!.activeItem as typeof before;
    expect(made).not.toBe(before);
    expect([made.width, made.height]).toEqual([1080, 1920]);
    expect(made.stack.at(-1)?.name).toBe("KVFX Kinetic Background");
    const line = made.stack.find((l) => l.name === "KVFX Kinetic · Make videos")!;
    const animators = line.property("ADBE Text Properties")!.property("ADBE Text Animators")!.children;
    expect(animators[0]!.name).toBe("KVFX Accent videos");
    const selector = animators[0]!.property("ADBE Text Selectors")!.property(1)!;
    expect(selector.property("ADBE Text Index Start")!.value).toBe(1);
    expect(before.stack.map((l) => l.name)).toEqual(["Existing"]);
  });

  it("punch shows one word at a time", () => {
    const ae = blank();
    runCommand(ae, "kvfx.rig.kinetic", { text: "One two three", style: "punch" });
    const two = ae.raw("KVFX Kinetic · two");
    expect(two.transform("ADBE Opacity").expression).toContain("time - (0.5 + 0.5)");
  });
});

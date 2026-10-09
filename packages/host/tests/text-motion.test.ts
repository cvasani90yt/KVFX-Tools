import { describe, expect, it } from "vitest";
import { createMockAe, type MockAe } from "./mock-ae.js";
import type { MockLayer, MockProp } from "./mock-dom.js";
import { runCommand } from "./run-command.js";

/**
 * Animate Text, end to end: what lands on the layer for each engine.
 */

function scene(text = "Hello world"): MockAe {
  const ae = createMockAe({ comp: { frameRate: 25, layers: [{ name: "Title", kind: "text", text, selected: true }] } });
  ae.comp!.time = 2;
  ae.raw("Title").outPoint = 8;
  return ae;
}

function animators(layer: MockLayer): MockProp[] {
  return layer.property("ADBE Text Properties")!.property("ADBE Text Animators")!.children;
}

function selectors(animator: MockProp): MockProp[] {
  return animator.property("ADBE Text Selectors")!.children;
}

describe("Animate Text — live engine", () => {
  it("adds the hidden state and an expression selector stamped with the playhead", () => {
    const ae = scene();
    runCommand(ae, "kvfx.text.animate", { preset: "rise", unit: "words", order: "centre", ease: "back" });
    const [animator] = animators(ae.raw("Title"));
    expect(animator!.name).toBe("KVFX Rise");
    const props = animator!.property("ADBE Text Animator Properties")!.children.map((p) => p.matchName);
    expect(props).toEqual(["ADBE Text Opacity", "ADBE Text Position 3D"]);
    const selector = selectors(animator!)[0]!;
    expect(selector.matchName).toBe("ADBE Text Expressible Selector");
    expect(selector.property("ADBE Text Range Type2")!.value).toBe(3);
    const amount = selector.property("ADBE Text Expressible Amount")!;
    expect(amount.expressionEnabled).toBe(true);
    expect(amount.expression).toContain("var start = 2;");
    expect(amount.expression).not.toContain("__KVFX_NOW__");
    expect(amount.expression).toContain("Math.abs(i - (n - 1) / 2)");
  });

  it("Typing writes a Source Text expression, and leaves one the user wrote alone", () => {
    const ae = scene();
    runCommand(ae, "kvfx.text.animate", { preset: "typing", stagger: 3 });
    const source = ae.raw("Title").property("ADBE Text Properties")!.property("ADBE Text Document")!;
    expect(source.expression).toContain("var perChar = 0.12;");
    expect(animators(ae.raw("Title"))).toHaveLength(0);

    const again = scene();
    const mine = again.raw("Title").property("ADBE Text Properties")!.property("ADBE Text Document")!;
    mine.expression = "\"mine\"";
    mine.expressionEnabled = true;
    const reply = runCommand(again, "kvfx.text.animate", { preset: "typing" });
    expect(mine.expression).toBe("\"mine\"");
    expect(JSON.stringify(reply.result)).toContain("already has an expression");
  });
});

describe("Animate Text — keys engine", () => {
  it("stretches the keys to the text: stagger × (units − 1) + duration", () => {
    // "Hello world": 10 characters without the space. 2 fr stagger, 10 fr each at 25 fps.
    const ae = scene();
    runCommand(ae, "kvfx.text.animate", { preset: "fade", engine: "keys", stagger: 2, duration: 10, ease: "linear" });
    const selector = selectors(animators(ae.raw("Title"))[0]!)[0]!;
    const start = selector.property("ADBE Text Percent Start")!;
    expect(start.numKeys).toBe(2);
    expect(start.keyTime(1)).toBeCloseTo(2);
    expect(start.keyTime(2)).toBeCloseTo(2 + 9 * 0.08 + 0.4);
    expect(selector.property("ADBE Text Range Advanced")!.property("ADBE Text Range Type2")!.value).toBe(2);
  });

  it("In + Out: the out phase ends exactly at the layer's out point", () => {
    const ae = scene("One two three");
    runCommand(ae, "kvfx.text.animate", { preset: "rise", engine: "keys", mode: "inOut", unit: "words", stagger: 5, duration: 10 });
    const [, out] = animators(ae.raw("Title"));
    expect(out!.name).toBe("KVFX Rise Out");
    const end = selectors(out!)[0]!.property("ADBE Text Percent End")!;
    expect(end.keyTime(2)).toBeCloseTo(8);
    expect(end.keyTime(1)).toBeCloseTo(8 - (2 * 0.2 + 0.4));
  });

  it("random order uses the selector's own shuffle with the chosen seed", () => {
    const ae = scene();
    runCommand(ae, "kvfx.text.animate", { preset: "pop", engine: "keys", order: "random", seed: 42 });
    const advanced = selectors(animators(ae.raw("Title"))[0]!)[0]!.property("ADBE Text Range Advanced")!;
    expect(advanced.property("ADBE Text Randomize Order")!.value).toBe(1);
    expect(advanced.property("ADBE Text Random Seed")!.value).toBe(42);
  });

  it("eases the selector keys with the chosen curve", () => {
    const ae = scene();
    runCommand(ae, "kvfx.text.animate", { preset: "rise", engine: "keys", ease: "expo" });
    const start = selectors(animators(ae.raw("Title"))[0]!)[0]!.property("ADBE Text Percent Start")!;
    expect(start.keyOutTemporalEase(1)[0]!.influence).toBeCloseTo(16, 0);
  });
});

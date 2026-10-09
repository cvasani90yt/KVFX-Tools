import { describe, expect, it } from "vitest";
import { cardIndexExpression, cursorTimeline, rippleOpacityExpression } from "@kvfx/core";
import { createMockAe, type MockAe } from "./mock-ae.js";
import { INTERP, TRACK_MATTE, type MockLayer } from "./mock-dom.js";
import { runCommand } from "./run-command.js";

/**
 * UI Motion rigs, end to end against the mock After Effects.
 */

function ui(): MockAe {
  const ae = createMockAe({
    comp: {
      width: 1920,
      height: 1080,
      frameRate: 25,
      layers: [
        { name: "Button", selected: true, geometry: { sourceRect: { left: 0, top: 0, width: 200, height: 60 }, position: { x: 800, y: 900 } } },
        { name: "Header", selected: true, geometry: { sourceRect: { left: 0, top: 0, width: 600, height: 80 }, position: { x: 400, y: 100 } } },
        { name: "Card", selected: true, geometry: { sourceRect: { left: 0, top: 0, width: 400, height: 300 }, position: { x: 1200, y: 400 } } },
        { name: "Wallpaper" },
      ],
    },
  });
  ae.comp!.time = 1;
  return ae;
}

const slider = (layer: MockLayer, name: string) => layer.effects.property(name)!.property(1)!;

/** Runs generated expression source with the globals it reads. */
function evaluate(source: string, globals: Record<string, unknown>): unknown {
  const names = Object.keys(globals);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- executing generated expression source under test
  const run = new Function(...names, "src", "return eval(src);") as (...args: unknown[]) => unknown;
  return run(...names.map((k) => globals[k]), source);
}

describe("UI Stagger", () => {
  it("reveals top to bottom on screen, each layer a stagger later, from the playhead", () => {
    const ae = ui();
    runCommand(ae, "kvfx.rig.uistagger", { style: "rise", stagger: 5, duration: 10 });
    const first = (name: string): number => slider(ae.raw(name), "KVFX Reveal").keyTime(1);
    // Header (y 100) first, then Card (y 400), then Button (y 900); 5 fr = 0.2 s.
    expect(first("Header")).toBeCloseTo(1);
    expect(first("Card")).toBeCloseTo(1.2);
    expect(first("Button")).toBeCloseTo(1.4);
    expect(slider(ae.raw("Card"), "KVFX Reveal").keyTime(2)).toBeCloseTo(1.6);
    const position = ae.raw("Card").transform("ADBE Position");
    expect(position.expression).toContain('effect("KVFX Reveal")');
    expect(ae.raw("Card").transform("ADBE Opacity").expressionEnabled).toBe(true);
    expect(ae.raw("Wallpaper").effects.property("KVFX Reveal")).toBeNull();
  });

  it("In + Out also leaves, finishing at each layer's out point", () => {
    const ae = ui();
    runCommand(ae, "kvfx.rig.uistagger", { style: "pop", mode: "inOut", order: "stack", stagger: 0, duration: 10 });
    const keys = slider(ae.raw("Button"), "KVFX Reveal");
    expect(keys.numKeys).toBe(4);
    expect(keys.keyTime(4)).toBeCloseTo(ae.raw("Button").outPoint);
    expect(keys.keyValue(4)).toBe(0);
    expect(ae.raw("Button").transform("ADBE Scale").expression).toContain("kvEase");
  });

  it("blur style adds a blur effect driven by the same slider", () => {
    const ae = ui();
    runCommand(ae, "kvfx.rig.uistagger", { style: "blur" });
    const blur = ae.raw("Header").effects.property("KVFX Reveal Blur")!.property(1)!;
    expect(blur.expression).toContain("40 * (1 - Math.min(1, e))");
  });
});

describe("Cursor Rig", () => {
  it("travels to each target in screen order and clicks partway through each hold", () => {
    const timeline = cursorTimeline([[10, 10], [50, 50]], [0, 0], 1, 0.5, 0.4);
    expect(timeline.keys.map((k) => k.time)).toEqual([0, 1, 1.5, 2.5, 3]);
    expect(timeline.clicks).toEqual([1.2, 2.7]);
  });

  it("builds the cursor, its ripple and name tag, and presses each target", () => {
    const ae = ui();
    runCommand(ae, "kvfx.rig.cursor", { tag: "Alex", order: "leftRight", travel: 1, hold: 0.5 });
    const cursor = ae.raw("KVFX Cursor");
    const outline = cursor.property("ADBE Root Vectors Group")!.property(1)!.property("ADBE Vectors Group")!.property("Outline")!;
    expect((outline.property("ADBE Vector Shape")!.value as { vertices: number[][] }).vertices[0]).toEqual([0, 0]);
    const position = cursor.transform("ADBE Position");
    expect(position.numKeys).toBe(7);
    expect(position.keyTime(1)).toBeCloseTo(1);
    // Left to right: Header (centre x 700) is clicked first.
    expect(position.keyValue(2)).toEqual([700, 140]);
    expect(position.expression).toContain("arc");
    expect(cursor.effects.property("KVFX Cursor Shadow")).not.toBeNull();

    const ripple = ae.raw("KVFX Click Ripple");
    const ripplePosition = ripple.transform("ADBE Position");
    expect(ripplePosition.numKeys).toBe(3);
    expect(ripplePosition.keys.every((k) => k.outType === INTERP.hold)).toBe(true);
    expect(ripple.transform("ADBE Scale").expression).not.toContain("__KVFX_NOW__");

    const tag = ae.raw("KVFX Cursor Tag");
    expect(tag.parent).toBe(cursor);
    expect(ae.raw("KVFX Cursor Tag Plate").parent).toBe(tag);
    expect(ae.stack().slice(0, 4)).toEqual(["KVFX Cursor", "KVFX Cursor Tag", "KVFX Cursor Tag Plate", "KVFX Click Ripple"]);

    expect(ae.raw("Header").transform("ADBE Scale").expression).toContain("button press");
    expect(ae.raw("Wallpaper").transform("ADBE Scale").expression).toBe("");
  });

  it("the ripple fades out after each click", () => {
    const source = rippleOpacityExpression([1, 3]).split("__KVFX_NOW__").join("10");
    expect(evaluate(source, { time: 10.5 })).toBe(0);
    expect(evaluate(source, { time: 11 })).toBeCloseTo(100);
    expect(evaluate(source, { time: 11.2 })).toBeGreaterThan(0);
    expect(evaluate(source, { time: 12 })).toBe(0);
    expect(evaluate(source, { time: 13.1 })).toBeGreaterThan(50);
  });
});

describe("Card Carousel", () => {
  it("parents the cards to a control null, slotted left to right", () => {
    const ae = ui();
    runCommand(ae, "kvfx.rig.cardcarousel", { gap: 40 });
    const hub = ae.raw("KVFX Card Carousel");
    expect(slider(hub, "Spacing").value).toBe(640);
    expect(slider(hub, "Index").expression).toContain("var n = 3;");
    for (const name of ["Header", "Card", "Button"]) expect(ae.raw(name).parent).toBe(hub);
    // Left to right by centre: Header (700), Button (900), Card (1400).
    expect(ae.raw("Header").transform("ADBE Position").expression).toContain("slot = 0;");
    expect(ae.raw("Button").transform("ADBE Position").expression).toContain("slot = 1;");
    expect(ae.raw("Card").transform("ADBE Position").expression).toContain("slot = 2;");
  });

  it("advances one card per hold + move, and stops at the last card unless looping", () => {
    const source = cardIndexExpression(3).split("__KVFX_NOW__").join("0");
    const at = (time: number, loop: number): number =>
      evaluate(source, { time, effect: (name: string) => () => ({ Hold: 1, Move: 0.5, Loop: loop })[name] ?? 0 }) as number;
    expect(at(0.5, 1)).toBe(0);
    expect(at(1.5, 1)).toBeCloseTo(1);
    expect(at(1.25, 1)).toBeCloseTo(0.5);
    expect(at(9, 0)).toBe(2);
    expect(at(9, 1)).toBeCloseTo(6);
  });
});

describe("Animated Backdrop", () => {
  it("drift: a 4-colour gradient solid at the bottom of the stack, with speed and grain", () => {
    const ae = ui();
    runCommand(ae, "kvfx.rig.backdrop", { style: "drift", palette: "ocean" });
    expect(ae.stack().at(-1)).toBe("KVFX Backdrop");
    const bg = ae.raw("KVFX Backdrop");
    const gradient = bg.effects.property("KVFX Drift")!;
    expect(gradient.property(1)!.expression).toContain('effect("Speed")');
    expect(gradient.property(2)!.value).toEqual([0x25 / 255, 0x63 / 255, 0xeb / 255, 1]);
    expect(bg.effects.property("KVFX Grain")!.property(1)!.value).toBe(6);
  });

  it("stars: a twinkling field above its base", () => {
    const ae = ui();
    runCommand(ae, "kvfx.rig.backdrop", { style: "stars", grain: false });
    expect(ae.stack().slice(-2)).toEqual(["KVFX Stars", "KVFX Backdrop"]);
    const groups = ae.raw("KVFX Stars").property("ADBE Root Vectors Group")!;
    expect(groups.numProperties).toBe(70);
    const opacity = groups.property(5)!.property("ADBE Vector Transform Group")!.property("ADBE Vector Group Opacity")!;
    expect(opacity.expression).toContain("star");
    expect(ae.raw("KVFX Backdrop").effects.property("KVFX Grain")).toBeNull();
  });

  it("clipped: sits above the layer, matted by a hidden copy, the original untouched", () => {
    const ae = ui();
    ae.select("Card");
    runCommand(ae, "kvfx.rig.backdrop", { style: "horizon", clip: true });
    const card = ae.raw("Card");
    const glow = ae.raw("KVFX Horizon Glow");
    expect(glow.blendingMode).not.toBe(ae.raw("KVFX Backdrop").blendingMode);
    const mattes = ae.comp!.stack.filter((l) => l.name === "KVFX Backdrop Matte");
    expect(mattes).toHaveLength(2);
    expect(mattes.every((m) => !m.enabled)).toBe(true);
    expect(glow.trackMatteType).toBe(TRACK_MATTE.alpha);
    expect(mattes).toContain(glow.trackMatteLayer);
    expect(card.enabled).toBe(true);
    expect(card.trackMatteType).toBe(TRACK_MATTE.none);
    const stack = ae.stack();
    expect(stack.indexOf("KVFX Backdrop")).toBeLessThan(stack.indexOf("Card"));
    expect(stack.indexOf("KVFX Horizon Glow")).toBeLessThan(stack.indexOf("KVFX Backdrop"));
  });
});

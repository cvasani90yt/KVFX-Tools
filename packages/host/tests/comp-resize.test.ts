import { describe, expect, it } from "vitest";
import { createMockAe, type MockAe } from "./mock-ae.js";
import { MockItem, type MockLayer } from "./mock-dom.js";
import { runCommand } from "./run-command.js";

/**
 * Comp Resizer from 9:16 to 16:9: backgrounds cover the new frame in every
 * mode, Stretch stretches everything, and locked layers move with the rest.
 */

const VERTICAL = { width: 1080, height: 1920 } as const;
const W = 1920;
const H = 1080;

function place(layer: MockLayer, anchor: [number, number], position: [number, number]): MockLayer {
  layer.transform("ADBE Anchor Point").setValue([...anchor, 0]);
  layer.transform("ADBE Position").setValue([...position, 0]);
  return layer;
}

/** A vertical comp with the usual stack: content over a background solid. */
function vertical(): MockAe {
  const ae = createMockAe({ comp: { name: "Reel", ...VERTICAL, frameRate: 30, duration: 10, layers: [] } });
  const comp = ae.comp!;
  const bg = comp.layers.addSolid([0.1, 0.1, 0.12], "BG", VERTICAL.width, VERTICAL.height, 1) as unknown as MockLayer;
  place(bg, [540, 960], [540, 960]);
  const logo = comp.addLayer({ name: "Logo", kind: "av" });
  logo.sourceRect = { left: 0, top: 0, width: 200, height: 100 };
  place(logo, [100, 50], [540, 400]);
  return ae;
}

function sourceOf(ae: MockAe, name: string): MockItem {
  return ae.raw(name).source as MockItem;
}

describe("Comp Resizer: backgrounds fill the new frame", () => {
  it("gives a background solid a new solid the size of the frame, centred", () => {
    const ae = vertical();
    const old = sourceOf(ae, "BG");
    runCommand(ae, "kvfx.comp.resize", { width: W, height: H, fit: "keep" });

    const bg = ae.raw("BG");
    const fresh = sourceOf(ae, "BG");
    expect(fresh).not.toBe(old);
    expect([fresh.width, fresh.height]).toEqual([W, H]);
    expect(fresh.mainSource?.color).toEqual([0.1, 0.1, 0.12]);
    expect(bg.transform("ADBE Anchor Point").value).toEqual([960, 540, 0]);
    expect(bg.transform("ADBE Position").value).toEqual([960, 540, 0]);
    expect(bg.transform("ADBE Scale").value).toEqual([100, 100, 100]);
    // The old solid is left as it was, for any other comp that uses it.
    expect([old.width, old.height]).toEqual([VERTICAL.width, VERTICAL.height]);
  });

  it("keeps an adjustment layer an adjustment layer, covering the new frame", () => {
    const ae = vertical();
    const adjust = ae.comp!.layers.addSolid([1, 1, 1], "Grade", VERTICAL.width, VERTICAL.height, 1) as unknown as MockLayer;
    adjust.adjustmentLayer = true;
    place(adjust, [540, 960], [540, 960]);
    runCommand(ae, "kvfx.comp.resize", { width: W, height: H, fit: "fit" });
    const grade = ae.raw("Grade");
    expect(grade.adjustmentLayer).toBe(true);
    expect([sourceOf(ae, "Grade").width, sourceOf(ae, "Grade").height]).toEqual([W, H]);
    expect(grade.transform("ADBE Position").value).toEqual([960, 540, 0]);
  });

  it("moves a background's effect points and masks with its new size", () => {
    const ae = vertical();
    const bg = ae.raw("BG");
    const ramp = bg.effects.addProperty("ADBE Ramp");
    ramp.property(1)!.setValue([540, 0]);
    ramp.property(3)!.setValue([540, 1920]);
    const mask = bg.property("ADBE Mask Parade")!.addProperty("ADBE Mask Atom");
    mask.property("ADBE Mask Shape")!.setValue({ vertices: [[0, 0], [1080, 0], [1080, 1920], [0, 1920]], inTangents: [], outTangents: [], closed: true });

    runCommand(ae, "kvfx.comp.resize", { width: W, height: H });
    const effect = ae.raw("BG").effects.property(1)!;
    expect(effect.property(1)!.value).toEqual([960, 0]);
    expect(effect.property(3)!.value).toEqual([960, 1080]);
    const shape = ae.raw("BG").property("ADBE Mask Parade")!.property(1)!.property("ADBE Mask Shape")!.value as { vertices: number[][] };
    expect(shape.vertices).toEqual([[0, 0], [1920, 0], [1920, 1080], [0, 1080]]);
  });

  it("scales full-frame footage evenly until it covers, and stretches a full-frame shape", () => {
    const ae = vertical();
    const item = new MockItem("phone-video.mp4", "Footage");
    item.width = VERTICAL.width;
    item.height = VERTICAL.height;
    const photo = ae.comp!.addLayer({ name: "Photo", kind: "av", source: item });
    photo.sourceRect = { left: 0, top: 0, width: VERTICAL.width, height: VERTICAL.height };
    place(photo, [540, 960], [540, 960]);
    const card = ae.comp!.addLayer({ name: "Card", kind: "shape" });
    card.sourceRect = { left: -540, top: -960, width: VERTICAL.width, height: VERTICAL.height };
    place(card, [0, 0], [540, 960]);

    runCommand(ae, "kvfx.comp.resize", { width: W, height: H, fit: "keep" });
    const cover = (W / VERTICAL.width) * 100;
    const [px, py] = ae.raw("Photo").transform("ADBE Scale").value as number[];
    expect(px).toBeCloseTo(cover);
    expect(py).toBeCloseTo(cover);
    expect(ae.raw("Photo").transform("ADBE Position").value).toEqual([960, 540, 0]);
    const [cx, cy] = ae.raw("Card").transform("ADBE Scale").value as number[];
    expect(cx).toBeCloseTo((W / VERTICAL.width) * 100);
    expect(cy).toBeCloseTo((H / VERTICAL.height) * 100);
  });

  it("treats a layer that does not cover the frame as content", () => {
    const ae = vertical();
    const strip = ae.comp!.layers.addSolid([1, 0, 0], "Strip", 1080, 300, 1) as unknown as MockLayer;
    place(strip, [540, 150], [540, 1700]);
    const old = sourceOf(ae, "Strip");
    runCommand(ae, "kvfx.comp.resize", { width: W, height: H, fit: "keep" });
    expect(sourceOf(ae, "Strip")).toBe(old);
    // Keep: it moves with the centre, (+420, −420).
    expect(ae.positionOf("Strip")).toEqual({ x: 960, y: 1280 });
  });

  it("can be turned off, leaving backgrounds to the chosen mode", () => {
    const ae = vertical();
    const old = sourceOf(ae, "BG");
    runCommand(ae, "kvfx.comp.resize", { width: W, height: H, fit: "keep", backgrounds: false });
    expect(sourceOf(ae, "BG")).toBe(old);
    expect(ae.positionOf("BG")).toEqual({ x: 960, y: 540 });
  });
});

describe("Comp Resizer: modes", () => {
  it("fit shrinks content evenly into the new frame while the background still covers it", () => {
    const ae = vertical();
    runCommand(ae, "kvfx.comp.resize", { width: W, height: H, fit: "fit" });
    const k = H / VERTICAL.height;
    const [sx, sy] = ae.raw("Logo").transform("ADBE Scale").value as number[];
    expect(sx).toBeCloseTo(k * 100);
    expect(sy).toBeCloseTo(k * 100);
    const logo = ae.positionOf("Logo")!;
    expect(logo.x).toBeCloseTo(960);
    expect(logo.y).toBeCloseTo(540 + (400 - 960) * k);
    expect([sourceOf(ae, "BG").width, sourceOf(ae, "BG").height]).toEqual([W, H]);
  });

  it("stretch stretches every layer with the frame, wider and shorter", () => {
    const ae = vertical();
    runCommand(ae, "kvfx.comp.resize", { width: W, height: H, fit: "stretch" });
    const [sx, sy] = ae.raw("Logo").transform("ADBE Scale").value as number[];
    expect(sx).toBeCloseTo((W / VERTICAL.width) * 100);
    expect(sy).toBeCloseTo((H / VERTICAL.height) * 100);
    const logo = ae.positionOf("Logo")!;
    // Same place relative to the frame: 50 % across, 400 / 1920 down.
    expect(logo.x).toBeCloseTo(960);
    expect(logo.y).toBeCloseTo((400 / 1920) * 1080);
  });

  it("stretch counter-stretches the precomp layers that show the comp", () => {
    const ae = vertical();
    const parent = ae.project!.addComp("Edit", 1920, 1080);
    const user = parent.addLayer({ name: "Reel", kind: "precomp", source: ae.comp! });
    place(user, [540, 960], [960, 540]);
    runCommand(ae, "kvfx.comp.resize", { width: W, height: H, fit: "stretch" });
    const [sx, sy] = user.transform("ADBE Scale").value as number[];
    expect(sx).toBeCloseTo((VERTICAL.width / W) * 100);
    expect(sy).toBeCloseTo((VERTICAL.height / H) * 100);
    expect(user.transform("ADBE Anchor Point").value).toEqual([960, 540, 0]);
  });
});

describe("Comp Resizer: locked layers", () => {
  it("moves locked layers with everything else and locks them again", () => {
    const ae = vertical();
    ae.raw("BG").locked = true;
    ae.raw("Logo").locked = true;
    const reply = runCommand(ae, "kvfx.comp.resize", { width: W, height: H, fit: "keep" });
    expect(ae.raw("BG").locked).toBe(true);
    expect(ae.raw("Logo").locked).toBe(true);
    expect(ae.positionOf("BG")).toEqual({ x: 960, y: 540 });
    expect(ae.positionOf("Logo")).toEqual({ x: 960, y: -20 });
    const result = (reply.result as { steps: { result: { lockedLayersMoved: number; backgroundsFilled: number } }[] }).steps[0]!.result;
    expect(result.lockedLayersMoved).toBe(2);
    expect(result.backgroundsFilled).toBe(1);
  });
});

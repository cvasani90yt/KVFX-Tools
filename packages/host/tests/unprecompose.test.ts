import { describe, expect, it } from "vitest";
import { summarizeResult, type JsonValue } from "@kvfx/core";
import { createMockAe, type MockAe } from "./mock-ae.js";
import type { MockComp, MockLayer } from "./mock-dom.js";
import { runCommand } from "./run-command.js";

/**
 * Unprecompose: a precomp layer's layers back in the comp, looking and timed
 * exactly as they were inside it, with nothing deleted.
 */

function place(layer: MockLayer, anchor: [number, number], position: [number, number]): MockLayer {
  layer.transform("ADBE Anchor Point").setValue([...anchor, 0]);
  layer.transform("ADBE Position").setValue([...position, 0]);
  return layer;
}

interface Setup {
  ae: MockAe;
  scene: MockComp;
  precomp: MockLayer;
}

/** "Edit" holds a precomp layer of "Scene": a title, a card with a badge on it, and a background. */
function setup(): Setup {
  const ae = createMockAe({ comp: { name: "Edit", width: 1920, height: 1080, frameRate: 30, duration: 20, layers: [{ name: "Music" }] } });
  const scene = ae.project!.addComp("Scene", 1920, 1080, 30, 10);
  const bg = scene.addLayer({ name: "BG" });
  place(bg, [960, 540], [960, 540]);
  const card = place(scene.addLayer({ name: "Card", kind: "shape" }), [0, 0], [700, 600]);
  const badge = place(scene.addLayer({ name: "Badge", kind: "shape" }), [0, 0], [40, -30]);
  badge.parent = card;
  const title = scene.addLayer({ name: "Title", kind: "text", text: "Hello" });
  const position = title.transform("ADBE Position");
  position.setValueAtTime(0, [960, 300, 0]);
  position.setValueAtTime(1, [960, 400, 0]);

  const precomp = ae.comp!.addLayer({ name: "Scene", kind: "precomp", source: scene });
  place(precomp, [960, 540], [960, 540]);
  precomp.startTime = 2;
  precomp.inPoint = 2.5;
  precomp.outPoint = 8;
  ae.select("Scene");
  return { ae, scene, precomp };
}

function stepResult(reply: { result?: unknown }): Record<string, JsonValue> {
  return (reply.result as { steps: { result: Record<string, JsonValue> }[] }).steps[0]!.result;
}

describe("Unprecompose", () => {
  it("puts the layers back in order, above the precomp layer, which is switched off", () => {
    const { ae, scene, precomp } = setup();
    runCommand(ae, "kvfx.layer.unprecompose");
    expect(ae.stack()).toEqual(["Title", "Badge", "Card", "BG", "Scene", "Music"]);
    expect(precomp.enabled).toBe(false);
    // The nested comp is untouched and still in the project.
    expect(scene.stack.map((l) => l.name)).toEqual(["Title", "Badge", "Card", "BG"]);
  });

  it("keeps their values when the precomp is shown 1:1, and needs no null", () => {
    const { ae } = setup();
    runCommand(ae, "kvfx.layer.unprecompose");
    expect(ae.stack().some((n) => n.includes("released"))).toBe(false);
    expect(ae.positionOf("Card")).toEqual({ x: 700, y: 600 });
    expect(ae.raw("Card").parent).toBeNull();
  });

  it("shifts time by the precomp layer's start, keyframes included, and trims to what it showed", () => {
    const { ae } = setup();
    runCommand(ae, "kvfx.layer.unprecompose");
    const title = ae.raw("Title");
    expect(title.startTime).toBe(2);
    const position = title.transform("ADBE Position");
    expect([position.keyTime(1), position.keyTime(2)]).toEqual([2, 3]);
    expect([title.inPoint, title.outPoint]).toEqual([2.5, 8]);
  });

  it("rebuilds parenting between the released layers", () => {
    const { ae } = setup();
    runCommand(ae, "kvfx.layer.unprecompose");
    expect(ae.raw("Badge").parent).toBe(ae.raw("Card"));
    expect(ae.positionOf("Badge")).toEqual({ x: 40, y: -30 });
  });

  it("hangs them from a null carrying the precomp layer's transform when it is moved, scaled or animated", () => {
    const { ae, precomp } = setup();
    precomp.transform("ADBE Scale").setValue([50, 50, 100]);
    precomp.transform("ADBE Rotate Z").setValue(10);
    const position = precomp.transform("ADBE Position");
    position.setValueAtTime(3, [400, 300, 0]);
    position.setValueAtTime(5, [600, 300, 0]);
    runCommand(ae, "kvfx.layer.unprecompose");

    const holder = ae.raw("Scene · released");
    expect(ae.stack()).toEqual(["Scene · released", "Title", "Badge", "Card", "BG", "Scene", "Music"]);
    expect(holder.transform("ADBE Scale").value).toEqual([50, 50, 100]);
    expect(holder.transform("ADBE Rotate Z").value).toBe(10);
    expect(holder.transform("ADBE Anchor Point").value).toEqual([960, 540, 0]);
    const keys = holder.transform("ADBE Position");
    expect([keys.keyTime(1), keys.keyValue(1), keys.keyTime(2), keys.keyValue(2)]).toEqual([3, [400, 300, 0], 5, [600, 300, 0]]);
    // Top-level layers hang from the null; nested parenting stays as it was.
    expect(ae.raw("Title").parent).toBe(holder);
    expect(ae.raw("Card").parent).toBe(holder);
    expect(ae.raw("Badge").parent).toBe(ae.raw("Card"));
    // Their own values are untouched: the null does the placing.
    expect(ae.positionOf("Card")).toEqual({ x: 700, y: 600 });
  });

  it("leaves out layers that were never on screen in the precomp layer's span, and says so", () => {
    const { ae, scene } = setup();
    const early = scene.addLayer({ name: "Early" });
    early.outPoint = 0.4;
    const reply = runCommand(ae, "kvfx.layer.unprecompose");
    expect(ae.stack()).not.toContain("Early");
    expect(summarizeResult(reply.result as JsonValue)).toContain("never on screen");
  });

  it("keeps a locked layer locked, and leaves cameras inside", () => {
    const { ae, scene } = setup();
    scene.stack.find((l) => l.name === "BG")!.locked = true;
    scene.addLayer({ name: "Camera 1", kind: "camera" });
    const reply = runCommand(ae, "kvfx.layer.unprecompose");
    expect(ae.raw("BG").locked).toBe(true);
    expect(ae.stack()).not.toContain("Camera 1");
    expect(summarizeResult(reply.result as JsonValue)).toContain("camera or light layer left inside");
  });

  it("reports what plain layers cannot carry: the precomp layer's effects and opacity", () => {
    const { ae, precomp } = setup();
    precomp.effects.addProperty("ADBE Fill");
    precomp.transform("ADBE Opacity").setValue(50);
    const reply = runCommand(ae, "kvfx.layer.unprecompose");
    const message = summarizeResult(reply.result as JsonValue);
    expect(message).toContain("4 layers released from Scene");
    expect(message).toContain("its 1 effect stay on the switched-off precomp layer");
    expect(message).toContain("its opacity is not carried over");
    expect(stepResult(reply)["releasedCount"]).toBe(4);
  });

  it("warns when a released layer shares a name with one already in the comp", () => {
    const { ae } = setup();
    ae.comp!.addLayer({ name: "BG" }).moveToEnd();
    const message = summarizeResult(runCommand(ae, "kvfx.layer.unprecompose").result as JsonValue);
    expect(message).toContain("1 released layer shares its name with a layer already here");
  });

  it("skips precomp layers it cannot release without changing them", () => {
    const { ae, precomp } = setup();
    precomp.timeRemapEnabled = true;
    const reply = runCommand(ae, "kvfx.layer.unprecompose");
    expect(precomp.enabled).toBe(true);
    expect(ae.stack()).toEqual(["Scene", "Music"]);
    expect(summarizeResult(reply.result as JsonValue)).toContain("Time-remapped or stretched");

    const flat = setup();
    flat.precomp.threeDLayer = true;
    expect(summarizeResult(runCommand(flat.ae, "kvfx.layer.unprecompose").result as JsonValue)).toContain("turn off 3D first");
  });
});

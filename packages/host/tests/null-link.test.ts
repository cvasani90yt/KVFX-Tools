import { describe, expect, it } from "vitest";
import { createDispatcher } from "../src/runtime/dispatcher.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { createProductionRegistry } from "../src/ops/index.js";
import type { HostJson } from "../src/runtime/serialize.js";
import { createMockAe, type MockLayerSpec } from "./mock-ae.js";
import type { MockLayer } from "./mock-dom.js";

/**
 * layer.addNull — Create Null and Parent to New Null. With layers selected,
 * of any kind, the null lands at them and they are linked to it.
 */

interface Reply {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

function scene(layers: readonly MockLayerSpec[]) {
  const ae = createMockAe({ comp: { name: "Main", width: 1920, height: 1080, duration: 10, layers } });
  const dispatch = createDispatcher(createProductionRegistry(), ae);
  const run = (args: Record<string, HostJson> = { target: "selection" }): Record<string, unknown> => {
    const reply = JSON.parse(dispatch({ v: PROTOCOL_VERSION, id: "r1", kind: "op", op: "kvfx.op.layer.addNull", args, undoGroup: "KVFX Tools — Create Null", budgetMs: 1000 })) as Reply;
    if (!reply.ok) throw new Error(reply.error?.message);
    return reply.result!;
  };
  const layer = (name: string): MockLayer => ae.comp!.stack.find((l) => l.name === name)!;
  const at = (name: string, position: number[]): void => {
    layer(name).transform("ADBE Position").setValue(position);
  };
  return { ae, run, layer, at };
}

describe("Create Null with layers selected", () => {
  it("links text, shapes, precomps, footage and cameras alike", () => {
    const { run, layer } = scene([
      { name: "Title", kind: "text", selected: true },
      { name: "Badge", kind: "shape", selected: true },
      { name: "Scene", kind: "av", selected: true },
      { name: "Cam", kind: "camera", isAV: false, selected: true },
      { name: "Backdrop", kind: "av" },
    ]);
    const out = run();
    expect(out["linkedCount"]).toBe(4);
    const nul = layer("KVFX Control");
    for (const name of ["Title", "Badge", "Scene", "Cam"]) expect(layer(name).parent, name).toBe(nul);
    expect(layer("Backdrop").parent).toBeNull();
  });

  it("names the null after a single layer", () => {
    const { run, layer } = scene([{ name: "Logo", kind: "shape", selected: true }]);
    expect(run()["name"]).toBe("Logo Control");
    expect(layer("Logo").parent).toBe(layer("Logo Control"));
  });

  it("sits at the layers, centred on its own box, directly above the topmost of them", () => {
    const { ae, run, layer, at } = scene([
      { name: "Top", kind: "av" },
      { name: "A", kind: "text", selected: true },
      { name: "Between", kind: "av" },
      { name: "B", kind: "shape", selected: true },
    ]);
    at("A", [400, 300, 0]);
    at("B", [800, 500, 0]);
    run();
    const nul = layer("KVFX Control");
    expect(nul.transform("ADBE Position").value).toEqual([600, 400]);
    const box = nul.sourceRectAtTime(0, false);
    expect(nul.transform("ADBE Anchor Point").value).toEqual([box.left + box.width / 2, box.top + box.height / 2]);
    expect(ae.comp!.stack.map((l) => l.name)).toEqual(["Top", "KVFX Control", "A", "Between", "B"]);
  });

  it("spans the layers' time, and is 3D only when every one of them is", () => {
    const flat = scene([
      { name: "A", kind: "av", selected: true, threeD: true },
      { name: "B", kind: "av", selected: true },
    ]);
    flat.layer("A").inPoint = 2;
    flat.layer("A").outPoint = 5;
    flat.layer("B").inPoint = 3;
    flat.layer("B").outPoint = 8;
    flat.run();
    const nul = flat.layer("KVFX Control");
    expect([nul.inPoint, nul.outPoint]).toEqual([2, 8]);
    expect(nul.threeDLayer).toBe(false);

    const deep = scene([
      { name: "A", kind: "av", selected: true, threeD: true },
      { name: "Cam", kind: "camera", isAV: false, selected: true },
    ]);
    deep.at("A", [100, 200, -300]);
    deep.at("Cam", [300, 400, -900]);
    deep.run();
    const nul3d = deep.layer("KVFX Control");
    expect(nul3d.threeDLayer).toBe(true);
    expect(nul3d.transform("ADBE Position").value).toEqual([200, 300, -600]);
  });

  it("keeps a rig's shape: a layer parented to another selected layer keeps its parent", () => {
    const { run, layer } = scene([
      { name: "Arm", kind: "shape", selected: true },
      { name: "Hand", kind: "shape", selected: true },
    ]);
    layer("Hand").parent = layer("Arm");
    expect(run()["linkedCount"]).toBe(1);
    // Only Arm is linked, so the null is named after it.
    expect(layer("Arm").parent).toBe(layer("Arm Control"));
    expect(layer("Hand").parent).toBe(layer("Arm"));
  });

  it("leaves locked layers alone, with a reason", () => {
    const { run, layer } = scene([
      { name: "Free", kind: "av", selected: true },
      { name: "Fixed", kind: "av", selected: true, locked: true },
    ]);
    const out = run();
    expect(out["linkedCount"]).toBe(1);
    expect(out["skipped"]).toEqual([expect.objectContaining({ name: "Fixed", reason: "Layer is locked" })]);
    expect(layer("Fixed").parent).toBeNull();
  });
});

describe("Create Null with nothing selected", () => {
  it("is a plain null at the top, linked to nothing", () => {
    const { ae, run } = scene([{ name: "A", kind: "av" }]);
    const out = run();
    expect(out["linkedCount"]).toBe(0);
    expect(ae.comp!.stack[0]!.name).toBe(out["name"]);
    expect(ae.comp!.stack[1]!.parent).toBeNull();
  });
});

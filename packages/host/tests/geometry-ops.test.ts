import { describe, expect, it } from "vitest";
import { measureOperation, setTransformOperation } from "../src/ops/layer/geometry.js";
import { createMockAe, type MockAe, type MockLayerSpec } from "./mock-ae.js";
import type { HostJson } from "../src/runtime/serialize.js";

function run(
  op: typeof measureOperation,
  env: MockAe,
  args: Record<string, HostJson>,
): Record<string, unknown> {
  return op.run({ env, args, deadlineMs: Number.MAX_SAFE_INTEGER }) as Record<string, unknown>;
}

function ae(layers: readonly MockLayerSpec[]): MockAe {
  return createMockAe({ comp: { layers, width: 1920, height: 1080 } });
}

describe("kvfx.op.layer.measure", () => {
  it("reports composition size and the selected layers", () => {
    const env = ae([{ name: "A", selected: true }, { name: "B" }]);
    const result = run(measureOperation, env, { target: "selection" });

    expect((result["comp"] as Record<string, unknown>)["width"]).toBe(1920);
    expect(result["selectedIds"]).toEqual([env.idOf("A")]);
    expect(result["layers"]).toHaveLength(1);
  });

  it("includes ancestors that are not selected", () => {
    // A parent determines where its child renders, so it must travel with the
    // measurement even when the user did not select it.
    const env = ae([
      { name: "Parent" },
      { name: "Child", selected: true, geometry: { parent: "Parent" } },
    ]);
    const result = run(measureOperation, env, { target: "selection" });

    const names = (result["layers"] as { name: string }[]).map((entry) => entry.name).sort();
    expect(names).toEqual(["Child", "Parent"]);
    expect(result["selectedIds"]).toEqual([env.idOf("Child")]);
  });

  it("walks a multi-level parent chain", () => {
    const env = ae([
      { name: "Grandparent" },
      { name: "Parent", geometry: { parent: "Grandparent" } },
      { name: "Child", selected: true, geometry: { parent: "Parent" } },
    ]);
    const result = run(measureOperation, env, { target: "selection" });
    expect(result["layers"]).toHaveLength(3);
  });

  it("does not measure the whole composition", () => {
    // Measuring every layer would make this scale with project size for no gain.
    const many: MockLayerSpec[] = Array.from({ length: 50 }, (_, index) => ({
      name: `L${String(index)}`,
      selected: index === 0,
    }));
    expect(run(measureOperation, ae(many), { target: "selection" })["layers"]).toHaveLength(1);
  });

  it("reports each layer's transform", () => {
    const env = ae([
      {
        name: "A",
        selected: true,
        geometry: {
          position: { x: 300, y: 200 },
          anchorPoint: { x: 50, y: 25 },
          scale: { x: 150, y: 150 },
          rotation: 45,
          sourceRect: { left: -10, top: -5, width: 100, height: 50 },
        },
      },
    ]);
    const layer = (run(measureOperation, env, { target: "selection" })["layers"] as Record<string, unknown>[])[0];

    expect(layer?.["position"]).toEqual({ x: 300, y: 200 });
    expect(layer?.["anchorPoint"]).toEqual({ x: 50, y: 25 });
    expect(layer?.["scale"]).toEqual({ x: 150, y: 150 });
    expect(layer?.["rotation"]).toBe(45);
    expect(layer?.["sourceRect"]).toEqual({ left: -10, top: -5, width: 100, height: 50 });
  });

  it("marks a camera as not an AV layer", () => {
    const env = ae([{ name: "Camera", selected: true, isAV: false }]);
    const layer = (run(measureOperation, env, { target: "selection" })["layers"] as Record<string, unknown>[])[0];
    expect(layer?.["isAV"]).toBe(false);
  });

  it("carries the reason a layer cannot be repositioned", () => {
    const env = ae([{ name: "A", selected: true, geometry: { blockedReason: "Position is animated" } }]);
    const layer = (run(measureOperation, env, { target: "selection" })["layers"] as Record<string, unknown>[])[0];
    expect(layer?.["blockedReason"]).toBe("Position is animated");
  });

  it("opens no undo group — it is a read", () => {
    const env = ae([{ name: "A", selected: true }]);
    run(measureOperation, env, { target: "selection" });
    expect(env.undoEvents).toEqual([]);
  });

  it("fails cleanly with no composition", () => {
    expect(() => run(measureOperation, createMockAe({}), { target: "selection" })).toThrow();
  });
});

describe("kvfx.op.layer.setTransform", () => {
  it("writes position by id", () => {
    const env = ae([{ name: "A" }, { name: "B" }]);
    const result = run(setTransformOperation, env, {
      changes: [{ id: env.idOf("B"), position: { x: 640, y: 360 } }],
    });

    expect(result["changedCount"]).toBe(1);
    expect(env.positionOf("B")).toEqual({ x: 640, y: 360 });
    expect(env.positionOf("A")).toEqual({ x: 0, y: 0 });
  });

  it("writes anchor point and position together", () => {
    const env = ae([{ name: "A" }]);
    run(setTransformOperation, env, {
      changes: [{ id: env.idOf("A"), anchorPoint: { x: 50, y: 25 }, position: { x: 100, y: 100 } }],
    });

    expect(env.anchorOf("A")).toEqual({ x: 50, y: 25 });
    expect(env.positionOf("A")).toEqual({ x: 100, y: 100 });
  });

  it("skips a locked layer and says why", () => {
    const env = ae([{ name: "A", locked: true }]);
    const result = run(setTransformOperation, env, {
      changes: [{ id: env.idOf("A"), position: { x: 5, y: 5 } }],
    });

    expect(result["changedCount"]).toBe(0);
    expect((result["skipped"] as { reason: string }[])[0]?.reason).toBe("Layer is locked");
    expect(env.positionOf("A")).toEqual({ x: 0, y: 0 });
  });

  it("skips a layer whose position is animated rather than writing a keyframe", () => {
    // Adding a keyframe would alter animation the user never asked us to touch.
    const env = ae([{ name: "A", geometry: { blockedReason: "Position is animated" } }]);
    const result = run(setTransformOperation, env, {
      changes: [{ id: env.idOf("A"), position: { x: 5, y: 5 } }],
    });

    expect(result["changedCount"]).toBe(0);
    expect((result["skipped"] as { reason: string }[])[0]?.reason).toBe("Position is animated");
    expect(env.positionOf("A")).toEqual({ x: 0, y: 0 });
  });

  it("reports ids that no longer exist", () => {
    const env = ae([{ name: "A" }]);
    const result = run(setTransformOperation, env, {
      changes: [{ id: env.idOf("A"), position: { x: 1, y: 1 } }, { id: 9999, position: { x: 2, y: 2 } }],
    });

    expect(result["changedCount"]).toBe(1);
    expect(result["missingIds"]).toEqual([9999]);
  });

  it("validates every change before writing any of them", () => {
    // A malformed change late in the list must not leave the composition
    // half-modified.
    const env = ae([{ name: "A" }, { name: "B" }]);
    expect(() =>
      run(setTransformOperation, env, {
        changes: [{ id: env.idOf("A"), position: { x: 5, y: 5 } }, { notAnId: true }],
      }),
    ).toThrow();

    expect(env.positionOf("A")).toEqual({ x: 0, y: 0 });
  });

  it("rejects a non-finite coordinate rather than corrupting the layer", () => {
    const env = ae([{ name: "A" }]);
    const result = run(setTransformOperation, env, {
      changes: [{ id: env.idOf("A"), position: { x: Number.NaN, y: 0 } }],
    });

    expect(result["changedCount"]).toBe(0);
    expect(env.positionOf("A")).toEqual({ x: 0, y: 0 });
  });

  it("rejects a changes argument that is not an array", () => {
    expect(() => run(setTransformOperation, ae([{ name: "A" }]), { changes: "nope" })).toThrow();
  });
});

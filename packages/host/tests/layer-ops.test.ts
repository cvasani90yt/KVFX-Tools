import { describe, expect, it } from "vitest";
import { setFlagOperation } from "../src/ops/layer/flags.js";
import { reorderOperation } from "../src/ops/layer/reorder.js";
import { createLayerOperation } from "../src/ops/layer/create.js";
import { readSnapshot } from "../src/ops/selection.js";
import { createMockAe, type MockAe, type MockLayerSpec } from "./mock-ae.js";
import type { HostJson } from "../src/runtime/serialize.js";

function ae(layers: readonly MockLayerSpec[], extra: { hasProject?: boolean } = {}): MockAe {
  return createMockAe({ comp: { layers }, ...extra });
}

function run(
  op: typeof setFlagOperation,
  env: MockAe,
  args: Record<string, HostJson>,
): Record<string, unknown> {
  return op.run({ env, args, deadlineMs: Number.MAX_SAFE_INTEGER }) as Record<string, unknown>;
}

describe("kvfx.op.layer.setFlag — toggle semantics", () => {
  it("turns the switch on when none of the targets have it", () => {
    const env = ae([{ name: "A", selected: true }, { name: "B", selected: true }]);
    const result = run(setFlagOperation, env, { target: "selection", flag: "solo", value: "toggle" });

    expect(result["value"]).toBe(true);
    expect(result["changedCount"]).toBe(2);
    expect(env.layerByName("A")?.flags["solo"]).toBe(true);
  });

  it("turns the switch off only when every target already has it", () => {
    const env = ae([
      { name: "A", selected: true, solo: true },
      { name: "B", selected: true, solo: true },
    ]);
    const result = run(setFlagOperation, env, { target: "selection", flag: "solo", value: "toggle" });

    expect(result["value"]).toBe(false);
    expect(env.layerByName("B")?.flags["solo"]).toBe(false);
  });

  it("normalises a mixed selection to on rather than flipping each layer", () => {
    // Flipping individually would leave the selection just as mixed as before,
    // which is never what the user meant by pressing one button.
    const env = ae([
      { name: "A", selected: true, solo: true },
      { name: "B", selected: true, solo: false },
    ]);
    run(setFlagOperation, env, { target: "selection", flag: "solo", value: "toggle" });

    expect(env.layerByName("A")?.flags["solo"]).toBe(true);
    expect(env.layerByName("B")?.flags["solo"]).toBe(true);
  });

  it("only counts layers it actually changed", () => {
    const env = ae([
      { name: "A", selected: true, solo: true },
      { name: "B", selected: true, solo: false },
    ]);
    const result = run(setFlagOperation, env, { target: "selection", flag: "solo", value: "toggle" });
    expect(result["changedCount"]).toBe(1);
  });

  it("honours an explicit value", () => {
    const env = ae([{ name: "A", selected: true }]);
    run(setFlagOperation, env, { target: "selection", flag: "locked", value: true });
    expect(env.layerByName("A")?.flags["locked"]).toBe(true);
  });
});

describe("kvfx.op.layer.setFlag — what it refuses to touch", () => {
  it("skips a locked layer instead of throwing, and says why", () => {
    // After Effects throws when a locked layer is modified. Unlocking it for the
    // user would override an explicit instruction.
    const env = ae([
      { name: "Locked", selected: true, locked: true },
      { name: "Free", selected: true },
    ]);
    const result = run(setFlagOperation, env, { target: "selection", flag: "solo", value: true });

    expect(env.layerByName("Locked")?.flags["solo"]).toBe(false);
    expect(env.layerByName("Free")?.flags["solo"]).toBe(true);
    expect(result["skipped"]).toEqual([
      { id: env.idOf("Locked"), name: "Locked", reason: "Layer is locked" },
    ]);
  });

  it("still allows the lock switch itself on a locked layer", () => {
    const env = ae([{ name: "Locked", selected: true, locked: true }]);
    run(setFlagOperation, env, { target: "selection", flag: "locked", value: false });
    expect(env.layerByName("Locked")?.flags["locked"]).toBe(false);
  });

  it("skips a layer type that has no such switch", () => {
    const env = ae([
      { name: "Camera", selected: true, isAV: false },
      { name: "Solid", selected: true },
    ]);
    const result = run(setFlagOperation, env, { target: "selection", flag: "solo", value: true });

    expect(result["changedCount"]).toBe(1);
    expect((result["skipped"] as { reason: string }[])[0]?.reason).toBe(
      "This layer type has no such switch",
    );
  });

  it("rejects an unknown flag", () => {
    const env = ae([{ name: "A", selected: true }]);
    expect(() => run(setFlagOperation, env, { target: "selection", flag: "sparkle", value: true })).toThrow();
  });

  it("rejects a bad value", () => {
    const env = ae([{ name: "A", selected: true }]);
    expect(() => run(setFlagOperation, env, { target: "selection", flag: "solo", value: "yes" })).toThrow();
  });
});

describe("kvfx.op.layer.setFlag — targets", () => {
  it("reads the live selection, not a list supplied by the panel", () => {
    const env = ae([{ name: "A" }, { name: "B" }]);
    env.select("B");
    run(setFlagOperation, env, { target: "selection", flag: "solo", value: true });

    expect(env.layerByName("A")?.flags["solo"]).toBe(false);
    expect(env.layerByName("B")?.flags["solo"]).toBe(true);
  });

  it("can target every layer, which is how unlock-all reaches locked layers", () => {
    const env = ae([{ name: "A", locked: true }, { name: "B", locked: true }]);
    run(setFlagOperation, env, { target: "all", flag: "locked", value: false });

    expect(env.layerByName("A")?.flags["locked"]).toBe(false);
    expect(env.layerByName("B")?.flags["locked"]).toBe(false);
  });

  it("reports ids that no longer exist rather than silently dropping them", () => {
    const env = ae([{ name: "A" }]);
    const result = run(setFlagOperation, env, {
      target: "ids",
      ids: [env.idOf("A"), 9999],
      flag: "solo",
      value: true,
    });

    expect(result["changedCount"]).toBe(1);
    expect(result["missingIds"]).toEqual([9999]);
  });
});

describe("kvfx.op.layer.reorder", () => {
  const four: readonly MockLayerSpec[] = [
    { name: "1" },
    { name: "2" },
    { name: "3" },
    { name: "4" },
  ];

  it("moves layers to the top preserving their relative order", () => {
    // A naive ascending loop reverses them; this is the regression that matters.
    const env = ae(four);
    env.select("2", "4");
    run(reorderOperation, env, { target: "selection", to: "top" });
    expect(env.stack()).toEqual(["2", "4", "1", "3"]);
  });

  it("moves layers to the bottom preserving their relative order", () => {
    const env = ae(four);
    env.select("1", "3");
    run(reorderOperation, env, { target: "selection", to: "bottom" });
    expect(env.stack()).toEqual(["2", "4", "1", "3"]);
  });

  it("moves a single layer up one step", () => {
    const env = ae(four);
    env.select("3");
    run(reorderOperation, env, { target: "selection", to: "up" });
    expect(env.stack()).toEqual(["1", "3", "2", "4"]);
  });

  it("moves a single layer down one step", () => {
    const env = ae(four);
    env.select("2");
    run(reorderOperation, env, { target: "selection", to: "down" });
    expect(env.stack()).toEqual(["1", "3", "2", "4"]);
  });

  it("does nothing when the top layer is asked to move up", () => {
    const env = ae(four);
    env.select("1");
    const result = run(reorderOperation, env, { target: "selection", to: "up" });

    expect(env.stack()).toEqual(["1", "2", "3", "4"]);
    expect(result["movedCount"]).toBe(0);
  });

  it("does nothing when the bottom layer is asked to move down", () => {
    const env = ae(four);
    env.select("4");
    const result = run(reorderOperation, env, { target: "selection", to: "down" });

    expect(env.stack()).toEqual(["1", "2", "3", "4"]);
    expect(result["movedCount"]).toBe(0);
  });

  it("keeps a block against the top edge intact", () => {
    // Layer 1 cannot move; layer 2 must not move either, or the two would swap
    // and the user's selection would be silently reordered.
    const env = ae(four);
    env.select("1", "2");
    run(reorderOperation, env, { target: "selection", to: "up" });
    expect(env.stack()).toEqual(["1", "2", "3", "4"]);
  });

  it("keeps a block against the bottom edge intact", () => {
    const env = ae(four);
    env.select("3", "4");
    run(reorderOperation, env, { target: "selection", to: "down" });
    expect(env.stack()).toEqual(["1", "2", "3", "4"]);
  });

  it("moves a contiguous block up as a block", () => {
    const env = ae(four);
    env.select("2", "3");
    run(reorderOperation, env, { target: "selection", to: "up" });
    expect(env.stack()).toEqual(["2", "3", "1", "4"]);
  });

  it("moves a contiguous block down as a block", () => {
    const env = ae(four);
    env.select("2", "3");
    run(reorderOperation, env, { target: "selection", to: "down" });
    expect(env.stack()).toEqual(["1", "4", "2", "3"]);
  });

  it("skips locked layers and reports them", () => {
    const env = ae([{ name: "1" }, { name: "2", locked: true }, { name: "3" }]);
    env.select("2", "3");
    const result = run(reorderOperation, env, { target: "selection", to: "top" });

    expect(env.stack()).toEqual(["3", "1", "2"]);
    expect((result["skipped"] as { name: string }[])[0]?.name).toBe("2");
  });

  it("rejects an unknown direction", () => {
    const env = ae(four);
    expect(() => run(reorderOperation, env, { target: "selection", to: "sideways" })).toThrow();
  });
});

describe("kvfx.op.layer.create", () => {
  it("adds a null at the top and reports it", () => {
    const env = ae([{ name: "Existing" }]);
    const result = run(createLayerOperation, env, { kind: "null" });

    expect(result["index"]).toBe(1);
    expect(env.stack()[1]).toBe("Existing");
    expect(typeof result["id"]).toBe("number");
  });

  it("adds an adjustment layer with the adjustment switch already on", () => {
    const env = ae([]);
    run(createLayerOperation, env, { kind: "adjustment" });

    expect(env.stack()).toEqual(["Adjustment Layer"]);
    expect(env.layerByName("Adjustment Layer")?.flags["adjustment"]).toBe(true);
  });

  it("rejects an unknown kind", () => {
    const env = ae([]);
    expect(() => run(createLayerOperation, env, { kind: "hologram" })).toThrow();
  });
});

describe("kvfx.op.selection.snapshot", () => {
  it("reports the composition and the selected layers", () => {
    const env = ae([{ name: "A", selected: true }, { name: "B" }]);
    const snap = readSnapshot(env) as Record<string, unknown>;

    expect(snap["hasProject"]).toBe(true);
    expect((snap["comp"] as Record<string, unknown>)["layerCount"]).toBe(2);
    expect(snap["layers"]).toHaveLength(1);
    expect((snap["layers"] as Record<string, unknown>[])[0]?.["name"]).toBe("A");
  });

  it("marks a camera or light as not an AV layer", () => {
    const env = ae([{ name: "Camera", selected: true, isAV: false }]);
    const layers = (readSnapshot(env) as { layers: Record<string, unknown>[] }).layers;
    expect(layers[0]?.["isAV"]).toBe(false);
  });

  it("reports no composition rather than failing when none is open", () => {
    const env = createMockAe({});
    const snap = readSnapshot(env) as Record<string, unknown>;

    expect(snap["hasProject"]).toBe(true);
    expect(snap["comp"]).toBeNull();
    expect(snap["layers"]).toEqual([]);
  });

  it("reports no project rather than failing when none is open", () => {
    const env = createMockAe({ hasProject: false });
    expect((readSnapshot(env) as Record<string, unknown>)["hasProject"]).toBe(false);
  });

  it("opens no undo group — it is a read", () => {
    const env = ae([{ name: "A", selected: true }]);
    readSnapshot(env);
    expect(env.undoEvents).toEqual([]);
  });
});

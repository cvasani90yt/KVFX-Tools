import { describe, expect, it } from "vitest";
import { PLAN_OPERATION_ID, createDispatcher } from "../src/runtime/dispatcher.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { createProductionRegistry } from "../src/ops/index.js";
import type { HostJson } from "../src/runtime/serialize.js";
import { createMockAe, type MockAeOptions, type MockLayerSpec } from "./mock-ae.js";
import { MockComp, PURGE_ALL, font } from "./mock-dom.js";

/**
 * The generic primitives the core plan builders compose, run against the mock
 * After Effects DOM through the real dispatcher.
 */

interface Reply {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

function harness(layers: readonly MockLayerSpec[] = [], options: MockAeOptions = {}) {
  const ae = createMockAe({ comp: { layers }, ...options });
  const dispatch = createDispatcher(createProductionRegistry(), ae);
  let n = 0;

  const send = (request: Record<string, unknown>): Reply =>
    JSON.parse(dispatch({ v: PROTOCOL_VERSION, id: `r${String((n += 1))}`, budgetMs: 1000, ...request })) as Reply;

  return {
    ae,
    query: (op: string, args: Record<string, HostJson> = {}) => send({ kind: "query", op, args }),
    command: (op: string, args: Record<string, HostJson> = {}) =>
      send({ kind: "op", op, args, undoGroup: "KVFX Tools — Test" }),
    plan: (steps: unknown[]) =>
      send({ kind: "plan", op: PLAN_OPERATION_ID, args: { steps }, undoGroup: "KVFX Tools — Test" }),
  };
}

const result = (reply: Reply): Record<string, unknown> => {
  if (!reply.ok) throw new Error(`Expected success, got ${reply.error?.code}: ${reply.error?.message}`);
  return reply.result as Record<string, unknown>;
};

// ---------------------------------------------------------------------------

describe("system.memory and system.purge", () => {
  it("reports memory in use", () => {
    const { query } = harness();
    expect(result(query("kvfx.op.system.memory"))["bytes"]).toBeGreaterThan(1e9);
  });

  it("purges all caches without opening an undo group", () => {
    const { ae, query } = harness();
    result(query("kvfx.op.system.purge"));
    expect(ae.app.purges).toEqual([PURGE_ALL]);
    expect(ae.undoEvents).toEqual([]);
  });
});

describe("layer.create", () => {
  it.each([
    ["null", "null"],
    ["adjustment", "av"],
    ["solid", "av"],
    ["text", "text"],
    ["shape", "shape"],
    ["camera", "camera"],
  ])("creates a %s layer at the top", (kind, mockKind) => {
    const { ae, command } = harness([{ name: "Existing" }]);
    const out = result(command("kvfx.op.layer.create", { kind }));
    expect(ae.comp?.stack[0]?.id).toBe(out["id"]);
    expect(ae.comp?.stack[0]?.kind).toBe(mockKind);
  });

  it("makes adjustment layers adjustment layers", () => {
    const { ae, command } = harness();
    command("kvfx.op.layer.create", { kind: "adjustment" });
    expect(ae.comp?.stack[0]?.adjustmentLayer).toBe(true);
  });

  it("gives a solid the requested colour, clamped to 0–1", () => {
    const { ae, command } = harness();
    command("kvfx.op.layer.create", { kind: "solid", color: [1.4, 0.5, -1], name: "BG" });
    const solid = ae.comp?.stack[0] as unknown as { solidColor: number[]; name: string };
    expect(solid.solidColor).toEqual([1, 0.5, 0]);
    expect(solid.name).toBe("BG");
  });

  it("rejects an unknown kind", () => {
    const { command } = harness();
    expect(command("kvfx.op.layer.create", { kind: "hologram" }).error?.code).toBe("invalid_argument");
  });
});

describe("prop.set", () => {
  it("writes a static value on each target", () => {
    const { ae, command } = harness([
      { name: "A", selected: true },
      { name: "B", selected: true },
    ]);
    const out = result(
      command("kvfx.op.prop.set", {
        target: "selection",
        path: ["ADBE Transform Group", "ADBE Opacity"],
        value: 40,
      }),
    );
    expect(out["changedCount"]).toBe(2);
    expect(ae.raw("A").transform("ADBE Opacity").value).toBe(40);
  });

  it("skips animated properties by default and says why", () => {
    const { ae, command } = harness([{ name: "A", selected: true }]);
    ae.raw("A").transform("ADBE Opacity").setValueAtTime(0, 100);
    const out = result(
      command("kvfx.op.prop.set", { target: "selection", path: ["ADBE Transform Group", "ADBE Opacity"], value: 10 }),
    );
    expect(out["changedCount"]).toBe(0);
    expect(out["skipped"]).toEqual([{ id: ae.idOf("A"), name: "A", reason: "Opacity is animated" }]);
  });

  it("keys the current time when asked to, like the Properties panel", () => {
    const { ae, command } = harness([{ name: "A", selected: true }]);
    const opacity = ae.raw("A").transform("ADBE Opacity");
    opacity.setValueAtTime(0, 100);
    ae.comp!.time = 2;
    result(
      command("kvfx.op.prop.set", {
        target: "selection",
        path: ["ADBE Transform Group", "ADBE Opacity"],
        value: 10,
        whenAnimated: "keyframe",
      }),
    );
    expect(opacity.numKeys).toBe(2);
    expect(opacity.keyValue(2)).toBe(10);
  });

  it("fails the request in error mode", () => {
    const { ae, command } = harness([{ name: "A", selected: true }]);
    ae.raw("A").transform("ADBE Opacity").setValueAtTime(0, 100);
    const reply = command("kvfx.op.prop.set", {
      target: "selection",
      path: ["ADBE Transform Group", "ADBE Opacity"],
      value: 10,
      whenAnimated: "error",
    });
    expect(reply.error?.code).toBe("precondition_failed");
  });

  it("skips locked layers and separated dimensions", () => {
    const { ae, command } = harness([
      { name: "Locked", selected: true, locked: true },
      { name: "Split", selected: true, geometry: { blockedReason: "separated" } },
    ]);
    const out = result(
      command("kvfx.op.prop.set", {
        target: "selection",
        path: ["ADBE Transform Group", "ADBE Position"],
        value: [1, 2, 0],
      }),
    );
    expect((out["skipped"] as { reason: string }[]).map((s) => s.reason)).toEqual([
      "Layer is locked",
      "Position has separated dimensions",
    ]);
    expect(ae.positionOf("Split")).toEqual({ x: 0, y: 0 });
  });

  it("reports ids that no longer exist instead of dropping them", () => {
    const { command } = harness([{ name: "A" }]);
    const out = result(
      command("kvfx.op.prop.set", { ids: [424242], path: ["ADBE Transform Group", "ADBE Opacity"], value: 1 }),
    );
    expect(out["missingIds"]).toEqual([424242]);
  });
});

describe("prop.expression", () => {
  it("sets and enables an expression", () => {
    const { ae, command } = harness([{ name: "A", selected: true }]);
    command("kvfx.op.prop.expression", {
      target: "selection",
      path: ["ADBE Transform Group", "ADBE Rotate Z"],
      expression: "time * 90",
    });
    const rotation = ae.raw("A").transform("ADBE Rotate Z");
    expect(rotation.expression).toBe("time * 90");
    expect(rotation.expressionEnabled).toBe(true);
  });

  it("clears and disables with an empty string", () => {
    const { ae, command } = harness([{ name: "A", selected: true }]);
    const rotation = ae.raw("A").transform("ADBE Rotate Z");
    rotation.expression = "wiggle(1, 5)";
    rotation.expressionEnabled = true;
    command("kvfx.op.prop.expression", {
      target: "selection",
      path: ["ADBE Transform Group", "ADBE Rotate Z"],
      expression: "",
    });
    expect(rotation.expressionEnabled).toBe(false);
  });
});

describe("effect.add", () => {
  it("adds an effect and sets parameters by value type, not by localised name", () => {
    const { ae, command } = harness([{ name: "A", selected: true }]);
    const out = result(
      command("kvfx.op.effect.add", {
        target: "selection",
        matchName: "ADBE Fill",
        name: "KVFX Fill",
        params: [{ path: [{ valueType: "color", nth: 1 }], value: [1, 0.5, 0, 1] }],
      }),
    );
    const fill = ae.raw("A").effects.property(1)!;
    expect(out["ids"]).toEqual([ae.idOf("A")]);
    expect(fill.name).toBe("KVFX Fill");
    expect(fill.property("Color")?.value).toEqual([1, 0.5, 0, 1]);
  });

  it("skips layers that cannot take effects", () => {
    const { command } = harness([{ name: "Cam", kind: "camera", selected: true }]);
    const out = result(command("kvfx.op.effect.add", { target: "selection", matchName: "ADBE Fill" }));
    expect(out["skipped"]).toHaveLength(1);
  });
});

describe("plan-local references", () => {
  it("lets later steps act on what earlier steps created", () => {
    const { ae, plan } = harness();
    const reply = plan([
      { op: "kvfx.op.layer.create", args: { kind: "null" }, bind: "ctrl" },
      {
        op: "kvfx.op.effect.add",
        args: { id: { $ref: "ctrl" }, matchName: "ADBE Slider Control", name: "Radius" },
      },
    ]);
    expect(reply.ok).toBe(true);
    expect(ae.comp?.stack[0]?.effects.property(1)?.name).toBe("Radius");
  });

  it("picks one element of a bound array with `at`", () => {
    const { ae, plan } = harness([{ name: "Card", selected: true }]);
    const reply = plan([
      { op: "kvfx.op.layer.duplicate", args: { target: "selection", count: 2 }, bind: "copies" },
      { op: "kvfx.op.layer.set", args: { id: { $ref: "copies", at: 1 }, name: "Second" } },
    ]);
    expect(reply.ok).toBe(true);
    expect(ae.stack()).toEqual(["Card", "Second", "Card"]);
  });

  it("refuses an element that was never made", () => {
    const { plan } = harness([{ name: "Locked", selected: true, locked: true }]);
    const reply = plan([
      { op: "kvfx.op.layer.duplicate", args: { target: "selection" }, bind: "copies" },
      { op: "kvfx.op.layer.set", args: { id: { $ref: "copies", at: 0 }, name: "X" } },
    ]);
    expect(reply.error?.code).toBe("precondition_failed");
  });

  it("refuses an unknown reference", () => {
    const { plan } = harness();
    const reply = plan([{ op: "kvfx.op.layer.set", args: { id: { $ref: "ghost" }, name: "X" } }]);
    expect(reply.error?.code).toBe("invalid_request");
  });
});

describe("layer.duplicate and layer.set", () => {
  it("duplicates each target and returns the copies", () => {
    const { ae, command } = harness([{ name: "A", selected: true }, { name: "B" }]);
    const out = result(command("kvfx.op.layer.duplicate", { target: "selection", count: 3 }));
    expect((out["ids"] as number[]).length).toBe(3);
    expect(ae.stack()).toEqual(["A", "A", "A", "A", "B"]);
  });

  it("bounds the duplicate count", () => {
    const { command } = harness([{ name: "A", selected: true }]);
    expect(command("kvfx.op.layer.duplicate", { target: "selection", count: 5000 }).error?.code).toBe(
      "invalid_argument",
    );
  });

  it("sets label, timing and name", () => {
    const { ae, command } = harness([{ name: "A", selected: true }]);
    result(command("kvfx.op.layer.set", { target: "selection", label: 9, startTime: 1.5, name: "Renamed" }));
    const layer = ae.raw("Renamed");
    expect(layer.label).toBe(9);
    expect(layer.startTime).toBe(1.5);
  });

  it("rejects a label outside 0–16", () => {
    const { command } = harness([{ name: "A", selected: true }]);
    expect(command("kvfx.op.layer.set", { target: "selection", label: 17 }).error?.code).toBe("invalid_argument");
  });

  it("parents and unparents, refusing self-parenting", () => {
    const { ae, command } = harness([{ name: "Child", selected: true }, { name: "Boss" }]);
    result(command("kvfx.op.layer.set", { target: "selection", parent: ae.idOf("Boss") }));
    expect(ae.raw("Child").parent?.name).toBe("Boss");
    const self = result(command("kvfx.op.layer.set", { ids: [ae.idOf("Boss")], parent: ae.idOf("Boss") }));
    expect(self["skipped"]).toHaveLength(1);
    result(command("kvfx.op.layer.set", { target: "selection", parent: null }));
    expect(ae.raw("Child").parent).toBeNull();
  });
});

describe("layer.select", () => {
  it("selects every layer with a label", () => {
    const { ae, command } = harness([{ name: "A" }, { name: "B" }, { name: "C", selected: true }]);
    ae.raw("A").label = 5;
    ae.raw("B").label = 5;
    const out = result(command("kvfx.op.layer.select", { label: 5 }));
    expect(out["selectedCount"]).toBe(2);
    expect(ae.comp?.selectedLayers.map((l) => l.name)).toEqual(["A", "B"]);
  });

  it("adds to the selection in add mode", () => {
    const { ae, command } = harness([{ name: "A" }, { name: "B", selected: true }]);
    command("kvfx.op.layer.select", { ids: [ae.idOf("A")], mode: "add" });
    expect(ae.comp?.selectedLayers.map((l) => l.name)).toEqual(["A", "B"]);
  });
});

describe("layer.precomposeEach", () => {
  it("puts each layer in its own comp, in place", () => {
    const { ae, command } = harness([{ name: "A", selected: true }, { name: "Mid" }, { name: "B", selected: true }]);
    const out = result(command("kvfx.op.layer.precomposeEach", { target: "selection" }));
    expect(ae.stack()).toEqual(["A Comp", "Mid", "B Comp"]);
    expect((out["ids"] as number[]).length).toBe(2);
    expect((ae.comp!.stack[0]!.source as MockComp).stack.map((l) => l.name)).toEqual(["A"]);
  });
});

describe("layer.split", () => {
  it("runs After Effects' own Split Layer", () => {
    const { ae, command } = harness([{ name: "A", selected: true }]);
    ae.comp!.time = 4;
    const out = result(command("kvfx.op.layer.split"));
    expect(ae.app.executedCommands).toEqual(["Split Layer"]);
    expect(out["addedCount"]).toBe(1);
  });

  it("says so when the command cannot be found", () => {
    const { ae, command } = harness([{ name: "A", selected: true }]);
    ae.app.menuCommands = {};
    expect(command("kvfx.op.layer.split").error?.code).toBe("precondition_failed");
  });
});

describe("comp.deepDuplicate", () => {
  function nested() {
    const h = harness([{ name: "Other" }]);
    const project = h.ae.project!;
    const inner = project.addComp("Inner");
    inner.addLayer({ name: "Leaf" });
    const outer = project.addComp("Outer");
    const innerLayer = outer.addLayer({ name: "Inner", kind: "precomp", source: inner });
    innerLayer.transform("ADBE Opacity").expression = 'comp("Outer").layer(1).transform.opacity';
    innerLayer.transform("ADBE Rotate Z").expression = "comp(name).layer(1).rotation";
    const outerLayer = h.ae.comp!.addLayer({ name: "Outer", kind: "precomp", source: outer });
    outerLayer.selected = true;
    return { ...h, inner, outer };
  }

  it("copies the whole nest, leaving the original untouched", () => {
    const { ae, command, inner, outer } = nested();
    const out = result(command("kvfx.op.comp.deepDuplicate", { target: "selection" }));
    expect(out["compCount"]).toBe(2);

    const copyLayer = ae.comp!.stack[0]!;
    const outerCopy = copyLayer.source as MockComp;
    expect(outerCopy).not.toBe(outer);
    expect(outerCopy.name).toBe("Outer 2");
    const innerCopy = outerCopy.stack[0]!.source as MockComp;
    expect(innerCopy).not.toBe(inner);
    expect(innerCopy.name).toBe("Inner 2");
    expect(outer.stack[0]!.source).toBe(inner);
  });

  it("retargets literal comp() references and counts dynamic ones", () => {
    const { ae, command } = nested();
    const out = result(command("kvfx.op.comp.deepDuplicate", { target: "selection" }));
    const outerCopy = ae.comp!.stack[0]!.source as MockComp;
    expect(outerCopy.stack[0]!.transform("ADBE Opacity").expression).toBe(
      'comp("Outer 2").layer(1).transform.opacity',
    );
    expect(out["rewrittenExpressions"]).toBe(1);
    expect(out["dynamicExpressions"]).toBe(1);
  });

  it("skips layers that are not precomps", () => {
    const { command } = harness([{ name: "Plain", selected: true }]);
    const out = result(command("kvfx.op.comp.deepDuplicate", { target: "selection" }));
    expect(out["skipped"]).toHaveLength(1);
  });
});

describe("fx.list, fx.setEnabled, fx.remove", () => {
  function withEffects() {
    const h = harness([{ name: "A", selected: true }]);
    const fx = h.ae.raw("A").effects;
    fx.addProperty("ADBE Gaussian Blur 2");
    fx.addProperty("ADBE Fill");
    fx.addProperty("ADBE Tint");
    return h;
  }

  it("lists effects on the selected layers", () => {
    const { query } = withEffects();
    const out = result(query("kvfx.op.fx.list"));
    const layer = (out["layers"] as { effects: { matchName: string }[] }[])[0]!;
    expect(layer.effects.map((e) => e.matchName)).toEqual(["ADBE Gaussian Blur 2", "ADBE Fill", "ADBE Tint"]);
  });

  it("toggles effects", () => {
    const { ae, command } = withEffects();
    result(
      command("kvfx.op.fx.setEnabled", {
        effects: [{ id: ae.idOf("A"), index: 2, matchName: "ADBE Fill" }],
        enabled: false,
      }),
    );
    expect(ae.raw("A").effects.property(2)?.enabled).toBe(false);
  });

  it("removes several effects on one layer without index drift", () => {
    const { ae, command } = withEffects();
    const id = ae.idOf("A");
    result(
      command("kvfx.op.fx.remove", {
        effects: [
          { id, index: 1, matchName: "ADBE Gaussian Blur 2" },
          { id, index: 3, matchName: "ADBE Tint" },
        ],
      }),
    );
    const fx = ae.raw("A").effects;
    expect(fx.numProperties).toBe(1);
    expect(fx.property(1)?.matchName).toBe("ADBE Fill");
  });

  it("refuses when the stack changed since the scan", () => {
    const { ae, command } = withEffects();
    const reply = command("kvfx.op.fx.remove", {
      effects: [{ id: ae.idOf("A"), index: 1, matchName: "ADBE Fill" }],
    });
    expect(reply.error?.code).toBe("target_not_found");
    expect(ae.raw("A").effects.numProperties).toBe(3);
  });
});

describe("fonts", () => {
  it("lists used fonts and replaces one project-wide", () => {
    const { ae, query, command } = harness();
    ae.project!.usedFonts = [{ font: font("ArialMT", "Arial"), usedAt: [{}, {}] }];
    const used = result(query("kvfx.op.fonts.used"));
    expect(used["fonts"]).toEqual([{ postScriptName: "ArialMT", family: "Arial", style: "Regular", uses: 2 }]);

    result(command("kvfx.op.fonts.replace", { from: "ArialMT", to: "Inter-Bold" }));
    expect(ae.project!.fontReplacements).toEqual([{ from: "ArialMT", to: "Inter-Bold" }]);
  });

  it("searches installed fonts", () => {
    const { ae, query } = harness();
    ae.project!.usedFonts = [];
    const out = result(query("kvfx.op.fonts.search", { query: "inter" }));
    expect((out["fonts"] as { postScriptName: string }[]).map((f) => f.postScriptName)).toEqual(["Inter-Bold"]);
  });

  it("refuses a target font that is not installed", () => {
    const { ae, command } = harness();
    ae.project!.usedFonts = [{ font: font("ArialMT", "Arial"), usedAt: [] }];
    expect(command("kvfx.op.fonts.replace", { from: "ArialMT", to: "Nope-Regular" }).error?.code).toBe(
      "target_not_found",
    );
  });

  it("explains the version requirement on older hosts", () => {
    const { ae, query } = harness();
    (ae.project as unknown as { usedFonts: unknown }).usedFonts = undefined;
    expect(query("kvfx.op.fonts.used").error?.code).toBe("unsupported_host_version");
  });
});

describe("project.info, project.import, layer.applyPreset", () => {
  it("reports where a saved project lives", () => {
    const { ae, query } = harness();
    ae.project!.file = { exists: true, fsName: "/Users/me/Jobs/Promo/promo.aep", name: "promo.aep" };
    expect(result(query("kvfx.op.project.info"))).toEqual({ open: true, saved: true, folder: "/Users/me/Jobs/Promo" });
  });

  it("imports footage and places it in the comp", () => {
    const { ae, command } = harness();
    ae.app.existingFiles.add("/media/logo.png");
    const out = result(command("kvfx.op.project.import", { path: "/media/logo.png", addToComp: true }));
    expect(ae.project!.imported).toEqual(["/media/logo.png"]);
    expect(ae.comp?.stack[0]?.id).toBe(out["layerId"]);
  });

  it("imports projects without placing them", () => {
    const { ae, command } = harness();
    ae.app.existingFiles.add("/lib/rig.aep");
    const out = result(command("kvfx.op.project.import", { path: "/lib/rig.aep", addToComp: true }));
    expect(out["layerId"]).toBeNull();
  });

  it("refuses scripts and missing files", () => {
    const { ae, command } = harness();
    ae.app.existingFiles.add("/lib/evil.jsx");
    expect(command("kvfx.op.project.import", { path: "/lib/evil.jsx" }).error?.code).toBe("invalid_argument");
    expect(command("kvfx.op.project.import", { path: "/lib/gone.png" }).error?.code).toBe("target_not_found");
  });

  it("applies an .ffx preset to the selected layers", () => {
    const { ae, command } = harness([{ name: "A", selected: true }]);
    ae.app.existingFiles.add("/presets/pop.ffx");
    result(command("kvfx.op.layer.applyPreset", { target: "selection", path: "/presets/pop.ffx" }));
    expect(ae.raw("A").appliedPresets).toEqual(["/presets/pop.ffx"]);
  });
});

describe("selection snapshot", () => {
  it("reports kind, label and timing per layer", () => {
    const { ae, query } = harness([
      { name: "Title", kind: "text", selected: true },
      { name: "Ctrl", kind: "null", selected: true },
      { name: "Cam", kind: "camera", selected: true },
    ]);
    ae.raw("Title").label = 3;
    ae.raw("Title").startTime = 0.5;
    const out = result(query("kvfx.op.selection.snapshot"));
    const layers = out["layers"] as { name: string; kind: string; label: number; startTime: number }[];
    expect(layers.map((l) => l.kind)).toEqual(["text", "null", "camera"]);
    expect(layers[0]?.label).toBe(3);
    expect(layers[0]?.startTime).toBe(0.5);
  });

  it("includes the first transformable layer's values for the inspector", () => {
    const { ae, query } = harness([
      { name: "Cam", kind: "camera", selected: true },
      { name: "A", selected: true, geometry: { position: { x: 10, y: 20 } } },
    ]);
    ae.raw("A").transform("ADBE Opacity").setValueAtTime(0, 50);
    const primary = result(query("kvfx.op.selection.snapshot"))["primary"] as Record<string, unknown>;
    expect(primary["id"]).toBe(ae.idOf("A"));
    expect(primary["position"]).toEqual({ value: [10, 20, 0], animated: false, expression: false });
    expect((primary["opacity"] as { animated: boolean }).animated).toBe(true);
  });

  it("reports the work area for trimming", () => {
    const { ae, query } = harness([]);
    ae.comp!.workAreaStart = 1;
    ae.comp!.workAreaDuration = 3;
    const comp = result(query("kvfx.op.selection.snapshot"))["comp"] as Record<string, number>;
    expect(comp["workAreaStart"]).toBe(1);
    expect(comp["workAreaDuration"]).toBe(3);
    expect(comp["frameDuration"]).toBeCloseTo(0.04);
  });
});

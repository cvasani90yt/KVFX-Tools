import { describe, expect, it } from "vitest";
import { createDispatcher } from "../src/runtime/dispatcher.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { createProductionRegistry } from "../src/ops/index.js";
import type { HostJson } from "../src/runtime/serialize.js";
import { createMockAe, type MockLayerSpec } from "./mock-ae.js";
import { INTERP, type MockProp } from "./mock-dom.js";

interface Reply {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

function harness(layers: readonly MockLayerSpec[] = []) {
  const ae = createMockAe({ comp: { layers } });
  const dispatch = createDispatcher(createProductionRegistry(), ae);
  let n = 0;
  const send = (kind: string, op: string, args: Record<string, HostJson>): Reply =>
    JSON.parse(
      dispatch({
        v: PROTOCOL_VERSION,
        id: `r${String((n += 1))}`,
        kind,
        op,
        args,
        budgetMs: 1000,
        ...(kind === "op" ? { undoGroup: "KVFX Tools — Test" } : {}),
      }),
    ) as Reply;
  return {
    ae,
    query: (op: string, args: Record<string, HostJson> = {}) => send("query", op, args),
    command: (op: string, args: Record<string, HostJson> = {}) => send("op", op, args),
  };
}

const ok = (reply: Reply): Record<string, unknown> => {
  if (!reply.ok) throw new Error(`Expected success, got ${reply.error?.code}: ${reply.error?.message}`);
  return reply.result as Record<string, unknown>;
};

/** An opacity property animated 0 → 100 over two seconds, both keys selected. */
function animatedOpacity(from = 0, to = 100): { h: ReturnType<typeof harness>; prop: MockProp } {
  const h = harness([{ name: "A" }]);
  const prop = h.ae.raw("A").transform("ADBE Opacity");
  prop.setValueAtTime(0, from);
  prop.setValueAtTime(2, to);
  prop.selectKeys(1, 2);
  prop.selected = true;
  return { h, prop };
}

describe("keys.ease — bezier to temporal ease", () => {
  it("maps an ease-out-quart style curve onto speed and influence", () => {
    const { h, prop } = animatedOpacity();
    ok(h.command("kvfx.op.keys.ease", { bezier: [0.25, 1, 0.5, 1] }));

    // Average speed is 50 %/s. Out: influence 25 %, speed (1 / 0.25)·50 = 200.
    const out = prop.keyOutTemporalEase(1)[0]!;
    expect(out.influence).toBeCloseTo(25);
    expect(out.speed).toBeCloseTo(200);
    // In: influence (1 − 0.5)·100 = 50 %, speed ((1 − 1) / 0.5)·50 = 0.
    const into = prop.keyInTemporalEase(2)[0]!;
    expect(into.influence).toBeCloseTo(50);
    expect(into.speed).toBeCloseTo(0);
    expect(prop.keyOutInterpolationType(1)).toBe(INTERP.bezier);
  });

  it("keeps the sign of a falling value", () => {
    const { h, prop } = animatedOpacity(100, 0);
    ok(h.command("kvfx.op.keys.ease", { bezier: [0.5, 0.25, 0.5, 1] }));
    expect(prop.keyOutTemporalEase(1)[0]!.speed).toBeCloseTo(-25);
  });

  it("clamps influence into After Effects' 0.1–100 range", () => {
    const { h, prop } = animatedOpacity();
    ok(h.command("kvfx.op.keys.ease", { bezier: [0, 0, 1, 1] }));
    expect(prop.keyOutTemporalEase(1)[0]!.influence).toBeCloseTo(0.1);
    expect(prop.keyInTemporalEase(2)[0]!.influence).toBeCloseTo(0.1);
  });

  it("writes one ease per dimension for scale", () => {
    const h = harness([{ name: "A" }]);
    const scale = h.ae.raw("A").transform("ADBE Scale");
    scale.setValueAtTime(0, [0, 0, 100]);
    scale.setValueAtTime(1, [100, 50, 100]);
    scale.selectKeys(1, 2);
    scale.selected = true;
    ok(h.command("kvfx.op.keys.ease", { bezier: [0.5, 1, 0.5, 1] }));
    expect(scale.keyOutTemporalEase(1).map((e) => Math.round(e.speed))).toEqual([200, 100, 0]);
  });

  it("uses one non-negative path speed for position", () => {
    const h = harness([{ name: "A" }]);
    const position = h.ae.raw("A").transform("ADBE Position");
    position.setValueAtTime(0, [0, 0, 0]);
    position.setValueAtTime(1, [30, 40, 0]);
    position.selectKeys(1, 2);
    position.selected = true;
    // An anticipation curve: y1 < 0 would mean a negative path speed.
    ok(h.command("kvfx.op.keys.ease", { bezier: [0.5, -0.5, 0.5, 1] }));
    const out = position.keyOutTemporalEase(1);
    expect(out).toHaveLength(1);
    expect(out[0]!.speed).toBe(0);
    const into = position.keyInTemporalEase(2);
    expect(into[0]!.speed).toBe(0);
  });

  it("eases both sides of a lone selected middle key", () => {
    const h = harness([{ name: "A" }]);
    const prop = h.ae.raw("A").transform("ADBE Rotate Z");
    prop.setValueAtTime(0, 0);
    prop.setValueAtTime(1, 90);
    prop.setValueAtTime(2, 180);
    prop.selectKeys(2);
    prop.selected = true;
    ok(h.command("kvfx.op.keys.ease", { bezier: [0.4, 0, 0.6, 1] }));
    expect(prop.keyInTemporalEase(2)[0]!.influence).toBeCloseTo(40);
    expect(prop.keyOutTemporalEase(2)[0]!.influence).toBeCloseTo(40);
    expect(prop.keyOutTemporalEase(1)[0]!.influence).toBeCloseTo(16.67, 1);
  });

  it("needs selected keyframes", () => {
    const h = harness([{ name: "A" }]);
    expect(h.command("kvfx.op.keys.ease", { bezier: [0.4, 0, 0.6, 1] }).error?.code).toBe("precondition_failed");
  });

  it("rejects x values outside 0–1", () => {
    const { h } = animatedOpacity();
    expect(h.command("kvfx.op.keys.ease", { bezier: [1.2, 0, 0.6, 1] }).error?.code).toBe("invalid_argument");
  });
});

describe("keys.readEase", () => {
  it("round-trips what keys.ease wrote", () => {
    const { h } = animatedOpacity();
    ok(h.command("kvfx.op.keys.ease", { bezier: [0.3, 0.1, 0.2, 0.9] }));
    const read = ok(h.query("kvfx.op.keys.readEase"));
    const [x1, y1, x2, y2] = read["bezier"] as number[];
    expect(x1).toBeCloseTo(0.3);
    expect(y1).toBeCloseTo(0.1);
    expect(x2).toBeCloseTo(0.2);
    expect(y2).toBeCloseTo(0.9);
  });

  it("reports linear keys as linear", () => {
    const { h } = animatedOpacity();
    const read = ok(h.query("kvfx.op.keys.readEase"));
    expect(read["linear"]).toBe(true);
  });
});

describe("keys.interpolation", () => {
  it("sets hold on the selected keys", () => {
    const { h, prop } = animatedOpacity();
    ok(h.command("kvfx.op.keys.interpolation", { type: "hold" }));
    expect(prop.keyInInterpolationType(1)).toBe(INTERP.hold);
    expect(prop.keyOutInterpolationType(2)).toBe(INTERP.hold);
  });
});

describe("keys.reverse", () => {
  it("mirrors keys in time, swapping in and out sides", () => {
    const h = harness([{ name: "A" }]);
    const prop = h.ae.raw("A").transform("ADBE Opacity");
    prop.setValueAtTime(1, 0);
    prop.setValueAtTime(2, 30);
    prop.setValueAtTime(4, 100);
    prop.setTemporalEaseAtKey(1, [{ speed: 0, influence: 10 }], [{ speed: 0, influence: 80 }]);
    prop.selectKeys(1, 2, 3);
    prop.selected = true;

    ok(h.command("kvfx.op.keys.reverse"));
    expect([1, 2, 3].map((k) => prop.keyTime(k))).toEqual([1, 3, 4]);
    expect([1, 2, 3].map((k) => prop.keyValue(k))).toEqual([100, 30, 0]);
    // The old first key is now last, with its ease sides swapped.
    expect(prop.keyInTemporalEase(3)[0]!.influence).toBe(80);
    expect(prop.keyOutTemporalEase(3)[0]!.influence).toBe(10);
    expect(prop.selectedKeys).toEqual([1, 2, 3]);
  });

  it("needs two keys on a property", () => {
    const h = harness([{ name: "A" }]);
    const prop = h.ae.raw("A").transform("ADBE Opacity");
    prop.setValueAtTime(1, 0);
    prop.selectKeys(1);
    prop.selected = true;
    expect(h.command("kvfx.op.keys.reverse").error?.code).toBe("precondition_failed");
  });
});

describe("prop.keyframes", () => {
  it("writes keys relative to the playhead and eases them", () => {
    const h = harness([{ name: "A", selected: true }]);
    h.ae.comp!.time = 3;
    ok(
      h.command("kvfx.op.prop.keyframes", {
        target: "selection",
        path: ["ADBE Transform Group", "ADBE Opacity"],
        keys: [
          { time: 0, value: 0 },
          { time: 1, value: 100 },
        ],
        relative: true,
        bezier: [0.5, 0, 0.5, 1],
      }),
    );
    const prop = h.ae.raw("A").transform("ADBE Opacity");
    expect([prop.keyTime(1), prop.keyTime(2)]).toEqual([3, 4]);
    expect(prop.keyOutTemporalEase(1)[0]!.influence).toBeCloseTo(50);
  });
});

describe("prop.expressionOnSelected", () => {
  it("applies to selected animated properties and skips static ones", () => {
    const h = harness([{ name: "A" }]);
    const opacity = h.ae.raw("A").transform("ADBE Opacity");
    opacity.setValueAtTime(0, 0);
    opacity.setValueAtTime(1, 100);
    opacity.selected = true;
    const rotation = h.ae.raw("A").transform("ADBE Rotate Z");
    rotation.selected = true;

    const out = ok(
      h.command("kvfx.op.prop.expressionOnSelected", { expression: "// bounce", requireKeys: true }),
    );
    expect(out["changedCount"]).toBe(1);
    expect(opacity.expression).toBe("// bounce");
    expect(rotation.expression).toBe("");
  });

  it("needs a property selection", () => {
    const h = harness([{ name: "A" }]);
    expect(h.command("kvfx.op.prop.expressionOnSelected", { expression: "x" }).error?.code).toBe(
      "precondition_failed",
    );
  });
});

describe("text.addAnimator", () => {
  it("builds an animator with properties and a keyed selector", () => {
    const h = harness([{ name: "Title", kind: "text", selected: true }]);
    ok(
      h.command("kvfx.op.text.addAnimator", {
        target: "selection",
        animator: {
          name: "Fade Up",
          properties: [
            { matchName: "ADBE Text Opacity", value: 0 },
            { matchName: "ADBE Text Position 3D", value: [0, 40, 0] },
          ],
          selectors: [{ units: "percent", keys: { offset: [{ time: 0, value: -100 }, { time: 1, value: 100 }] } }],
        },
      }),
    );
    const animator = h.ae
      .raw("Title")
      .property("ADBE Text Properties")!
      .property("ADBE Text Animators")!
      .property(1)!;
    expect(animator.name).toBe("Fade Up");
    expect(animator.property("ADBE Text Animator Properties")!.property("ADBE Text Opacity")!.value).toBe(0);
    const offset = animator.property("ADBE Text Selectors")!.property(1)!.property("ADBE Text Percent Offset")!;
    expect(offset.numKeys).toBe(2);
  });

  it("skips layers that are not text", () => {
    const h = harness([{ name: "Solid", selected: true }]);
    const out = ok(h.command("kvfx.op.text.addAnimator", { target: "selection", animator: { name: "X" } }));
    expect(out["skipped"]).toHaveLength(1);
  });
});

describe("text.explode", () => {
  it("makes one live-text layer per range and hides the original", () => {
    const h = harness([{ name: "Hi you", kind: "text", text: "Hi you", selected: true }]);
    const id = h.ae.idOf("Hi you");
    const out = ok(
      h.command("kvfx.op.text.explode", {
        id,
        ranges: [
          { start: 0, end: 2, name: "Hi" },
          { start: 3, end: 6, name: "you" },
        ],
      }),
    );
    expect(out["ids"]).toHaveLength(2);
    expect(h.ae.stack()).toEqual(["Hi", "you", "Hi you"]);
    expect(h.ae.raw("Hi you").enabled).toBe(false);

    const selectors = h.ae
      .raw("you")
      .property("ADBE Text Properties")!
      .property("ADBE Text Animators")!
      .property(1)!
      .property("ADBE Text Selectors")!;
    const carve = selectors.property(2)!;
    const advanced = carve.property("ADBE Text Range Advanced")!;
    expect(advanced.property("ADBE Text Range Units")!.value).toBe(2);
    expect(advanced.property("ADBE Text Selector Mode")!.value).toBe(2);
    expect(carve.property("ADBE Text Index Start")!.value).toBe(3);
    expect(carve.property("ADBE Text Index End")!.value).toBe(6);
  });

  it("refuses a non-text layer", () => {
    const h = harness([{ name: "Solid" }]);
    const reply = h.command("kvfx.op.text.explode", { id: h.ae.idOf("Solid"), ranges: [{ start: 0, end: 1 }] });
    expect(reply.error?.code).toBe("precondition_failed");
  });
});

describe("text.setStyle and text.read", () => {
  it("restyles the source text document", () => {
    const h = harness([{ name: "T", kind: "text", text: "Hello", selected: true }]);
    ok(
      h.command("kvfx.op.text.setStyle", {
        target: "selection",
        font: "Inter-Bold",
        fontSize: 120,
        fillColor: [1, 0.5, 0],
        tracking: 50,
      }),
    );
    const doc = h.ae.raw("T").property("ADBE Text Properties")!.property("ADBE Text Document")!.value as Record<
      string,
      unknown
    >;
    expect(doc).toMatchObject({ font: "Inter-Bold", fontSize: 120, fillColor: [1, 0.5, 0], tracking: 50 });
  });

  it("reads the selected text layer's string", () => {
    const h = harness([{ name: "T", kind: "text", text: "Hello", selected: true }]);
    expect(ok(h.query("kvfx.op.text.read"))["text"]).toBe("Hello");
  });
});

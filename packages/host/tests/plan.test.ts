import { describe, expect, it } from "vitest";
import { PLAN_OPERATION_ID, createDispatcher } from "../src/runtime/dispatcher.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { createProductionRegistry } from "../src/ops/index.js";
import { createMockAe, type MockAe, type MockLayerSpec } from "./mock-ae.js";

interface Reply {
  ok: boolean;
  result?: { stepCount: number; steps: { op: string; result: unknown }[] };
  error?: { code: string; message: string };
}

function harness(layers: readonly MockLayerSpec[]): {
  ae: MockAe;
  /** Pass `null` for "send no undo group at all". */
  plan: (steps: unknown[], undoGroup?: string | null) => Reply;
} {
  const ae = createMockAe({ comp: { layers } });
  const raw = createDispatcher(createProductionRegistry(), ae);

  return {
    ae,
    plan: (steps, undoGroup = "KVFX Tools — Test") => {
      const request: Record<string, unknown> = {
        v: PROTOCOL_VERSION,
        id: "r1",
        kind: "plan",
        op: PLAN_OPERATION_ID,
        args: { steps },
        budgetMs: 250,
      };
      // `undefined` would hit the default parameter, so `null` is the signal to
      // omit the field entirely — which is the case under test.
      if (undoGroup !== null) request["undoGroup"] = undoGroup;
      return JSON.parse(raw(request)) as Reply;
    },
  };
}

describe("plan execution", () => {
  it("runs every step inside a single undo group", () => {
    const { ae, plan } = harness([{ name: "A", selected: true }, { name: "B" }]);
    const reply = plan([
      { op: "kvfx.op.layer.setFlag", args: { target: "selection", flag: "solo", value: true } },
      { op: "kvfx.op.layer.reorder", args: { target: "selection", to: "bottom" } },
    ]);

    expect(reply.ok).toBe(true);
    expect(reply.result?.stepCount).toBe(2);
    // One begin, one end — not one group per step.
    expect(ae.undoEvents).toEqual(["begin:KVFX Tools — Test", "end"]);
    expect(ae.stack()).toEqual(["B", "A"]);
  });

  it("returns each step's result in order", () => {
    const { plan } = harness([{ name: "A", selected: true }]);
    const reply = plan([
      { op: "kvfx.op.layer.create", args: { kind: "null" } },
      { op: "kvfx.op.layer.setFlag", args: { target: "selection", flag: "shy", value: true } },
    ]);

    expect(reply.result?.steps.map((s) => s.op)).toEqual([
      "kvfx.op.layer.create",
      "kvfx.op.layer.setFlag",
    ]);
  });

  it("closes the undo group when a step fails, so one undo reverts the partial work", () => {
    const { ae, plan } = harness([{ name: "A", selected: true }]);
    const reply = plan([
      { op: "kvfx.op.layer.setFlag", args: { target: "selection", flag: "solo", value: true } },
      { op: "kvfx.op.layer.create", args: { kind: "hologram" } },
    ]);

    expect(reply.ok).toBe(false);
    expect(reply.error?.code).toBe("invalid_argument");
    // The first step did apply — and that is safe precisely because the group
    // was opened and closed, so Ctrl+Z reverts the whole attempt at once.
    expect(ae.layerByName("A")?.flags["solo"]).toBe(true);
    expect(ae.openGroups()).toBe(0);
    expect(ae.undoEvents).toEqual(["begin:KVFX Tools — Test", "end"]);
  });

  it("preserves an operation's own error code instead of collapsing it", () => {
    const { plan } = harness([]);
    const reply = plan([{ op: "kvfx.op.layer.create", args: { kind: "hologram" } }]);
    expect(reply.error?.code).toBe("invalid_argument");
  });

  it("reports a missing composition as a precondition, not a crash", () => {
    const ae = createMockAe({});
    const raw = createDispatcher(createProductionRegistry(), ae);
    const reply = JSON.parse(
      raw({
        v: PROTOCOL_VERSION,
        id: "r1",
        kind: "plan",
        op: PLAN_OPERATION_ID,
        args: { steps: [{ op: "kvfx.op.layer.create", args: { kind: "null" } }] },
        budgetMs: 250,
        undoGroup: "KVFX Tools — Test",
      }),
    ) as Reply;

    expect(reply.error?.code).toBe("precondition_failed");
  });

  it("rejects an unknown step operation", () => {
    const { plan } = harness([]);
    const reply = plan([{ op: "kvfx.op.layer.teleport", args: {} }]);
    expect(reply.error?.code).toBe("unknown_operation");
  });

  it("rejects an empty plan", () => {
    const { plan } = harness([]);
    expect(plan([]).error?.code).toBe("invalid_request");
  });

  it("rejects a malformed step", () => {
    const { plan } = harness([]);
    expect(plan(["kvfx.op.layer.create"]).error?.code).toBe("invalid_request");
    expect(plan([{ args: {} }]).error?.code).toBe("invalid_request");
    expect(plan([{ op: "kvfx.op.layer.create" }]).error?.code).toBe("invalid_request");
  });

  it("refuses a plan with no undo group", () => {
    const { ae, plan } = harness([{ name: "A", selected: true }]);
    const reply = plan([{ op: "kvfx.op.layer.create", args: { kind: "null" } }], null);

    expect(reply.error?.code).toBe("invalid_request");
    expect(ae.undoEvents).toEqual([]);
  });

  it("refuses a plan request that does not use the plan operation id", () => {
    const ae = createMockAe({ comp: { layers: [] } });
    const raw = createDispatcher(createProductionRegistry(), ae);
    const reply = JSON.parse(
      raw({
        v: PROTOCOL_VERSION,
        id: "r1",
        kind: "plan",
        op: "kvfx.op.layer.create",
        args: { steps: [] },
        budgetMs: 250,
        undoGroup: "KVFX Tools — Test",
      }),
    ) as Reply;

    expect(reply.error?.code).toBe("invalid_request");
  });

  it("stops partway when the budget runs out", () => {
    // Each nowMs() call advances 200 ms, so a 250 ms budget cannot survive a
    // multi-step plan — and the abort must be reported, not swallowed.
    const ae = createMockAe({ comp: { layers: [{ name: "A", selected: true }] }, tickMs: 200 });
    const raw = createDispatcher(createProductionRegistry(), ae);
    const reply = JSON.parse(
      raw({
        v: PROTOCOL_VERSION,
        id: "r1",
        kind: "plan",
        op: PLAN_OPERATION_ID,
        args: {
          steps: [
            { op: "kvfx.op.layer.create", args: { kind: "null" } },
            { op: "kvfx.op.layer.create", args: { kind: "null" } },
            { op: "kvfx.op.layer.create", args: { kind: "null" } },
          ],
        },
        budgetMs: 250,
        undoGroup: "KVFX Tools — Test",
      }),
    ) as Reply;

    expect(reply.ok).toBe(false);
    expect(reply.error?.code).toBe("budget_exceeded");
    expect(ae.openGroups()).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { createDispatcher } from "../src/runtime/dispatcher.js";
import { createRegistry, type Operation } from "../src/runtime/registry.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { createMockAe, type MockAe } from "./mock-ae.js";

interface Reply {
  v: number;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
  elapsedMs: number;
}

const readOnlyOp: Operation = {
  id: "kvfx.op.test.read",
  mutates: false,
  run: () => ({ read: true }),
};

const mutatingOp: Operation = {
  id: "kvfx.op.test.write",
  mutates: true,
  run: () => ({ written: true }),
};

const throwingOp: Operation = {
  id: "kvfx.op.test.explode",
  mutates: true,
  run: () => {
    throw new Error("effect not found");
  },
};

const modernOp: Operation = {
  id: "kvfx.op.test.modern",
  mutates: false,
  aeMin: "25.0",
  run: () => null,
};

function setup(ae?: MockAe): { dispatch: (r: unknown) => Reply; ae: MockAe } {
  const env = ae ?? createMockAe();
  const raw = createDispatcher(
    createRegistry([readOnlyOp, mutatingOp, throwingOp, modernOp]),
    env,
  );
  return { ae: env, dispatch: (r: unknown) => JSON.parse(raw(r)) as Reply };
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: PROTOCOL_VERSION,
    id: "r1",
    kind: "query",
    op: "kvfx.op.test.read",
    args: {},
    budgetMs: 250,
    ...overrides,
  };
}

describe("dispatch — happy path", () => {
  it("runs a read-only operation and returns its result", () => {
    const { dispatch } = setup();
    const reply = dispatch(request());

    expect(reply.ok).toBe(true);
    expect(reply.result).toEqual({ read: true });
    expect(reply.id).toBe("r1");
    expect(reply.v).toBe(PROTOCOL_VERSION);
  });

  it("wraps a mutating operation in exactly one undo group", () => {
    const { dispatch, ae } = setup();
    const reply = dispatch(
      request({ kind: "op", op: "kvfx.op.test.write", undoGroup: "KVFX Tools — Test" }),
    );

    expect(reply.ok).toBe(true);
    expect(ae.undoEvents).toEqual(["begin:KVFX Tools — Test", "end"]);
    expect(ae.openGroups()).toBe(0);
  });
});

describe("dispatch — never throws, always replies", () => {
  it("closes the undo group when the operation throws", () => {
    const { dispatch, ae } = setup();
    const reply = dispatch(
      request({ kind: "op", op: "kvfx.op.test.explode", undoGroup: "KVFX Tools — Boom" }),
    );

    expect(reply.ok).toBe(false);
    expect(reply.error?.code).toBe("host_exception");
    expect(reply.error?.message).toContain("effect not found");
    // The critical assertion: a thrown operation must not leave After Effects
    // with an open undo group, which would corrupt the stack for the session.
    expect(ae.openGroups()).toBe(0);
    expect(ae.undoEvents).toEqual(["begin:KVFX Tools — Boom", "end"]);
  });

  it("replies rather than throwing for a null request", () => {
    const { dispatch } = setup();
    expect(dispatch(null).ok).toBe(false);
  });

  it("replies rather than throwing for a garbage request", () => {
    const { dispatch } = setup();
    const reply = dispatch({ nonsense: true });
    expect(reply.ok).toBe(false);
    expect(reply.error?.code).toBe("protocol_mismatch");
  });
});

describe("dispatch — validation", () => {
  it("rejects a protocol version mismatch with an actionable message", () => {
    const { dispatch } = setup();
    const reply = dispatch(request({ v: PROTOCOL_VERSION + 1 }));
    expect(reply.error?.code).toBe("protocol_mismatch");
    expect(reply.error?.message).toContain("Reinstall");
  });

  it("rejects an unknown operation", () => {
    const { dispatch } = setup();
    expect(dispatch(request({ op: "kvfx.op.test.nope" })).error?.code).toBe("unknown_operation");
  });

  it("rejects an unknown request kind", () => {
    const { dispatch } = setup();
    expect(dispatch(request({ kind: "sideways" })).error?.code).toBe("invalid_request");
  });

  it("rejects a missing or unusable budget", () => {
    const { dispatch } = setup();
    for (const budgetMs of [undefined, 0, -5, "soon"]) {
      expect(dispatch(request({ budgetMs })).error?.code).toBe("invalid_request");
    }
  });

  it("rejects args that are not an object", () => {
    const { dispatch } = setup();
    for (const args of [null, [], "x", 3]) {
      expect(dispatch(request({ args })).error?.code).toBe("invalid_request");
    }
  });

  it("refuses to mutate without an undo group", () => {
    const { dispatch, ae } = setup();
    const reply = dispatch(request({ kind: "op", op: "kvfx.op.test.write" }));

    expect(reply.error?.code).toBe("invalid_request");
    expect(reply.error?.message).toContain("requires an undo group");
    expect(ae.undoEvents).toEqual([]);
  });

  it("refuses to open an undo group for a read-only operation", () => {
    const { dispatch, ae } = setup();
    const reply = dispatch(request({ undoGroup: "KVFX Tools — Read" }));

    expect(reply.error?.code).toBe("invalid_request");
    expect(reply.error?.message).toContain("read-only");
    expect(ae.undoEvents).toEqual([]);
  });
});

describe("dispatch — host version gating", () => {
  it("declines to run at all below the product minimum", () => {
    const ae = createMockAe({ version: "21.0" });
    const { dispatch } = setup(ae);
    const reply = dispatch(request());

    expect(reply.error?.code).toBe("unsupported_host_version");
    expect(reply.error?.message).toContain("22.0");
  });

  it("declines an operation whose own minimum is not met", () => {
    const ae = createMockAe({ version: "24.0" });
    const { dispatch } = setup(ae);
    const reply = dispatch(request({ op: "kvfx.op.test.modern" }));

    expect(reply.error?.code).toBe("unsupported_host_version");
    expect(reply.error?.message).toContain("25.0");
  });

  it("runs the operation when the host is new enough", () => {
    const ae = createMockAe({ version: "26.0.1x45" });
    const { dispatch } = setup(ae);
    expect(dispatch(request({ op: "kvfx.op.test.modern" })).ok).toBe(true);
  });
});

describe("dispatch — budget", () => {
  it("reports an overrun instead of hiding it", () => {
    // Each nowMs() call advances 400 ms, so the operation blows a 250 ms budget.
    const ae = createMockAe({ tickMs: 400 });
    const { dispatch } = setup(ae);
    const reply = dispatch(request({ budgetMs: 250 }));

    expect(reply.ok).toBe(false);
    expect(reply.error?.code).toBe("budget_exceeded");
    expect(reply.elapsedMs).toBeGreaterThan(250);
  });
});

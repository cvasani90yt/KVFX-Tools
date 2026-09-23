import { describe, expect, it } from "vitest";
import { pingOperation } from "../src/ops/system.js";
import { createProductionRegistry } from "../src/ops/index.js";
import { createMockAe } from "./mock-ae.js";

describe("kvfx.op.system.ping", () => {
  it("reports host identity without touching the project", () => {
    const env = createMockAe({ version: "26.0.1x45" });
    const result = pingOperation.run({ env, args: {}, deadlineMs: Number.MAX_SAFE_INTEGER }) as Record<
      string,
      unknown
    >;

    expect(result["aeVersion"]).toBe("26.0.1x45");
    expect(result["aeBuild"]).toBe("Adobe After Effects 26.0.1x45");
    expect(result["os"]).toBe("Mock OS 1.0");
    expect(typeof result["hostTimeMs"]).toBe("number");
    // No undo group may be opened by a read-only operation.
    expect(env.undoEvents).toEqual([]);
  });

  it("is registered as read-only", () => {
    expect(pingOperation.mutates).toBe(false);
  });
});

describe("production registry", () => {
  it("registers ping", () => {
    expect(createProductionRegistry().ids()).toContain("kvfx.op.system.ping");
  });

  it("rejects duplicate operation ids at construction", () => {
    const registry = createProductionRegistry();
    expect(() => registry.register(pingOperation)).toThrow(/Duplicate operation id/);
  });
});

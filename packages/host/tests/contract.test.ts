import { describe, expect, it } from "vitest";
import { ErrorCode as CoreErrorCode, MIN_AE_VERSION as CoreMinAe, satisfiesMinimum as coreSatisfies } from "@kvfx/core";
import {
  PLAN_OPERATION_ID as BridgePlanOperationId,
  PROTOCOL_VERSION as BridgeProtocolVersion,
  buildRequest,
} from "@kvfx/bridge";
import {
  ACTIVE_COMP_DEFAULTS,
  EMPTY_SNAPSHOT,
  SELECTED_LAYER_DEFAULTS,
  type Command,
  type CommandContext,
  type PlanStep,
  createProductionCommandRegistry,
  defaultSettings,
} from "@kvfx/core";
import { createProductionRegistry } from "../src/ops/index.js";
import { ErrorCode as HostErrorCode, MIN_AE_VERSION as HostMinAe, PROTOCOL_VERSION as HostProtocolVersion } from "../src/runtime/protocol.js";
import { PLAN_OPERATION_ID as HostPlanOperationId } from "../src/runtime/dispatcher.js";
import { satisfiesMinimum as hostSatisfies } from "../src/runtime/version.js";

/**
 * `@kvfx/host` compiles to ES5 for ExtendScript and therefore cannot import the
 * shared packages at runtime (see `src/runtime/protocol.ts`). These tests are
 * what keep that duplication honest: if the copies drift, the build fails here
 * rather than in a user's project.
 */
const contractContext: CommandContext = {
  aeVersion: "26.0.1x45",
  snapshot: {
    ...EMPTY_SNAPSHOT,
    hasProject: true,
    comp: { ...ACTIVE_COMP_DEFAULTS, layerCount: 1 },
    layers: [{ ...SELECTED_LAYER_DEFAULTS, id: 10, name: "Layer 1" }],
  },
};

describe("host ↔ shared contract", () => {
  it("agrees with the bridge on the protocol version", () => {
    expect(HostProtocolVersion).toBe(BridgeProtocolVersion);
  });

  it("agrees with the bridge on the plan operation id", () => {
    expect(HostPlanOperationId).toBe(BridgePlanOperationId);
  });

  it("agrees with core on the minimum After Effects version", () => {
    expect(HostMinAe).toBe(CoreMinAe);
  });

  it("defines exactly the same error codes as core", () => {
    expect(Object.keys(HostErrorCode).sort()).toEqual(Object.keys(CoreErrorCode).sort());
    for (const key of Object.keys(CoreErrorCode)) {
      expect(HostErrorCode[key as keyof typeof HostErrorCode]).toBe(
        CoreErrorCode[key as keyof typeof CoreErrorCode],
      );
    }
  });

  it("compares versions identically to core across the cases that matter", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["26.0.1x45", "22.0"],
      ["22.0", "22.0"],
      ["21.9.9", "22.0"],
      ["26.10", "26.9"],
      ["26", "26.0.0"],
      ["  24.5  ", "24.5"],
      ["unknown", "22.0"],
      ["26.0", "unknown"],
      ["", "22.0"],
    ];

    for (const [actual, required] of cases) {
      expect(hostSatisfies(actual, required), `${actual} vs ${required}`).toBe(
        coreSatisfies(actual, required),
      );
    }
  });
});

/**
 * The operations a command can emit without After Effects: a simple command's
 * plan, or a measured command's probe. Measured plans need a real
 * measurement, so `commands-e2e.test.ts` covers them against the mock DOM.
 */
function staticSteps(command: Command): { probe: PlanStep | undefined; steps: readonly PlanStep[] } {
  if (command.kind === "measured") return { probe: command.probe(contractContext), steps: [] };
  const ctx = { ...contractContext, params: command.defaultParams?.({ ...defaultSettings().ui }) ?? {} };
  return { probe: undefined, steps: command.plan(ctx).steps };
}

describe("commands ↔ operations contract", () => {
  it("every operation a command emits or probes with is registered on the host", () => {
    // Catches a command referring to an operation that was renamed, never
    // written, or left out of the production registry — a failure that would
    // otherwise surface as "unknown_operation" in front of a user.
    const known = new Set(createProductionRegistry().ids());
    for (const command of createProductionCommandRegistry().all()) {
      const { probe, steps } = staticSteps(command);
      if (probe) expect(known, `${command.id} probe → ${probe.op}`).toContain(probe.op);
      for (const step of steps) expect(known, `${command.id} → ${step.op}`).toContain(step.op);
    }
  });

  it("every operation id is accepted by the bridge", () => {
    for (const command of createProductionCommandRegistry().all()) {
      const { probe, steps } = staticSteps(command);
      for (const step of probe ? [probe, ...steps] : steps) {
        expect(() => buildRequest({ id: "t", kind: "op", op: step.op, undoGroup: "KVFX Tools — Test" })).not.toThrow();
      }
    }
  });

  it("probes are read-only and plan steps mutate", () => {
    // The dispatcher refuses an undo group around a read-only operation and
    // refuses to run a mutating one without; getting this wrong fails at click time.
    const registry = createProductionRegistry();
    for (const command of createProductionCommandRegistry().all()) {
      const { probe, steps } = staticSteps(command);
      if (probe) expect(registry.lookup(probe.op)?.mutates, `${command.id} probe`).toBe(false);
      for (const step of steps) expect(registry.lookup(step.op)?.mutates, `${command.id} → ${step.op}`).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { ErrorCode as CoreErrorCode, MIN_AE_VERSION as CoreMinAe, satisfiesMinimum as coreSatisfies } from "@kvfx/core";
import {
  PLAN_OPERATION_ID as BridgePlanOperationId,
  PROTOCOL_VERSION as BridgeProtocolVersion,
  buildRequest,
} from "@kvfx/bridge";
import {
  EMPTY_SNAPSHOT,
  type CommandContext,
  createProductionCommandRegistry,
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
    comp: {
      id: 1,
      name: "Comp 1",
      width: 1920,
      height: 1080,
      frameRate: 25,
      duration: 10,
      time: 0,
      layerCount: 1,
    },
    layers: [
      {
        id: 10,
        name: "Layer 1",
        index: 1,
        enabled: true,
        locked: false,
        shy: false,
        isAV: true,
        solo: false,
        threeD: false,
        guide: false,
        adjustment: false,
      },
    ],
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

describe("commands ↔ operations contract", () => {
  it("every operation a command emits is registered on the host", () => {
    // This is the cross-check that catches a command referring to an operation
    // that was renamed, never written, or left out of the production registry —
    // a failure that would otherwise surface as "unknown_operation" in front of
    // a user.
    const registry = createProductionRegistry();
    const known = new Set(registry.ids());

    for (const command of createProductionCommandRegistry().all()) {
      for (const step of command.plan(contractContext).steps) {
        expect(known, `${command.id} → ${step.op}`).toContain(step.op);
      }
    }
  });

  it("every operation a command emits is accepted by the bridge", () => {
    // The bridge validates operation ids before anything is sent, so a command
    // emitting an id it rejects would fail at request-build time.
    for (const command of createProductionCommandRegistry().all()) {
      for (const step of command.plan(contractContext).steps) {
        expect(() =>
          buildRequest({ id: "t", kind: "op", op: step.op, undoGroup: "KVFX Tools — Test" }),
        ).not.toThrow();
      }
    }
  });

  it("marks host operations as mutating exactly when their command needs an undo group", () => {
    const registry = createProductionRegistry();
    for (const command of createProductionCommandRegistry().all()) {
      for (const step of command.plan(contractContext).steps) {
        const op = registry.lookup(step.op);
        // Every Phase 3 command changes the project, so each step it emits must
        // be declared mutating — otherwise the dispatcher would refuse the undo
        // group the command supplies.
        expect(op?.mutates, step.op).toBe(true);
      }
    }
  });
});

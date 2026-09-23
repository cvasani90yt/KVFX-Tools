import { describe, expect, it } from "vitest";
import { ErrorCode as CoreErrorCode, MIN_AE_VERSION as CoreMinAe, satisfiesMinimum as coreSatisfies } from "@kvfx/core";
import { PROTOCOL_VERSION as BridgeProtocolVersion } from "@kvfx/bridge";
import { ErrorCode as HostErrorCode, MIN_AE_VERSION as HostMinAe, PROTOCOL_VERSION as HostProtocolVersion } from "../src/runtime/protocol.js";
import { satisfiesMinimum as hostSatisfies } from "../src/runtime/version.js";

/**
 * `@kvfx/host` compiles to ES5 for ExtendScript and therefore cannot import the
 * shared packages at runtime (see `src/runtime/protocol.ts`). These tests are
 * what keep that duplication honest: if the copies drift, the build fails here
 * rather than in a user's project.
 */
describe("host ↔ shared contract", () => {
  it("agrees with the bridge on the protocol version", () => {
    expect(HostProtocolVersion).toBe(BridgeProtocolVersion);
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

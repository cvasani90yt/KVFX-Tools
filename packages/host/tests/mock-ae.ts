import type { AeEnvironment } from "../src/ae/environment.js";

/**
 * A scriptable stand-in for After Effects (DEVELOPMENT.md, tier 2).
 *
 * It models only what the runtime touches, and it records undo-group activity so
 * tests can assert the property that matters most: every mutation is wrapped in
 * exactly one balanced group, including on the failure path.
 *
 * Its fidelity is bounded and known. It proves our logic, not Adobe's
 * behaviour — that is what the tier 3 fixture projects are for.
 */
export interface MockAe extends AeEnvironment {
  readonly undoEvents: string[];
  openGroups(): number;
  setVersion(version: string): void;
  advance(ms: number): void;
}

export interface MockAeOptions {
  readonly version?: string;
  /** Milliseconds each `nowMs()` call advances by, simulating elapsed work. */
  readonly tickMs?: number;
}

export function createMockAe(options: MockAeOptions = {}): MockAe {
  const undoEvents: string[] = [];
  let version = options.version ?? "26.0.1x45";
  let depth = 0;
  let clock = 1_000_000;
  const tick = options.tickMs ?? 0;

  return {
    undoEvents,
    openGroups: () => depth,
    setVersion: (next: string) => {
      version = next;
    },
    advance: (ms: number) => {
      clock += ms;
    },

    version: () => version,
    buildName: () => `Adobe After Effects ${version}`,
    language: () => "en_US",
    os: () => "Mock OS 1.0",
    engineVersion: () => "4.2.0",

    beginUndoGroup: (name: string) => {
      depth += 1;
      undoEvents.push(`begin:${name}`);
    },
    endUndoGroup: () => {
      depth -= 1;
      undoEvents.push("end");
    },

    nowMs: () => {
      const value = clock;
      clock += tick;
      return value;
    },
  };
}

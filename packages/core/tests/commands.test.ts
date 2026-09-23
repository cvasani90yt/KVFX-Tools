import { describe, expect, it } from "vitest";
import {
  type ActiveComp,
  type Command,
  type CommandContext,
  EMPTY_SNAPSHOT,
  type SelectedLayer,
  type SelectionSnapshot,
  createCommandRegistry,
  createProductionCommandRegistry,
  undoGroupFor,
} from "../src/commands/index.js";

/**
 * Commands are pure functions from a snapshot to a plan, so every one of these
 * assertions runs with no After Effects present. That property is the whole
 * reason for ADR-0006.
 */

const comp: ActiveComp = {
  id: 1,
  name: "Comp 1",
  width: 1920,
  height: 1080,
  frameRate: 25,
  duration: 10,
  time: 0,
  layerCount: 3,
};

function layer(overrides: Partial<SelectedLayer> = {}): SelectedLayer {
  return {
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
    ...overrides,
  };
}

function ctx(snapshot: Partial<SelectionSnapshot> = {}, aeVersion = "26.0.1x45"): CommandContext {
  return {
    aeVersion,
    snapshot: { ...EMPTY_SNAPSHOT, hasProject: true, comp, layers: [layer()], ...snapshot },
  };
}

const registry = createProductionCommandRegistry();

function command(id: string): Command {
  const found = registry.get(id);
  if (found === undefined) throw new Error(`No such command: ${id}`);
  return found;
}

describe("registry integrity", () => {
  it("registers a non-empty command set", () => {
    expect(registry.all().length).toBeGreaterThan(0);
  });

  it("gives every command a unique, well-formed id", () => {
    const ids = registry.all().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^kvfx\.[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/);
  });

  it("gives every command the metadata the UI depends on", () => {
    for (const c of registry.all()) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.icon.length).toBeGreaterThan(0);
      expect(c.keywords.length).toBeGreaterThan(0);
      expect(c.category.length).toBeGreaterThan(0);
    }
  });

  it("names every undo group so it is attributable in After Effects", () => {
    for (const c of registry.all()) {
      const plan = c.plan(ctx());
      expect(plan.undoGroup.startsWith("KVFX Tools — ")).toBe(true);
      expect(plan.steps.length).toBeGreaterThan(0);
    }
  });

  it("emits only well-formed operation ids", () => {
    for (const c of registry.all()) {
      for (const step of c.plan(ctx()).steps) {
        expect(step.op).toMatch(/^kvfx\.op\.[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/);
      }
    }
  });

  it("rejects a duplicate id at construction", () => {
    const one = command("kvfx.layer.solo");
    expect(() => createCommandRegistry([one, one])).toThrow(/Duplicate command id/);
  });

  it("rejects a malformed id at construction", () => {
    const bad = { ...command("kvfx.layer.solo"), id: "solo" };
    expect(() => createCommandRegistry([bad])).toThrow(/Malformed command id/);
  });

  it("filters by category", () => {
    expect(registry.byCategory("LAYER").length).toBe(registry.all().length);
    expect(registry.byCategory("KEYFRAME")).toEqual([]);
  });
});

describe("availability", () => {
  it("requires a project", () => {
    const result = command("kvfx.layer.solo").canExecute({
      aeVersion: "26.0",
      snapshot: EMPTY_SNAPSHOT,
    });
    expect(result).toEqual({ available: false, reason: "Open a project first." });
  });

  it("requires a composition", () => {
    const result = command("kvfx.layer.solo").canExecute(ctx({ comp: undefined }));
    expect(result).toEqual({ available: false, reason: "Open a composition first." });
  });

  it("requires a selection for commands that act on layers", () => {
    const result = command("kvfx.layer.solo").canExecute(ctx({ layers: [] }));
    expect(result).toEqual({ available: false, reason: "Select a layer first." });
  });

  it("does not require a selection for creation commands", () => {
    expect(command("kvfx.layer.createnull").canExecute(ctx({ layers: [] }))).toEqual({
      available: true,
    });
  });

  it("does not require a selection for unlock-all", () => {
    // The whole point is to reach layers that cannot be selected.
    expect(command("kvfx.layer.unlockall").canExecute(ctx({ layers: [] }))).toEqual({
      available: true,
    });
  });

  it("resolves availability for the whole registry in one pass", () => {
    const resolved = registry.resolve(ctx({ layers: [] }));
    const solo = resolved.find((r) => r.command.id === "kvfx.layer.solo");

    expect(solo?.available).toBe(false);
    // Unavailable commands are returned with a reason rather than hidden, so the
    // palette can teach the rule instead of silently dropping the entry.
    expect(solo?.reason).toBe("Select a layer first.");
    expect(resolved.length).toBe(registry.all().length);
  });
});

describe("plans", () => {
  it("targets the live selection rather than ids from the snapshot", () => {
    // Baking snapshot ids into the plan would let a stale selection modify the
    // wrong layers — ADR-0002.
    const plan = command("kvfx.layer.solo").plan(ctx({ layers: [layer({ id: 42 })] }));

    expect(plan.steps[0]?.args).toEqual({ target: "selection", flag: "solo", value: "toggle" });
    expect(JSON.stringify(plan)).not.toContain("42");
  });

  it("asks the host to resolve toggle state", () => {
    for (const id of ["kvfx.layer.solo", "kvfx.layer.shy", "kvfx.layer.threed"]) {
      expect(command(id).plan(ctx()).steps[0]?.args["value"]).toBe("toggle");
    }
  });

  it("locks the selection but unlocks the whole composition", () => {
    expect(command("kvfx.layer.lock").plan(ctx()).steps[0]?.args).toEqual({
      target: "selection",
      flag: "locked",
      value: true,
    });
    expect(command("kvfx.layer.unlockall").plan(ctx()).steps[0]?.args).toEqual({
      target: "all",
      flag: "locked",
      value: false,
    });
  });

  it("maps each ordering command to its direction", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["kvfx.layer.movetop", "top"],
      ["kvfx.layer.movebottom", "bottom"],
      ["kvfx.layer.moveup", "up"],
      ["kvfx.layer.movedown", "down"],
    ];
    for (const [id, to] of cases) {
      expect(command(id).plan(ctx()).steps[0]?.args).toEqual({ target: "selection", to });
    }
  });

  it("maps creation commands to their kind", () => {
    expect(command("kvfx.layer.createnull").plan(ctx()).steps[0]?.args).toEqual({ kind: "null" });
    expect(command("kvfx.layer.createadjustment").plan(ctx()).steps[0]?.args).toEqual({
      kind: "adjustment",
    });
  });

  it("marks nothing in the Phase 3 set as destructive", () => {
    for (const c of registry.all()) expect(c.metadata.destructive).toBe(false);
  });
});

describe("undoGroupFor", () => {
  it("prefixes the product name so undo entries are attributable", () => {
    expect(undoGroupFor("Create Null")).toBe("KVFX Tools — Create Null");
  });
});

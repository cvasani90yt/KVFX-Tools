import { describe, expect, it } from "vitest";
import {
  type Command,
  type CommandContext,
  type JsonValue,
  createProductionCommandRegistry,
  decodeSnapshot,
  defaultSettings,
} from "@kvfx/core";
import { createDispatcher } from "../src/runtime/dispatcher.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { createProductionRegistry } from "../src/ops/index.js";
import { createMockAe, type MockAe } from "./mock-ae.js";
import { font } from "./mock-dom.js";

/**
 * Every shipped command, end to end, against the mock After Effects DOM.
 *
 * For each command: read the real selection snapshot, check availability,
 * run its probe if it has one, build its plan with the parameters the palette
 * would use, and execute that plan through the production dispatcher. This is
 * what catches a plan that names the wrong argument, a path that resolves to
 * nothing, or a `$ref` to a step that binds nothing — mistakes no unit test of
 * either side alone can see.
 */

/** A scene with something for every command to act on. */
function scene(): MockAe {
  const ae = createMockAe({
    comp: {
      frameRate: 25,
      layers: [
        { name: "Title", kind: "text", text: "Hello world", selected: true },
        { name: "Card", selected: true, geometry: { sourceRect: { left: 0, top: 0, width: 400, height: 300 } } },
        { name: "Backdrop", selected: true },
        { name: "Cam", kind: "camera" },
      ],
    },
  });
  const comp = ae.comp!;
  comp.time = 1;

  // A precomp among the selection, for deep duplicate.
  const inner = ae.project!.addComp("Inner");
  inner.addLayer({ name: "Leaf" });
  const nested = comp.addLayer({ name: "Nested", kind: "precomp", source: inner });
  nested.selected = true;
  nested.moveToEnd();

  // Selected keyframes on a selected property, for the keyframe commands.
  const opacity = ae.raw("Card").transform("ADBE Opacity");
  opacity.setValueAtTime(0, 0);
  opacity.setValueAtTime(2, 100);
  opacity.selectKeys(1, 2);
  opacity.selected = true;

  ae.project!.usedFonts = [{ font: font("ArialMT", "Arial"), usedAt: [{}] }];
  return ae;
}

function send(ae: MockAe, request: Record<string, unknown>): { ok: boolean; result?: unknown; error?: { code: string; message: string } } {
  const dispatch = createDispatcher(createProductionRegistry(), ae);
  return JSON.parse(dispatch({ v: PROTOCOL_VERSION, id: "e2e", ...request })) as ReturnType<typeof send>;
}

function run(command: Command): { ok: boolean; reason?: string; steps: number } {
  const ae = scene();
  const snapshot = send(ae, { kind: "query", op: "kvfx.op.selection.snapshot", args: {}, budgetMs: 250 });
  const ctx: CommandContext = {
    snapshot: decodeSnapshot(snapshot.result as JsonValue),
    aeVersion: "26.0.1x45",
    params: command.defaultParams?.(defaultSettings().ui) ?? {},
  };

  const availability = command.canExecute(ctx);
  if (!availability.available) return { ok: false, reason: `unavailable: ${availability.reason}`, steps: 0 };

  let plan;
  if (command.kind === "measured") {
    const probe = command.probe(ctx);
    const measured = send(ae, { kind: "query", op: probe.op, args: probe.args, budgetMs: 1000 });
    if (!measured.ok) return { ok: false, reason: `probe: ${measured.error?.message ?? "?"}`, steps: 0 };
    plan = command.plan(ctx, measured.result as JsonValue);
  } else {
    plan = command.plan(ctx);
  }
  if (plan.steps.length === 0) return { ok: false, reason: "empty plan", steps: 0 };

  const reply = send(ae, {
    kind: "plan",
    op: "kvfx.op.core.plan",
    args: { steps: plan.steps as unknown as JsonValue },
    undoGroup: plan.undoGroup,
    budgetMs: plan.budgetMs ?? 1000,
  });
  return reply.ok
    ? { ok: true, steps: plan.steps.length }
    : { ok: false, reason: `${reply.error?.code ?? "?"}: ${reply.error?.message ?? "?"}`, steps: plan.steps.length };
}

/**
 * Commands that legitimately do nothing in this scene, and why. Anything not
 * listed here must run cleanly.
 */
const EXPECTED_NO_OP: Record<string, string> = {
  // Every selected layer already sits where the command would put it.
  "kvfx.layer.movetotop": "empty plan",
};

describe("every command, end to end", () => {
  const commands = createProductionCommandRegistry().all();

  it("covers the whole registry", () => {
    expect(commands.length).toBeGreaterThan(60);
  });

  for (const command of commands) {
    it(`${command.id} runs against the mock DOM`, () => {
      const outcome = run(command);
      const expected = EXPECTED_NO_OP[command.id];
      if (expected !== undefined && !outcome.ok) {
        expect(outcome.reason).toContain(expected);
        return;
      }
      expect(outcome, command.name).toMatchObject({ ok: true });
    });
  }
});

describe("generators build what they promise", () => {
  function runWith(id: string, params: Record<string, JsonValue>, prepare?: (ae: MockAe) => void): MockAe {
    const ae = scene();
    prepare?.(ae);
    const command = createProductionCommandRegistry().get(id)!;
    const snapshot = send(ae, { kind: "query", op: "kvfx.op.selection.snapshot", args: {}, budgetMs: 250 });
    const ctx: CommandContext = { snapshot: decodeSnapshot(snapshot.result as JsonValue), aeVersion: "26.0", params };
    let plan;
    if (command.kind === "measured") {
      const probe = command.probe(ctx);
      plan = command.plan(ctx, send(ae, { kind: "query", op: probe.op, args: probe.args, budgetMs: 1000 }).result as JsonValue);
    } else plan = command.plan(ctx);
    const reply = send(ae, {
      kind: "plan",
      op: "kvfx.op.core.plan",
      args: { steps: plan.steps as unknown as JsonValue },
      undoGroup: plan.undoGroup,
      budgetMs: plan.budgetMs ?? 1000,
    });
    expect(reply.ok, reply.error?.message).toBe(true);
    return ae;
  }

  it("number counter: a text layer driven by a keyed progress slider", () => {
    const ae = runWith("kvfx.rig.counter", { from: 0, to: 2500, duration: 3 });
    const counter = ae.raw("KVFX Counter");
    const slider = counter.effects.property("KVFX Counter")!.property(1)!;
    expect([slider.keyTime(1), slider.keyTime(2)]).toEqual([1, 4]);
    const source = counter.property("ADBE Text Properties")!.property("ADBE Text Document")!;
    expect(source.expression).toContain("var to = 2500;");
    expect(source.expressionEnabled).toBe(true);
  });

  it("carousel from one card: hub, copies, all parented with slot expressions", () => {
    const ae = runWith("kvfx.rig.carousel", { count: 5, radius: 300 }, (scene) => scene.select("Card"));
    const hub = ae.raw("KVFX Carousel");
    expect(hub.threeDLayer).toBe(true);
    expect(hub.effects.property("Radius")!.property(1)!.value).toBe(300);
    const cards = ae.comp!.stack.filter((l) => l.parent === hub);
    expect(cards).toHaveLength(5);
    const slots = cards.map((c) => /var slot = (\d+);/.exec(c.transform("ADBE Position").expression)?.[1]).sort();
    expect(slots).toEqual(["0", "1", "2", "3", "4"]);
    expect(cards.every((c) => c.threeDLayer === true)).toBe(true);
  });

  it("extrusion: slices parented behind the face, side colour, depth control on the face", () => {
    let faceId = 0;
    const ae = runWith("kvfx.rig.extrude", { slices: 4, depth: 80 }, (scene) => {
      scene.select("Card");
      faceId = scene.idOf("Card");
    });
    // The slices are duplicates and share the face's name, so find it by id.
    const face = ae.comp!.stack.find((l) => l.id === faceId)!;
    const slices = ae.comp!.stack.filter((l) => l.parent === face);
    expect(slices).toHaveLength(4);
    expect(face.effects.property("KVFX Extrude")!.property(1)!.value).toBe(80);
    expect(slices.every((s) => s.effects.property("KVFX Extrude") === null)).toBe(true);
    expect(slices.every((s) => s.effects.property("KVFX Extrude Side") !== null)).toBe(true);
    const depths = slices.map((s) => /depth \* (\d+) \/ 4/.exec(s.transform("ADBE Position").expression)?.[1]).sort();
    expect(depths).toEqual(["1", "2", "3", "4"]);
  });

  it("text exploder: one layer per word, original hidden", () => {
    const ae = runWith("kvfx.text.explode", { mode: "words" }, (scene) => scene.select("Title"));
    expect(ae.stack().slice(0, 3)).toEqual(["Hello", "world", "Title"]);
    expect(ae.raw("Title").enabled).toBe(false);
  });

  it("sequence: staggers in-points top to bottom by the frame step", () => {
    const ae = runWith("kvfx.layer.sequence", { frames: 5 }, (scene) => scene.select("Title", "Card", "Backdrop"));
    const starts = ["Title", "Card", "Backdrop"].map((n) => ae.raw(n).startTime);
    expect(starts[0]).toBeCloseTo(0);
    expect(starts[1]).toBeCloseTo(0.2);
    expect(starts[2]).toBeCloseTo(0.4);
  });

  it("parent to new null: every selected layer, none left behind", () => {
    const ae = runWith("kvfx.layer.nullparent", {}, (scene) => scene.select("Title", "Card"));
    const control = ae.raw("KVFX Control");
    expect(ae.raw("Title").parent).toBe(control);
    expect(ae.raw("Card").parent).toBe(control);
  });
});

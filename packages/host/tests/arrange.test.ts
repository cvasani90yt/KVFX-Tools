import { describe, expect, it } from "vitest";
import { maxRank, rankExpression, seededPermutation, staggerRanks } from "@kvfx/core";
import { createMockAe, type MockAe } from "./mock-ae.js";
import { runCommand, runSteps } from "./run-command.js";

/**
 * Arrange tools: align as a group, even gaps, sequence order and Follow.
 */

function row(): MockAe {
  return createMockAe({
    comp: {
      width: 1920,
      height: 1080,
      layers: [
        { name: "A", selected: true, geometry: { sourceRect: { left: 0, top: 0, width: 100, height: 50 }, position: { x: 200, y: 300 } } },
        { name: "B", selected: true, geometry: { sourceRect: { left: 0, top: 0, width: 300, height: 50 }, position: { x: 500, y: 400 } } },
        { name: "C", selected: true, geometry: { sourceRect: { left: 0, top: 0, width: 50, height: 50 }, position: { x: 1500, y: 350 } } },
      ],
    },
  });
}

describe("align as group", () => {
  it("moves the selection's combined bounds to the comp edge, keeping the arrangement", () => {
    const ae = row();
    runCommand(ae, "kvfx.align.left.group");
    // The block's left edge was A at 200; everything shifts left by 200.
    expect(ae.positionOf("A")).toEqual({ x: 0, y: 300 });
    expect(ae.positionOf("B")).toEqual({ x: 300, y: 400 });
    expect(ae.positionOf("C")).toEqual({ x: 1300, y: 350 });
  });

  it("carries keyframes with an animated layer instead of skipping it", () => {
    const ae = row();
    const position = ae.raw("B").transform("ADBE Position");
    position.setValueAtTime(0, [500, 400, 0]);
    position.setValueAtTime(2, [700, 400, 0]);
    runCommand(ae, "kvfx.align.top.group");
    // The block's top was A at 300; everything moves up by 300.
    expect(position.keyValue(1)).toEqual([500, 100, 0]);
    expect(position.keyValue(2)).toEqual([700, 100, 0]);
    expect(ae.positionOf("A")).toEqual({ x: 200, y: 0 });
  });

  it("moves separated X and Y dimensions, keyed or not", () => {
    const ae = row();
    const raw = ae.raw("C");
    raw.transform("ADBE Position").dimensionsSeparated = true;
    raw.transform("ADBE Position_0").setValue(1500);
    raw.transform("ADBE Position_1").setValueAtTime(0, 350);
    raw.transform("ADBE Position_1").setValueAtTime(1, 450);
    runSteps(ae, [{ op: "kvfx.op.layer.offsetPosition", args: { changes: [{ id: raw.id, dx: -10, dy: 20 }] } }]);
    expect(raw.transform("ADBE Position_0").value).toBe(1490);
    expect(raw.transform("ADBE Position_1").keyValue(1)).toBe(370);
    expect(raw.transform("ADBE Position_1").keyValue(2)).toBe(470);
  });

  it("does not move a child twice when its parent moves too", () => {
    const ae = createMockAe({
      comp: {
        layers: [
          { name: "Child", selected: true, geometry: { parent: "Parent", position: { x: 50, y: 0 } } },
          { name: "Parent", selected: true, geometry: { position: { x: 400, y: 400 } } },
        ],
      },
    });
    runCommand(ae, "kvfx.align.left.group");
    expect(ae.positionOf("Child")).toEqual({ x: 50, y: 0 });
    expect(ae.positionOf("Parent")?.x).toBeCloseTo(0);
  });

  it("skips locked layers with a reason", () => {
    const ae = row();
    ae.raw("B").locked = true;
    const reply = runCommand(ae, "kvfx.align.left.group");
    expect(JSON.stringify(reply.result)).toContain("Layer is locked");
    expect(ae.positionOf("B")).toEqual({ x: 500, y: 400 });
  });
});

describe("even gaps", () => {
  it("shares the span between the outer two equally between edges", () => {
    const ae = row();
    runCommand(ae, "kvfx.align.gaps.horizontal");
    // Span 200…1550 = 1350; sizes 100+300+50 = 450; two gaps of 450.
    expect(ae.positionOf("A")?.x).toBeCloseTo(200);
    expect(ae.positionOf("B")?.x).toBeCloseTo(750);
    expect(ae.positionOf("C")?.x).toBeCloseTo(1500);
  });

  it("stacks with a fixed gap from the first layer", () => {
    const ae = row();
    runCommand(ae, "kvfx.align.gaps.horizontal", { gap: 20 });
    expect(ae.positionOf("A")?.x).toBeCloseTo(200);
    expect(ae.positionOf("B")?.x).toBeCloseTo(320);
    expect(ae.positionOf("C")?.x).toBeCloseTo(640);
  });

  it("works on two layers only when a gap is given", () => {
    const ae = row();
    ae.select("A", "B");
    runCommand(ae, "kvfx.align.gaps.vertical", { gap: 10 });
    expect(ae.positionOf("B")?.y).toBeCloseTo(360);
  });
});

describe("stagger order", () => {
  it("ranks centre-out and edges-in symmetrically, ties starting together", () => {
    expect(staggerRanks(5, "centre")).toEqual([2, 1, 0, 1, 2]);
    expect(staggerRanks(4, "centre")).toEqual([1, 0, 0, 1]);
    expect(staggerRanks(5, "edges")).toEqual([0, 1, 2, 1, 0]);
    expect(staggerRanks(3, "reverse")).toEqual([2, 1, 0]);
    expect(maxRank(4, "centre")).toBe(1);
    expect(maxRank(6, "forward")).toBe(5);
  });

  it("shuffles deterministically, and the expression shuffles the same way", () => {
    const panel = seededPermutation(12, 77);
    expect(seededPermutation(12, 77)).toEqual(panel);
    expect([...panel].sort((a, b) => a - b)).toEqual([...Array(12).keys()]);

    // Evaluate the generated expression source in plain JavaScript.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- testing generated expression source
    const make = new Function(`${rankExpression("random", 77)}\nreturn kvRank;`) as () => (i: number, n: number) => number;
    const kvRank = make();
    const ranks = staggerRanks(12, "random", 77);
    for (let i = 0; i < 12; i += 1) expect(kvRank(i, 12)).toBe(ranks[i]);
  });

  it("sequence from the centre: the middle layer first, the ends last", () => {
    const ae = row();
    runCommand(ae, "kvfx.layer.sequence", { frames: 5, order: "centre" });
    // 25 fps: 5 frames = 0.2 s.
    expect(ae.raw("B").startTime).toBeCloseTo(0);
    expect(ae.raw("A").startTime).toBeCloseTo(0.2);
    expect(ae.raw("C").startTime).toBeCloseTo(0.2);
  });

  it("sequence chained in reverse: each starts after the previous ends", () => {
    const ae = row();
    for (const name of ["A", "B", "C"]) ae.raw(name).outPoint = 2;
    runCommand(ae, "kvfx.layer.sequence", { frames: 0, mode: "chain", order: "reverse" });
    expect(ae.raw("C").startTime).toBeCloseTo(0);
    expect(ae.raw("B").startTime).toBeCloseTo(2);
    expect(ae.raw("A").startTime).toBeCloseTo(4);
  });
});

describe("follow layer", () => {
  it("rigs the followers to the top layer through a Layer Control, stamped with the attach time", () => {
    const ae = row();
    ae.comp!.time = 1.5;
    runCommand(ae, "kvfx.layer.follow", { rotation: true, delay: 3 });
    const leader = ae.raw("A");
    for (const name of ["B", "C"]) {
      const follower = ae.raw(name);
      expect(follower.effects.property("KVFX Follow")!.property(1)!.value).toBe(leader.index);
      expect(follower.effects.property("KVFX Follow Delay")!.property(1)!.value).toBe(3);
      const position = follower.transform("ADBE Position");
      expect(position.expressionEnabled).toBe(true);
      expect(position.expression).toContain("var t0 = 1.5;");
      expect(follower.transform("ADBE Rotate Z").expression).toContain("lead.rotation");
      expect(follower.transform("ADBE Scale").expression).toBe("");
    }
    expect(leader.effects.property("KVFX Follow")).toBeNull();
  });

  it("never replaces an expression the user already wrote", () => {
    const ae = row();
    const mine = ae.raw("A").transform("ADBE Position");
    mine.expression = "wiggle(2, 20)";
    mine.expressionEnabled = true;
    const reply = runCommand(ae, "kvfx.layer.follow", { leader: "bottom" });
    expect(mine.expression).toBe("wiggle(2, 20)");
    expect(JSON.stringify(reply.result)).toContain("already has an expression");
    // C is the leader when the bottom leads, so it gets no follow effect.
    expect(ae.raw("C").effects.property("KVFX Follow")).toBeNull();
    expect(ae.raw("A").effects.property("KVFX Follow")!.property(1)!.value).toBe(ae.raw("C").index);
  });
});

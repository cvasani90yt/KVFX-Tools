import { describe, expect, it } from "vitest";
import {
  type PlacedRamp,
  SPEED_RAMPS,
  SPEED_RAMP_TAG,
  parseSpeedRampComment,
  rampAdvance,
  rampLengthChange,
  rampedTime,
  speedAt,
  speedRampById,
  speedRampComment,
  speedRampExpression,
  speedRampWindow,
} from "@kvfx/core";
import { createMockAe, type MockAe } from "./mock-ae.js";
import { FRAME_BLEND } from "./mock-dom.js";
import { planFor, runCommand } from "./run-command.js";

/**
 * Speed Ramp: the presets' maths, the Time Remap expression, and the command
 * end to end against the mock After Effects.
 */

const FRAME = 1 / 25;

interface MarkerKey {
  readonly time: number;
  readonly duration: number;
  readonly comment: string;
}

/** Runs the Time Remap expression the way After Effects would, at comp time `t`. */
function evaluate(source: string, t: number, markers: readonly MarkerKey[], startTime = 0): number {
  const thisLayer = { marker: { numKeys: markers.length, key: (i: number) => markers[i - 1] } };
  // Time Remap's own keyframes: the source plays at normal speed from the layer's start.
  const valueAtTime = (x: number): number => x - startTime;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- executing generated expression source under test
  const run = new Function("time", "thisLayer", "valueAtTime", "src", "return eval(src);") as (...args: unknown[]) => unknown;
  return run(t, thisLayer, valueAtTime, source) as number;
}

const ramp = (id: string, start: number, duration: number, s = 1): PlacedRamp => ({ start, duration, preset: speedRampById(id)!, s });
const markerOf = (r: PlacedRamp): MarkerKey => ({ time: r.start, duration: r.duration, comment: speedRampComment(r.preset, r.s * 100) });

describe("speed ramp presets", () => {
  it("has a dozen, with unique ids and names a marker comment can carry", () => {
    expect(SPEED_RAMPS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(SPEED_RAMPS.map((p) => p.id)).size).toBe(SPEED_RAMPS.length);
    for (const p of SPEED_RAMPS) {
      expect(p.name, p.id).not.toMatch(/[()]/);
      expect(p.hit, p.id).toBeGreaterThanOrEqual(0);
      expect(p.hit, p.id).toBeLessThanOrEqual(1);
    }
  });

  it("start and end at normal speed, so the clip never jumps into or out of a ramp", () => {
    for (const p of SPEED_RAMPS) {
      const points = p.points;
      expect(points[0], p.id).toEqual([0, 1]);
      expect(points[points.length - 1], p.id).toEqual([1, 1]);
      for (let i = 1; i < points.length; i += 1) expect(points[i]![0], p.id).toBeGreaterThan(points[i - 1]![0]);
      for (const s of [0.5, 1, 2]) {
        expect(speedAt(points, 0, s), p.id).toBe(1);
        expect(speedAt(points, 1, s), p.id).toBe(1);
      }
    }
  });

  it("advance is the exact integral of the eased speed", () => {
    const steps = 4000;
    for (const p of SPEED_RAMPS) {
      for (const s of [0.6, 1, 1.5]) {
        let sum = 0;
        for (let i = 0; i < steps; i += 1) {
          const u = (i + 0.5) / steps;
          sum += speedAt(p.points, u, s) / steps;
          if (i % 500 === 499) expect(rampAdvance(p.points, (i + 1) / steps, s), `${p.id} s=${String(s)}`).toBeCloseTo(sum, 5);
        }
      }
    }
  });

  it("strength 0 is no ramp for forward presets, and more strength is more extreme", () => {
    const slow = speedRampById("slowMo")!;
    expect(rampAdvance(slow.points, 1, 0)).toBeCloseTo(1, 9);
    expect(rampAdvance(slow.points, 1, 2)).toBeLessThan(rampAdvance(slow.points, 1, 1));
    const fast = speedRampById("speedUp")!;
    expect(rampAdvance(fast.points, 1, 2)).toBeGreaterThan(rampAdvance(fast.points, 1, 1));
  });

  it("slow motion lengthens the clip and speed shortens it", () => {
    expect(rampLengthChange(speedRampById("slowMo")!, 1, 1)).toBeGreaterThan(0.4);
    expect(rampLengthChange(speedRampById("speedUp")!, 1, 1)).toBeLessThan(-2);
    expect(rampLengthChange(speedRampById("rewind")!, 1, 1)).toBeGreaterThan(4);
  });

  it("puts the key moment on the playhead, on whole frames", () => {
    const window = speedRampWindow({ time: 4, frame: FRAME, frames: 30, hit: 0.5 });
    expect(window.duration).toBeCloseTo(30 * FRAME);
    expect(window.start).toBeCloseTo(4 - 15 * FRAME);
    const early = speedRampWindow({ time: 4, frame: FRAME, frames: 30, hit: 0.1 });
    expect(early.start).toBeCloseTo(4 - 3 * FRAME);
    expect(speedRampWindow({ time: 0.1, frame: FRAME, frames: 30, hit: 0.5 }).start).toBe(0);
  });

  it("reads a marker comment back, so editing the percentage changes the strength", () => {
    const preset = speedRampById("slowMo")!;
    expect(speedRampComment(preset, 150)).toBe("KVFX Speed Ramp: Slow-Mo (150%)");
    expect(parseSpeedRampComment("KVFX Speed Ramp: Slow-Mo (150%)")).toEqual({ preset, s: 1.5 });
    expect(parseSpeedRampComment("KVFX Speed Ramp: Nothing (100%)")).toBeUndefined();
    expect(parseSpeedRampComment("Chapter 2")).toBeUndefined();
  });
});

describe("the Time Remap expression", () => {
  const source = speedRampExpression();

  it("carries its tag and every preset", () => {
    expect(source.startsWith(SPEED_RAMP_TAG)).toBe(true);
    for (const p of SPEED_RAMPS) expect(source).toContain(JSON.stringify(p.name));
    expect(source).not.toMatch(/\blet\b|=>|`/);
  });

  it("gives the same source time as the panel's maths, through several ramps on one clip", () => {
    const ramps = [ramp("velocity", 1, 1.2), ramp("freezeHit", 3, 0.8, 1.4), ramp("rewind", 5, 0.6, 0.7)];
    const markers = [...ramps.map(markerOf), { time: 2.5, duration: 0, comment: "Chapter" }];
    for (let t = 0; t <= 7; t += 0.05) {
      expect(evaluate(source, t, markers, 0.5), `t=${t.toFixed(2)}`).toBeCloseTo(rampedTime(ramps, t) - 0.5, 6);
    }
  });

  it("plays at normal speed outside every ramp, offset by what each ramp added", () => {
    const slow = ramp("slowMo", 2, 1);
    const markers = [markerOf(slow)];
    expect(evaluate(source, 1.5, markers)).toBeCloseTo(1.5, 9);
    const after = evaluate(source, 4, markers);
    expect(after).toBeCloseTo(4 - rampLengthChange(slow.preset, 1, 1), 6);
    expect(evaluate(source, 4.5, markers) - after).toBeCloseTo(0.5, 9);
  });

  it("ignores other markers", () => {
    const markers = [{ time: 1, duration: 2, comment: "Intro" }];
    expect(evaluate(source, 2, markers)).toBeCloseTo(2, 9);
  });
});

function edit(): MockAe {
  const ae = createMockAe({
    comp: {
      width: 1920,
      height: 1080,
      frameRate: 25,
      duration: 20,
      layers: [{ name: "Title", kind: "text", selected: true }, { name: "Shot A", selected: true }],
    },
  });
  ae.raw("Shot A").outPoint = 10;
  ae.comp!.time = 4;
  return ae;
}

describe("Add Speed Ramp", () => {
  it("remaps the selected clip with a ramp marker, its expression and frame blending", () => {
    const ae = edit();
    runCommand(ae, "kvfx.rig.speedRamp", { preset: "slowMo", frames: 40, strength: 100 });
    const shot = ae.raw("Shot A");
    expect(shot.timeRemapEnabled).toBe(true);
    const remap = shot.property("ADBE Time Remapping")!;
    expect(remap.expression.startsWith(SPEED_RAMP_TAG)).toBe(true);
    expect(remap.expressionEnabled).toBe(true);
    const marker = shot.property("ADBE Marker")!;
    expect(marker.numKeys).toBe(1);
    expect(marker.keyTime(1)).toBeCloseTo(4 - 20 * FRAME);
    expect(marker.keyValue(1)).toEqual({ comment: "KVFX Speed Ramp: Slow-Mo (100%)", duration: 40 * FRAME });
    expect(shot.frameBlendingType).toBe(FRAME_BLEND.frameMix);
    // Slow motion makes the clip longer, so it still ends on its last frame.
    expect(shot.outPoint).toBeCloseTo(10 + rampLengthChange(speedRampById("slowMo")!, 40 * FRAME, 1));
  });

  it("leaves text and other layers that can't be remapped alone", () => {
    const ae = edit();
    runCommand(ae, "kvfx.rig.speedRamp", { preset: "velocity" });
    const title = ae.raw("Title");
    expect(title.timeRemapEnabled).toBe(false);
    expect(title.property("ADBE Marker")!.numKeys).toBe(0);
  });

  it("keeps the out point when asked, and frame blending off", () => {
    const ae = edit();
    runCommand(ae, "kvfx.rig.speedRamp", { preset: "speedUp", fit: false, blend: false });
    const shot = ae.raw("Shot A");
    expect(shot.outPoint).toBe(10);
    expect(shot.frameBlendingType).toBe(FRAME_BLEND.none);
  });

  it("adds a second ramp as a second marker under the same expression", () => {
    const ae = edit();
    runCommand(ae, "kvfx.rig.speedRamp", { preset: "slowMo", fit: false });
    const first = ae.raw("Shot A").property("ADBE Time Remapping")!.expression;
    ae.comp!.time = 7;
    runCommand(ae, "kvfx.rig.speedRamp", { preset: "rewind", fit: false, strength: 80 });
    const shot = ae.raw("Shot A");
    expect(shot.property("ADBE Marker")!.numKeys).toBe(2);
    expect(shot.property("ADBE Marker")!.keyValue(2)).toMatchObject({ comment: "KVFX Speed Ramp: Rewind (80%)" });
    expect(shot.property("ADBE Time Remapping")!.expression).toBe(first);
  });

  it("never replaces a Time Remap expression it didn't write", () => {
    const ae = edit();
    const remap = ae.raw("Shot A").property("ADBE Time Remapping")!;
    remap.expression = "loopOut()";
    remap.expressionEnabled = true;
    const reply = runCommand(ae, "kvfx.rig.speedRamp", { preset: "velocity" });
    expect(remap.expression).toBe("loopOut()");
    expect(ae.raw("Shot A").property("ADBE Marker")!.numKeys).toBe(0);
    expect(JSON.stringify(reply.result)).toContain("Time Remap already has an expression");
  });

  it("is unavailable without a video or precomp layer selected", () => {
    const ae = createMockAe({ comp: { width: 1920, height: 1080, frameRate: 25, layers: [{ name: "Title", kind: "text", selected: true }] } });
    expect(() => planFor(ae, "kvfx.rig.speedRamp", {})).toThrow("Select a video or precomp layer.");
  });
});

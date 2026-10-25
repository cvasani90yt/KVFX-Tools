import { describe, expect, it } from "vitest";
import {
  TRANSITIONS,
  type Channel,
  type ChannelVars,
  type TransitionPreset,
  centredPointExpression,
  pairExpression,
  scalarExpression,
  transitionPose,
  transitionWindow,
} from "@kvfx/core";
import { createMockAe, type MockAe } from "./mock-ae.js";
import { BLEND } from "./mock-dom.js";
import { planFor, runCommand } from "./run-command.js";

/**
 * Add Transition: the presets' maths, their expressions, and the layer the
 * command builds, end to end against the mock After Effects.
 */

const W = 1920;
const H = 1080;
const FRAME = 1 / 25;

/** Runs generated expression source the way After Effects would, at progress `t`. */
function evaluate(source: string, v: ChannelVars, frames: number): unknown {
  const inPoint = 10;
  const outPoint = inPoint + frames * FRAME;
  const globals: Record<string, unknown> = {
    time: inPoint + v.t * (outPoint - inPoint),
    inPoint,
    outPoint,
    thisComp: { frameDuration: FRAME, width: v.W, height: v.H },
    effect: () => () => v.s * 100,
  };
  const names = Object.keys(globals);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- executing generated expression source under test
  const run = new Function(...names, "src", "return eval(src);") as (...args: unknown[]) => unknown;
  return run(...names.map((key) => globals[key]), source);
}

interface Drive {
  readonly label: string;
  readonly source: (seed: number) => string;
  readonly expect: (v: ChannelVars) => number[];
}

/** Every animated value a preset sets, as expression source and as the preview's maths. */
function drives(preset: TransitionPreset): Drive[] {
  const one = (label: string, c: Channel): Drive => ({ label, source: (seed) => scalarExpression(c, seed), expect: (v) => [c.at(v)] });
  const out: Drive[] = [];
  const build = preset.build;
  if (build.kind === "shape") {
    for (const g of build.groups(W, H)) {
      const pos = g.position;
      const scale = g.scale;
      if (pos !== undefined) out.push({ label: `${g.name} position`, source: (seed) => pairExpression(pos[0], pos[1], seed), expect: (v) => [pos[0].at(v), pos[1].at(v)] });
      if (scale !== undefined) out.push({ label: `${g.name} scale`, source: (seed) => pairExpression(scale[0], scale[1], seed), expect: (v) => [scale[0].at(v), scale[1].at(v)] });
      if (g.opacity !== undefined) out.push(one(`${g.name} opacity`, g.opacity));
    }
    return out;
  }
  if (build.kind === "solid") out.push(one("opacity", build.opacity));
  for (const effect of build.effects) {
    for (const p of effect.params) {
      const point = p.point;
      if (point !== undefined) {
        out.push({
          label: `${effect.name} ${p.param}`,
          source: (seed) => centredPointExpression(point[0], point[1], seed),
          expect: (v) => [v.W / 2 + point[0].at(v), v.H / 2 + point[1].at(v)],
        });
      } else if (p.channel !== undefined) out.push(one(`${effect.name} ${p.param}`, p.channel));
    }
    if (effect.mix !== undefined) out.push(one(`${effect.name} mix`, effect.mix));
  }
  return out;
}

const SAMPLES = [0, 0.04, 0.15, 0.3, 0.45, 0.5, 0.55, 0.7, 0.85, 0.96, 1];

describe("transition presets", () => {
  it("has more than twenty, each with a unique id, a name and a length", () => {
    expect(TRANSITIONS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(TRANSITIONS.map((p) => p.id)).size).toBe(TRANSITIONS.length);
    for (const p of TRANSITIONS) {
      expect(p.name.length, p.id).toBeGreaterThan(0);
      expect(p.frames, p.id).toBeGreaterThanOrEqual(8);
    }
  });

  it("their expressions give the same numbers as the preview's maths", () => {
    for (const preset of TRANSITIONS) {
      for (const drive of drives(preset)) {
        for (const s of [0.5, 1, 1.6]) {
          for (const seed of [3, 41]) {
            for (const t of SAMPLES) {
              const f = Math.floor((t * preset.frames * FRAME) / FRAME + 0.001);
              const v: ChannelVars = { t, s, f, W, H, seed };
              const got = evaluate(drive.source(seed), v, preset.frames);
              const values = Array.isArray(got) ? (got as number[]) : [got as number];
              const want = drive.expect(v);
              values.forEach((value, i) => expect(value, `${preset.id} ${drive.label} t=${String(t)} s=${String(s)}`).toBeCloseTo(want[i] ?? NaN, 4));
            }
          }
        }
      }
    }
  });

  it("leave the first and last frames as they were", () => {
    for (const preset of TRANSITIONS) {
      for (const t of [0, 1]) {
        const pose = transitionPose(preset, t, { seed: 9 });
        const label = `${preset.id} at ${String(t)}`;
        // Moves end a whole frame (or turn) away — the same picture, from Motion Tile.
        expect(Math.abs(pose.x % W), label).toBeCloseTo(0, 6);
        expect(Math.abs(pose.y % H), label).toBeCloseTo(0, 6);
        expect(Math.abs(pose.rotation % 360), label).toBeCloseTo(0, 6);
        expect(pose.scaleX, label).toBeCloseTo(100, 6);
        expect(pose.scaleY, label).toBeCloseTo(100, 6);
        if (pose.solid !== undefined) expect(pose.solid.opacity, label).toBe(0);
        for (const [param, amount] of Object.entries(pose.amounts)) {
          if (/Gaussian Blur 2-0001|Twirl-0001|Turbulent Displace-0002|Optics|Wave Warp-0002|Channel Blur-000[13]|Noise-0001|Brightness/.test(param)) {
            expect(Math.abs(amount), `${label} ${param}`).toBeCloseTo(0, 6);
          }
          if (/mix$/.test(param)) expect(amount, `${label} ${param}`).toBe(0);
          if (param === "ADBE Invert-0002") expect(amount, label).toBe(100);
        }
        expect(uncovered(pose.shapes), label).toBe(1);
      }
    }
  });

  it("moves pass the cut at full speed, never standing still on it", () => {
    for (const preset of TRANSITIONS.filter((p) => p.id.startsWith("whip") || p.id === "spin" || p.id === "roll")) {
      const before = transitionPose(preset, 0.48);
      const after = transitionPose(preset, 0.52);
      const moved = Math.hypot(after.x - before.x, after.y - before.y) + Math.abs(after.rotation - before.rotation);
      expect(moved, preset.id).toBeGreaterThan(50);
    }
  });

  it("graphic wipes cover the whole frame on both sides of the cut, so the switch never shows", () => {
    for (const preset of TRANSITIONS.filter((p) => p.build.kind === "shape")) {
      const frame = 1 / preset.frames;
      for (const t of [0.5 - frame, 0.5, 0.5 + frame / 2]) {
        expect(uncovered(transitionPose(preset, t).shapes), `${preset.id} at ${t.toFixed(3)}`).toBe(0);
      }
    }
  });

  it("each hit is different with a new seed, and the same with the same seed", () => {
    const glitch = TRANSITIONS.find((p) => p.id === "glitch")!;
    const at = (seed: number): number[] => SAMPLES.map((t) => transitionPose(glitch, t, { seed }).x);
    expect(at(5)).toEqual(at(5));
    expect(at(5)).not.toEqual(at(6));
  });
});

/** The share of a grid of points across the frame that no shape covers. */
function uncovered(shapes: ReturnType<typeof transitionPose>["shapes"]): number {
  if (shapes.length === 0) return 1;
  let open = 0;
  let total = 0;
  for (let gx = 0; gx <= 16; gx += 1) {
    for (let gy = 0; gy <= 9; gy += 1) {
      const px = (gx / 16) * W - W / 2;
      const py = (gy / 9) * H - H / 2;
      total += 1;
      const covered = shapes.some((s) => {
        if (s.stroke !== undefined || s.opacity < 50 || s.scaleX <= 0 || s.scaleY <= 0) return false;
        const a = (-s.rotation * Math.PI) / 180;
        const dx = px - s.x;
        const dy = py - s.y;
        const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / (s.scaleX / 100);
        const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / (s.scaleY / 100);
        const [w, h] = s.size;
        if (s.type === "ellipse") return (lx / (w / 2)) ** 2 + (ly / (h / 2)) ** 2 <= 1;
        return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
      });
      if (!covered) open += 1;
    }
  }
  return open / total;
}

describe("transition timing", () => {
  it("centres on the playhead, or on the nearest selected cut within reach", () => {
    const base = { frame: FRAME, frames: 16, compDuration: 20, cuts: [3, 8], snap: true };
    expect(transitionWindow({ ...base, time: 3.3 })).toMatchObject({ cut: 3, start: 3 - 0.32, end: 3 + 0.32, snapped: true });
    expect(transitionWindow({ ...base, time: 5 })).toMatchObject({ cut: 5, snapped: false });
    const free = transitionWindow({ ...base, time: 3.3, snap: false });
    expect(free.snapped).toBe(false);
    expect(free.cut).toBeCloseTo(3.32);
  });

  it("stays inside the comp at either end", () => {
    const base = { frame: FRAME, frames: 20, compDuration: 10, cuts: [], snap: true };
    expect(transitionWindow({ ...base, time: 0.1 })).toMatchObject({ start: 0, end: 0.8 });
    const end = transitionWindow({ ...base, time: 9.9 });
    expect(end.end).toBe(10);
    expect(end.start).toBeCloseTo(9.2);
  });
});

function edit(): MockAe {
  const ae = createMockAe({
    comp: { width: W, height: H, frameRate: 25, duration: 20, layers: [{ name: "Title" }, { name: "Shot B", selected: true }, { name: "Shot A", selected: true }] },
  });
  ae.raw("Shot A").outPoint = 4;
  ae.raw("Shot B").inPoint = 4;
  ae.comp!.time = 4.2;
  return ae;
}

describe("Add Transition", () => {
  it("adds an adjustment layer across the selected cut, above the clips, with its effects", () => {
    const ae = edit();
    runCommand(ae, "kvfx.rig.transition", { preset: "whipLeft", frames: 16, seed: 12 });
    const layer = ae.raw("KVFX Transition · Whip Left");
    expect(layer.adjustmentLayer).toBe(true);
    expect(layer.inPoint).toBeCloseTo(4 - 0.32);
    expect(layer.outPoint).toBeCloseTo(4 + 0.32);
    expect(ae.stack()).toEqual(["Title", "KVFX Transition · Whip Left", "Shot B", "Shot A"]);
    expect(layer.effects.property("KVFX Strength")!.property(1)!.value).toBe(100);
    expect(layer.effects.property("KVFX Tile")!.property("ADBE Tile-0004")!.value).toBe(400);
    const move = layer.effects.property("KVFX Move")!;
    expect(move.property("ADBE Geometry2-0002")!.expression).toContain("[W / 2 + (-W * io(t)), H / 2 + (0)]");
    expect(move.property("ADBE Geometry2-0009")!.value).toBe(0);
    expect(move.property("ADBE Geometry2-0010")!.expression).toContain("240 * s");
  });

  it("uses the playhead when nothing is selected, at the top of the stack", () => {
    const ae = createMockAe({ comp: { width: W, height: H, frameRate: 25, duration: 20, layers: [{ name: "Clip" }] } });
    ae.comp!.time = 6;
    runCommand(ae, "kvfx.rig.transition", { preset: "zoomIn" });
    const layer = ae.raw("KVFX Transition · Zoom In");
    expect(layer.inPoint).toBeCloseTo(6 - (14 * FRAME) / 2);
    expect(ae.stack()[0]).toBe("KVFX Transition · Zoom In");
  });

  it("builds a flash as a solid in Add mode, and a light leak in Screen", () => {
    const ae = edit();
    runCommand(ae, "kvfx.rig.transition", { preset: "flash" });
    const flash = ae.raw("KVFX Transition · Flash");
    expect(flash.blendingMode).toBe(BLEND.add);
    expect(flash.transform("ADBE Opacity").expression).toContain("Math.pow(pk(t, 1), 4)");
    runCommand(ae, "kvfx.rig.transition", { preset: "leak" });
    const leak = ae.raw("KVFX Transition · Light Leak");
    expect(leak.blendingMode).toBe(BLEND.screen);
    expect(leak.effects.property("KVFX Light")!.property("ADBE 4ColorGradient-0001")!.expression).toContain("W / 2 +");
  });

  it("fades Mosaic in and out through its own effect opacity", () => {
    const ae = edit();
    runCommand(ae, "kvfx.rig.transition", { preset: "pixelate" });
    const pixels = ae.raw("KVFX Transition · Pixelate").effects.property("KVFX Pixels")!;
    expect(pixels.property("ADBE Effect Built In Params")!.property("ADBE Effect Mask Opacity")!.expression).toContain("pk(t, 2) > 0.02");
  });

  it("draws graphic wipes as shape groups in the chosen colour", () => {
    const ae = edit();
    runCommand(ae, "kvfx.rig.transition", { preset: "bars", color: "#3366ff" });
    const layer = ae.raw("KVFX Transition · Bars");
    const root = layer.property("ADBE Root Vectors Group")!;
    expect(root.numProperties).toBe(5);
    const first = root.property(1)!;
    expect(first.property("ADBE Vector Transform Group")!.property("ADBE Vector Position")!.expression).toContain("eo(cl(");
    const fill = first.property("ADBE Vectors Group")!.property(2)!;
    expect(fill.property("ADBE Vector Fill Color")!.value).toEqual([0.2, 0.4, 1, 1]);
  });

  it("builds every preset without the host refusing a step", () => {
    for (const preset of TRANSITIONS) {
      const ae = edit();
      const plan = planFor(ae, "kvfx.rig.transition", { preset: preset.id, seed: 4 });
      expect(plan.steps.length, preset.id).toBeGreaterThan(3);
      runCommand(ae, "kvfx.rig.transition", { preset: preset.id, seed: 4 });
      expect(ae.raw(`KVFX Transition · ${preset.name}`), preset.id).toBeDefined();
    }
  });
});

import { describe, expect, it } from "vitest";
import { SILENCE_PRESETS, dotGrid, findSilences } from "@kvfx/core";
import { createMockAe, type MockAe } from "./mock-ae.js";
import { MockItem, TRACK_MATTE } from "./mock-dom.js";
import { runCommand, runSteps, send } from "./run-command.js";

/**
 * Comp Resizer, Relink, Silence Remover and the interface rigs.
 */

function hd(): MockAe {
  return createMockAe({
    comp: {
      name: "Main",
      width: 1920,
      height: 1080,
      frameRate: 25,
      duration: 10,
      layers: [
        { name: "Logo", selected: true, geometry: { sourceRect: { left: 0, top: 0, width: 200, height: 100 }, position: { x: 960, y: 540 } } },
        { name: "Corner", geometry: { position: { x: 1820, y: 100 } } },
      ],
    },
  });
}

describe("Comp Resizer", () => {
  it("keeps content centred on a new canvas, and fixes the precomp layer showing it", () => {
    const ae = hd();
    const main = ae.comp!;
    const parent = ae.project!.addComp("Edit", 1920, 1080);
    const user = parent.addLayer({ name: "Main", kind: "precomp", source: main });
    user.transform("ADBE Anchor Point").setValue([960, 540, 0]);
    user.transform("ADBE Position").setValue([960, 540, 0]);

    runCommand(ae, "kvfx.comp.resize", { width: 1080, height: 1920, fit: "keep", anchor: "centre" });
    expect([main.width, main.height]).toEqual([1080, 1920]);
    // Content moves by the change in the centre: (540 − 960, 960 − 540).
    expect(ae.positionOf("Logo")).toEqual({ x: 540, y: 960 });
    expect(ae.positionOf("Corner")).toEqual({ x: 1400, y: 520 });
    // The parent's layer anchor moves the same way, so the content stays put there.
    expect(user.transform("ADBE Anchor Point").value).toEqual([540, 960, 0]);
  });

  it("fit scales content about the anchor and counter-scales users of the comp", () => {
    const ae = hd();
    const main = ae.comp!;
    const parent = ae.project!.addComp("Edit", 1920, 1080);
    const user = parent.addLayer({ name: "Main", kind: "precomp", source: main });
    runCommand(ae, "kvfx.comp.resize", { width: 960, height: 540, fit: "fit", anchor: "topLeft" });
    expect(ae.positionOf("Logo")).toEqual({ x: 480, y: 270 });
    expect(ae.raw("Logo").transform("ADBE Scale").value).toEqual([50, 50, 100]);
    expect(user.transform("ADBE Scale").value).toEqual([200, 200, 100]);
  });

  it("moves keyframes, extends layers that ran to the end, and sets duration and rate", () => {
    const ae = hd();
    const position = ae.raw("Logo").transform("ADBE Position");
    position.setValueAtTime(0, [100, 100, 0]);
    position.setValueAtTime(1, [200, 100, 0]);
    runCommand(ae, "kvfx.comp.resize", { percent: 50, fit: "fit", anchor: "topLeft", duration: 20, frameRate: 30 });
    expect(position.keyValue(2)).toEqual([100, 50, 0]);
    expect([ae.comp!.width, ae.comp!.height, ae.comp!.duration, ae.comp!.frameRate]).toEqual([960, 540, 20, 30]);
    expect(ae.raw("Corner").outPoint).toBe(20);
  });

  it("swaps width and height", () => {
    const ae = hd();
    runCommand(ae, "kvfx.comp.resize", { width: 1920, height: 1080, swap: true });
    expect([ae.comp!.width, ae.comp!.height]).toEqual([1080, 1920]);
  });
});

describe("Relink Missing", () => {
  it("lists missing footage and relinks only confirmed files that exist", () => {
    const ae = hd();
    const found = new MockItem("intro.mov", "Footage");
    found.footageMissing = true;
    found.file = { exists: false, fsName: "/old/drive/intro.mov", name: "intro.mov" };
    const lost = new MockItem("music.wav", "Footage");
    lost.footageMissing = true;
    ae.project!.items.push(found, lost);
    ae.app.existingFiles.add("/new/intro.mov");

    const listed = send(ae, { kind: "query", op: "kvfx.op.project.missing", args: {}, budgetMs: 500 });
    expect((listed.result as { items: { name: string; file: string }[] }).items.map((i) => i.file)).toEqual(["intro.mov", "music.wav"]);

    const reply = runSteps(ae, [
      {
        op: "kvfx.op.project.relink",
        args: { items: [{ id: found.id, path: "/new/intro.mov" }, { id: lost.id, path: "/nowhere/music.wav" }] },
      },
    ]);
    expect(reply.ok).toBe(true);
    expect(found.footageMissing).toBe(false);
    expect(found.file?.fsName).toBe("/new/intro.mov");
    expect(lost.footageMissing).toBe(true);
    expect(JSON.stringify(reply.result)).toContain("File not found");
  });
});

describe("Silence Remover", () => {
  // 25 fps: 1 s of speech, 1 s of near-silence, 1 s of speech.
  const samples = [...Array(25).fill(20), ...Array(25).fill(0.4), ...Array(25).fill(18)] as number[];

  it("finds pauses relative to the loud level, padded so words are not clipped", () => {
    const result = findSilences(samples, 0, 0.04, { threshold: 8, minSilence: 0.3, padding: 0.1 });
    expect(result.silences).toEqual([{ start: 1.1, end: 1.9 }]);
    expect(result.keep).toEqual([
      { start: 0, end: 1.1 },
      { start: 1.9, end: 3 },
    ]);
    expect(result.removed).toBeCloseTo(0.8);
  });

  it("ignores pauses shorter than the minimum, and presets order from gentle to tight", () => {
    expect(findSilences(samples, 0, 0.04, { threshold: 8, minSilence: 1.5, padding: 0 }).silences).toEqual([]);
    const thresholds = SILENCE_PRESETS.map((p) => p.threshold);
    expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds);
  });

  it("reads loudness through Convert Audio to Keyframes and leaves the project as it was", () => {
    const ae = hd();
    const voice = ae.raw("Logo");
    voice.hasAudio = true;
    voice.inPoint = 1;
    voice.outPoint = 4;
    ae.raw("Corner").selected = true;
    ae.app.audioSamples = samples;
    const before = ae.stack();
    const reply = runSteps(ae, [{ op: "kvfx.op.audio.analyse", args: { id: voice.id } }]);
    expect(reply.ok, reply.error?.message).toBe(true);
    const result = (reply.result as { steps: { result: { start: number; samples: number[] } }[] }).steps[0]!.result;
    expect(result.start).toBe(1);
    expect(result.samples).toHaveLength(75);
    expect(ae.stack()).toEqual(before);
    expect(ae.comp!.workAreaStart).toBe(0);
    expect(ae.comp!.workAreaDuration).toBe(10);
    expect(ae.raw("Corner").selected).toBe(true);
  });

  it("cuts every selected layer to the kept ranges and closes the gaps in sync", () => {
    const ae = hd();
    for (const name of ["Logo", "Corner"]) ae.raw(name).selected = true;
    runSteps(ae, [
      {
        op: "kvfx.op.layer.cutRanges",
        args: { target: "selection", close: true, keep: [{ start: 0, end: 2 }, { start: 3, end: 5 }, { start: 8, end: 10 }] },
      },
    ]);
    const pieces = ae.comp!.stack.filter((l) => l.name === "Logo").map((l) => [l.inPoint + 0, l.outPoint + 0]).sort((a, b) => a[0]! - b[0]!);
    // 1 s removed before the second piece, 4 s before the third.
    expect(pieces).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ]);
    expect(ae.comp!.stack.filter((l) => l.name === "Corner")).toHaveLength(3);
  });

  it("can mark the pauses instead", () => {
    const ae = hd();
    runSteps(ae, [{ op: "kvfx.op.layer.markers", args: { target: "selection", markers: [{ time: 1.1, duration: 0.8, comment: "Silence" }] } }]);
    const marker = ae.raw("Logo").property("ADBE Marker")!;
    expect(marker.numKeys).toBe(1);
    expect(marker.keyValue(1)).toEqual({ comment: "Silence", duration: 0.8 });
  });
});

function ui(): MockAe {
  return createMockAe({
    comp: {
      width: 1920,
      height: 1080,
      frameRate: 25,
      layers: [
        { name: "KVFX Cursor", kind: "shape", selected: true },
        { name: "Card", selected: true, geometry: { sourceRect: { left: 0, top: 0, width: 400, height: 300 }, position: { x: 760, y: 390 } } },
        { name: "Wallpaper" },
      ],
    },
  });
}

describe("interface rigs", () => {
  it("Hover Lift: the cursor drives a Transform effect on the others", () => {
    const ae = ui();
    runCommand(ae, "kvfx.rig.hover", { radius: 200 });
    const card = ae.raw("Card");
    expect(card.effects.property("KVFX Hover Cursor")!.property(1)!.value).toBe(ae.raw("KVFX Cursor").index);
    const transform = card.effects.property("KVFX Hover")!;
    expect(transform.property(4)!.expression).toContain('effect("Hover Scale")');
    expect(transform.property(2)!.expression).toContain('effect("Hover Lift")');
    expect(ae.raw("KVFX Cursor").effects.property("KVFX Hover")).toBeNull();
  });

  it("Dot Pulse: a capped grid, each dot timed by its distance, behind the selected card", () => {
    expect(dotGrid(1920, 1080, 10).length).toBeLessThanOrEqual(360);
    const ae = ui();
    ae.select("Card");
    runCommand(ae, "kvfx.rig.dotpulse", { spacing: 40 });
    const dots = ae.raw("KVFX Dot Pulse");
    const groups = dots.property("ADBE Root Vectors Group")!;
    expect(groups.numProperties).toBeGreaterThan(20);
    const scale = groups.property(1)!.property("ADBE Vector Transform Group")!.property("ADBE Vector Scale")!;
    expect(scale.expression).toMatch(/var d = 1;/);
    expect(scale.expression).not.toContain("__KVFX_NOW__");
    expect(ae.stack().indexOf("KVFX Dot Pulse")).toBe(ae.stack().indexOf("Card") + 1);
  });

  it("Frosted Glass: a blurring adjustment layer under the card, matted by a hidden copy", () => {
    const ae = ui();
    ae.select("Card");
    runCommand(ae, "kvfx.rig.glass", { blur: 40, cardOpacity: 35 });
    const glass = ae.raw("KVFX Glass");
    expect(glass.adjustmentLayer).toBe(true);
    expect(glass.effects.property("KVFX Glass Blur")!.property(1)!.value).toBe(40);
    expect(glass.trackMatteType).toBe(TRACK_MATTE.alpha);
    expect(glass.trackMatteLayer?.name).toBe("KVFX Glass Matte");
    expect(glass.trackMatteLayer?.enabled).toBe(false);
    expect(ae.raw("Card").transform("ADBE Opacity").value).toBe(35);
  });

  it("Wipe Reveal: linear wipes keyed from full to clear, one layer after another", () => {
    const ae = ui();
    ae.select("Card", "Wallpaper");
    ae.comp!.time = 2;
    runCommand(ae, "kvfx.rig.wipe", { stagger: 5, duration: 10 });
    const wallpaper = ae.raw("Wallpaper").effects.property("KVFX Wipe")!.property(1)!;
    expect(wallpaper.keyTime(1)).toBeCloseTo(2.2);
    expect([wallpaper.keyValue(1), wallpaper.keyValue(2)]).toEqual([100, 0]);
  });

  it("Code Glyphs Title: a decoding headline over code lines and glyphs", () => {
    const ae = ui();
    runCommand(ae, "kvfx.rig.codeglyphs", { text: "Build it" });
    expect(ae.stack().slice(0, 3)).toEqual(["KVFX Code Headline", "KVFX Code Lines", "KVFX Glyph Field"]);
    const headline = ae.raw("KVFX Code Headline");
    expect(headline.property("ADBE Text Properties")!.property("ADBE Text Animators")!.numProperties).toBe(2);
    expect(ae.raw("KVFX Code Lines").property("ADBE Text Properties")!.property("ADBE Text Document")!.expression).toContain("var rows = 6;");
  });

  it("Input Bar: box, placeholder, typing text and send button on one null", () => {
    const ae = ui();
    runCommand(ae, "kvfx.rig.inputbar", { text: "Hello", speed: 10 });
    const bar = ae.raw("KVFX Input Bar");
    for (const name of ["KVFX Input Box", "KVFX Input Placeholder", "KVFX Input Text", "KVFX Input Send"]) {
      expect(ae.raw(name).parent).toBe(bar);
    }
    expect(ae.raw("KVFX Input Text").property("ADBE Text Properties")!.property("ADBE Text Document")!.expression).toContain("var perChar = 0.1;");
    expect(ae.raw("KVFX Input Send").transform("ADBE Scale").expression).toContain("0.75");
    expect(ae.stack().indexOf("KVFX Input Text")).toBeLessThan(ae.stack().indexOf("KVFX Input Box"));
  });
});

describe("save reminder", () => {
  it("reports how long ago the project file was written, and saves only to an existing file", () => {
    const ae = hd();
    expect(send(ae, { kind: "query", op: "kvfx.op.project.save", args: {}, budgetMs: 500 }).ok).toBe(false);
    ae.project!.file = { exists: true, fsName: "/work/promo.aep", name: "promo.aep", modified: new Date(1_000_000 - 90_000) };
    const info = send(ae, { kind: "query", op: "kvfx.op.project.info", args: {}, budgetMs: 500 });
    expect((info.result as { savedAgo: number }).savedAgo).toBe(90);
    expect(send(ae, { kind: "query", op: "kvfx.op.project.save", args: {}, budgetMs: 500 }).ok).toBe(true);
    expect(ae.project!.saveCount).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  EMPTY_SNAPSHOT,
  type CommandContext,
  type MeasuredCommand,
  type SelectedLayer,
  createProductionCommandRegistry,
} from "../src/index.js";

/**
 * The measured-command round trip: probe → host reply → plan.
 *
 * This is where the geometry maths, the decoder and the operation contract meet,
 * and it runs with no After Effects present because the host reply is just data.
 */

const registry = createProductionCommandRegistry();

function measured(id: string): MeasuredCommand {
  const command = registry.get(id);
  if (command === undefined) throw new Error(`No such command: ${id}`);
  if (command.kind !== "measured") throw new Error(`${id} is not a measured command`);
  return command;
}

function selectedLayer(id: number): SelectedLayer {
  return {
    id,
    name: `Layer ${String(id)}`,
    index: id,
    enabled: true,
    locked: false,
    shy: false,
    isAV: true,
    solo: false,
    threeD: false,
    guide: false,
    adjustment: false,
  };
}

function ctx(count: number): CommandContext {
  return {
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
        layerCount: count,
      },
      layers: Array.from({ length: count }, (_, index) => selectedLayer(index + 1)),
    },
  };
}

/** Shapes a host `kvfx.op.layer.measure` reply. */
function reply(
  layers: ReadonlyArray<{
    id: number;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    threeD?: boolean;
    parentId?: number;
    rotation?: number;
  }>,
  selectedIds?: readonly number[],
): Record<string, unknown> {
  return {
    comp: { id: 1, width: 1920, height: 1080, time: 0 },
    layers: layers.map((layer) => ({
      id: layer.id,
      name: `Layer ${String(layer.id)}`,
      sourceRect: { left: 0, top: 0, width: layer.width ?? 100, height: layer.height ?? 50 },
      anchorPoint: { x: 0, y: 0 },
      position: { x: layer.x ?? 0, y: layer.y ?? 0 },
      scale: { x: 100, y: 100 },
      rotation: layer.rotation ?? 0,
      threeD: layer.threeD ?? false,
      isAV: true,
      parentId: layer.parentId ?? null,
    })),
    selectedIds: selectedIds ?? layers.map((layer) => layer.id),
  };
}

interface TransformChange {
  readonly id: number;
  readonly position?: { x: number; y: number };
  readonly anchorPoint?: { x: number; y: number };
}

function changesFrom(plan: { steps: readonly { op: string; args: Record<string, unknown> }[] }): TransformChange[] {
  const step = plan.steps[0];
  expect(step?.op).toBe("kvfx.op.layer.setTransform");
  return (step?.args["changes"] ?? []) as TransformChange[];
}

describe("probe", () => {
  it("asks for a read-only measurement of the selection", () => {
    const probe = measured("kvfx.align.left").probe(ctx(1));
    expect(probe.op).toBe("kvfx.op.layer.measure");
    expect(probe.args).toEqual({ target: "selection" });
  });

  it("is the same probe for every measured command", () => {
    for (const command of registry.all()) {
      if (command.kind !== "measured") continue;
      expect(command.probe(ctx(1)).op).toBe("kvfx.op.layer.measure");
    }
  });
});

describe("align — auto reference", () => {
  it("aligns a single layer to the composition, leaving the other axis alone", () => {
    const plan = measured("kvfx.align.left").plan(ctx(1), reply([{ id: 1, x: 500, y: 300 }]));
    expect(changesFrom(plan)[0]).toEqual({ id: 1, position: { x: 0, y: 300 } });
  });

  it("aligns several layers to each other, not to the composition", () => {
    // Two or more layers almost always means "line these up with each other".
    const plan = measured("kvfx.align.left").plan(
      ctx(2),
      reply([
        { id: 1, x: 300 },
        { id: 2, x: 700 },
      ]),
    );
    for (const change of changesFrom(plan)) expect(change.position?.x).toBe(300);
  });
});

describe("align — explicit reference", () => {
  it("honours 'to composition' with several layers selected", () => {
    const plan = measured("kvfx.align.left.composition").plan(
      ctx(2),
      reply([
        { id: 1, x: 300 },
        { id: 2, x: 700 },
      ]),
    );
    for (const change of changesFrom(plan)) expect(change.position?.x).toBe(0);
  });

  it("honours 'to selection' with one layer selected", () => {
    const plan = measured("kvfx.align.left.selection").plan(ctx(1), reply([{ id: 1, x: 640 }]));
    expect(changesFrom(plan)[0]?.position?.x).toBe(640);
  });

  it("registers a hidden variant for each reference and edge", () => {
    for (const edge of ["left", "centrex", "right", "top", "centrey", "bottom"]) {
      for (const reference of ["composition", "selection"]) {
        const command = registry.get(`kvfx.align.${edge}.${reference}`);
        expect(command, `${edge}.${reference}`).toBeDefined();
        expect(command?.metadata.hidden).toBe(true);
      }
    }
  });
});

describe("align — layers it declines to move", () => {
  it("leaves 3D layers out of the plan", () => {
    const plan = measured("kvfx.align.left").plan(
      ctx(2),
      reply([
        { id: 1, x: 300 },
        { id: 2, x: 700, threeD: true },
      ]),
    );
    const ids = changesFrom(plan).map((change) => change.id);
    expect(ids).toEqual([1]);
  });

  it("produces no steps when every layer is declined", () => {
    // The session reports "Nothing to change" rather than sending an empty plan.
    const plan = measured("kvfx.align.left").plan(ctx(1), reply([{ id: 1, threeD: true }]));
    expect(plan.steps[0]?.args["changes"]).toEqual([]);
  });

  it("ignores a measured layer the user did not select", () => {
    // Parents travel with the measurement but must not be moved themselves.
    const plan = measured("kvfx.align.left").plan(
      ctx(1),
      reply([{ id: 1, x: 500 }, { id: 2, x: 900 }], [1]),
    );
    expect(changesFrom(plan).map((change) => change.id)).toEqual([1]);
  });
});

describe("distribute", () => {
  it("moves only the layers between the ends", () => {
    const plan = measured("kvfx.align.distribute.horizontal").plan(
      ctx(3),
      reply([
        { id: 1, x: 0 },
        { id: 2, x: 50 },
        { id: 3, x: 400 },
      ]),
    );
    const changes = changesFrom(plan);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.id).toBe(2);
    expect(changes[0]?.position?.x).toBe(200);
  });

  it("needs three layers before it is even offered", () => {
    expect(measured("kvfx.align.distribute.horizontal").canExecute(ctx(2))).toEqual({
      available: false,
      reason: "Select at least 3 layers.",
    });
    expect(measured("kvfx.align.distribute.horizontal").canExecute(ctx(3))).toEqual({
      available: true,
    });
  });
});

describe("anchor", () => {
  it("writes the anchor point and a compensating position together", () => {
    // Both in one change, so the layer never renders in an intermediate state.
    const plan = measured("kvfx.anchor.centre").plan(ctx(1), reply([{ id: 1, x: 100, y: 100 }]));
    const change = changesFrom(plan)[0];

    expect(change?.anchorPoint).toEqual({ x: 50, y: 25 });
    expect(change?.position).toEqual({ x: 150, y: 125 });
  });

  it("accounts for rotation when compensating", () => {
    const plan = measured("kvfx.anchor.centre").plan(
      ctx(1),
      reply([{ id: 1, x: 0, y: 0, rotation: 90 }]),
    );
    const change = changesFrom(plan)[0];

    // Rotated 90°, moving the anchor +50x/+25y shifts position by (-25, +50).
    expect(change?.position?.x).toBeCloseTo(-25, 6);
    expect(change?.position?.y).toBeCloseTo(50, 6);
  });

  it("registers all nine spots, visible in the palette", () => {
    const spots = [
      "topleft", "topcentre", "topright",
      "middleleft", "centre", "middleright",
      "bottomleft", "bottomcentre", "bottomright",
    ];
    for (const spot of spots) {
      const command = registry.get(`kvfx.anchor.${spot}`);
      expect(command, spot).toBeDefined();
      expect(command?.metadata.hidden).toBeUndefined();
    }
  });
});

describe("plans are well formed", () => {
  it("names the undo group after the command", () => {
    const plan = measured("kvfx.align.centrex").plan(ctx(1), reply([{ id: 1 }]));
    expect(plan.undoGroup).toBe("KVFX Tools — Align Horizontal Centre");
  });

  it("survives a malformed host reply without throwing", () => {
    // A half-updated install could return anything; the panel must not crash.
    for (const bad of [null, "nope", 42, {}, { layers: "no" }, { layers: [{ id: "x" }] }]) {
      expect(() => measured("kvfx.align.left").plan(ctx(1), bad as never)).not.toThrow();
    }
  });
});

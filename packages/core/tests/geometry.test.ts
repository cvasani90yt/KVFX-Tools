import { describe, expect, it } from "vitest";
import {
  AlignEdge,
  AnchorSpot,
  type LayerMeasurement,
  type LayerTransform,
  type Rect,
  alignLayers,
  anchorPointFor,
  distributeLayers,
  matrixFromTransform,
  measureSelection,
  moveAnchorPoints,
  transformPoint,
  transformedBounds,
  unionRects,
} from "../src/geometry/index.js";

const COMP = { compWidth: 1920, compHeight: 1080 };

function transform(overrides: Partial<LayerTransform> = {}): LayerTransform {
  return {
    anchorPoint: { x: 0, y: 0 },
    position: { x: 0, y: 0 },
    scale: { x: 100, y: 100 },
    rotation: 0,
    ...overrides,
  };
}

/** A 100×50 layer whose anchor sits at its top-left by default. */
function layer(
  id: number,
  overrides: Partial<LayerMeasurement> = {},
): LayerMeasurement {
  return {
    id,
    name: `Layer ${String(id)}`,
    sourceRect: { left: 0, top: 0, width: 100, height: 50 },
    transform: transform(),
    parentId: undefined,
    threeD: false,
    isAV: true,
    ...overrides,
  };
}

function close(actual: number, expected: number, tolerance = 1e-9): void {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
}

function boundsOf(measurement: LayerMeasurement): Rect {
  const result = measureSelection([measurement]);
  const first = result.layers[0];
  if (first === undefined) throw new Error("layer was skipped");
  return first.bounds;
}

describe("transform composition", () => {
  it("places an unrotated layer at its position", () => {
    const bounds = boundsOf(layer(1, { transform: transform({ position: { x: 200, y: 100 } }) }));
    expect(bounds).toEqual({ left: 200, top: 100, width: 100, height: 50 });
  });

  it("accounts for the anchor point", () => {
    // Anchor at the centre means position marks the centre, not the corner.
    const bounds = boundsOf(
      layer(1, {
        transform: transform({ anchorPoint: { x: 50, y: 25 }, position: { x: 200, y: 100 } }),
      }),
    );
    expect(bounds).toEqual({ left: 150, top: 75, width: 100, height: 50 });
  });

  it("accounts for scale", () => {
    const bounds = boundsOf(
      layer(1, { transform: transform({ scale: { x: 200, y: 50 }, position: { x: 10, y: 10 } }) }),
    );
    expect(bounds).toEqual({ left: 10, top: 10, width: 200, height: 25 });
  });

  it("produces an axis-aligned box for a rotated layer", () => {
    // A 100×50 layer rotated 90° occupies a 50×100 box.
    const bounds = boundsOf(
      layer(1, { transform: transform({ rotation: 90, anchorPoint: { x: 50, y: 25 }, position: { x: 0, y: 0 } }) }),
    );
    close(bounds.width, 50);
    close(bounds.height, 100);
  });

  it("composes a parent chain", () => {
    const parent = layer(1, { transform: transform({ position: { x: 100, y: 100 } }) });
    const child = layer(2, { parentId: 1, transform: transform({ position: { x: 10, y: 20 } }) });

    const measured = measureSelection([child], [parent, child]);
    expect(measured.layers[0]?.bounds.left).toBe(110);
    expect(measured.layers[0]?.bounds.top).toBe(120);
  });

  it("composes a parent's scale into the child's bounds", () => {
    const parent = layer(1, { transform: transform({ scale: { x: 200, y: 200 } }) });
    const child = layer(2, { parentId: 1, transform: transform({ position: { x: 10, y: 10 } }) });

    const measured = measureSelection([child], [parent, child]);
    expect(measured.layers[0]?.bounds).toEqual({ left: 20, top: 20, width: 200, height: 100 });
  });

  it("does not hang on a parent cycle", () => {
    const a = layer(1, { parentId: 2 });
    const b = layer(2, { parentId: 1 });
    expect(() => measureSelection([a, b], [a, b])).not.toThrow();
  });

  it("ignores a parent that is not in the project", () => {
    const orphan = layer(1, { parentId: 99, transform: transform({ position: { x: 5, y: 5 } }) });
    expect(boundsOf(orphan).left).toBe(5);
  });
});

describe("measureSelection — what it declines to touch", () => {
  it("skips 3D layers rather than mis-positioning them", () => {
    const result = measureSelection([layer(1, { threeD: true })]);
    expect(result.layers).toEqual([]);
    expect(result.skipped[0]?.reason).toMatch(/3D/);
  });

  it("skips cameras and lights", () => {
    expect(measureSelection([layer(1, { isAV: false })]).skipped[0]?.reason).toMatch(/Cameras/);
  });

  it("skips a layer with no bounds", () => {
    const empty = layer(1, { sourceRect: { left: 0, top: 0, width: 0, height: 0 } });
    expect(measureSelection([empty]).skipped[0]?.reason).toMatch(/no visible bounds/);
  });
});

describe("alignLayers — to the composition", () => {
  const at = (x: number, y: number, id = 1): LayerMeasurement =>
    layer(id, { transform: transform({ position: { x, y } }) });

  it("aligns left, right and horizontal centre", () => {
    const cases: ReadonlyArray<readonly [AlignEdge, number]> = [
      [AlignEdge.Left, 0],
      [AlignEdge.Right, 1820],
      [AlignEdge.CentreX, 910],
    ];
    for (const [edge, expected] of cases) {
      const result = alignLayers({ measurements: [at(500, 500)], edge, reference: "composition", ...COMP });
      close(result.changes[0]?.position.x ?? Number.NaN, expected);
    }
  });

  it("aligns top, bottom and vertical centre", () => {
    const cases: ReadonlyArray<readonly [AlignEdge, number]> = [
      [AlignEdge.Top, 0],
      [AlignEdge.Bottom, 1030],
      [AlignEdge.CentreY, 515],
    ];
    for (const [edge, expected] of cases) {
      const result = alignLayers({ measurements: [at(500, 500)], edge, reference: "composition", ...COMP });
      close(result.changes[0]?.position.y ?? Number.NaN, expected);
    }
  });

  it("moves only the axis it was asked to", () => {
    const result = alignLayers({
      measurements: [at(500, 500)],
      edge: AlignEdge.Left,
      reference: "composition",
      ...COMP,
    });
    expect(result.changes[0]?.position.y).toBe(500);
  });

  it("is idempotent", () => {
    const first = alignLayers({ measurements: [at(500, 500)], edge: AlignEdge.CentreX, reference: "composition", ...COMP });
    const moved = at(first.changes[0]?.position.x ?? 0, 500);
    const second = alignLayers({ measurements: [moved], edge: AlignEdge.CentreX, reference: "composition", ...COMP });
    close(second.changes[0]?.position.x ?? Number.NaN, first.changes[0]?.position.x ?? Number.NaN);
  });

  it("accounts for the anchor point when centring", () => {
    // Centre-anchored, the resulting position is the comp centre itself.
    const centred = layer(1, {
      transform: transform({ anchorPoint: { x: 50, y: 25 }, position: { x: 500, y: 500 } }),
    });
    const result = alignLayers({ measurements: [centred], edge: AlignEdge.CentreX, reference: "composition", ...COMP });
    close(result.changes[0]?.position.x ?? Number.NaN, 960);
  });

  it("accounts for scale", () => {
    const scaled = layer(1, { transform: transform({ scale: { x: 200, y: 100 }, position: { x: 0, y: 0 } }) });
    const result = alignLayers({ measurements: [scaled], edge: AlignEdge.Right, reference: "composition", ...COMP });
    // 100 wide at 200% is 200 wide, so its left edge lands at 1720.
    close(result.changes[0]?.position.x ?? Number.NaN, 1720);
  });
});

describe("alignLayers — parented layers", () => {
  it("converts the correction through a translated parent", () => {
    const parent = layer(1, { transform: transform({ position: { x: 300, y: 0 } }) });
    const child = layer(2, { parentId: 1, transform: transform({ position: { x: 0, y: 0 } }) });

    const result = alignLayers({
      measurements: [child],
      context: [parent, child],
      edge: AlignEdge.Left,
      reference: "composition",
      ...COMP,
    });

    // The child sits at comp x=300 and must reach 0, so its parent-space
    // position becomes -300.
    close(result.changes[0]?.position.x ?? Number.NaN, -300);
  });

  it("converts the correction through a scaled parent", () => {
    // This is the case that breaks naive implementations: a composition-space
    // delta added straight to position is wrong by the parent's scale factor.
    const parent = layer(1, { transform: transform({ scale: { x: 200, y: 200 } }) });
    const child = layer(2, { parentId: 1, transform: transform({ position: { x: 100, y: 0 } }) });

    const result = alignLayers({
      measurements: [child],
      context: [parent, child],
      edge: AlignEdge.Left,
      reference: "composition",
      ...COMP,
    });

    // Child renders at comp x=200; it must move -200 in comp space, which is
    // -100 in the parent's doubled space.
    close(result.changes[0]?.position.x ?? Number.NaN, 0);
  });

  it("converts the correction through a rotated parent", () => {
    const parent = layer(1, { transform: transform({ rotation: 90 }) });
    const child = layer(2, { parentId: 1, transform: transform({ position: { x: 0, y: 0 } }) });

    const result = alignLayers({
      measurements: [child],
      context: [parent, child],
      edge: AlignEdge.Left,
      reference: "composition",
      ...COMP,
    });

    // Verify by replaying the transform rather than asserting a magic number.
    const moved: LayerMeasurement = {
      ...child,
      transform: { ...child.transform, position: result.changes[0]?.position ?? { x: 0, y: 0 } },
    };
    const after = measureSelection([moved], [parent, moved]);
    close(after.layers[0]?.bounds.left ?? Number.NaN, 0, 1e-6);
  });

  it("skips a layer whose parent is scaled to zero", () => {
    const parent = layer(1, { transform: transform({ scale: { x: 0, y: 0 } }) });
    const child = layer(2, { parentId: 1 });

    const result = alignLayers({
      measurements: [child],
      context: [parent, child],
      edge: AlignEdge.Left,
      reference: "composition",
      ...COMP,
    });

    expect(result.changes).toEqual([]);
    expect(result.skipped[0]?.reason).toMatch(/scaled to zero/);
  });
});

describe("alignLayers — to the selection", () => {
  it("aligns to the selection's own bounding box", () => {
    const a = layer(1, { transform: transform({ position: { x: 100, y: 0 } }) });
    const b = layer(2, { transform: transform({ position: { x: 500, y: 0 } }) });

    const result = alignLayers({ measurements: [a, b], edge: AlignEdge.Left, reference: "selection", ...COMP });
    for (const change of result.changes) close(change.position.x, 100);
  });

  it("leaves a single layer where it is", () => {
    const only = layer(1, { transform: transform({ position: { x: 640, y: 360 } }) });
    const result = alignLayers({ measurements: [only], edge: AlignEdge.CentreX, reference: "selection", ...COMP });
    close(result.changes[0]?.position.x ?? Number.NaN, 640);
  });
});

describe("distributeLayers", () => {
  const row = (positions: readonly number[]): LayerMeasurement[] =>
    positions.map((x, index) => layer(index + 1, { transform: transform({ position: { x, y: 0 } }) }));

  it("spaces centres evenly and leaves the ends alone", () => {
    const result = distributeLayers({ measurements: row([0, 50, 400]), axis: "horizontal" });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.id).toBe(2);
    close(result.changes[0]?.position.x ?? Number.NaN, 200);
  });

  it("works regardless of the order layers were selected in", () => {
    const shuffled = [row([0, 50, 400])[2], row([0, 50, 400])[0], row([0, 50, 400])[1]].filter(
      (entry): entry is LayerMeasurement => entry !== undefined,
    );
    const result = distributeLayers({ measurements: shuffled, axis: "horizontal" });
    expect(result.changes[0]?.id).toBe(2);
    close(result.changes[0]?.position.x ?? Number.NaN, 200);
  });

  it("is idempotent", () => {
    const first = distributeLayers({ measurements: row([0, 50, 400]), axis: "horizontal" });
    const settled = row([0, first.changes[0]?.position.x ?? 0, 400]);
    const second = distributeLayers({ measurements: settled, axis: "horizontal" });
    close(second.changes[0]?.position.x ?? Number.NaN, first.changes[0]?.position.x ?? Number.NaN);
  });

  it("does nothing with fewer than three layers", () => {
    expect(distributeLayers({ measurements: row([0, 100]), axis: "horizontal" }).changes).toEqual([]);
  });

  it("distributes vertically", () => {
    const column = [0, 10, 300].map((y, index) =>
      layer(index + 1, { transform: transform({ position: { x: 0, y } }) }),
    );
    const result = distributeLayers({ measurements: column, axis: "vertical" });
    close(result.changes[0]?.position.y ?? Number.NaN, 150);
  });
});

describe("anchorPointFor", () => {
  const rect: Rect = { left: -50, top: -25, width: 100, height: 50 };

  it("maps each of the nine spots", () => {
    expect(anchorPointFor(rect, AnchorSpot.TopLeft)).toEqual({ x: -50, y: -25 });
    expect(anchorPointFor(rect, AnchorSpot.Centre)).toEqual({ x: 0, y: 0 });
    expect(anchorPointFor(rect, AnchorSpot.BottomRight)).toEqual({ x: 50, y: 25 });
    expect(anchorPointFor(rect, AnchorSpot.TopCentre)).toEqual({ x: 0, y: -25 });
    expect(anchorPointFor(rect, AnchorSpot.MiddleLeft)).toEqual({ x: -50, y: 0 });
  });

  it("respects a source rect that does not start at the origin", () => {
    expect(anchorPointFor({ left: 10, top: 20, width: 100, height: 50 }, AnchorSpot.Centre)).toEqual({
      x: 60,
      y: 45,
    });
  });
});

describe("moveAnchorPoints — the layer must not appear to move", () => {
  function rendersIdentically(measurement: LayerMeasurement, spot: AnchorSpot): void {
    const before = boundsOf(measurement);
    const change = moveAnchorPoints([measurement], spot).changes[0];
    if (change === undefined) throw new Error("no change produced");

    const after = boundsOf({
      ...measurement,
      transform: { ...measurement.transform, anchorPoint: change.anchorPoint, position: change.position },
    });

    close(after.left, before.left, 1e-6);
    close(after.top, before.top, 1e-6);
    close(after.width, before.width, 1e-6);
    close(after.height, before.height, 1e-6);
  }

  it("holds a plain layer still", () => {
    rendersIdentically(layer(1, { transform: transform({ position: { x: 300, y: 200 } }) }), AnchorSpot.Centre);
  });

  it("holds a scaled layer still", () => {
    rendersIdentically(
      layer(1, { transform: transform({ scale: { x: 250, y: 80 }, position: { x: 300, y: 200 } }) }),
      AnchorSpot.Centre,
    );
  });

  it("holds a rotated layer still", () => {
    // Ignoring rotation here is what makes rotated layers jump.
    rendersIdentically(
      layer(1, { transform: transform({ rotation: 37, position: { x: 300, y: 200 } }) }),
      AnchorSpot.BottomRight,
    );
  });

  it("holds a rotated and scaled layer still, for every spot", () => {
    const spots = Object.values(AnchorSpot);
    for (const spot of spots) {
      rendersIdentically(
        layer(1, {
          transform: transform({ rotation: -120, scale: { x: 140, y: 60 }, position: { x: 800, y: 400 } }),
        }),
        spot,
      );
    }
  });

  it("sets the anchor to the requested spot", () => {
    const change = moveAnchorPoints([layer(1)], AnchorSpot.Centre).changes[0];
    expect(change?.anchorPoint).toEqual({ x: 50, y: 25 });
  });

  it("skips layers with no bounds", () => {
    const empty = layer(1, { sourceRect: { left: 0, top: 0, width: 0, height: 0 } });
    expect(moveAnchorPoints([empty], AnchorSpot.Centre).skipped[0]?.reason).toMatch(/no visible bounds/);
  });
});

describe("helpers", () => {
  it("unions rectangles", () => {
    expect(
      unionRects([
        { left: 0, top: 0, width: 10, height: 10 },
        { left: 20, top: 5, width: 10, height: 10 },
      ]),
    ).toEqual({ left: 0, top: 0, width: 30, height: 15 });
  });

  it("returns undefined for an empty union", () => {
    expect(unionRects([])).toBeUndefined();
  });

  it("round-trips a point through a transform", () => {
    const matrix = matrixFromTransform(transform({ position: { x: 5, y: 5 } }));
    expect(transformPoint(matrix, { x: 1, y: 2 })).toEqual({ x: 6, y: 7 });
  });

  it("bounds an unrotated rect exactly", () => {
    expect(transformedBounds(matrixFromTransform(transform()), { left: 1, top: 2, width: 3, height: 4 })).toEqual({
      left: 1,
      top: 2,
      width: 3,
      height: 4,
    });
  });
});

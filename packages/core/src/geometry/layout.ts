import {
  IDENTITY,
  type LayerTransform,
  type Matrix2D,
  type Rect,
  type Vec2,
  invertLinear,
  matrixFromTransform,
  multiply,
  rectBottom,
  rectCentre,
  rectRight,
  transformVector,
  transformedBounds,
  unionRects,
} from "./matrix.js";

/** What the host reports for one layer so the panel can position it. */
export interface LayerMeasurement {
  readonly id: number;
  readonly name: string;
  /** `sourceRectAtTime`, in the layer's own space. */
  readonly sourceRect: Rect;
  readonly transform: LayerTransform;
  /** Parent layer id, when the layer is parented. */
  readonly parentId: number | undefined;
  readonly threeD: boolean;
  /** False for cameras and lights, which have no bounds to align. */
  readonly isAV: boolean;
}

export interface LayerBounds {
  readonly id: number;
  readonly name: string;
  /** Axis-aligned bounds in composition space. */
  readonly bounds: Rect;
  /** Parent's layer-to-composition matrix; identity when unparented. */
  readonly parentWorld: Matrix2D;
}

export interface SkippedLayer {
  readonly id: number;
  readonly name: string;
  readonly reason: string;
}

export interface MeasuredSelection {
  readonly layers: readonly LayerBounds[];
  readonly skipped: readonly SkippedLayer[];
}

const MAX_PARENT_DEPTH = 32;

/** Two layers have nothing between the ends to space out. */
const MIN_LAYERS_TO_DISTRIBUTE = 3;

/**
 * Composes a layer's transform up its parent chain.
 *
 * Depth-limited rather than trusting the project: After Effects will not create
 * a parent cycle, but a malformed measurement set should not hang the panel.
 */
function worldMatrix(
  byId: ReadonlyMap<number, LayerMeasurement>,
  layer: LayerMeasurement,
  depth = 0,
): Matrix2D {
  const local = matrixFromTransform(layer.transform);
  if (layer.parentId === undefined || depth >= MAX_PARENT_DEPTH) return local;

  const parent = byId.get(layer.parentId);
  if (parent === undefined) return local;

  return multiply(worldMatrix(byId, parent, depth + 1), local);
}

function parentWorldMatrix(
  byId: ReadonlyMap<number, LayerMeasurement>,
  layer: LayerMeasurement,
): Matrix2D {
  if (layer.parentId === undefined) return IDENTITY;
  const parent = byId.get(layer.parentId);
  return parent === undefined ? IDENTITY : worldMatrix(byId, parent);
}

/**
 * Converts measurements into composition-space bounds.
 *
 * Layers we cannot place correctly are **skipped with a reason** rather than
 * approximated. Silently mis-positioning a 3D layer would be worse than
 * declining to touch it — see ADR-0007 on reporting rather than guessing.
 */
export function measureSelection(
  measurements: readonly LayerMeasurement[],
  context: readonly LayerMeasurement[] = measurements,
): MeasuredSelection {
  // Parents may be outside the selection, so the chain resolves against every
  // layer the host reported, not just the selected ones.
  const byId = new Map<number, LayerMeasurement>();
  for (const entry of context) byId.set(entry.id, entry);
  for (const entry of measurements) byId.set(entry.id, entry);

  const layers: LayerBounds[] = [];
  const skipped: SkippedLayer[] = [];

  for (const layer of measurements) {
    if (!layer.isAV) {
      skipped.push({ id: layer.id, name: layer.name, reason: "Cameras and lights have no bounds" });
      continue;
    }
    if (layer.threeD) {
      skipped.push({ id: layer.id, name: layer.name, reason: "3D layers are not supported yet" });
      continue;
    }
    if (layer.sourceRect.width === 0 && layer.sourceRect.height === 0) {
      skipped.push({ id: layer.id, name: layer.name, reason: "Layer has no visible bounds" });
      continue;
    }

    layers.push({
      id: layer.id,
      name: layer.name,
      bounds: transformedBounds(worldMatrix(byId, layer), layer.sourceRect),
      parentWorld: parentWorldMatrix(byId, layer),
    });
  }

  return { layers, skipped };
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

export const AlignEdge = {
  Left: "left",
  CentreX: "centreX",
  Right: "right",
  Top: "top",
  CentreY: "centreY",
  Bottom: "bottom",
} as const;

export type AlignEdge = (typeof AlignEdge)[keyof typeof AlignEdge];

/** Composition-space displacement needed to align `bounds` to `reference`. */
function alignDelta(bounds: Rect, reference: Rect, edge: AlignEdge): Vec2 {
  switch (edge) {
    case AlignEdge.Left:
      return { x: reference.left - bounds.left, y: 0 };
    case AlignEdge.Right:
      return { x: rectRight(reference) - rectRight(bounds), y: 0 };
    case AlignEdge.CentreX:
      return { x: rectCentre(reference).x - rectCentre(bounds).x, y: 0 };
    case AlignEdge.Top:
      return { x: 0, y: reference.top - bounds.top };
    case AlignEdge.Bottom:
      return { x: 0, y: rectBottom(reference) - rectBottom(bounds) };
    case AlignEdge.CentreY:
      return { x: 0, y: rectCentre(reference).y - rectCentre(bounds).y };
  }
}

export interface PositionChange {
  readonly id: number;
  /** New value for the layer's `position`, in its own parent space. */
  readonly position: Vec2;
}

export interface LayoutResult {
  readonly changes: readonly PositionChange[];
  readonly skipped: readonly SkippedLayer[];
}

/**
 * Converts a composition-space displacement into a new `position` value.
 *
 * `position` lives in the parent's coordinate space, so the correction has to
 * come back through the inverse of the parent's rotation and scale. Adding the
 * composition-space delta directly is the classic bug: it looks right until
 * someone aligns a layer parented to a rotated null.
 */
function applyDelta(layer: LayerBounds, transform: LayerTransform, delta: Vec2): Vec2 | undefined {
  const inverse = invertLinear(layer.parentWorld);
  if (inverse === undefined) return undefined;

  const local = transformVector(inverse, delta);
  return { x: transform.position.x + local.x, y: transform.position.y + local.y };
}

export interface AlignOptions {
  readonly measurements: readonly LayerMeasurement[];
  readonly edge: AlignEdge;
  /** Align to the composition, or to the selection's own bounding box. */
  readonly reference: "composition" | "selection";
  readonly compWidth: number;
  readonly compHeight: number;
  /** Every layer in the composition, so parent chains resolve. */
  readonly context?: readonly LayerMeasurement[];
}

export function alignLayers(options: AlignOptions): LayoutResult {
  const measured = measureSelection(options.measurements, options.context ?? options.measurements);
  const byId = new Map(options.measurements.map((entry) => [entry.id, entry]));

  const reference =
    options.reference === "composition"
      ? { left: 0, top: 0, width: options.compWidth, height: options.compHeight }
      : unionRects(measured.layers.map((entry) => entry.bounds));

  if (reference === undefined) return { changes: [], skipped: measured.skipped };

  const changes: PositionChange[] = [];
  const skipped: SkippedLayer[] = [...measured.skipped];

  for (const layer of measured.layers) {
    const measurement = byId.get(layer.id);
    if (measurement === undefined) continue;

    const position = applyDelta(layer, measurement.transform, alignDelta(layer.bounds, reference, options.edge));
    if (position === undefined) {
      skipped.push({ id: layer.id, name: layer.name, reason: "Layer or its parent is scaled to zero" });
      continue;
    }
    changes.push({ id: layer.id, position });
  }

  return { changes, skipped };
}

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

export type DistributeAxis = "horizontal" | "vertical";

/**
 * Spaces layer **centres** evenly between the outermost two.
 *
 * Centres rather than gaps: with mixed layer sizes, even gaps and even centres
 * disagree, and even centres is the behaviour people expect from a row of
 * differently-sized elements. The two outermost layers never move, so the
 * operation is stable when repeated.
 */
export function distributeLayers(options: {
  readonly measurements: readonly LayerMeasurement[];
  readonly axis: DistributeAxis;
  readonly context?: readonly LayerMeasurement[];
}): LayoutResult {
  const measured = measureSelection(options.measurements, options.context ?? options.measurements);
  const byId = new Map(options.measurements.map((entry) => [entry.id, entry]));
  const horizontal = options.axis === "horizontal";

  // Fewer than three layers have nothing between the ends to distribute.
  if (measured.layers.length < MIN_LAYERS_TO_DISTRIBUTE) return { changes: [], skipped: measured.skipped };

  const ordered = [...measured.layers].sort((first, second) => {
    const a = rectCentre(first.bounds);
    const b = rectCentre(second.bounds);
    return horizontal ? a.x - b.x : a.y - b.y;
  });

  const first = ordered[0] as LayerBounds;
  const last = ordered[ordered.length - 1] as LayerBounds;
  const start = horizontal ? rectCentre(first.bounds).x : rectCentre(first.bounds).y;
  const end = horizontal ? rectCentre(last.bounds).x : rectCentre(last.bounds).y;
  const step = (end - start) / (ordered.length - 1);

  const changes: PositionChange[] = [];
  const skipped: SkippedLayer[] = [...measured.skipped];

  for (let index = 1; index < ordered.length - 1; index += 1) {
    const layer = ordered[index] as LayerBounds;
    const measurement = byId.get(layer.id);
    if (measurement === undefined) continue;

    const centre = rectCentre(layer.bounds);
    const target = start + step * index;
    const delta = horizontal ? { x: target - centre.x, y: 0 } : { x: 0, y: target - centre.y };

    const position = applyDelta(layer, measurement.transform, delta);
    if (position === undefined) {
      skipped.push({ id: layer.id, name: layer.name, reason: "Layer or its parent is scaled to zero" });
      continue;
    }
    changes.push({ id: layer.id, position });
  }

  return { changes, skipped };
}

// ---------------------------------------------------------------------------
// Anchor point
// ---------------------------------------------------------------------------

export const AnchorSpot = {
  TopLeft: "topLeft",
  TopCentre: "topCentre",
  TopRight: "topRight",
  MiddleLeft: "middleLeft",
  Centre: "centre",
  MiddleRight: "middleRight",
  BottomLeft: "bottomLeft",
  BottomCentre: "bottomCentre",
  BottomRight: "bottomRight",
} as const;

export type AnchorSpot = (typeof AnchorSpot)[keyof typeof AnchorSpot];

const HORIZONTAL_FACTOR: Readonly<Record<AnchorSpot, number>> = {
  topLeft: 0,
  middleLeft: 0,
  bottomLeft: 0,
  topCentre: 0.5,
  centre: 0.5,
  bottomCentre: 0.5,
  topRight: 1,
  middleRight: 1,
  bottomRight: 1,
};

const VERTICAL_FACTOR: Readonly<Record<AnchorSpot, number>> = {
  topLeft: 0,
  topCentre: 0,
  topRight: 0,
  middleLeft: 0.5,
  centre: 0.5,
  middleRight: 0.5,
  bottomLeft: 1,
  bottomCentre: 1,
  bottomRight: 1,
};

/** The anchor point, in layer space, for a named spot on the layer's bounds. */
export function anchorPointFor(sourceRect: Rect, spot: AnchorSpot): Vec2 {
  return {
    x: sourceRect.left + sourceRect.width * HORIZONTAL_FACTOR[spot],
    y: sourceRect.top + sourceRect.height * VERTICAL_FACTOR[spot],
  };
}

export interface AnchorChange {
  readonly id: number;
  readonly anchorPoint: Vec2;
  /** Compensating position, so the layer does not appear to move. */
  readonly position: Vec2;
}

export interface AnchorResult {
  readonly changes: readonly AnchorChange[];
  readonly skipped: readonly SkippedLayer[];
}

/**
 * Moves the anchor point without moving the layer on screen.
 *
 * A layer point renders at `position + R·S·(p − anchor)`, so holding that fixed
 * while the anchor changes gives `position' = position + R·S·(anchor' − anchor)`.
 * Rotation and scale are part of it: skipping them is why naïvely-written anchor
 * tools make rotated layers jump.
 */
export function moveAnchorPoints(
  measurements: readonly LayerMeasurement[],
  spot: AnchorSpot,
): AnchorResult {
  const changes: AnchorChange[] = [];
  const skipped: SkippedLayer[] = [];

  for (const layer of measurements) {
    if (!layer.isAV) {
      skipped.push({ id: layer.id, name: layer.name, reason: "Cameras and lights have no anchor bounds" });
      continue;
    }
    if (layer.sourceRect.width === 0 && layer.sourceRect.height === 0) {
      skipped.push({ id: layer.id, name: layer.name, reason: "Layer has no visible bounds" });
      continue;
    }

    const target = anchorPointFor(layer.sourceRect, spot);
    const current = layer.transform.anchorPoint;
    const local = matrixFromTransform(layer.transform);
    const shift = transformVector(local, { x: target.x - current.x, y: target.y - current.y });

    changes.push({
      id: layer.id,
      anchorPoint: target,
      position: {
        x: layer.transform.position.x + shift.x,
        y: layer.transform.position.y + shift.y,
      },
    });
  }

  return { changes, skipped };
}

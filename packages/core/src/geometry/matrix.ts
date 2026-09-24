/**
 * 2D affine transforms.
 *
 * After Effects composes a layer's transform as
 * `translate(position) · rotate(rotation) · scale(scale) · translate(-anchor)`,
 * and a parented layer's `position` is expressed in its **parent's** coordinate
 * space, not the composition's. Aligning a layer therefore means measuring in
 * composition space and then converting the correction back through the parent
 * chain — which is exactly what makes "just add the delta to position" wrong for
 * any layer that is parented, rotated or scaled.
 *
 * Pure maths, no host dependency, so every case above is unit-tested.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * A rectangle in the convention After Effects uses for `sourceRectAtTime`:
 * `left`/`top` may be negative, and the origin is the layer's own space.
 */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Row-major affine matrix mapping `(x, y)` to
 * `(a·x + c·y + tx, b·x + d·y + ty)`.
 */
export interface Matrix2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export const IDENTITY: Matrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

const HALF_TURN_DEGREES = 180;
const DEGREES_TO_RADIANS = Math.PI / HALF_TURN_DEGREES;
const PERCENT = 100;

/** `first` then `second` — i.e. `second · first`. */
export function multiply(second: Matrix2D, first: Matrix2D): Matrix2D {
  return {
    a: second.a * first.a + second.c * first.b,
    b: second.b * first.a + second.d * first.b,
    c: second.a * first.c + second.c * first.d,
    d: second.b * first.c + second.d * first.d,
    tx: second.a * first.tx + second.c * first.ty + second.tx,
    ty: second.b * first.tx + second.d * first.ty + second.ty,
  };
}

export function transformPoint(matrix: Matrix2D, point: Vec2): Vec2 {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
}

/**
 * Transforms a direction, ignoring translation.
 *
 * A correction computed in composition space is a *displacement*, so it must not
 * pick up the parent's offset when converted — only its rotation and scale.
 */
export function transformVector(matrix: Matrix2D, vector: Vec2): Vec2 {
  return {
    x: matrix.a * vector.x + matrix.c * vector.y,
    y: matrix.b * vector.x + matrix.d * vector.y,
  };
}

export interface LayerTransform {
  readonly anchorPoint: Vec2;
  /** In the parent's coordinate space, or the composition's when unparented. */
  readonly position: Vec2;
  /** Percent, as After Effects reports it. */
  readonly scale: Vec2;
  /** Degrees. */
  readonly rotation: number;
}

/** Builds the layer-to-parent matrix After Effects uses. */
export function matrixFromTransform(transform: LayerTransform): Matrix2D {
  const radians = transform.rotation * DEGREES_TO_RADIANS;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const sx = transform.scale.x / PERCENT;
  const sy = transform.scale.y / PERCENT;

  // translate(position) · rotate · scale · translate(-anchor)
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;

  return {
    a,
    b,
    c,
    d,
    tx: transform.position.x - (a * transform.anchorPoint.x + c * transform.anchorPoint.y),
    ty: transform.position.y - (b * transform.anchorPoint.x + d * transform.anchorPoint.y),
  };
}

/**
 * Inverts the linear part (rotation and scale), discarding translation.
 *
 * Returns `undefined` when the matrix is singular — a layer scaled to zero on an
 * axis has no invertible transform, and guessing would place it arbitrarily.
 */
export function invertLinear(matrix: Matrix2D): Matrix2D | undefined {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (determinant === 0 || !Number.isFinite(determinant)) return undefined;

  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    tx: 0,
    ty: 0,
  };
}

/** Axis-aligned bounding box of `rect` after `matrix`. */
export function transformedBounds(matrix: Matrix2D, rect: Rect): Rect {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;

  const corners = [
    transformPoint(matrix, { x: rect.left, y: rect.top }),
    transformPoint(matrix, { x: right, y: rect.top }),
    transformPoint(matrix, { x: right, y: bottom }),
    transformPoint(matrix, { x: rect.left, y: bottom }),
  ];

  let minX = corners[0]?.x ?? 0;
  let maxX = minX;
  let minY = corners[0]?.y ?? 0;
  let maxY = minY;

  for (const corner of corners) {
    if (corner.x < minX) minX = corner.x;
    if (corner.x > maxX) maxX = corner.x;
    if (corner.y < minY) minY = corner.y;
    if (corner.y > maxY) maxY = corner.y;
  }

  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

export function rectRight(rect: Rect): number {
  return rect.left + rect.width;
}

export function rectBottom(rect: Rect): number {
  return rect.top + rect.height;
}

export function rectCentre(rect: Rect): Vec2 {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Smallest rectangle containing all of `rects`. */
export function unionRects(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const rect of rects) {
    if (rect.left < left) left = rect.left;
    if (rect.top < top) top = rect.top;
    if (rectRight(rect) > right) right = rectRight(rect);
    if (rectBottom(rect) > bottom) bottom = rectBottom(rect);
  }

  return { left, top, width: right - left, height: bottom - top };
}

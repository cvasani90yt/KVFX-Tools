import { isArray } from "../../runtime/es3.js";
import { hostError } from "../../runtime/errors.js";
import { ErrorCode } from "../../runtime/protocol.js";
import type { Operation, OperationContext } from "../../runtime/registry.js";
import type { HostJson } from "../../runtime/serialize.js";
import { layerById, requireComp, skipped } from "../raw.js";

/**
 * Moves layers by a displacement, keyframes and all.
 *
 * `layer.setTransform` writes an absolute position and so has to refuse
 * animated layers: there is no single right value to write. A displacement
 * has no such problem — adding the same offset to every keyframe moves the
 * whole animation without changing its timing, easing or path shape (spatial
 * tangents are relative to their keys, so they come along unchanged). That
 * is what lets the selection move "as a group" with its animation intact.
 *
 * Each change is `{ id, dx, dy }`, in the layer's own parent space; the maths
 * converting from composition space lives in `@kvfx/core`.
 */

const POSITION = "ADBE Position";
const TRANSFORM = "ADBE Transform Group";
const EPSILON = 1e-9;

interface Offset {
  readonly layer: AeRawLayer;
  readonly dx: number;
  readonly dy: number;
}

function shifted(value: unknown, dx: number, dy: number): unknown {
  if (!isArray(value)) return value;
  const list = value as number[];
  const out: number[] = [];
  for (let i = 0; i < list.length; i += 1) out[i] = list[i] as number;
  out[0] = (out[0] as number) + dx;
  if (out.length > 1) out[1] = (out[1] as number) + dy;
  return out;
}

/** Adds `delta` to a one-dimensional property, static or keyed. */
function shiftScalar(prop: AeRawProp, delta: number): void {
  if (Math.abs(delta) < EPSILON) return;
  if (prop.numKeys > 0) {
    for (let k = 1; k <= prop.numKeys; k += 1) prop.setValueAtKey(k, (prop.keyValue(k) as number) + delta);
  } else {
    prop.setValue((prop.value as number) + delta);
  }
}

function shiftPosition(layer: AeRawLayer, dx: number, dy: number): void {
  const transform = layer.property(TRANSFORM);
  if (!transform) return;
  const position = transform.property(POSITION);
  if (!position) return;

  if (position.dimensionsSeparated === true) {
    const x = transform.property("ADBE Position_0");
    const y = transform.property("ADBE Position_1");
    if (x) shiftScalar(x, dx);
    if (y) shiftScalar(y, dy);
    return;
  }
  if (position.numKeys > 0) {
    for (let k = 1; k <= position.numKeys; k += 1) {
      position.setValueAtKey(k, shifted(position.keyValue(k), dx, dy));
    }
    return;
  }
  position.setValue(shifted(position.value, dx, dy));
}

export const offsetPositionOperation: Operation = {
  id: "kvfx.op.layer.offsetPosition",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const raw = ctx.args["changes"];
    if (!isArray(raw)) throw hostError(ErrorCode.InvalidArgument, "changes must be an array.");
    const list = raw as HostJson[];

    // Everything is validated before anything moves, so a malformed change
    // late in the list cannot leave the group half-moved.
    const pending: Offset[] = [];
    const skips: HostJson[] = [];
    const missing: number[] = [];
    for (let i = 0; i < list.length; i += 1) {
      const entry = list[i];
      if (!entry || typeof entry !== "object" || isArray(entry)) {
        throw hostError(ErrorCode.InvalidArgument, "Change " + String(i) + " is not an object.");
      }
      const bag = entry as { [key: string]: HostJson };
      const id = bag["id"];
      const dx = bag["dx"];
      const dy = bag["dy"];
      if (typeof id !== "number" || typeof dx !== "number" || typeof dy !== "number" || !isFinite(dx) || !isFinite(dy)) {
        throw hostError(ErrorCode.InvalidArgument, "Change " + String(i) + " needs an id, dx and dy.");
      }
      const layer = layerById(comp, id);
      if (!layer) {
        missing[missing.length] = id;
        continue;
      }
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      pending[pending.length] = { layer: layer, dx: dx, dy: dy };
    }

    let changed = 0;
    for (let i = 0; i < pending.length; i += 1) {
      const change = pending[i] as Offset;
      if (Math.abs(change.dx) < EPSILON && Math.abs(change.dy) < EPSILON) continue;
      shiftPosition(change.layer, change.dx, change.dy);
      changed += 1;
    }

    return {
      changedCount: changed,
      skipped: skips as unknown as HostJson,
      missingIds: missing as unknown as HostJson,
    };
  },
};

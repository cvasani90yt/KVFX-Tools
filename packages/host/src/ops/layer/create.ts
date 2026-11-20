import { isArray } from "../../runtime/es3.js";
import { hostError, labelOf } from "../../runtime/errors.js";
import { ErrorCode } from "../../runtime/protocol.js";
import type { Operation, OperationContext } from "../../runtime/registry.js";
import type { HostJson } from "../../runtime/serialize.js";
import { readColor, readString, requireComp, skipped, targets } from "../raw.js";

/**
 * Creates a layer.
 *
 * New layers land at the top of the stack, which is what After Effects does on
 * its own and therefore what users already expect. Inserting above the
 * selection instead would be cleverer and less predictable.
 *
 * Returns the new layer's `id`, so a plan can `bind` it and keep working on it
 * in later steps.
 */

const ADJUSTMENT_LAYER_NAME = "Adjustment Layer";
const SOLID_LAYER_NAME = "Solid";
const CAMERA_NAME = "Camera";
const DEFAULT_TEXT = "Text";
const WHITE: [number, number, number] = [1, 1, 1];
const HALF = 2;

export const createLayerOperation: Operation = {
  id: "kvfx.op.layer.create",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const kind = ctx.args["kind"];
    const name = readString(ctx.args, "name", "");
    let created: AeRawLayer;

    if (kind === "null") {
      created = comp.layers.addNull(comp.duration);
    } else if (kind === "adjustment") {
      created = comp.layers.addSolid(
        WHITE,
        name || ADJUSTMENT_LAYER_NAME,
        comp.width,
        comp.height,
        comp.pixelAspect,
        comp.duration,
      );
      created.adjustmentLayer = true;
    } else if (kind === "solid") {
      created = comp.layers.addSolid(
        readColor(ctx.args, "color", WHITE),
        name || SOLID_LAYER_NAME,
        comp.width,
        comp.height,
        comp.pixelAspect,
        comp.duration,
      );
    } else if (kind === "text") {
      created = comp.layers.addText(readString(ctx.args, "text", DEFAULT_TEXT));
    } else if (kind === "shape") {
      created = comp.layers.addShape();
    } else if (kind === "camera") {
      created = comp.layers.addCamera(name || CAMERA_NAME, [comp.width / HALF, comp.height / HALF]);
    } else {
      throw hostError(ErrorCode.InvalidArgument, `Unknown layer kind: ${labelOf(kind)}`);
    }

    if (name && kind !== "adjustment" && kind !== "solid" && kind !== "camera") created.name = name;

    return { id: created.id, name: created.name, index: created.index, kind: kind as HostJson };
  },
};

/** A null's own box, when After Effects can't say: its default 100 × 100. */
const NULL_SIZE = 100;

/** A layer's position at the current time, in its parent's space; undefined for a layer without one. */
function positionOf(layer: AeRawLayer): number[] | undefined {
  try {
    const transform = layer.property("ADBE Transform Group");
    const position = transform ? transform.property("ADBE Position") : null;
    const value: unknown = position ? position.value : undefined;
    return isArray(value) ? (value as number[]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Puts a new null where the layers it will carry are: at the average
 * position of those without a parent of their own, directly above the
 * topmost of them in the stack, over the time they span, centred on its own
 * box, and 3D when every one of them is (cameras and lights count as 3D).
 */
function placeAt(comp: AeRawComp, nul: AeRawLayer, roots: AeRawLayer[]): void {
  let top = roots[0] as AeRawLayer;
  let start = top.inPoint;
  let end = top.outPoint;
  let all3d = true;
  const sum = [0, 0, 0];
  let counted = 0;
  for (let i = 0; i < roots.length; i += 1) {
    const layer = roots[i] as AeRawLayer;
    if (layer.index < top.index) top = layer;
    if (layer.inPoint < start) start = layer.inPoint;
    if (layer.outPoint > end) end = layer.outPoint;
    if (layer.threeDLayer === false) all3d = false;
    // A parented layer's position is in its parent's space, not the comp's.
    const position = layer.parent ? undefined : positionOf(layer);
    if (position !== undefined && position.length >= 2) {
      sum[0] = (sum[0] as number) + (position[0] as number);
      sum[1] = (sum[1] as number) + (position[1] as number);
      sum[2] = (sum[2] as number) + (typeof position[2] === "number" ? position[2] : 0);
      counted += 1;
    }
  }

  if (all3d) nul.threeDLayer = true;
  const transform = nul.property("ADBE Transform Group");
  const box = typeof nul.sourceRectAtTime === "function" ? nul.sourceRectAtTime(comp.time, false) : undefined;
  const cx = box ? box.left + box.width / HALF : NULL_SIZE / HALF;
  const cy = box ? box.top + box.height / HALF : NULL_SIZE / HALF;
  const anchor = transform ? transform.property("ADBE Anchor Point") : null;
  if (anchor) anchor.setValue(all3d ? [cx, cy, 0] : [cx, cy]);
  const position = transform ? transform.property("ADBE Position") : null;
  if (position && counted > 0) {
    const x = (sum[0] as number) / counted;
    const y = (sum[1] as number) / counted;
    position.setValue(all3d ? [x, y, (sum[2] as number) / counted] : [x, y]);
  }

  const from = Math.max(0, start);
  const to = Math.min(comp.duration, end);
  if (to > from) {
    nul.inPoint = from;
    nul.outPoint = to;
  }
  nul.moveBefore(top);
}

/**
 * Adds a null, linked to the selection when there is one.
 *
 * With layers selected — footage, text, shapes, precomps, solids, cameras,
 * lights, anything — the null lands where they are (see placeAt) and every
 * selected layer whose parent isn't selected too is parented to it, keeping
 * its place on screen. That is setting `parent`, as the pick whip does;
 * `setParentWithJump` keeps the values instead and lets the layer leap. A
 * layer already parented to another selected layer keeps that parent, so a
 * rig keeps its shape. Locked layers are left alone, with a reason. With
 * nothing selected it is a plain null at the top of the stack.
 *
 * The selection is read here, before the null exists: After Effects selects
 * a layer it has just made.
 *
 *   { target?: "selection", name? }  →  { id, name, linkedCount, skipped }
 */
export const addNullOperation: Operation = {
  id: "kvfx.op.layer.addNull",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const selected = ctx.args["target"] === "selection" ? targets(comp, { target: "selection" }).layers : [];
    const inSelection: { [id: string]: boolean } = {};
    for (let i = 0; i < selected.length; i += 1) inSelection[String((selected[i] as AeRawLayer).id)] = true;

    const roots: AeRawLayer[] = [];
    const skips: HostJson[] = [];
    for (let i = 0; i < selected.length; i += 1) {
      const layer = selected[i] as AeRawLayer;
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      const parent = layer.parent;
      if (parent && inSelection[String(parent.id)] === true && !parent.locked) continue;
      roots[roots.length] = layer;
    }

    const nul = comp.layers.addNull(comp.duration);
    const name = readString(ctx.args, "name", "");
    if (name) nul.name = name;
    else if (roots.length === 1) nul.name = (roots[0] as AeRawLayer).name + " Control";
    else if (roots.length > 1) nul.name = "KVFX Control";

    let linked = 0;
    if (roots.length > 0) {
      placeAt(comp, nul, roots);
      for (let i = 0; i < roots.length; i += 1) {
        const layer = roots[i] as AeRawLayer;
        try {
          layer.parent = nul;
          linked += 1;
        } catch {
          skips[skips.length] = skipped(layer, "This layer can't take a parent");
        }
      }
    }

    return { id: nul.id, name: nul.name, linkedCount: linked, skipped: skips as unknown as HostJson };
  },
};

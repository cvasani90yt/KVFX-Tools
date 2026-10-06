import { hostError, labelOf } from "../../runtime/errors.js";
import { ErrorCode } from "../../runtime/protocol.js";
import type { Operation, OperationContext } from "../../runtime/registry.js";
import type { HostJson } from "../../runtime/serialize.js";
import { readColor, readString, requireComp } from "../raw.js";

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

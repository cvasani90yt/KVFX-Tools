import { isArray } from "../../runtime/es3.js";
import { hostError } from "../../runtime/errors.js";
import { ErrorCode } from "../../runtime/protocol.js";
import type { Operation, OperationContext } from "../../runtime/registry.js";
import type { HostJson } from "../../runtime/serialize.js";
import { layerById, readString, requireComp, skipped } from "../raw.js";

/**
 * Where generated layers sit, and how they combine with what is below.
 *
 * Generators create layers at the top of the stack, as After Effects does;
 * a backdrop then belongs under the layer it sits behind, and a glass panel
 * needs the card above it as its matte. These operations say so by id.
 */

function readIdList(raw: HostJson | undefined): number[] {
  const out: number[] = [];
  if (typeof raw === "number") out[0] = raw;
  else if (isArray(raw)) {
    const list = raw as HostJson[];
    for (let i = 0; i < list.length; i += 1) if (typeof list[i] === "number") out[out.length] = list[i] as number;
  }
  return out;
}

/**
 * Moves layers directly below (or above) an anchor layer, keeping their
 * order relative to each other. `below: "bottom"` sends them to the bottom.
 */
export const placeLayersOperation: Operation = {
  id: "kvfx.op.layer.place",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const ids = readIdList(ctx.args["ids"] === undefined ? ctx.args["id"] : ctx.args["ids"]);
    const below = ctx.args["below"];
    const above = ctx.args["above"];
    const moving: AeRawLayer[] = [];
    const missing: number[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      const layer = layerById(comp, ids[i] as number);
      if (layer) moving[moving.length] = layer;
      else missing[missing.length] = ids[i] as number;
    }

    if (below === "bottom") {
      for (let i = 0; i < moving.length; i += 1) (moving[i] as AeRawLayer).moveToEnd();
      return { movedCount: moving.length, missingIds: missing as unknown as HostJson };
    }

    const anchorId = typeof below === "number" ? below : typeof above === "number" ? above : undefined;
    if (anchorId === undefined) throw hostError(ErrorCode.InvalidArgument, "Say which layer to place them below or above.");
    const anchor = layerById(comp, anchorId);
    if (!anchor) throw hostError(ErrorCode.TargetNotFound, "The layer to place them by no longer exists.");

    // Moving each one directly under the previous keeps their order.
    let previous = anchor;
    let moved = 0;
    if (typeof below === "number") {
      for (let i = 0; i < moving.length; i += 1) {
        const layer = moving[i] as AeRawLayer;
        if (layer.id === anchor.id) continue;
        layer.moveAfter(previous);
        previous = layer;
        moved += 1;
      }
    } else {
      for (let i = moving.length - 1; i >= 0; i -= 1) {
        const layer = moving[i] as AeRawLayer;
        if (layer.id === anchor.id) continue;
        layer.moveBefore(previous);
        previous = layer;
        moved += 1;
      }
    }
    return { movedCount: moved, missingIds: missing as unknown as HostJson };
  },
};

/**
 * Uses one layer as another's track matte.
 *
 * After Effects 23 lets any layer be a matte (`setTrackMatte`); before that
 * the matte had to sit directly above, so on older versions it is moved
 * there. Either way the matte layer stops rendering on its own, as in the UI.
 */
export const setMatteOperation: Operation = {
  id: "kvfx.op.layer.matte",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const id = ctx.args["id"];
    const matteId = ctx.args["matteId"];
    const layer = typeof id === "number" ? layerById(comp, id) : undefined;
    const matte = typeof matteId === "number" ? layerById(comp, matteId) : undefined;
    if (!layer || !matte) throw hostError(ErrorCode.TargetNotFound, "The layer or its matte no longer exists.");
    if (layer.id === matte.id) throw hostError(ErrorCode.InvalidArgument, "A layer cannot be its own matte.");
    if (layer.locked) return { changedCount: 0, skipped: [skipped(layer, "Layer is locked")] as unknown as HostJson };

    const types = ctx.env.trackMatteTypes();
    const kind = readString(ctx.args, "type", "alpha");
    const type =
      kind === "alphaInverted" ? types.alphaInverted : kind === "luma" ? types.luma : kind === "lumaInverted" ? types.lumaInverted : types.alpha;

    if (typeof layer.setTrackMatte === "function") {
      layer.setTrackMatte(matte, type);
    } else if (layer.trackMatteType !== undefined) {
      matte.moveBefore(layer);
      layer.trackMatteType = type;
    } else {
      throw hostError(ErrorCode.PreconditionFailed, "This layer type cannot take a track matte.");
    }
    return { changedCount: 1, id: layer.id, matteId: matte.id };
  },
};

export const stackOperations: Operation[] = [placeLayersOperation, setMatteOperation];

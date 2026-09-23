import type { AeLayerHandle } from "../../ae/environment.js";
import { hostError } from "../../runtime/errors.js";
import { ErrorCode } from "../../runtime/protocol.js";
import type { Operation, OperationContext } from "../../runtime/registry.js";
import type { HostJson } from "../../runtime/serialize.js";
import { parseTargetKind, readIds, resolveTarget } from "./target.js";

/**
 * Moves layers within the stack.
 *
 * Two things here are easy to get wrong and both are handled explicitly.
 *
 * **Relative order.** Moving three layers to the top with a naive ascending
 * loop reverses them, because each `moveToBeginning` lands on top of the
 * previous one. Top moves therefore iterate descending and bottom moves
 * ascending, which preserves the user's ordering.
 *
 * **Blocked edges.** With layers 1 and 2 selected and "move up", layer 1 cannot
 * move and layer 2 must not either — moving it would swap the two, silently
 * reordering a selection the user asked to shift as a block. The `blocked`
 * cursor tracks how far the stuck region extends and stops that.
 *
 * Indices are re-read from After Effects after every move, never cached, since
 * each move renumbers the stack.
 */

type Direction = "top" | "bottom" | "up" | "down";

function parseDirection(raw: HostJson | undefined): Direction | undefined {
  if (raw === "top" || raw === "bottom" || raw === "up" || raw === "down") return raw;
  return undefined;
}

function sortByIndex(layers: AeLayerHandle[], ascending: boolean): AeLayerHandle[] {
  const out = layers.slice(0);
  // Insertion sort: the lists are small and ExtendScript's Array.sort comparator
  // support is not worth relying on for something this size.
  for (let i = 1; i < out.length; i += 1) {
    const current = out[i] as AeLayerHandle;
    let j = i - 1;
    while (j >= 0) {
      const other = out[j] as AeLayerHandle;
      const shift = ascending ? other.index() > current.index() : other.index() < current.index();
      if (!shift) break;
      out[j + 1] = other;
      j -= 1;
    }
    out[j + 1] = current;
  }
  return out;
}

export const reorderOperation: Operation = {
  id: "kvfx.op.layer.reorder",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = ctx.env.activeComp();
    if (!comp) {
      throw hostError(ErrorCode.PreconditionFailed, "No composition is open.");
    }

    const direction = parseDirection(ctx.args["to"]);
    if (!direction) {
      throw hostError(ErrorCode.InvalidArgument, 'to must be "top", "bottom", "up" or "down".');
    }

    const kind = parseTargetKind(ctx.args["target"]);
    if (!kind) {
      throw hostError(ErrorCode.InvalidArgument, "Missing or invalid target.");
    }

    const resolved = resolveTarget(comp, kind, readIds(ctx.args["ids"]));
    const movable: AeLayerHandle[] = [];
    const skipped: HostJson[] = [];

    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i];
      if (!layer) continue;
      if (layer.getFlag("locked") === true) {
        skipped[skipped.length] = { id: layer.id(), name: layer.name(), reason: "Layer is locked" };
        continue;
      }
      movable[movable.length] = layer;
    }

    let moved = 0;

    if (direction === "top") {
      const ordered = sortByIndex(movable, false);
      for (let i = 0; i < ordered.length; i += 1) {
        (ordered[i] as AeLayerHandle).moveToTop();
        moved += 1;
      }
    } else if (direction === "bottom") {
      const ordered = sortByIndex(movable, true);
      for (let i = 0; i < ordered.length; i += 1) {
        (ordered[i] as AeLayerHandle).moveToBottom();
        moved += 1;
      }
    } else if (direction === "up") {
      const ordered = sortByIndex(movable, true);
      let blocked = 0;
      for (let i = 0; i < ordered.length; i += 1) {
        const layer = ordered[i] as AeLayerHandle;
        const index = layer.index();
        if (index <= blocked + 1) {
          blocked = index;
          continue;
        }
        layer.moveBeforeIndex(index - 1);
        moved += 1;
      }
    } else {
      const ordered = sortByIndex(movable, false);
      let blocked = comp.layerCount() + 1;
      for (let i = 0; i < ordered.length; i += 1) {
        const layer = ordered[i] as AeLayerHandle;
        const index = layer.index();
        if (index >= blocked - 1) {
          blocked = index;
          continue;
        }
        layer.moveAfterIndex(index + 1);
        moved += 1;
      }
    }

    return {
      direction: direction,
      movedCount: moved,
      skipped: skipped as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

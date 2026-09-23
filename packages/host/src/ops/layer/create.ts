import { hostError, labelOf } from "../../runtime/errors.js";
import { ErrorCode } from "../../runtime/protocol.js";
import type { Operation, OperationContext } from "../../runtime/registry.js";
import type { HostJson } from "../../runtime/serialize.js";

/**
 * Creates a layer.
 *
 * New layers land at the top of the stack, which is what After Effects does on
 * its own and therefore what users already expect. Inserting above the
 * selection instead would be cleverer and less predictable.
 */

const ADJUSTMENT_LAYER_NAME = "Adjustment Layer";

export const createLayerOperation: Operation = {
  id: "kvfx.op.layer.create",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = ctx.env.activeComp();
    if (!comp) {
      throw hostError(ErrorCode.PreconditionFailed, "No composition is open.");
    }

    const kind = ctx.args["kind"];
    let created;

    if (kind === "null") {
      created = comp.addNull();
    } else if (kind === "adjustment") {
      created = comp.addAdjustment(ADJUSTMENT_LAYER_NAME);
    } else {
      throw hostError(ErrorCode.InvalidArgument, `Unknown layer kind: ${labelOf(kind)}`);
    }

    return { id: created.id(), name: created.name(), index: created.index(), kind: kind };
  },
};

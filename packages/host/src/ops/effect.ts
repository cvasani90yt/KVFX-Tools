import { isArray } from "../runtime/es3.js";
import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";
import { type Args, readString, requireComp, resolvePath, skipped, targets } from "./raw.js";

/**
 * Adds an effect to each target layer, optionally setting parameters.
 *
 * Parameters are addressed with the same paths as `prop.set`, relative to the
 * new effect — typically `{ valueType, nth }`, since effect parameter match
 * names are undocumented and their display names are localised.
 *
 * A layer that cannot take the effect — a camera, or an effect not installed —
 * is skipped with a reason rather than failing the plan.
 */
export const addEffectOperation: Operation = {
  id: "kvfx.op.effect.add",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const matchName = readString(ctx.args, "matchName", "");
    if (!matchName) throw hostError(ErrorCode.InvalidArgument, "matchName is required.");
    const name = readString(ctx.args, "name", "");
    const params = ctx.args["params"];
    const list = isArray(params) ? (params as HostJson[]) : [];

    const ids: number[] = [];
    const skips: HostJson[] = [];

    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      const parade = layer.property("ADBE Effect Parade");
      if (!parade || !parade.canAddProperty(matchName)) {
        skips[skips.length] = skipped(layer, "Layer cannot take this effect");
        continue;
      }

      const effect = parade.addProperty(matchName);
      if (name) effect.name = name;

      for (let p = 0; p < list.length; p += 1) {
        const spec = list[p];
        if (!spec || typeof spec !== "object" || isArray(spec)) continue;
        const bag = spec as Args;
        const param = resolvePath(ctx.env, effect, bag["path"]);
        if (!param) continue;
        if (bag["value"] !== undefined) param.setValue(bag["value"]);
        if (typeof bag["expression"] === "string") {
          param.expression = bag["expression"];
          param.expressionEnabled = (bag["expression"]).length > 0;
        }
      }
      ids[ids.length] = layer.id;
    }

    return {
      ids: ids as unknown as HostJson,
      skipped: skips as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

export const effectOperations: Operation[] = [addEffectOperation];

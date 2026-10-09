import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";
import { readWhenAnimated, requireComp, resolvePath, skipped, targets, writeValue } from "./raw.js";

/**
 * Generic property writes.
 *
 * Every feature that "sets X on the selected layers" — the transform
 * inspector, gradient lock, the counter's source text — is a plan of these
 * rather than its own ExtendScript. The decision of *what* to write lives in
 * `@kvfx/core`; this only knows how to write it safely.
 */

export const setPropertyOperation: Operation = {
  id: "kvfx.op.prop.set",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const value = ctx.args["value"];
    if (value === undefined) throw hostError(ErrorCode.InvalidArgument, "value is required.");
    const whenAnimated = readWhenAnimated(ctx.args);

    let changed = 0;
    const skips: HostJson[] = [];

    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      const prop = resolvePath(ctx.env, layer, ctx.args["path"]);
      if (!prop || prop.propertyType !== ctx.env.leafPropertyType()) {
        skips[skips.length] = skipped(layer, "Layer has no such property");
        continue;
      }
      const reason = writeValue(prop, value, whenAnimated, comp.time);
      if (reason) skips[skips.length] = skipped(layer, reason);
      else changed += 1;
    }

    return {
      changedCount: changed,
      skipped: skips as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

/**
 * Sets (or, with an empty string, clears) an expression.
 *
 * Clearing also disables evaluation so the property returns to its keyframed
 * or static value exactly — leaving an empty-but-enabled expression is how
 * "removed" rigs keep confusing people months later.
 *
 * `keepExisting` skips a property that already carries an expression instead
 * of replacing it, for rigs added on top of a layer the user may have rigged
 * themselves. With `relative`, the token `__KVFX_NOW__` in the expression
 * becomes the composition's current time — a rig that measures change "since
 * it was attached" needs that moment, and only the host knows it exactly.
 */
export const setExpressionOperation: Operation = {
  id: "kvfx.op.prop.expression",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const given = ctx.args["expression"];
    if (typeof given !== "string") {
      throw hostError(ErrorCode.InvalidArgument, "expression must be a string.");
    }
    const expression = ctx.args["relative"] === true ? stampTime(given, comp.time) : given;
    const keepExisting = ctx.args["keepExisting"] === true;

    let changed = 0;
    const skips: HostJson[] = [];

    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      const prop = resolvePath(ctx.env, layer, ctx.args["path"]);
      if (!prop || !prop.canSetExpression) {
        skips[skips.length] = skipped(layer, "Property cannot take an expression");
        continue;
      }
      if (keepExisting && prop.expression && prop.expressionEnabled) {
        skips[skips.length] = skipped(layer, prop.name + " already has an expression");
        continue;
      }
      prop.expression = expression;
      prop.expressionEnabled = expression.length > 0;
      changed += 1;
    }

    return {
      changedCount: changed,
      skipped: skips as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

const MICROSECONDS = 1e6;

/** The token a plan uses for "the composition time when this ran". */
export const NOW_TOKEN = "__KVFX_NOW__";

/** Replaces every `__KVFX_NOW__` with a time in seconds. */
export function stampTime(expression: string, time: number): string {
  return expression.split(NOW_TOKEN).join(String(Math.round(time * MICROSECONDS) / MICROSECONDS));
}

export const propertyOperations: Operation[] = [setPropertyOperation, setExpressionOperation];

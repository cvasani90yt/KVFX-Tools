import { hostError } from "../../runtime/errors.js";
import { ErrorCode } from "../../runtime/protocol.js";
import type { Operation, OperationContext } from "../../runtime/registry.js";
import type { HostJson } from "../../runtime/serialize.js";
import { type Args, requireComp, skipped, targets } from "../raw.js";

/**
 * Adds a speed ramp to layers through Time Remapping.
 *
 *   { ids, marker: { time, duration, comment }, expression, tag, outShift?, frameBlending? }
 *
 * The ramp itself is a layer marker; the expression on Time Remap reads every
 * ramp marker on the layer, so this writes the same expression each time and
 * a layer can carry as many ramps as it has markers. An expression on Time
 * Remap that is not one of ours (it lacks `tag`) is left alone and the layer
 * skipped, so a hand-built remap is never replaced. `outShift` moves the out
 * point by the time the ramp adds or saves, for layers it reaches, so the
 * clip still ends on its last frame.
 */

const REMAP = "ADBE Time Remapping";

export const speedRampOperation: Operation = {
  id: "kvfx.op.layer.speedRamp",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const marker = ctx.args["marker"] as Args | undefined;
    const expression = ctx.args["expression"];
    const tag = ctx.args["tag"];
    if (!marker || typeof marker["time"] !== "number" || typeof marker["duration"] !== "number" || typeof marker["comment"] !== "string") {
      throw hostError(ErrorCode.InvalidArgument, "marker needs a time, a duration and a comment.");
    }
    if (typeof expression !== "string" || typeof tag !== "string" || expression.indexOf(tag) === -1) {
      throw hostError(ErrorCode.InvalidArgument, "expression must be a string that carries its tag.");
    }
    const time = marker["time"];
    const duration = marker["duration"];
    const comment = marker["comment"];
    const outShift = typeof ctx.args["outShift"] === "number" ? ctx.args["outShift"] : 0;
    const blend = ctx.args["frameBlending"] === true;

    let changed = 0;
    const skips: HostJson[] = [];
    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i]!;
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      if (layer.canSetTimeRemapEnabled !== true) {
        skips[skips.length] = skipped(layer, "Speed ramps need a video or precomp layer");
        continue;
      }
      const remap = layer.property(REMAP);
      if (!remap) {
        skips[skips.length] = skipped(layer, "Layer has no Time Remap property");
        continue;
      }
      if (remap.expressionEnabled && remap.expression && remap.expression.indexOf(tag) === -1) {
        skips[skips.length] = skipped(layer, "Time Remap already has an expression of its own");
        continue;
      }
      if (layer.timeRemapEnabled !== true) layer.timeRemapEnabled = true;
      const markers = layer.property("ADBE Marker");
      if (markers) markers.setValueAtTime(time, ctx.env.newMarker(comment, duration));
      remap.expression = expression;
      remap.expressionEnabled = true;
      // Only clips the ramp reaches: it starts before their end.
      if (outShift !== 0 && time < layer.outPoint) {
        const frame = comp.frameDuration;
        layer.outPoint = Math.max(layer.inPoint + frame, Math.min(time + duration, layer.outPoint) + frame, layer.outPoint + outShift);
      }
      if (blend && layer.frameBlendingType !== undefined) layer.frameBlendingType = ctx.env.frameBlendingTypes().frameMix;
      changed += 1;
    }
    return { changedCount: changed, skipped: skips as unknown as HostJson, missingIds: resolved.missing as unknown as HostJson };
  },
};

import type { AeLayerHandle, LayerFlag } from "../../ae/environment.js";
import { hostError, labelOf } from "../../runtime/errors.js";
import { ErrorCode } from "../../runtime/protocol.js";
import type { Operation, OperationContext } from "../../runtime/registry.js";
import type { HostJson } from "../../runtime/serialize.js";
import { parseTargetKind, readIds, resolveTarget } from "./target.js";

/**
 * Sets or toggles a layer switch.
 *
 * Toggle is resolved here rather than in the command, because the command was
 * built from a snapshot that may no longer match the live selection (ADR-0002).
 * The rule is the one users expect: if every targeted layer already has the
 * switch on, turn it off; otherwise turn it on. Mixed selections therefore
 * normalise to "on" rather than flipping each layer independently, which would
 * leave the selection just as mixed as before.
 */

const VALID_FLAGS: LayerFlag[] = [
  "enabled",
  "locked",
  "shy",
  "solo",
  "threeD",
  "guide",
  "adjustment",
];

function isValidFlag(value: unknown): value is LayerFlag {
  for (let i = 0; i < VALID_FLAGS.length; i += 1) {
    if (VALID_FLAGS[i] === value) return true;
  }
  return false;
}

interface SkipRecord {
  [key: string]: HostJson;
}

export const setFlagOperation: Operation = {
  id: "kvfx.op.layer.setFlag",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = ctx.env.activeComp();
    if (!comp) {
      throw hostError(ErrorCode.PreconditionFailed, "No composition is open.");
    }

    const flag = ctx.args["flag"];
    if (!isValidFlag(flag)) {
      throw hostError(ErrorCode.InvalidArgument, `Unknown layer flag: ${labelOf(flag)}`);
    }

    const kind = parseTargetKind(ctx.args["target"]);
    if (!kind) {
      throw hostError(ErrorCode.InvalidArgument, "Missing or invalid target.");
    }

    const requested = ctx.args["value"];
    if (requested !== true && requested !== false && requested !== "toggle") {
      throw hostError(ErrorCode.InvalidArgument, "value must be true, false or \"toggle\".");
    }

    const resolved = resolveTarget(comp, kind, readIds(ctx.args["ids"]));
    const applicable: AeLayerHandle[] = [];
    const skipped: SkipRecord[] = [];

    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i];
      if (!layer) continue;

      if (layer.getFlag(flag) === undefined) {
        // A camera or light has no solo, 3D, guide or adjustment switch.
        skipped[skipped.length] = {
          id: layer.id(),
          name: layer.name(),
          reason: "This layer type has no such switch",
        };
        continue;
      }

      // After Effects throws when a locked layer is modified, so a locked layer
      // is reported rather than allowed to abort the whole plan. Unlocking one
      // silently would be worse: the lock is the user's explicit instruction.
      if (flag !== "locked" && layer.getFlag("locked") === true) {
        skipped[skipped.length] = { id: layer.id(), name: layer.name(), reason: "Layer is locked" };
        continue;
      }

      applicable[applicable.length] = layer;
    }

    let value: boolean;
    if (requested === "toggle") {
      let allOn = applicable.length > 0;
      for (let i = 0; i < applicable.length; i += 1) {
        if ((applicable[i] as AeLayerHandle).getFlag(flag) !== true) {
          allOn = false;
          break;
        }
      }
      value = !allOn;
    } else {
      value = requested;
    }

    const changed: HostJson[] = [];
    for (let i = 0; i < applicable.length; i += 1) {
      const layer = applicable[i] as AeLayerHandle;
      if (layer.getFlag(flag) === value) continue;
      layer.setFlag(flag, value);
      changed[changed.length] = layer.id();
    }

    return {
      flag: flag,
      value: value,
      changedCount: changed.length,
      changedIds: changed,
      skipped: skipped as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

import { isArray } from "../runtime/es3.js";
import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";
import { layerById, requireComp } from "./raw.js";

/**
 * The effects manager: list, switch on and off, remove.
 *
 * Listing is an explicit, user-triggered scan of the selected layers only — it
 * walks one level of each layer's effect stack and nothing deeper (ADR-0002).
 * Effects are addressed by layer id plus their position in the stack, which is
 * re-checked against the match name the panel saw so that a stack the user
 * reordered in the meantime is refused rather than edited in the wrong place.
 */

const PARADE = "ADBE Effect Parade";
const MAX_LAYERS = 64;

function parade(layer: AeRawLayer): AeRawProp | null {
  return layer.property(PARADE);
}

export const listEffectsOperation: Operation = {
  id: "kvfx.op.fx.list",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const selected = comp.selectedLayers;
    const layers: HostJson[] = [];
    const limit = selected.length < MAX_LAYERS ? selected.length : MAX_LAYERS;

    for (let i = 0; i < limit; i += 1) {
      const layer = selected[i] as AeRawLayer;
      const fx = parade(layer);
      const effects: HostJson[] = [];
      if (fx) {
        for (let e = 1; e <= fx.numProperties; e += 1) {
          const effect = fx.property(e) as AeRawProp;
          effects[effects.length] = {
            index: e,
            name: effect.name,
            matchName: effect.matchName,
            enabled: effect.enabled,
          };
        }
      }
      layers[layers.length] = {
        id: layer.id,
        name: layer.name,
        locked: layer.locked,
        effects: effects as unknown as HostJson,
      };
    }
    return { layers: layers as unknown as HostJson, truncated: selected.length > MAX_LAYERS };
  },
};

interface EffectRef {
  layer: AeRawLayer;
  index: number;
}

/** Resolves `[{ id, index, matchName }]`, refusing any that no longer match. */
function resolveEffects(comp: AeRawComp, value: HostJson | undefined): EffectRef[] {
  if (!isArray(value)) throw hostError(ErrorCode.InvalidArgument, "effects must be an array.");
  const list = value as HostJson[];
  const out: EffectRef[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const spec = list[i] as { [key: string]: HostJson };
    if (!spec || typeof spec["id"] !== "number" || typeof spec["index"] !== "number") continue;
    const layer = layerById(comp, spec["id"]);
    if (!layer) throw hostError(ErrorCode.TargetNotFound, "A layer in the list no longer exists. Rescan.");
    if (layer.locked) throw hostError(ErrorCode.PreconditionFailed, layer.name + " is locked.");
    const fx = parade(layer);
    const effect = fx ? fx.property(spec["index"]) : null;
    if (!effect || effect.matchName !== spec["matchName"]) {
      throw hostError(ErrorCode.TargetNotFound, "The effects on " + layer.name + " changed. Rescan.");
    }
    out[out.length] = { layer: layer, index: spec["index"] };
  }
  return out;
}

export const setEffectEnabledOperation: Operation = {
  id: "kvfx.op.fx.setEnabled",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const enabled = ctx.args["enabled"];
    if (typeof enabled !== "boolean") throw hostError(ErrorCode.InvalidArgument, "enabled must be true or false.");
    const refs = resolveEffects(comp, ctx.args["effects"]);
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i] as EffectRef;
      ((parade(ref.layer) as AeRawProp).property(ref.index) as AeRawProp).enabled = enabled;
    }
    return { changedCount: refs.length };
  },
};

/**
 * Removes effects. The panel asks for confirmation before sending this; the
 * removal itself is one undoable step.
 */
export const removeEffectsOperation: Operation = {
  id: "kvfx.op.fx.remove",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const refs = resolveEffects(comp, ctx.args["effects"]);
    // Highest index first per layer, so earlier indices stay valid.
    refs.sort(function (a: EffectRef, b: EffectRef): number {
      if (a.layer.id !== b.layer.id) return a.layer.id - b.layer.id;
      return b.index - a.index;
    });
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i] as EffectRef;
      ((parade(ref.layer) as AeRawProp).property(ref.index) as AeRawProp).remove();
    }
    return { removedCount: refs.length };
  },
};

export const fxOperations: Operation[] = [listEffectsOperation, setEffectEnabledOperation, removeEffectsOperation];

import type { AeEnvironment, ValueTypes } from "../ae/environment.js";
import { isArray } from "../runtime/es3.js";
import { hostError, labelOf } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";

/**
 * Shared plumbing for operations that work on the raw After Effects DOM.
 *
 * These are the generic primitives the plan builders in `@kvfx/core` compose:
 * resolve which layers to act on, walk to a property by match name, find an
 * effect parameter without depending on its localised display name, and write
 * a value without silently rewriting someone's animation.
 */

export type Args = { [key: string]: HostJson };

export function requireComp(ctx: OperationContext): AeRawComp {
  const comp = ctx.env.rawComp();
  if (!comp) throw hostError(ErrorCode.PreconditionFailed, "No composition is open.");
  return comp;
}

export function layerById(comp: AeRawComp, id: number): AeRawLayer | undefined {
  for (let i = 1; i <= comp.numLayers; i += 1) {
    const layer = comp.layer(i);
    if (layer.id === id) return layer;
  }
  return undefined;
}

export interface Targets {
  readonly layers: AeRawLayer[];
  /** Ids that were asked for and no longer exist — reported, never dropped silently. */
  readonly missing: number[];
}

/**
 * Resolves the layers an operation acts on.
 *
 * `id` / `ids` come from a plan (often via a plan-local reference); `target`
 * reads After Effects' live state *now*, which is what makes a stale panel
 * snapshot harmless (ADR-0002).
 */
export function targets(comp: AeRawComp, args: Args): Targets {
  const layers: AeRawLayer[] = [];
  const missing: number[] = [];

  const one = args["id"];
  const many = args["ids"];
  const wanted: number[] = [];
  if (typeof one === "number") wanted[wanted.length] = one;
  if (isArray(many)) {
    const list = many as HostJson[];
    for (let i = 0; i < list.length; i += 1) {
      const id = list[i];
      if (typeof id === "number") wanted[wanted.length] = id;
    }
  }

  if (wanted.length > 0) {
    for (let i = 0; i < wanted.length; i += 1) {
      const id = wanted[i] as number;
      const layer = layerById(comp, id);
      if (layer) layers[layers.length] = layer;
      else missing[missing.length] = id;
    }
    return { layers, missing };
  }

  const target = args["target"];
  if (target === "selection") {
    const selected = comp.selectedLayers;
    for (let i = 0; i < selected.length; i += 1) layers[layers.length] = selected[i] as AeRawLayer;
    return { layers, missing };
  }
  if (target === "all") {
    for (let i = 1; i <= comp.numLayers; i += 1) layers[layers.length] = comp.layer(i);
    return { layers, missing };
  }

  throw hostError(ErrorCode.InvalidArgument, "Name the layers with id, ids or target.");
}

/** A value-type name a plan may use, mapped onto the host's enum. */
function valueTypeFor(name: string, types: ValueTypes): number | undefined {
  switch (name) {
    case "oneD":
      return types.oneD;
    case "twoD":
      return types.twoD;
    case "twoDSpatial":
      return types.twoDSpatial;
    case "threeD":
      return types.threeD;
    case "threeDSpatial":
      return types.threeDSpatial;
    case "color":
      return types.color;
    case "textDocument":
      return types.textDocument;
    default:
      return undefined;
  }
}

/**
 * Walks to a property.
 *
 * Each path step is one of:
 *   - a string: a match name (or, as a fallback After Effects itself applies, a
 *     display name);
 *   - a number: a 1-based index;
 *   - `{ "valueType": "color", "nth": 1 }`: the nth child of that value type.
 *
 * The last form exists for effect parameters. Their match names are not
 * documented anywhere we can verify, and their display names change with the
 * user's language — but "the first colour parameter of Fill" is stable across
 * both, and it is the property the plan actually means.
 */
export function resolvePath(
  env: AeEnvironment,
  root: AeRawLayer | AeRawProp,
  path: HostJson | undefined,
): AeRawProp | null {
  if (!isArray(path)) throw hostError(ErrorCode.InvalidArgument, "path must be an array.");
  const steps = path as HostJson[];
  let current: AeRawLayer | AeRawProp | null = root;

  for (let i = 0; i < steps.length && current; i += 1) {
    const step = steps[i];
    if (typeof step === "string" || typeof step === "number") {
      current = current.property(step);
      continue;
    }
    if (step && typeof step === "object" && !isArray(step)) {
      const spec = step as Args;
      const typeName = typeof spec["valueType"] === "string" ? spec["valueType"] : "";
      const wanted = valueTypeFor(typeName, env.valueTypes());
      const nth = typeof spec["nth"] === "number" ? spec["nth"] : 1;
      if (wanted === undefined) {
        throw hostError(ErrorCode.InvalidArgument, `Unknown value type ${labelOf(spec["valueType"])}.`);
      }
      const group = current as AeRawProp;
      let seen = 0;
      let found: AeRawProp | null = null;
      for (let c = 1; c <= group.numProperties; c += 1) {
        const child = group.property(c);
        if (child && child.propertyValueType === wanted) {
          seen += 1;
          if (seen === nth) {
            found = child;
            break;
          }
        }
      }
      current = found;
      continue;
    }
    throw hostError(ErrorCode.InvalidArgument, `Path step ${String(i)} is not usable.`);
  }

  return current === root ? null : (current as AeRawProp | null);
}

export type WhenAnimated = "skip" | "keyframe" | "error";

export function readWhenAnimated(args: Args): WhenAnimated {
  const value = args["whenAnimated"];
  return value === "keyframe" || value === "error" ? value : "skip";
}

/**
 * Writes a property value without rewriting animation behind the user's back.
 *
 * `setValue` on an animated property throws in After Effects. What to do
 * instead is the caller's decision, never this function's: bulk tools skip and
 * report; the transform inspector writes a keyframe at the current time, which
 * is what After Effects' own Properties panel does when you edit an animated
 * value.
 *
 * Returns the reason a property was skipped, or undefined when it was written.
 */
export function writeValue(
  prop: AeRawProp,
  value: HostJson,
  whenAnimated: WhenAnimated,
  time: number,
): string | undefined {
  if (prop.numKeys > 0) {
    if (whenAnimated === "keyframe") {
      prop.setValueAtTime(time, value);
      return undefined;
    }
    if (whenAnimated === "error") {
      throw hostError(ErrorCode.PreconditionFailed, `${prop.name} is animated.`);
    }
    return `${prop.name} is animated`;
  }
  if (prop.dimensionsSeparated === true) return `${prop.name} has separated dimensions`;
  prop.setValue(value);
  return undefined;
}

export function readString(args: Args, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

export function readNumber(args: Args, key: string, fallback: number): number {
  const value = args[key];
  return typeof value === "number" && isFinite(value) ? value : fallback;
}

/** A colour as After Effects wants it: three channels in 0–1. */
export function readColor(args: Args, key: string, fallback: [number, number, number]): [number, number, number] {
  const value = args[key];
  if (!isArray(value)) return fallback;
  const list = value as HostJson[];
  const out: [number, number, number] = [fallback[0], fallback[1], fallback[2]];
  for (let i = 0; i < out.length; i += 1) {
    const channel = list[i];
    if (typeof channel === "number" && isFinite(channel)) {
      out[i] = channel < 0 ? 0 : channel > 1 ? 1 : channel;
    }
  }
  return out;
}

/** A skip record in the shape every operation reports. */
export function skipped(layer: AeRawLayer, reason: string): HostJson {
  return { id: layer.id, name: layer.name, reason: reason };
}

import type { AeEnvironment } from "../ae/environment.js";
import { isArray } from "../runtime/es3.js";
import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";
import { type Args, requireComp, resolvePath, skipped, targets } from "./raw.js";

/**
 * Keyframe operations.
 *
 * The easing maths maps a CSS-style cubic bezier (x1, y1, x2, y2) onto After
 * Effects' temporal ease, which is expressed per keyframe as a speed and an
 * influence on each side:
 *
 *   out ease of the first key:  influence = x1·100,      speed = (y1 / x1) · v
 *   in ease of the second key:  influence = (1 − x2)·100, speed = ((1 − y2) / (1 − x2)) · v
 *
 * where v is the segment's average speed (value change ÷ duration). That is
 * the exact correspondence for a one-dimensional value: After Effects draws a
 * cubic bezier whose handles have those lengths and slopes. For spatial
 * properties speed is a magnitude along the path, so it is never negative and
 * overshoot handles are clamped to zero.
 */

const MIN_INFLUENCE = 0.1;
const MAX_INFLUENCE = 100;
const PERCENT = 100;
const EPSILON = 1e-9;
const BEZIER_LENGTH = 4;

export type Bezier = [number, number, number, number];

function clampInfluence(value: number): number {
  if (!(value >= MIN_INFLUENCE)) return MIN_INFLUENCE;
  return value > MAX_INFLUENCE ? MAX_INFLUENCE : value;
}

export function readBezier(value: HostJson | undefined): Bezier {
  if (!isArray(value)) throw hostError(ErrorCode.InvalidArgument, "bezier must be [x1, y1, x2, y2].");
  const list = value as HostJson[];
  const out: number[] = [];
  for (let i = 0; i < BEZIER_LENGTH; i += 1) {
    const n = list[i];
    if (typeof n !== "number" || !isFinite(n)) {
      throw hostError(ErrorCode.InvalidArgument, "bezier must be four numbers.");
    }
    out[i] = n;
  }
  const x1 = out[0] as number;
  const x2 = out[2] as number;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw hostError(ErrorCode.InvalidArgument, "bezier x values must be within 0–1.");
  }
  return [x1, out[1] as number, x2, out[3] as number];
}

/** How a property's ease array is shaped, and how its speed is measured. */
type EaseShape = "scalar" | "perDimension" | "spatial" | "influenceOnly" | "none";

function easeShape(env: AeEnvironment, prop: AeRawProp): EaseShape {
  const types = env.valueTypes();
  const type = prop.propertyValueType;
  if (type === types.oneD) return "scalar";
  if (type === types.twoD || type === types.threeD) return "perDimension";
  if (type === types.twoDSpatial || type === types.threeDSpatial) return "spatial";
  if (type === types.noValue || type === types.textDocument) return "none";
  // Colour, shape paths and custom values: one ease, speed in units we cannot
  // derive reliably — keep influence, flatten speed.
  return "influenceOnly";
}

function asList(value: unknown): number[] {
  if (isArray(value)) return value as number[];
  return [value as number];
}

/** Average speed across a segment, per ease-array entry. */
function segmentSpeeds(prop: AeRawProp, shape: EaseShape, from: number, to: number): number[] {
  const dt = prop.keyTime(to) - prop.keyTime(from);
  if (!(dt > EPSILON) || shape === "influenceOnly") return [0];
  const a = asList(prop.keyValue(from));
  const b = asList(prop.keyValue(to));

  if (shape === "spatial") {
    let sum = 0;
    for (let d = 0; d < a.length; d += 1) {
      const delta = (b[d] as number) - (a[d] as number);
      sum += delta * delta;
    }
    return [Math.sqrt(sum) / dt];
  }
  if (shape === "scalar") return [((b[0] as number) - (a[0] as number)) / dt];

  const out: number[] = [];
  for (let d = 0; d < a.length; d += 1) out[d] = ((b[d] as number) - (a[d] as number)) / dt;
  return out;
}

function easeArray(
  env: AeEnvironment,
  speeds: number[],
  ratio: number,
  influence: number,
  spatial: boolean,
): AeKeyframeEase[] {
  const out: AeKeyframeEase[] = [];
  for (let d = 0; d < speeds.length; d += 1) {
    let speed = ratio * (speeds[d] as number);
    if (spatial && speed < 0) speed = 0;
    out[d] = env.newKeyframeEase(speed, clampInfluence(influence));
  }
  return out;
}

/**
 * Applies a bezier to the segments either side of each listed key.
 *
 * Per key, not per pair: selecting one keyframe eases both its sides, and
 * selecting every keyframe eases the whole curve, which is how users expect a
 * single click to behave.
 */
export function easeKeys(env: AeEnvironment, prop: AeRawProp, keys: number[], bezier: Bezier): number {
  const shape = easeShape(env, prop);
  if (shape === "none") return 0;
  const n = prop.numKeys;
  const x1 = bezier[0];
  const y1 = bezier[1];
  const x2 = bezier[2];
  const y2 = bezier[3];
  const outRatio = x1 > EPSILON ? y1 / x1 : 0;
  const inRatio = 1 - x2 > EPSILON ? (1 - y2) / (1 - x2) : 0;
  const bezierType = env.interpolation().bezier;
  const spatial = shape === "spatial";

  let changed = 0;
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i] as number;
    let inEase = prop.keyInTemporalEase(k);
    let outEase = prop.keyOutTemporalEase(k);
    let inType = prop.keyInInterpolationType(k);
    let outType = prop.keyOutInterpolationType(k);

    if (k < n) {
      outEase = easeArray(env, segmentSpeeds(prop, shape, k, k + 1), outRatio, x1 * PERCENT, spatial);
      outType = bezierType;
    }
    if (k > 1) {
      inEase = easeArray(env, segmentSpeeds(prop, shape, k - 1, k), inRatio, (1 - x2) * PERCENT, spatial);
      inType = bezierType;
    }
    if (k === n && k === 1) continue;

    prop.setInterpolationTypeAtKey(k, inType, outType);
    prop.setTemporalEaseAtKey(k, inEase, outEase);
    changed += 1;
  }
  return changed;
}

/** Leaf properties in the active comp that have selected keyframes. */
function propertiesWithSelectedKeys(env: AeEnvironment, comp: AeRawComp): AeRawProp[] {
  const leafType = env.leafPropertyType();
  const selected = comp.selectedProperties;
  const out: AeRawProp[] = [];
  for (let i = 0; i < selected.length; i += 1) {
    const prop = selected[i] as AeRawProp;
    if (prop.propertyType !== leafType || prop.numKeys === 0) continue;
    if (prop.selectedKeys.length === 0) continue;
    out[out.length] = prop;
  }
  return out;
}

function noKeysSelected(): never {
  throw hostError(ErrorCode.PreconditionFailed, "Select keyframes in the timeline first.");
}

export const easeKeysOperation: Operation = {
  id: "kvfx.op.keys.ease",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const bezier = readBezier(ctx.args["bezier"]);
    const props = propertiesWithSelectedKeys(ctx.env, comp);
    if (props.length === 0) noKeysSelected();

    let keys = 0;
    const failures: HostJson[] = [];
    for (let i = 0; i < props.length; i += 1) {
      const prop = props[i] as AeRawProp;
      try {
        keys += easeKeys(ctx.env, prop, prop.selectedKeys, bezier);
      } catch (cause) {
        // A locked layer's keyframes cannot change; report it and carry on.
        failures[failures.length] = { property: prop.name, reason: String(cause) };
      }
    }
    return { propertyCount: props.length, keyCount: keys, failures: failures as unknown as HostJson };
  },
};

/**
 * Reads the bezier of the first selected segment, so the curve editor can show
 * what is already on the keys instead of whatever the user last drew.
 */
export const readEaseOperation: Operation = {
  id: "kvfx.op.keys.readEase",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const props = propertiesWithSelectedKeys(ctx.env, comp);
    const linear = ctx.env.interpolation().linear;

    for (let i = 0; i < props.length; i += 1) {
      const prop = props[i] as AeRawProp;
      const shape = easeShape(ctx.env, prop);
      if (shape === "none" || shape === "influenceOnly") continue;
      const keys = prop.selectedKeys;
      for (let s = 0; s < keys.length; s += 1) {
        const k = keys[s] as number;
        if (k >= prop.numKeys) continue;
        if (prop.keyOutInterpolationType(k) === linear && prop.keyInInterpolationType(k + 1) === linear) {
          return { property: prop.name, bezier: [0, 0, 1, 1], linear: true };
        }
        const speeds = segmentSpeeds(prop, shape, k, k + 1);
        const v = speeds[0] as number;
        const out = prop.keyOutTemporalEase(k)[0] as AeKeyframeEase;
        const into = prop.keyInTemporalEase(k + 1)[0] as AeKeyframeEase;
        const x1 = out.influence / PERCENT;
        const x2 = 1 - into.influence / PERCENT;
        const flat = Math.abs(v) < EPSILON;
        const y1 = flat ? 0 : (out.speed / v) * x1;
        const y2 = flat ? 1 : 1 - (into.speed / v) * (1 - x2);
        return { property: prop.name, bezier: [x1, y1, x2, y2], linear: false };
      }
    }
    return { property: null, bezier: null, linear: false };
  },
};

export const interpolationOperation: Operation = {
  id: "kvfx.op.keys.interpolation",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const kind = ctx.args["type"];
    const types = ctx.env.interpolation();
    let type: number;
    if (kind === "linear") type = types.linear;
    else if (kind === "bezier") type = types.bezier;
    else if (kind === "hold") type = types.hold;
    else throw hostError(ErrorCode.InvalidArgument, "type must be linear, bezier or hold.");

    const props = propertiesWithSelectedKeys(ctx.env, comp);
    if (props.length === 0) noKeysSelected();

    let keys = 0;
    const failures: HostJson[] = [];
    for (let i = 0; i < props.length; i += 1) {
      const prop = props[i] as AeRawProp;
      const selected = prop.selectedKeys;
      try {
        for (let s = 0; s < selected.length; s += 1) {
          prop.setInterpolationTypeAtKey(selected[s] as number, type, type);
          keys += 1;
        }
      } catch (cause) {
        failures[failures.length] = { property: prop.name, reason: String(cause) };
      }
    }
    return { propertyCount: props.length, keyCount: keys, failures: failures as unknown as HostJson };
  },
};

interface KeyRecord {
  time: number;
  value: unknown;
  inEase: AeKeyframeEase[];
  outEase: AeKeyframeEase[];
  inType: number;
  outType: number;
  inTangent: number[] | undefined;
  outTangent: number[] | undefined;
}

/**
 * Mirrors the selected keyframes in time across their own span.
 *
 * Each key keeps its value; in and out sides swap — ease, interpolation and
 * spatial tangents — so a curve that eased out now eases in, exactly as
 * playing it backwards would.
 */
export const reverseKeysOperation: Operation = {
  id: "kvfx.op.keys.reverse",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const props = propertiesWithSelectedKeys(ctx.env, comp);
    if (props.length === 0) noKeysSelected();

    let reversed = 0;
    const failures: HostJson[] = [];
    for (let i = 0; i < props.length; i += 1) {
      const prop = props[i] as AeRawProp;
      const selected = prop.selectedKeys;
      if (selected.length < 2) continue;
      try {
        reverseOne(prop, selected);
        reversed += 1;
      } catch (cause) {
        failures[failures.length] = { property: prop.name, reason: String(cause) };
      }
    }
    if (reversed === 0 && failures.length === 0) {
      throw hostError(ErrorCode.PreconditionFailed, "Select at least two keyframes on a property to reverse.");
    }
    return { propertyCount: reversed, failures: failures as unknown as HostJson };
  },
};

function reverseOne(prop: AeRawProp, selected: number[]): void {
  const records: KeyRecord[] = [];
  let first = Infinity;
  let last = -Infinity;
  for (let s = 0; s < selected.length; s += 1) {
    const k = selected[s] as number;
    const time = prop.keyTime(k);
    if (time < first) first = time;
    if (time > last) last = time;
    records[records.length] = {
      time: time,
      value: prop.keyValue(k),
      inEase: prop.keyInTemporalEase(k),
      outEase: prop.keyOutTemporalEase(k),
      inType: prop.keyInInterpolationType(k),
      outType: prop.keyOutInterpolationType(k),
      inTangent: prop.isSpatial ? prop.keyInSpatialTangent(k) : undefined,
      outTangent: prop.isSpatial ? prop.keyOutSpatialTangent(k) : undefined,
    };
  }

  // Highest index first, so earlier indices stay valid while removing.
  for (let s = selected.length - 1; s >= 0; s -= 1) prop.removeKey(selected[s] as number);

  for (let r = 0; r < records.length; r += 1) {
    const rec = records[r] as KeyRecord;
    const index = prop.addKey(first + last - rec.time);
    prop.setValueAtKey(index, rec.value);
    prop.setInterpolationTypeAtKey(index, rec.outType, rec.inType);
    prop.setTemporalEaseAtKey(index, rec.outEase, rec.inEase);
    if (rec.inTangent && rec.outTangent) prop.setSpatialTangentsAtKey(index, rec.outTangent, rec.inTangent);
    if (typeof prop.setSelectedAtKey === "function") prop.setSelectedAtKey(index, true);
  }
}

/**
 * Writes keyframes onto a property of each target layer.
 *
 * Times are relative to the composition's current time when `relative` is
 * set, which is how generated animations (the counter, text presets) start at
 * the playhead. An optional bezier eases every segment written.
 */
export const setKeyframesOperation: Operation = {
  id: "kvfx.op.prop.keyframes",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const keysArg = ctx.args["keys"];
    if (!isArray(keysArg) || (keysArg as HostJson[]).length === 0) {
      throw hostError(ErrorCode.InvalidArgument, "keys must be a non-empty array.");
    }
    const keyList = keysArg as HostJson[];
    const offset = ctx.args["relative"] === true ? comp.time : 0;
    const bezier = ctx.args["bezier"] === undefined ? undefined : readBezier(ctx.args["bezier"]);

    let changed = 0;
    const skips: HostJson[] = [];
    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      const prop = resolvePath(ctx.env, layer, ctx.args["path"]);
      if (!prop || prop.propertyType !== ctx.env.leafPropertyType() || !prop.canVaryOverTime) {
        skips[skips.length] = skipped(layer, "Layer has no such property");
        continue;
      }

      const written: number[] = [];
      for (let k = 0; k < keyList.length; k += 1) {
        const spec = keyList[k] as Args;
        if (!spec || typeof spec["time"] !== "number" || spec["value"] === undefined) {
          throw hostError(ErrorCode.InvalidArgument, "Each key needs a time and a value.");
        }
        prop.setValueAtTime(offset + (spec["time"]), spec["value"]);
      }
      if (bezier) {
        // Indices are only stable once every key exists.
        for (let k = 0; k < keyList.length; k += 1) {
          const time = offset + ((keyList[k] as Args)["time"] as number);
          written[written.length] = nearestKey(prop, time);
        }
        easeKeys(ctx.env, prop, written, bezier);
      }
      changed += 1;
    }

    return {
      changedCount: changed,
      skipped: skips as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

function nearestKey(prop: AeRawProp, time: number): number {
  let best = 1;
  let bestDelta = Infinity;
  for (let k = 1; k <= prop.numKeys; k += 1) {
    const delta = Math.abs(prop.keyTime(k) - time);
    if (delta < bestDelta) {
      best = k;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Sets an expression on every selected property — the timeline selection, not
 * a path — which is how elastic and bounce are applied to whatever the user
 * has highlighted. With `requireKeys`, properties without at least two
 * keyframes are skipped, since an overshoot needs motion to overshoot.
 */
export const selectedExpressionOperation: Operation = {
  id: "kvfx.op.prop.expressionOnSelected",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const expression = ctx.args["expression"];
    if (typeof expression !== "string") throw hostError(ErrorCode.InvalidArgument, "expression must be a string.");
    const requireKeys = ctx.args["requireKeys"] === true;
    const leafType = ctx.env.leafPropertyType();

    const selected = comp.selectedProperties;
    let changed = 0;
    let considered = 0;
    const skips: HostJson[] = [];
    for (let i = 0; i < selected.length; i += 1) {
      const prop = selected[i] as AeRawProp;
      if (prop.propertyType !== leafType) continue;
      considered += 1;
      if (!prop.canSetExpression) {
        skips[skips.length] = { property: prop.name, reason: "Cannot take an expression" };
        continue;
      }
      if (requireKeys && prop.numKeys < 2) {
        skips[skips.length] = { property: prop.name, reason: "Needs at least two keyframes" };
        continue;
      }
      try {
        prop.expression = expression;
        prop.expressionEnabled = expression.length > 0;
        changed += 1;
      } catch (cause) {
        skips[skips.length] = { property: prop.name, reason: String(cause) };
      }
    }
    if (considered === 0) {
      throw hostError(ErrorCode.PreconditionFailed, "Select one or more properties in the timeline first.");
    }
    return { changedCount: changed, skipped: skips as unknown as HostJson };
  },
};

export const keyframeOperations: Operation[] = [
  easeKeysOperation,
  readEaseOperation,
  interpolationOperation,
  reverseKeysOperation,
  setKeyframesOperation,
  selectedExpressionOperation,
];

import { isArray } from "../runtime/es3.js";
import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";
import { readNumber, readString } from "./raw.js";

/**
 * Resizes compositions without moving their content off its anchor.
 *
 * After Effects' own Composition Settings change the canvas around its top-
 * left corner, scale nothing, and leave every comp that uses the resized one
 * showing it shifted. This keeps the content pinned to a chosen spot (any of
 * nine), optionally scales it to fit or fill, and corrects the precomp layers
 * that show the comp elsewhere so nothing jumps there either.
 *
 * For each comp:  p' = s · (p − A) + A'
 * where A and A' are the anchor spot on the old and new canvas and s is 1
 * (keep), or the fit or fill ratio. Only layers without a parent move; their
 * children follow through parenting. A precomp layer showing the comp gets
 * anchor' = s · (anchor − A) + A' and scale' = scale / s, which leaves the
 * content exactly where it was in the parent.
 */

const TRANSFORM = "ADBE Transform Group";
const MAX_SIZE = 30000;
const MIN_SIZE = 4;
const MAX_DURATION = 10800;
const MAX_FPS = 999;
const EPSILON = 1e-9;
/** Position, anchor and spatial tangents carry up to three components. */
const SPATIAL_DIMS = 3;
const CENTRE = 0.5;
const PERCENT = 100;
/** Layers ending this close to the old end are treated as running to it. */
const END_TOLERANCE_FRAMES = 1.5;

type Mapping = (x: number, y: number) => [number, number];

interface Plan {
  readonly comp: AeRawComp;
  readonly width: number;
  readonly height: number;
  readonly duration: number | undefined;
  readonly frameRate: number | undefined;
  readonly scale: number;
  readonly map: Mapping;
}

function mapVector(value: unknown, map: Mapping): unknown {
  if (!isArray(value)) return value;
  const list = value as number[];
  const out: number[] = [];
  for (let i = 0; i < list.length; i += 1) out[i] = list[i] as number;
  const mapped = map(out[0] as number, out[1] as number);
  out[0] = mapped[0];
  out[1] = mapped[1];
  return out;
}

function scaleVector(value: unknown, factor: number, dims: number): unknown {
  if (!isArray(value)) return typeof value === "number" ? value * factor : value;
  const list = value as number[];
  const out: number[] = [];
  for (let i = 0; i < list.length; i += 1) out[i] = i < dims ? (list[i] as number) * factor : (list[i] as number);
  return out;
}

/** Applies `change` to a property's static value or to every keyframe. */
function transformProperty(prop: AeRawProp | null, change: (value: unknown) => unknown, tangentScale?: number): void {
  if (!prop) return;
  if (prop.numKeys > 0) {
    for (let k = 1; k <= prop.numKeys; k += 1) {
      prop.setValueAtKey(k, change(prop.keyValue(k)));
      if (tangentScale !== undefined && Math.abs(tangentScale - 1) > EPSILON && prop.isSpatial) {
        prop.setSpatialTangentsAtKey(
          k,
          scaleVector(prop.keyInSpatialTangent(k), tangentScale, SPATIAL_DIMS) as number[],
          scaleVector(prop.keyOutSpatialTangent(k), tangentScale, SPATIAL_DIMS) as number[],
        );
      }
    }
  } else {
    prop.setValue(change(prop.value));
  }
}

function mapPosition(layer: AeRawLayer, map: Mapping, scale: number): void {
  const transform = layer.property(TRANSFORM);
  if (!transform) return;
  const position = transform.property("ADBE Position");
  if (position && position.dimensionsSeparated === true) {
    // Separated X and Y are mapped independently; the mapping is per axis.
    const origin = map(0, 0);
    const unit = map(1, 1);
    const sx = unit[0] - origin[0];
    const sy = unit[1] - origin[1];
    transformProperty(transform.property("ADBE Position_0"), (v) => origin[0] + sx * (v as number));
    transformProperty(transform.property("ADBE Position_1"), (v) => origin[1] + sy * (v as number));
    return;
  }
  transformProperty(position, (v) => mapVector(v, map), scale);
}

function isCameraOrLight(layer: AeRawLayer): boolean {
  return typeof layer.sourceRectAtTime !== "function";
}

function resolveComps(ctx: OperationContext): AeRawComp[] {
  const env = ctx.env;
  const project = env.rawProject();
  if (!project) throw hostError(ErrorCode.PreconditionFailed, "Open a project first.");
  const out: AeRawComp[] = [];
  const seen: { [id: string]: boolean } = {};
  const selection = isArray(project.selection) ? project.selection : [];
  for (let i = 0; i < selection.length; i += 1) {
    const item = selection[i];
    if (item && env.isComp(item) && !seen[String(item.id)]) {
      seen[String(item.id)] = true;
      out[out.length] = item as AeRawComp;
    }
  }
  if (out.length === 0) {
    const active = env.rawComp();
    if (active) out[0] = active;
  }
  if (out.length === 0) throw hostError(ErrorCode.PreconditionFailed, "Select comps in the Project panel, or open one.");
  return out;
}

function anchorFraction(args: { [key: string]: HostJson }): [number, number] {
  const raw = args["anchor"];
  if (isArray(raw)) {
    const list = raw as HostJson[];
    const x = list[0];
    const y = list[1];
    if (typeof x === "number" && typeof y === "number") {
      return [x < 0 ? 0 : x > 1 ? 1 : x, y < 0 ? 0 : y > 1 ? 1 : y];
    }
  }
  return [CENTRE, CENTRE];
}

function planFor(comp: AeRawComp, args: { [key: string]: HostJson }): Plan {
  const percent = args["percent"];
  let width: number;
  let height: number;
  if (typeof percent === "number" && percent > 0) {
    width = Math.round((comp.width * percent) / PERCENT);
    height = Math.round((comp.height * percent) / PERCENT);
  } else {
    width = Math.round(readNumber(args, "width", comp.width));
    height = Math.round(readNumber(args, "height", comp.height));
  }
  if (args["swap"] === true) {
    const t = width;
    width = height;
    height = t;
  }
  if (width < MIN_SIZE || height < MIN_SIZE || width > MAX_SIZE || height > MAX_SIZE) {
    throw hostError(ErrorCode.InvalidArgument, "Width and height must be between " + String(MIN_SIZE) + " and " + String(MAX_SIZE) + ".");
  }

  const fit = readString(args, "fit", "keep");
  const rx = width / comp.width;
  const ry = height / comp.height;
  const scale = fit === "fit" ? Math.min(rx, ry) : fit === "fill" ? Math.max(rx, ry) : 1;
  const anchor = anchorFraction(args);
  const ax = comp.width * anchor[0];
  const ay = comp.height * anchor[1];
  const bx = width * anchor[0];
  const by = height * anchor[1];

  const duration = args["duration"];
  const frameRate = args["frameRate"];
  return {
    comp: comp,
    width: width,
    height: height,
    duration: typeof duration === "number" && duration > 0 && duration <= MAX_DURATION ? duration : undefined,
    frameRate: typeof frameRate === "number" && frameRate > 0 && frameRate <= MAX_FPS ? frameRate : undefined,
    scale: scale,
    map: function (x: number, y: number): [number, number] {
      return [scale * (x - ax) + bx, scale * (y - ay) + by];
    },
  };
}

/** Moves the content of one comp and changes its settings. */
function resizeOne(plan: Plan, extend: boolean, skips: HostJson[]): void {
  const comp = plan.comp;
  const s = plan.scale;
  for (let i = 1; i <= comp.numLayers; i += 1) {
    const layer = comp.layer(i);
    if (layer.parent) continue;
    if (layer.locked) {
      skips[skips.length] = { comp: comp.name, name: layer.name, reason: "Layer is locked" };
      continue;
    }
    if (isCameraOrLight(layer)) {
      if (Math.abs(s - 1) > EPSILON) {
        skips[skips.length] = { comp: comp.name, name: layer.name, reason: "Cameras and lights are moved, not scaled" };
      }
      // A camera's point of interest is its Anchor Point property.
      const transform = layer.property(TRANSFORM);
      transformProperty(transform ? transform.property("ADBE Position") : null, (v) => mapVector(v, plan.map));
      transformProperty(transform ? transform.property("ADBE Anchor Point") : null, (v) => mapVector(v, plan.map));
      continue;
    }
    mapPosition(layer, plan.map, s);
    if (Math.abs(s - 1) > EPSILON) {
      const transform = layer.property(TRANSFORM);
      const dims = layer.threeDLayer === true ? SPATIAL_DIMS : 2;
      transformProperty(transform ? transform.property("ADBE Scale") : null, (v) => scaleVector(v, s, dims));
    }
  }

  const oldDuration = comp.duration;
  const typed = comp as unknown as { width: number; height: number; duration: number; frameRate: number };
  typed.width = plan.width;
  typed.height = plan.height;
  if (plan.frameRate !== undefined) typed.frameRate = plan.frameRate;
  if (plan.duration !== undefined) {
    typed.duration = plan.duration;
    if (extend && plan.duration > oldDuration) {
      const tolerance = comp.frameDuration * END_TOLERANCE_FRAMES;
      for (let i = 1; i <= comp.numLayers; i += 1) {
        const layer = comp.layer(i);
        if (layer.locked || layer.outPoint < oldDuration - tolerance) continue;
        try {
          layer.outPoint = plan.duration;
        } catch (cause) {
          // Footage cannot run past its own end without time remapping.
          void cause;
          skips[skips.length] = { comp: comp.name, name: layer.name, reason: "Could not extend: its footage ends sooner" };
        }
      }
    }
  }
}

/** Corrects every precomp layer that shows a resized comp, wherever it is used. */
function fixUsers(ctx: OperationContext, plans: Plan[], skips: HostJson[]): number {
  const project = ctx.env.rawProject();
  if (!project) return 0;
  const byId: { [id: string]: Plan } = {};
  for (let i = 0; i < plans.length; i += 1) byId[String((plans[i] as Plan).comp.id)] = plans[i] as Plan;
  let fixed = 0;
  for (let i = 1; i <= project.numItems; i += 1) {
    const item = project.item(i);
    if (!ctx.env.isComp(item)) continue;
    const parentComp = item as AeRawComp;
    for (let l = 1; l <= parentComp.numLayers; l += 1) {
      const layer = parentComp.layer(l);
      const source = layer.source;
      if (!source) continue;
      const plan = byId[String(source.id)];
      if (!plan) continue;
      if (layer.locked) {
        skips[skips.length] = { comp: parentComp.name, name: layer.name, reason: "Layer is locked, so it may shift" };
        continue;
      }
      const transform = layer.property(TRANSFORM);
      if (!transform) continue;
      transformProperty(transform.property("ADBE Anchor Point"), (v) => mapVector(v, plan.map));
      if (Math.abs(plan.scale - 1) > EPSILON) {
        const dims = layer.threeDLayer === true ? SPATIAL_DIMS : 2;
        transformProperty(transform.property("ADBE Scale"), (v) => scaleVector(v, 1 / plan.scale, dims));
      }
      fixed += 1;
    }
  }
  return fixed;
}

export const resizeCompsOperation: Operation = {
  id: "kvfx.op.comp.resize",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comps = resolveComps(ctx);
    const plans: Plan[] = [];
    for (let i = 0; i < comps.length; i += 1) plans[plans.length] = planFor(comps[i] as AeRawComp, ctx.args);

    const skips: HostJson[] = [];
    const names: string[] = [];
    for (let i = 0; i < plans.length; i += 1) {
      const plan = plans[i] as Plan;
      resizeOne(plan, ctx.args["extend"] !== false, skips);
      names[names.length] = plan.comp.name + " → " + String(plan.width) + "×" + String(plan.height);
    }
    const parents = ctx.args["fixParents"] === false ? 0 : fixUsers(ctx, plans, skips);
    return {
      changedCount: plans.length,
      resized: names as unknown as HostJson,
      parentLayersFixed: parents,
      skipped: skips as unknown as HostJson,
    };
  },
};

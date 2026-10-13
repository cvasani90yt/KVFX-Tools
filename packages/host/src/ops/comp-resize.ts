import { isArray } from "../runtime/es3.js";
import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { AeEnvironment } from "../ae/environment.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";
import { readNumber, readString } from "./raw.js";

/**
 * Resizes compositions without moving their content off its anchor.
 *
 * After Effects' own Composition Settings change the canvas around its top-
 * left corner, scale nothing, and leave every comp that uses the resized one
 * showing it shifted. This keeps the content pinned to a chosen spot (any of
 * nine), optionally scales it to fit, fill or stretch to the new frame, and
 * corrects the precomp layers that show the comp elsewhere so nothing jumps
 * there either.
 *
 * For each comp, per axis:  p' = k · (p − A) + A'
 * where A and A' are the anchor spot on the old and new canvas and k is 1
 * (keep), the fit or fill ratio on both axes, or each axis's own ratio
 * (stretch). Only layers without a parent move; their children follow through
 * parenting. A precomp layer showing the comp gets anchor' = k · (anchor − A)
 * + A' and scale' = scale / k, which leaves the content where it was in the
 * parent.
 *
 * Backgrounds: a layer that covered the whole old frame is made to cover the
 * new one, whatever the mode, since a background that stops short of the
 * frame is never what anyone wants. A solid or adjustment layer gets a new
 * solid of the right size (its own, so other comps using the old solid are
 * untouched), with its effect points and masks moved to match; a shape layer
 * stretches; footage and precomps scale evenly until they cover.
 *
 * Locked layers move with everything else and are locked again afterwards:
 * left behind, they would end up off the new frame.
 */

const TRANSFORM = "ADBE Transform Group";
const MAX_SIZE = 30000;
const MIN_SIZE = 4;
const MAX_DURATION = 10800;
const MAX_FPS = 999;
const EPSILON = 1e-9;
/** How deep effect parameter groups are searched for points. */
const MAX_EFFECT_DEPTH = 4;
const CENTRE = 0.5;
const PERCENT = 100;
/** What a new comp is when a plan does not say. */
const NEW_COMP = { width: 1920, height: 1080, duration: 10, frameRate: 30 } as const;
/** Layers ending this close to the old end are treated as running to it. */
const END_TOLERANCE_FRAMES = 1.5;

type Mapping = (x: number, y: number) => [number, number];

interface Plan {
  readonly comp: AeRawComp;
  readonly width: number;
  readonly height: number;
  readonly duration: number | undefined;
  readonly frameRate: number | undefined;
  /** Content scale on each axis; z scales only when x and y scale alike. */
  readonly kx: number;
  readonly ky: number;
  readonly kz: number;
  readonly map: Mapping;
  /** The new frame over the old, on each axis. */
  readonly rx: number;
  readonly ry: number;
  readonly backgrounds: boolean;
}

interface Tally {
  skips: HostJson[];
  backgrounds: number;
  unlocked: number;
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

/** Multiplies each component by its axis factor: [x, y, z]. Others pass through. */
function scaleAxes(value: unknown, factors: number[]): unknown {
  if (!isArray(value)) return typeof value === "number" ? value * (factors[0] as number) : value;
  const list = value as number[];
  const out: number[] = [];
  for (let i = 0; i < list.length; i += 1) out[i] = i < factors.length ? (list[i] as number) * (factors[i] as number) : (list[i] as number);
  return out;
}

function isIdentity(factors: number[]): boolean {
  for (let i = 0; i < factors.length; i += 1) if (Math.abs((factors[i] as number) - 1) > EPSILON) return false;
  return true;
}

/** Applies `change` to a property's static value or to every keyframe. */
function transformProperty(prop: AeRawProp | null, change: (value: unknown) => unknown, tangents?: number[]): void {
  if (!prop) return;
  if (prop.numKeys > 0) {
    for (let k = 1; k <= prop.numKeys; k += 1) {
      prop.setValueAtKey(k, change(prop.keyValue(k)));
      if (tangents !== undefined && !isIdentity(tangents) && prop.isSpatial) {
        prop.setSpatialTangentsAtKey(
          k,
          scaleAxes(prop.keyInSpatialTangent(k), tangents) as number[],
          scaleAxes(prop.keyOutSpatialTangent(k), tangents) as number[],
        );
      }
    }
  } else {
    prop.setValue(change(prop.value));
  }
}

function mapPosition(layer: AeRawLayer, map: Mapping, tangents: number[]): void {
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
  transformProperty(position, (v) => mapVector(v, map), tangents);
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
  const even = fit === "fit" ? Math.min(rx, ry) : fit === "fill" ? Math.max(rx, ry) : 1;
  const kx = fit === "stretch" ? rx : even;
  const ky = fit === "stretch" ? ry : even;
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
    kx: kx,
    ky: ky,
    kz: Math.abs(kx - ky) < EPSILON ? kx : 1,
    map: function (x: number, y: number): [number, number] {
      return [kx * (x - ax) + bx, ky * (y - ay) + by];
    },
    rx: rx,
    ry: ry,
    backgrounds: args["backgrounds"] !== false,
  };
}

// ---------------------------------------------------------------------------
// Backgrounds
// ---------------------------------------------------------------------------

/** Pixels a background may fall short of the frame by and still count. */
const COVER_TOLERANCE = 2;
const LEVEL_ROTATION = 0.01;

function isStatic(prop: AeRawProp | null): boolean {
  return !!prop && prop.numKeys === 0 && !(prop.expressionEnabled && prop.expression);
}

function isTextLayer(layer: AeRawLayer): boolean {
  return !!layer.property("ADBE Text Properties");
}

function isShapeLayer(layer: AeRawLayer): boolean {
  return !!layer.property("ADBE Root Vectors Group");
}

interface SolidSource {
  readonly color: number[];
}

function solidOf(layer: AeRawLayer): SolidSource | null {
  const source = layer.source as (AeRawItem & { mainSource?: { color?: unknown } | null }) | null | undefined;
  const main = source ? source.mainSource : null;
  return main && isArray(main.color) ? (main as SolidSource) : null;
}

/**
 * A layer that fills the old frame: flat, unrotated, still, not text, and
 * covering every edge.
 */
function coversFrame(comp: AeRawComp, layer: AeRawLayer): boolean {
  if (layer.threeDLayer === true || layer.nullLayer === true || isTextLayer(layer)) return false;
  if (typeof layer.sourceRectAtTime !== "function") return false;
  const transform = layer.property(TRANSFORM);
  if (!transform) return false;
  const position = transform.property("ADBE Position");
  const anchor = transform.property("ADBE Anchor Point");
  const scale = transform.property("ADBE Scale");
  const rotation = transform.property("ADBE Rotate Z");
  if (!position || position.dimensionsSeparated === true) return false;
  if (!isStatic(position) || !isStatic(anchor) || !isStatic(scale) || !isStatic(rotation)) return false;
  if (rotation && Math.abs(rotation.value as number) > LEVEL_ROTATION) return false;
  const p = position.value as number[];
  const a = (anchor ? anchor.value : [0, 0]) as number[];
  const s = (scale ? scale.value : [PERCENT, PERCENT]) as number[];
  const time = Math.max(0, Math.min(comp.duration, layer.inPoint));
  const r = layer.sourceRectAtTime(time, false);
  const sx = (s[0] as number) / PERCENT;
  const sy = (s[1] as number) / PERCENT;
  const x0 = (p[0] as number) + (r.left - (a[0] as number)) * sx;
  const x1 = (p[0] as number) + (r.left + r.width - (a[0] as number)) * sx;
  const y0 = (p[1] as number) + (r.top - (a[1] as number)) * sy;
  const y1 = (p[1] as number) + (r.top + r.height - (a[1] as number)) * sy;
  return (
    Math.min(x0, x1) <= COVER_TOLERANCE &&
    Math.min(y0, y1) <= COVER_TOLERANCE &&
    Math.max(x0, x1) >= comp.width - COVER_TOLERANCE &&
    Math.max(y0, y1) >= comp.height - COVER_TOLERANCE
  );
}

/** Scales every point an effect places in layer space, at any depth of its groups. */
function scaleEffectPoints(env: AeEnvironment, group: AeRawProp, factors: number[], depth: number): void {
  const types = env.valueTypes();
  for (let i = 1; i <= group.numProperties; i += 1) {
    const prop = group.property(i);
    if (!prop) continue;
    if (prop.propertyType !== env.leafPropertyType()) {
      if (depth < MAX_EFFECT_DEPTH) scaleEffectPoints(env, prop, factors, depth + 1);
      continue;
    }
    if (prop.propertyValueType === types.twoDSpatial || prop.propertyValueType === types.threeDSpatial) {
      transformProperty(prop, (v) => scaleAxes(v, factors), factors);
    }
  }
}

function scaleShapeValue(env: AeEnvironment, value: unknown, factors: number[]): unknown {
  const shape = value as { vertices?: number[][]; inTangents?: number[][]; outTangents?: number[][]; closed?: boolean } | null;
  if (!shape || !isArray(shape.vertices)) return value;
  const each = (list: number[][] | undefined): number[][] => {
    const out: number[][] = [];
    const source = list ?? [];
    for (let i = 0; i < source.length; i += 1) out[i] = scaleAxes(source[i], factors) as number[];
    return out;
  };
  return env.newShape(each(shape.vertices), each(shape.inTangents), each(shape.outTangents), shape.closed !== false);
}

/** Effect points and masks follow when a layer's own space is resized. */
function scaleLayerSpace(env: AeEnvironment, layer: AeRawLayer, factors: number[]): void {
  const effects = layer.property("ADBE Effect Parade");
  if (effects) {
    for (let i = 1; i <= effects.numProperties; i += 1) {
      const effect = effects.property(i);
      if (effect) scaleEffectPoints(env, effect, factors, 0);
    }
  }
  const masks = layer.property("ADBE Mask Parade");
  if (masks) {
    for (let i = 1; i <= masks.numProperties; i += 1) {
      const mask = masks.property(i);
      transformProperty(mask ? mask.property("ADBE Mask Shape") : null, (v) => scaleShapeValue(env, v, factors));
    }
  }
}

/** Makes a layer that covered the old frame cover the new one. */
function fillBackground(env: AeEnvironment, plan: Plan, layer: AeRawLayer): void {
  const comp = plan.comp;
  const transform = layer.property(TRANSFORM) as AeRawProp;
  const position = transform.property("ADBE Position") as AeRawProp;
  const anchor = transform.property("ADBE Anchor Point") as AeRawProp;
  const scale = transform.property("ADBE Scale") as AeRawProp;
  // Where it sits relative to the frame stays the same: centred stays centred.
  position.setValue(scaleAxes(position.value, [plan.rx, plan.ry]));

  const solid = solidOf(layer);
  const source = layer.source as (AeRawItem & { width?: number; height?: number; pixelAspect?: number }) | null | undefined;
  if (solid && source && typeof layer.replaceSource === "function" && source.width && source.height) {
    const width = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(source.width * plan.rx)));
    const height = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(source.height * plan.ry)));
    const factors = [width / source.width, height / source.height];
    // A solid of its own: other comps may share the old one.
    const maker = comp.layers.addSolid([solid.color[0] as number, solid.color[1] as number, solid.color[2] as number], source.name, width, height, source.pixelAspect ?? 1);
    const fresh = maker.source as AeRawItem;
    maker.remove();
    layer.replaceSource(fresh, false);
    anchor.setValue(scaleAxes(anchor.value, factors));
    scaleLayerSpace(env, layer, factors);
    return;
  }
  if (isShapeLayer(layer)) {
    scale.setValue(scaleAxes(scale.value, [plan.rx, plan.ry]));
    return;
  }
  const cover = Math.max(plan.rx, plan.ry);
  scale.setValue(scaleAxes(scale.value, [cover, cover]));
}

/** Runs `change` on a layer, unlocking it for the duration if it was locked. */
function unlocked(layer: AeRawLayer, tally: Tally, change: () => void): void {
  const wasLocked = layer.locked;
  if (wasLocked) {
    layer.locked = false;
    tally.unlocked += 1;
  }
  try {
    change();
  } finally {
    if (wasLocked) layer.locked = true;
  }
}

function moveContent(plan: Plan, layer: AeRawLayer): void {
  const factors = [plan.kx, plan.ky, plan.kz];
  mapPosition(layer, plan.map, factors);
  if (isIdentity(factors)) return;
  const transform = layer.property(TRANSFORM);
  const dims = layer.threeDLayer === true ? factors : [plan.kx, plan.ky];
  transformProperty(transform ? transform.property("ADBE Scale") : null, (v) => scaleAxes(v, dims));
}

/** Moves the content of one comp and changes its settings. */
function resizeOne(env: AeEnvironment, plan: Plan, extend: boolean, tally: Tally): void {
  const comp = plan.comp;
  const skips = tally.skips;
  // A layer something is parented to keeps its own space, so it is never
  // treated as a background whose space changes.
  const parents: { [id: string]: boolean } = {};
  for (let i = 1; i <= comp.numLayers; i += 1) {
    const parent = comp.layer(i).parent;
    if (parent) parents[String(parent.id)] = true;
  }
  const backgrounds: { [id: string]: boolean } = {};
  if (plan.backgrounds) {
    for (let i = 1; i <= comp.numLayers; i += 1) {
      const layer = comp.layer(i);
      if (!layer.parent && !parents[String(layer.id)] && !isCameraOrLight(layer) && coversFrame(comp, layer)) backgrounds[String(layer.id)] = true;
    }
  }
  const top: AeRawLayer[] = [];
  for (let i = 1; i <= comp.numLayers; i += 1) {
    const layer = comp.layer(i);
    if (!layer.parent) top[top.length] = layer;
  }

  for (let i = 0; i < top.length; i += 1) {
    const layer = top[i] as AeRawLayer;
    unlocked(layer, tally, function (): void {
      if (isCameraOrLight(layer)) {
        if (!isIdentity([plan.kx, plan.ky])) {
          skips[skips.length] = { comp: comp.name, name: layer.name, reason: "Cameras and lights are moved, not scaled" };
        }
        // A camera's point of interest is its Anchor Point property.
        const transform = layer.property(TRANSFORM);
        transformProperty(transform ? transform.property("ADBE Position") : null, (v) => mapVector(v, plan.map));
        transformProperty(transform ? transform.property("ADBE Anchor Point") : null, (v) => mapVector(v, plan.map));
        return;
      }
      if (backgrounds[String(layer.id)]) {
        fillBackground(env, plan, layer);
        tally.backgrounds += 1;
        return;
      }
      moveContent(plan, layer);
    });
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
        if (layer.outPoint < oldDuration - tolerance) continue;
        const target = plan.duration;
        unlocked(layer, tally, function (): void {
          try {
            layer.outPoint = target;
          } catch (cause) {
            // Footage cannot run past its own end without time remapping.
            void cause;
            skips[skips.length] = { comp: comp.name, name: layer.name, reason: "Could not extend: its footage ends sooner" };
          }
        });
      }
    }
  }
}

/** Corrects every precomp layer that shows a resized comp, wherever it is used. */
function fixUsers(ctx: OperationContext, plans: Plan[], tally: Tally): number {
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
      const transform = layer.property(TRANSFORM);
      if (!transform) continue;
      const inverse = [1 / plan.kx, 1 / plan.ky, 1 / plan.kz];
      unlocked(layer, tally, function (): void {
        transformProperty(transform.property("ADBE Anchor Point"), (v) => mapVector(v, plan.map));
        if (!isIdentity(inverse)) {
          const dims = layer.threeDLayer === true ? inverse : [inverse[0] as number, inverse[1] as number];
          transformProperty(transform.property("ADBE Scale"), (v) => scaleAxes(v, dims));
        }
      });
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

    const tally: Tally = { skips: [], backgrounds: 0, unlocked: 0 };
    const names: string[] = [];
    for (let i = 0; i < plans.length; i += 1) {
      const plan = plans[i] as Plan;
      resizeOne(ctx.env, plan, ctx.args["extend"] !== false, tally);
      names[names.length] = plan.comp.name + " → " + String(plan.width) + "×" + String(plan.height);
    }
    const parents = ctx.args["fixParents"] === false ? 0 : fixUsers(ctx, plans, tally);
    return {
      changedCount: plans.length,
      resized: names as unknown as HostJson,
      parentLayersFixed: parents,
      backgroundsFilled: tally.backgrounds,
      lockedLayersMoved: tally.unlocked,
      skipped: tally.skips as unknown as HostJson,
    };
  },
};

/**
 * Creates a composition and opens it, so the rest of the plan builds inside
 * it. Named after what it is for; a name already in use gets a number.
 */
export const createCompOperation: Operation = {
  id: "kvfx.op.comp.create",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const project = ctx.env.rawProject();
    if (!project || !project.items) throw hostError(ErrorCode.PreconditionFailed, "Open a project first.");
    const width = Math.round(readNumber(ctx.args, "width", NEW_COMP.width));
    const height = Math.round(readNumber(ctx.args, "height", NEW_COMP.height));
    const duration = readNumber(ctx.args, "duration", NEW_COMP.duration);
    const frameRate = readNumber(ctx.args, "frameRate", NEW_COMP.frameRate);
    if (width < MIN_SIZE || height < MIN_SIZE || width > MAX_SIZE || height > MAX_SIZE) {
      throw hostError(ErrorCode.InvalidArgument, "That size is outside what After Effects allows.");
    }
    if (!(duration > 0) || duration > MAX_DURATION || !(frameRate > 0) || frameRate > MAX_FPS) {
      throw hostError(ErrorCode.InvalidArgument, "Duration or frame rate is out of range.");
    }
    const base = readString(ctx.args, "name", "KVFX Comp");
    const taken: { [name: string]: boolean } = {};
    for (let i = 1; i <= project.numItems; i += 1) taken[project.item(i).name] = true;
    let name = base;
    for (let n = 2; taken[name]; n += 1) name = base + " " + String(n);
    const comp = project.items.addComp(name, width, height, 1, duration, frameRate);
    comp.openInViewer();
    return { id: comp.id, name: comp.name };
  },
};

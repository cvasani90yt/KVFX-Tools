import type { AeEnvironment } from "../../ae/environment.js";
import { hostError } from "../../runtime/errors.js";
import { ErrorCode } from "../../runtime/protocol.js";
import type { Operation, OperationContext } from "../../runtime/registry.js";
import type { HostJson } from "../../runtime/serialize.js";
import { layerById, requireComp, skipped, targets } from "../raw.js";

/**
 * Unprecompose: puts a precomp layer's layers back into the comp it sits in,
 * looking exactly as they did inside it.
 *
 * Each layer of the nested comp is copied in with After Effects' own layer
 * copy, so keyframes, effects, masks and expressions come along. The copies
 * keep their stacking order, directly above the precomp layer. Their time
 * shifts by the precomp layer's start and is trimmed to the span the precomp
 * layer showed. Parenting inside the nested comp is rebuilt between the copies.
 *
 * Space: when the precomp layer shows its comp 1:1 (top-left on top-left, no
 * scale, rotation, parent or animation), the copies keep their own values.
 * Otherwise they hang from a new null that carries the precomp layer's
 * transform, keyframes and expressions included, so every layer lands where it
 * was seen.
 *
 * Nothing is deleted. The precomp layer is switched off and stays below the
 * released layers, and the nested comp stays in the project. What a stack of
 * plain layers cannot reproduce, such as the precomp layer's effects, masks,
 * opacity, blending mode or track matte, is reported rather than guessed at.
 */

const TRANSFORM = "ADBE Transform Group";
const FULL = 100;
const NEAR = 0.001;
/** A copy on screen for less than this share of a frame never really showed. */
const MIN_FRAMES = 0.5;

interface Released {
  layers: number;
  notes: string[];
  skips: HostJson[];
  ids: number[];
}

function isStatic(prop: AeRawProp | null): boolean {
  return !prop || (prop.numKeys === 0 && !(prop.expressionEnabled && prop.expression));
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < NEAR;
}

/** True when the precomp layer draws its comp exactly over this one, untransformed. */
function showsOneToOne(layer: AeRawLayer): boolean {
  if (layer.parent) return false;
  const t = layer.property(TRANSFORM);
  if (!t) return false;
  const anchor = t.property("ADBE Anchor Point");
  const position = t.property("ADBE Position");
  const scale = t.property("ADBE Scale");
  const rotation = t.property("ADBE Rotate Z");
  if (!anchor || !position || !scale || !rotation || position.dimensionsSeparated === true) return false;
  if (!isStatic(anchor) || !isStatic(position) || !isStatic(scale) || !isStatic(rotation)) return false;
  const a = anchor.value as number[];
  const p = position.value as number[];
  const s = scale.value as number[];
  return near(p[0] as number, a[0] as number) && near(p[1] as number, a[1] as number) && near(s[0] as number, FULL) && near(s[1] as number, FULL) && near(rotation.value as number, 0);
}

/** Copies a property's value, keyframes (with their easing) and expression. */
function copyProperty(from: AeRawProp | null, to: AeRawProp | null): void {
  if (!from || !to) return;
  if (from.numKeys === 0) {
    to.setValue(from.value);
  } else {
    for (let k = 1; k <= from.numKeys; k += 1) to.setValueAtTime(from.keyTime(k), from.keyValue(k));
    for (let k = 1; k <= from.numKeys; k += 1) {
      to.setInterpolationTypeAtKey(k, from.keyInInterpolationType(k), from.keyOutInterpolationType(k));
      to.setTemporalEaseAtKey(k, from.keyInTemporalEase(k), from.keyOutTemporalEase(k));
      if (from.isSpatial) to.setSpatialTangentsAtKey(k, from.keyInSpatialTangent(k), from.keyOutSpatialTangent(k));
    }
  }
  if (from.expression) {
    to.expression = from.expression;
    to.expressionEnabled = from.expressionEnabled;
  }
}

/** A null that moves exactly as the precomp layer does. */
function transformNull(comp: AeRawComp, layer: AeRawLayer): AeRawLayer {
  const holder = comp.layers.addNull();
  holder.name = layer.name + " · released";
  holder.label = layer.label;
  const from = layer.property(TRANSFORM) as AeRawProp;
  const to = holder.property(TRANSFORM) as AeRawProp;
  copyProperty(from.property("ADBE Anchor Point"), to.property("ADBE Anchor Point"));
  const position = from.property("ADBE Position");
  if (position && position.dimensionsSeparated === true) {
    (to.property("ADBE Position") as unknown as { dimensionsSeparated: boolean }).dimensionsSeparated = true;
    copyProperty(from.property("ADBE Position_0"), to.property("ADBE Position_0"));
    copyProperty(from.property("ADBE Position_1"), to.property("ADBE Position_1"));
  } else {
    copyProperty(position, to.property("ADBE Position"));
  }
  copyProperty(from.property("ADBE Scale"), to.property("ADBE Scale"));
  copyProperty(from.property("ADBE Rotate Z"), to.property("ADBE Rotate Z"));
  if (layer.parent && typeof holder.setParentWithJump === "function") holder.setParentWithJump(layer.parent);
  holder.moveBefore(layer);
  return holder;
}

function count(group: AeRawProp | null): number {
  return group ? group.numProperties : 0;
}

/** What the precomp layer does that plain layers cannot. */
function lostLooks(env: AeEnvironment, layer: AeRawLayer, notes: string[]): void {
  const effects = count(layer.property("ADBE Effect Parade"));
  if (effects > 0) notes.push("its " + String(effects) + " effect" + (effects === 1 ? "" : "s") + " stay on the switched-off precomp layer");
  const masks = count(layer.property("ADBE Mask Parade"));
  if (masks > 0) notes.push("its mask" + (masks === 1 ? "" : "s") + " stay on the switched-off precomp layer");
  const t = layer.property(TRANSFORM);
  const opacity = t ? t.property("ADBE Opacity") : null;
  if (opacity && (!isStatic(opacity) || !near(opacity.value as number, FULL))) notes.push("its opacity is not carried over");
  if (typeof layer.trackMatteType === "number" && layer.trackMatteType !== env.trackMatteTypes().none) notes.push("its track matte is not carried over");
  if (typeof layer.blendingMode === "number" && layer.blendingMode !== env.blendingModes().normal) notes.push("its blending mode is not carried over");
}

function release(ctx: OperationContext, comp: AeRawComp, layer: AeRawLayer, out: Released): void {
  const nested = layer.source as AeRawComp;
  const start = layer.startTime;
  const shownFrom = layer.inPoint;
  const shownTo = layer.outPoint;
  const tooShort = comp.frameDuration * MIN_FRAMES;
  const taken: { [name: string]: boolean } = {};
  for (let i = 1; i <= comp.numLayers; i += 1) taken[comp.layer(i).name] = true;
  const holder = showsOneToOne(layer) ? null : transformNull(comp, layer);
  if (holder) out.ids.push(holder.id);

  // copies[i] is the copy of the nested comp's layer i + 1, or null.
  const copies: (AeRawLayer | null)[] = [];
  const relock: AeRawLayer[] = [];
  let released = 0;
  let cameras = 0;
  let unseen = 0;
  let clashes = 0;
  let solid = 0;
  for (let i = 1; i <= nested.numLayers; i += 1) {
    const inner = nested.layer(i);
    if (typeof inner.sourceRectAtTime !== "function" || typeof inner.copyToComp !== "function") {
      // Cameras and lights would start driving this comp's 3D layers.
      cameras += 1;
      copies.push(null);
      continue;
    }
    inner.copyToComp(comp);
    const copy = comp.layer(1);
    copy.moveBefore(layer);
    if (copy.locked) {
      copy.locked = false;
      relock.push(copy);
    }
    copy.startTime = copy.startTime + start;
    if (copy.inPoint < shownFrom) copy.inPoint = shownFrom;
    if (copy.outPoint > shownTo) copy.outPoint = shownTo;
    if (copy.outPoint - copy.inPoint < tooShort) {
      copy.remove();
      unseen += 1;
      copies.push(null);
      continue;
    }
    copies.push(copy);
    out.ids.push(copy.id);
    released += 1;
    if (taken[copy.name]) clashes += 1;
    if (copy.threeDLayer === true) solid += 1;
  }

  // Parenting and track mattes inside the nested comp, rebuilt between copies;
  // its top-level layers hang from the null when there is one.
  for (let i = 0; i < copies.length; i += 1) {
    const copy = copies[i];
    if (!copy) continue;
    const inner = nested.layer(i + 1);
    const innerParent = inner.parent;
    const parentCopy = innerParent ? copies[innerParent.index - 1] : null;
    const parent = parentCopy ? parentCopy : holder;
    if (typeof copy.setParentWithJump === "function") copy.setParentWithJump(parent);
    const matte = inner.trackMatteLayer;
    if (matte && typeof copy.setTrackMatte === "function" && typeof inner.trackMatteType === "number") {
      const matteCopy = copies[matte.index - 1];
      if (matteCopy) copy.setTrackMatte(matteCopy, inner.trackMatteType);
    }
  }
  for (let i = 0; i < relock.length; i += 1) (relock[i] as AeRawLayer).locked = true;

  layer.enabled = false;
  out.layers += released;
  out.notes.push(String(released) + " layer" + (released === 1 ? "" : "s") + " released from " + nested.name + (holder ? " onto a null" : ""));
  if (cameras > 0) out.notes.push(String(cameras) + " camera or light layer" + (cameras === 1 ? "" : "s") + " left inside");
  if (clashes > 0) out.notes.push(String(clashes) + " released layer" + (clashes === 1 ? " shares its name" : "s share their names") + " with a layer already here, so expressions that find layers by name may pick the other one");
  if (solid > 0) out.notes.push(String(solid) + " 3D layer" + (solid === 1 ? " now uses" : "s now use") + " this comp's camera and lights");
  if (unseen > 0) out.notes.push(String(unseen) + " layer" + (unseen === 1 ? " was" : "s were") + " never on screen in the precomp layer's span and " + (unseen === 1 ? "was" : "were") + " left out");
  lostLooks(ctx.env, layer, out.notes);
}

export const unprecomposeOperation: Operation = {
  id: "kvfx.op.layer.unprecompose",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const out: Released = { layers: 0, notes: [], skips: [], ids: [] };

    // Ids first: every release adds layers and shifts indices.
    const ids: number[] = [];
    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      const source = layer.source;
      if (!source || !ctx.env.isComp(source)) out.skips.push(skipped(layer, "Not a precomp layer"));
      else if (layer.locked) out.skips.push(skipped(layer, "Layer is locked"));
      else if (layer.threeDLayer === true) out.skips.push(skipped(layer, "3D precomp layers would look different released; turn off 3D first"));
      else if (layer.timeRemapEnabled === true || !near(layer.stretch, FULL)) out.skips.push(skipped(layer, "Time-remapped or stretched precomp layers can't keep their timing"));
      else if ((source as AeRawComp).numLayers === 0) out.skips.push(skipped(layer, "The precomp is empty"));
      else ids.push(layer.id);
    }
    if (ids.length === 0 && out.skips.length === 0) throw hostError(ErrorCode.PreconditionFailed, "Select a precomp layer.");

    for (let i = 0; i < ids.length; i += 1) {
      const layer = layerById(comp, ids[i] as number);
      if (layer) release(ctx, comp, layer, out);
    }
    return {
      changedCount: ids.length,
      releasedCount: out.layers,
      ids: out.ids as unknown as HostJson,
      notes: out.notes as unknown as HostJson,
      skipped: out.skips as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

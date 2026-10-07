import { isArray } from "../runtime/es3.js";
import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";
import { type Args, layerById, readColor, requireComp, skipped, targets } from "./raw.js";

/**
 * Text layer operations.
 *
 * After Effects invalidates every reference into a text layer's property tree
 * when a property is added to it. Each helper here therefore re-walks from the
 * layer by index after every `addProperty`, instead of holding on to a group
 * object that may already be dead.
 */

const TEXT_GROUP = "ADBE Text Properties";
const ANIMATORS = "ADBE Text Animators";
const ANIMATOR = "ADBE Text Animator";
const ANIMATOR_PROPS = "ADBE Text Animator Properties";
const SELECTORS = "ADBE Text Selectors";
const SELECTOR = "ADBE Text Selector";
const ADVANCED = "ADBE Text Range Advanced";

/** Range selector "Units": 1 = Percentage, 2 = Index. */
const UNITS_PERCENT = 1;
const UNITS_INDEX = 2;
/** Range selector "Mode": 1 = Add, 2 = Subtract. */
const MODE_SUBTRACT = 2;

const MAX_EXPLODE = 300;

function isTextLayer(layer: AeRawLayer): boolean {
  return layer.property(TEXT_GROUP) !== null;
}

function animatorAt(layer: AeRawLayer, index: number): AeRawProp {
  const group = (layer.property(TEXT_GROUP) as AeRawProp).property(ANIMATORS) as AeRawProp;
  return group.property(index) as AeRawProp;
}

function setIfPresent(group: AeRawProp, matchName: string, value: HostJson | undefined): void {
  if (value === undefined) return;
  const prop = group.property(matchName);
  if (prop) prop.setValue(value);
}

function keyIfPresent(group: AeRawProp, matchName: string, keys: HostJson | undefined, offset: number): void {
  if (!isArray(keys)) return;
  const prop = group.property(matchName);
  if (!prop) return;
  const list = keys as HostJson[];
  for (let i = 0; i < list.length; i += 1) {
    const key = list[i] as Args;
    if (key && typeof key["time"] === "number" && typeof key["value"] === "number") {
      prop.setValueAtTime(offset + (key["time"]), key["value"]);
    }
  }
}

/**
 * Adds one animator to a text layer.
 *
 * `spec`:
 *   name        animator name
 *   properties  [{ matchName, value }]  — what the animator changes
 *   selectors   [{ units: "percent" | "index", mode: "add" | "subtract",
 *                  start, end, offset, amount, easeHigh, easeLow,
 *                  keys: { start, end, offset: [{ time, value }] } }]
 */
function addAnimator(layer: AeRawLayer, spec: Args, timeOffset: number): void {
  const animators = (layer.property(TEXT_GROUP) as AeRawProp).property(ANIMATORS) as AeRawProp;
  const created = animators.addProperty(ANIMATOR);
  const index = created.propertyIndex;
  if (typeof spec["name"] === "string") animatorAt(layer, index).name = spec["name"];

  const props = isArray(spec["properties"]) ? (spec["properties"] as HostJson[]) : [];
  for (let i = 0; i < props.length; i += 1) {
    const entry = props[i] as Args;
    if (!entry || typeof entry["matchName"] !== "string") continue;
    const group = animatorAt(layer, index).property(ANIMATOR_PROPS) as AeRawProp;
    const prop = group.addProperty(entry["matchName"]);
    if (entry["value"] !== undefined) prop.setValue(entry["value"]);
  }

  const selectors = isArray(spec["selectors"]) ? (spec["selectors"] as HostJson[]) : [];
  for (let s = 0; s < selectors.length; s += 1) {
    const sel = selectors[s] as Args;
    if (!sel) continue;
    // Some versions create an animator with a range selector already in it;
    // reuse it rather than stacking a second one on top.
    const group = animatorAt(layer, index).property(SELECTORS) as AeRawProp;
    if (group.numProperties < s + 1) group.addProperty(SELECTOR);
    const selector = (animatorAt(layer, index).property(SELECTORS) as AeRawProp).property(s + 1) as AeRawProp;
    const advanced = selector.property(ADVANCED) as AeRawProp;

    const byIndex = sel["units"] === "index";
    setIfPresent(advanced, "ADBE Text Range Units", byIndex ? UNITS_INDEX : UNITS_PERCENT);
    if (sel["mode"] === "subtract") setIfPresent(advanced, "ADBE Text Selector Mode", MODE_SUBTRACT);
    setIfPresent(advanced, "ADBE Text Selector Max Amount", sel["amount"]);
    setIfPresent(advanced, "ADBE Text Levels Max Ease", sel["easeHigh"]);
    setIfPresent(advanced, "ADBE Text Levels Min Ease", sel["easeLow"]);
    setIfPresent(advanced, "ADBE Text Selector Smoothness", sel["smoothness"]);

    const start = byIndex ? "ADBE Text Index Start" : "ADBE Text Percent Start";
    const end = byIndex ? "ADBE Text Index End" : "ADBE Text Percent End";
    const offset = byIndex ? "ADBE Text Index Offset" : "ADBE Text Percent Offset";
    // End first, so a start beyond the default end is never briefly inverted.
    setIfPresent(selector, end, sel["end"]);
    setIfPresent(selector, start, sel["start"]);
    setIfPresent(selector, offset, sel["offset"]);

    const keys = sel["keys"] as Args | undefined;
    if (keys && typeof keys === "object") {
      keyIfPresent(selector, start, keys["start"], timeOffset);
      keyIfPresent(selector, end, keys["end"], timeOffset);
      keyIfPresent(selector, offset, keys["offset"], timeOffset);
    }
  }
}

export const addAnimatorOperation: Operation = {
  id: "kvfx.op.text.addAnimator",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const spec = ctx.args["animator"];
    if (!spec || typeof spec !== "object" || isArray(spec)) {
      throw hostError(ErrorCode.InvalidArgument, "animator must be an object.");
    }
    const offset = ctx.args["relative"] === true ? comp.time : 0;

    let changed = 0;
    const skips: HostJson[] = [];
    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      if (!isTextLayer(layer)) {
        skips[skips.length] = skipped(layer, "Not a text layer");
        continue;
      }
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      addAnimator(layer, spec as Args, offset);
      changed += 1;
    }
    return {
      changedCount: changed,
      skipped: skips as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

/**
 * Splits a text layer into one layer per character, word or line.
 *
 * Each piece is a duplicate of the original with an animator that hides every
 * character outside its range: a full-range selector sets opacity to zero and
 * an index selector in Subtract mode carves the piece back out. Pieces stay
 * live text in exactly their original positions, with the original's styling
 * and animation. The ranges are computed in `@kvfx/core` from the text itself.
 *
 * The original is hidden, not deleted.
 */
export const explodeTextOperation: Operation = {
  id: "kvfx.op.text.explode",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const id = ctx.args["id"];
    const layer = typeof id === "number" ? layerById(comp, id) : undefined;
    if (!layer) throw hostError(ErrorCode.TargetNotFound, "The text layer no longer exists.");
    if (!isTextLayer(layer)) throw hostError(ErrorCode.PreconditionFailed, "Choose a text layer to explode.");
    if (layer.locked) throw hostError(ErrorCode.PreconditionFailed, "The text layer is locked.");

    const ranges = ctx.args["ranges"];
    if (!isArray(ranges)) throw hostError(ErrorCode.InvalidArgument, "ranges must be an array.");
    const list = ranges as HostJson[];
    if (list.length === 0) throw hostError(ErrorCode.PreconditionFailed, "There is nothing to split.");
    if (list.length > MAX_EXPLODE) {
      throw hostError(ErrorCode.PreconditionFailed, "That would make more than " + String(MAX_EXPLODE) + " layers.");
    }

    const ids: number[] = [];
    for (let i = 0; i < list.length; i += 1) {
      const range = list[i] as Args;
      const start = range["start"];
      const end = range["end"];
      if (typeof start !== "number" || typeof end !== "number" || end <= start) continue;

      const piece = layer.duplicate();
      if (typeof range["name"] === "string" && (range["name"]).length > 0) piece.name = range["name"];
      addAnimator(
        piece,
        {
          name: "KVFX Split",
          properties: [{ matchName: "ADBE Text Opacity", value: 0 }],
          selectors: [
            { units: "percent", start: 0, end: 100 },
            { units: "index", mode: "subtract", start: start, end: end },
          ],
        },
        0,
      );
      ids[ids.length] = piece.id;
    }

    layer.enabled = false;
    return { ids: ids as unknown as HostJson, hiddenId: layer.id };
  },
};

/**
 * Restyles text: font, size, fill, tracking, and optionally the text itself.
 *
 * Applied to the whole layer through its Source Text document. Animated
 * Source Text is skipped — rewriting its keyframes would change the
 * animation, not the style.
 */
export const setTextStyleOperation: Operation = {
  id: "kvfx.op.text.setStyle",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    const args = ctx.args;

    let changed = 0;
    const skips: HostJson[] = [];
    for (let i = 0; i < resolved.layers.length; i += 1) {
      const layer = resolved.layers[i] as AeRawLayer;
      if (!isTextLayer(layer)) {
        skips[skips.length] = skipped(layer, "Not a text layer");
        continue;
      }
      if (layer.locked) {
        skips[skips.length] = skipped(layer, "Layer is locked");
        continue;
      }
      const source = (layer.property(TEXT_GROUP) as AeRawProp).property("ADBE Text Document") as AeRawProp;
      if (source.numKeys > 0) {
        skips[skips.length] = skipped(layer, "Source Text is animated");
        continue;
      }
      const doc = source.value as AeRawTextDocument;
      if (typeof args["text"] === "string") doc.text = args["text"];
      if (typeof args["font"] === "string" && (args["font"]).length > 0) doc.font = args["font"];
      if (typeof args["fontSize"] === "number" && (args["fontSize"]) > 0) doc.fontSize = args["fontSize"];
      if (isArray(args["fillColor"])) {
        doc.applyFill = true;
        doc.fillColor = readColor(args, "fillColor", [1, 1, 1]);
      }
      if (typeof args["tracking"] === "number") doc.tracking = args["tracking"];
      source.setValue(doc);
      changed += 1;
    }
    return {
      changedCount: changed,
      skipped: skips as unknown as HostJson,
      missingIds: resolved.missing as unknown as HostJson,
    };
  },
};

/** Reads a text layer's string, for computing explode ranges in core. */
export const readTextOperation: Operation = {
  id: "kvfx.op.text.read",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const selected = comp.selectedLayers;
    for (let i = 0; i < selected.length; i += 1) {
      const layer = selected[i] as AeRawLayer;
      if (!isTextLayer(layer)) continue;
      const source = (layer.property(TEXT_GROUP) as AeRawProp).property("ADBE Text Document") as AeRawProp;
      const doc = source.value as AeRawTextDocument;
      return { id: layer.id, name: layer.name, text: doc.text };
    }
    throw hostError(ErrorCode.PreconditionFailed, "Select a text layer.");
  },
};

export const textOperations: Operation[] = [
  addAnimatorOperation,
  explodeTextOperation,
  setTextStyleOperation,
  readTextOperation,
];

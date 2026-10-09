import { isArray } from "../runtime/es3.js";
import { hostError } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";
import { type Bezier, easeKeys, readBezier } from "./keys.js";
import { stampTime } from "./prop.js";
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
const EXPRESSION_SELECTOR = "ADBE Text Expressible Selector";
const KEY_TOLERANCE = 1e-6;
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

function keyIfPresent(
  env: OperationContext["env"],
  group: AeRawProp,
  matchName: string,
  keys: HostJson | undefined,
  offset: number,
  scale: number,
  bezier: Bezier | undefined,
): void {
  if (!isArray(keys)) return;
  const prop = group.property(matchName);
  if (!prop) return;
  const list = keys as HostJson[];
  const times: number[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const key = list[i] as Args;
    if (key && typeof key["time"] === "number" && typeof key["value"] === "number") {
      const time = offset + key["time"] * scale;
      prop.setValueAtTime(time, key["value"]);
      times[times.length] = time;
    }
  }
  if (!bezier || times.length < 2) return;
  const indices: number[] = [];
  for (let i = 0; i < times.length; i += 1) {
    for (let k = 1; k <= prop.numKeys; k += 1) {
      if (Math.abs(prop.keyTime(k) - (times[i] as number)) < KEY_TOLERANCE) indices[indices.length] = k;
    }
  }
  easeKeys(env, prop, indices, bezier);
}

/** Range selector "Based On": characters, characters without spaces, words, lines. */
const BASED_ON: { [unit: string]: number } = { characters: 1, glyphs: 2, words: 3, lines: 4 };

function basedOn(value: HostJson | undefined): number | undefined {
  return typeof value === "string" ? BASED_ON[value] : undefined;
}

/**
 * Adds one animator to a text layer.
 *
 * `spec`:
 *   name        animator name
 *   properties  [{ matchName, value }]  — what the animator changes
 *   selectors   [{ type: "range" | "expression",
 *                  range:      units: "percent" | "index", mode: "add" | "subtract",
 *                              basedOn, randomize, seed, shape,
 *                              start, end, offset, amount, easeHigh, easeLow, smoothness,
 *                              keys: { start, end, offset: [{ time, value }] }
 *                  expression: basedOn, expression }]
 *   ease        [x1, y1, x2, y2] — eases every selector keyframe written
 *
 * `timing` stretches normalised key times (0–1) to the layer's own text:
 * stagger × (units − 1) + duration seconds, counted in characters, words or
 * lines, and anchored at the playhead or so that it ends at the layer's out
 * point. Only the host can count, because only it can read every selected
 * layer's text at the moment the plan runs.
 */
function addAnimator(
  env: OperationContext["env"],
  layer: AeRawLayer,
  spec: Args,
  timeOffset: number,
  stampNow: number | undefined,
): void {
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

  const timing = readTiming(layer, spec["timing"]);
  let offset = timeOffset;
  let scale = 1;
  if (timing) {
    scale = timing.total;
    offset = timing.anchor === "end" ? layer.outPoint - timing.total : timeOffset;
  }
  const bezier = spec["ease"] === undefined ? undefined : readBezier(spec["ease"]);

  const selectors = isArray(spec["selectors"]) ? (spec["selectors"] as HostJson[]) : [];
  let auto = 0;
  for (let s = 0; s < selectors.length; s += 1) {
    const sel = selectors[s] as Args;
    if (!sel) continue;
    const position = s + 1 + auto;
    const isExpression = sel["type"] === "expression";
    const group = animatorAt(layer, index).property(SELECTORS) as AeRawProp;

    if (isExpression) {
      group.addProperty(EXPRESSION_SELECTOR);
      // A version that pre-filled a full range selector leaves it first; it
      // selects everything, so the expression selector below it decides.
      const fresh = animatorAt(layer, index).property(SELECTORS) as AeRawProp;
      const selector = fresh.property(fresh.numProperties) as AeRawProp;
      auto = fresh.numProperties - (s + 1);
      setIfPresent(selector, "ADBE Text Range Type2", basedOn(sel["basedOn"]));
      const amount = expressionAmount(selector);
      const source = typeof sel["expression"] === "string" ? sel["expression"] : "";
      if (amount && source.length > 0) {
        amount.expression = stampNow === undefined ? source : stampTime(source, stampNow);
        amount.expressionEnabled = true;
      }
      continue;
    }

    // Some versions create an animator with a range selector already in it;
    // reuse it rather than stacking a second one on top.
    if (group.numProperties < position) group.addProperty(SELECTOR);
    const selector = (animatorAt(layer, index).property(SELECTORS) as AeRawProp).property(position) as AeRawProp;
    const advanced = selector.property(ADVANCED) as AeRawProp;

    const byIndex = sel["units"] === "index";
    setIfPresent(advanced, "ADBE Text Range Units", byIndex ? UNITS_INDEX : UNITS_PERCENT);
    setIfPresent(advanced, "ADBE Text Range Type2", basedOn(sel["basedOn"]));
    if (sel["mode"] === "subtract") setIfPresent(advanced, "ADBE Text Selector Mode", MODE_SUBTRACT);
    setIfPresent(advanced, "ADBE Text Selector Max Amount", sel["amount"]);
    setIfPresent(advanced, "ADBE Text Range Shape", sel["shape"]);
    setIfPresent(advanced, "ADBE Text Levels Max Ease", sel["easeHigh"]);
    setIfPresent(advanced, "ADBE Text Levels Min Ease", sel["easeLow"]);
    setIfPresent(advanced, "ADBE Text Selector Smoothness", sel["smoothness"]);
    if (sel["randomize"] === true) {
      setIfPresent(advanced, "ADBE Text Randomize Order", 1);
      setIfPresent(advanced, "ADBE Text Random Seed", sel["seed"]);
    }

    const start = byIndex ? "ADBE Text Index Start" : "ADBE Text Percent Start";
    const end = byIndex ? "ADBE Text Index End" : "ADBE Text Percent End";
    const off = byIndex ? "ADBE Text Index Offset" : "ADBE Text Percent Offset";
    // End first, so a start beyond the default end is never briefly inverted.
    setIfPresent(selector, end, sel["end"]);
    setIfPresent(selector, start, sel["start"]);
    setIfPresent(selector, off, sel["offset"]);

    const keys = sel["keys"] as Args | undefined;
    if (keys && typeof keys === "object") {
      keyIfPresent(env, selector, start, keys["start"], offset, scale, bezier);
      keyIfPresent(env, selector, end, keys["end"], offset, scale, bezier);
      keyIfPresent(env, selector, off, keys["offset"], offset, scale, bezier);
    }
  }
}

/** The expression selector's Amount, found by match name or, failing that, by role. */
function expressionAmount(selector: AeRawProp): AeRawProp | null {
  const named = selector.property("ADBE Text Expressible Amount");
  if (named) return named;
  for (let i = selector.numProperties; i >= 1; i -= 1) {
    const child = selector.property(i);
    if (child && child.canSetExpression) return child;
  }
  return null;
}

interface Timing {
  readonly total: number;
  readonly anchor: "playhead" | "end";
}

const MAX_TIMING_SECONDS = 3600;
const ETX = 3;

/** Characters (spaces excluded), words or lines in a text layer's string. */
export function countUnits(text: string, unit: string): number {
  if (unit === "lines") {
    // After Effects marks a soft line break with ETX (character 3).
    const lines = text.split(String.fromCharCode(ETX)).join("\n").split(/\r\n|\r|\n/);
    let n = 0;
    for (let i = 0; i < lines.length; i += 1) if (/\S/.test(lines[i] as string)) n += 1;
    return n;
  }
  if (unit === "words") {
    const words = text.split(/\s+/);
    let n = 0;
    for (let i = 0; i < words.length; i += 1) if ((words[i] as string).length > 0) n += 1;
    return n;
  }
  return text.replace(/\s+/g, "").length;
}

function readTiming(layer: AeRawLayer, raw: HostJson | undefined): Timing | undefined {
  if (!raw || typeof raw !== "object" || isArray(raw)) return undefined;
  const bag = raw as Args;
  const stagger = typeof bag["stagger"] === "number" ? bag["stagger"] : 0;
  const duration = typeof bag["duration"] === "number" ? bag["duration"] : 0;
  const unit = typeof bag["unit"] === "string" ? bag["unit"] : "characters";
  const source = (layer.property(TEXT_GROUP) as AeRawProp).property("ADBE Text Document") as AeRawProp;
  const text = (source.value as AeRawTextDocument).text;
  const count = Math.max(1, countUnits(String(text), unit));
  let total = stagger * (count - 1) + duration;
  if (!(total > 0)) total = duration > 0 ? duration : 1;
  if (total > MAX_TIMING_SECONDS) total = MAX_TIMING_SECONDS;
  return { total: total, anchor: bag["anchor"] === "end" ? "end" : "playhead" };
}

export const addAnimatorOperation: Operation = {
  id: "kvfx.op.text.addAnimator",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const resolved = targets(comp, ctx.args);
    // One animator, or several applied together (an in and an out, say).
    const many = ctx.args["animators"];
    const specs: Args[] = [];
    if (isArray(many)) {
      const list = many as HostJson[];
      for (let i = 0; i < list.length; i += 1) {
        const entry = list[i];
        if (!entry || typeof entry !== "object" || isArray(entry)) {
          throw hostError(ErrorCode.InvalidArgument, "Each animator must be an object.");
        }
        specs[specs.length] = entry as Args;
      }
    } else {
      const spec = ctx.args["animator"];
      if (!spec || typeof spec !== "object" || isArray(spec)) {
        throw hostError(ErrorCode.InvalidArgument, "animator must be an object.");
      }
      specs[0] = spec as Args;
    }
    if (specs.length === 0) throw hostError(ErrorCode.InvalidArgument, "There is no animator to add.");
    const relative = ctx.args["relative"] === true;
    const offset = relative ? comp.time : 0;

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
      for (let a = 0; a < specs.length; a += 1) {
        addAnimator(ctx.env, layer, specs[a] as Args, offset, relative ? comp.time : undefined);
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
        ctx.env,
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
        undefined,
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
      const align = args["justification"];
      if (align === "left" || align === "center" || align === "right") doc.justification = ctx.env.justifications()[align];
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

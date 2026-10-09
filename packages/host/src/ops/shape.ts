import { isArray } from "../runtime/es3.js";
import { hostError, labelOf } from "../runtime/errors.js";
import { ErrorCode } from "../runtime/protocol.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";
import { stampTime } from "./prop.js";
import { type Args, layerById, readColor, requireComp, resolvePath } from "./raw.js";

/**
 * Builds vector content inside a shape layer.
 *
 * Generators describe artwork as data — groups of rectangles, ellipses and
 * paths with fills, strokes and repeaters — and this turns it into After
 * Effects shape groups. Like text animators, shape groups invalidate
 * references when something is added to them, so every step re-walks from
 * the layer by index instead of holding on to a group object.
 *
 * `groups`: [{ name, items: [item], transform: { position, anchor, scale, rotation, opacity } }]
 * Each group may also carry `expressions: [{ path, expression }]`, paths
 * relative to the group, so a generator with hundreds of animated groups is
 * one step rather than hundreds. With `relative`, `__KVFX_NOW__` in them
 * becomes the current time.
 *
 * item:      { type: "rect", name, size, position, roundness }
 *            { type: "ellipse", name, size, position }
 *            { type: "path", name, vertices, inTangents, outTangents, closed }
 *            { type: "fill", name, color, opacity }
 *            { type: "stroke", name, color, width, opacity }
 *            { type: "repeater", name, copies, offset, position, scale, endOpacity }
 */

const ROOT = "ADBE Root Vectors Group";
const GROUP = "ADBE Vector Group";
const CONTENTS = "ADBE Vectors Group";
const TRANSFORM = "ADBE Vector Transform Group";
const MAX_GROUPS = 400;
const MAX_ITEMS = 40;
const OPAQUE = 1;

const ITEM_MATCH_NAMES: { [type: string]: string } = {
  rect: "ADBE Vector Shape - Rect",
  ellipse: "ADBE Vector Shape - Ellipse",
  path: "ADBE Vector Shape - Group",
  fill: "ADBE Vector Graphic - Fill",
  stroke: "ADBE Vector Graphic - Stroke",
  repeater: "ADBE Vector Filter - Repeater",
};

function groupAt(layer: AeRawLayer, index: number): AeRawProp {
  return (layer.property(ROOT) as AeRawProp).property(index) as AeRawProp;
}

function contentsAt(layer: AeRawLayer, groupIndex: number): AeRawProp {
  return groupAt(layer, groupIndex).property(CONTENTS) as AeRawProp;
}

function set(group: AeRawProp | null, matchName: string, value: HostJson | undefined): void {
  if (!group || value === undefined || value === null) return;
  const prop = group.property(matchName);
  if (prop) prop.setValue(value);
}

function points(raw: HostJson | undefined): number[][] {
  if (!isArray(raw)) return [];
  const list = raw as HostJson[];
  const out: number[][] = [];
  for (let i = 0; i < list.length; i += 1) {
    const point = list[i];
    if (isArray(point) && typeof (point as HostJson[])[0] === "number" && typeof (point as HostJson[])[1] === "number") {
      out[out.length] = [(point as number[])[0] as number, (point as number[])[1] as number];
    }
  }
  return out;
}

function zeros(count: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; i += 1) out[i] = [0, 0];
  return out;
}

function addItem(ctx: OperationContext, layer: AeRawLayer, groupIndex: number, item: Args): void {
  const type = typeof item["type"] === "string" ? item["type"] : "";
  const matchName = ITEM_MATCH_NAMES[type];
  if (!matchName) throw hostError(ErrorCode.InvalidArgument, "Unknown shape item " + labelOf(item["type"]) + ".");

  const created = contentsAt(layer, groupIndex).addProperty(matchName);
  const index = created.propertyIndex;
  const fresh = (): AeRawProp => contentsAt(layer, groupIndex).property(index) as AeRawProp;
  if (typeof item["name"] === "string" && item["name"].length > 0) fresh().name = item["name"];

  if (type === "rect") {
    set(fresh(), "ADBE Vector Rect Size", item["size"]);
    set(fresh(), "ADBE Vector Rect Position", item["position"]);
    set(fresh(), "ADBE Vector Rect Roundness", item["roundness"]);
  } else if (type === "ellipse") {
    set(fresh(), "ADBE Vector Ellipse Size", item["size"]);
    set(fresh(), "ADBE Vector Ellipse Position", item["position"]);
  } else if (type === "path") {
    const vertices = points(item["vertices"]);
    if (vertices.length < 2) throw hostError(ErrorCode.InvalidArgument, "A path needs at least two points.");
    const ins = points(item["inTangents"]);
    const outs = points(item["outTangents"]);
    const shape = ctx.env.newShape(
      vertices,
      ins.length === vertices.length ? ins : zeros(vertices.length),
      outs.length === vertices.length ? outs : zeros(vertices.length),
      item["closed"] !== false,
    );
    const path = fresh().property("ADBE Vector Shape");
    if (path) path.setValue(shape);
  } else if (type === "fill") {
    const rgb = readColor(item, "color", [1, 1, 1]);
    set(fresh(), "ADBE Vector Fill Color", [rgb[0], rgb[1], rgb[2], OPAQUE]);
    set(fresh(), "ADBE Vector Fill Opacity", item["opacity"]);
  } else if (type === "stroke") {
    const rgb = readColor(item, "color", [1, 1, 1]);
    set(fresh(), "ADBE Vector Stroke Color", [rgb[0], rgb[1], rgb[2], OPAQUE]);
    set(fresh(), "ADBE Vector Stroke Width", item["width"]);
    set(fresh(), "ADBE Vector Stroke Opacity", item["opacity"]);
  } else {
    set(fresh(), "ADBE Vector Repeater Copies", item["copies"]);
    set(fresh(), "ADBE Vector Repeater Offset", item["offset"]);
    const transform = fresh().property("ADBE Vector Repeater Transform");
    set(transform, "ADBE Vector Repeater Position", item["position"]);
    set(transform, "ADBE Vector Repeater Scale", item["scale"]);
    set(transform, "ADBE Vector Repeater Opacity 2", item["endOpacity"]);
  }
}

export const buildShapeOperation: Operation = {
  id: "kvfx.op.shape.build",
  mutates: true,
  run: function (ctx: OperationContext): HostJson {
    const comp = requireComp(ctx);
    const id = ctx.args["id"];
    const layer = typeof id === "number" ? layerById(comp, id) : undefined;
    if (!layer) throw hostError(ErrorCode.TargetNotFound, "The shape layer no longer exists.");
    if (!layer.property(ROOT)) throw hostError(ErrorCode.PreconditionFailed, "That layer is not a shape layer.");
    if (layer.locked) throw hostError(ErrorCode.PreconditionFailed, "The shape layer is locked.");

    const stamp = ctx.args["relative"] === true ? comp.time : undefined;
    const raw = ctx.args["groups"];
    if (!isArray(raw)) throw hostError(ErrorCode.InvalidArgument, "groups must be an array.");
    const groups = raw as HostJson[];
    if (groups.length > MAX_GROUPS) throw hostError(ErrorCode.InvalidArgument, "Too many shape groups.");

    for (let g = 0; g < groups.length; g += 1) {
      const spec = groups[g] as Args;
      if (!spec || typeof spec !== "object" || isArray(spec)) continue;
      const created = (layer.property(ROOT) as AeRawProp).addProperty(GROUP);
      const groupIndex = created.propertyIndex;
      if (typeof spec["name"] === "string" && spec["name"].length > 0) groupAt(layer, groupIndex).name = spec["name"];

      const items = isArray(spec["items"]) ? (spec["items"] as HostJson[]) : [];
      if (items.length > MAX_ITEMS) throw hostError(ErrorCode.InvalidArgument, "Too many items in one shape group.");
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item && typeof item === "object" && !isArray(item)) addItem(ctx, layer, groupIndex, item as Args);
      }

      const expressions = isArray(spec["expressions"]) ? (spec["expressions"] as HostJson[]) : [];
      for (let e = 0; e < expressions.length; e += 1) {
        const entry = expressions[e] as Args;
        if (!entry || typeof entry["expression"] !== "string") continue;
        const prop = resolvePath(ctx.env, groupAt(layer, groupIndex), entry["path"]);
        if (!prop || !prop.canSetExpression) continue;
        prop.expression = stamp === undefined ? entry["expression"] : stampTime(entry["expression"], stamp);
        prop.expressionEnabled = true;
      }

      const transform = spec["transform"];
      if (transform && typeof transform === "object" && !isArray(transform)) {
        const t = transform as Args;
        const group = groupAt(layer, groupIndex).property(TRANSFORM);
        set(group, "ADBE Vector Anchor", t["anchor"]);
        set(group, "ADBE Vector Position", t["position"]);
        set(group, "ADBE Vector Scale", t["scale"]);
        set(group, "ADBE Vector Rotation", t["rotation"]);
        set(group, "ADBE Vector Group Opacity", t["opacity"]);
      }
    }
    return { id: layer.id, groupCount: groups.length };
  },
};

export const shapeOperations: Operation[] = [buildShapeOperation];

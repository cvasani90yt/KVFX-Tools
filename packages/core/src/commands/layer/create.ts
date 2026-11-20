import { rgbToHex } from "../../color/index.js";
import { NEEDS_COMP, NEEDS_LAYER, colorParam, rgbJson, simpleCommand, stringParam } from "../define.js";
import { type Command, CommandCategory } from "../types.js";

/**
 * Layer creation.
 *
 * These need a composition but no selection, so they stay available in the
 * palette when nothing is selected — which is exactly when a user reaches for
 * "create null".
 */

const WHITE = [1, 1, 1] as const;

/**
 * With layers selected — any kind — the null lands at them and they are
 * linked to it, keeping their place; with none, it is a plain null on top.
 * The host reads the selection before it makes the null.
 */
export const createNull = simpleCommand({
  id: "kvfx.layer.createnull",
  name: "Create Null",
  description: "Add a null — with layers selected, it sits at them and they are parented to it, staying where they are",
  category: CommandCategory.Layer,
  keywords: ["null", "controller", "parent", "link", "rig", "empty", "object", "control"],
  icon: "null",
  metadata: NEEDS_COMP,
  steps: () => [{ op: "kvfx.op.layer.addNull", args: { target: "selection" } }],
});

export const createAdjustment = simpleCommand({
  id: "kvfx.layer.createadjustment",
  name: "Create Adjustment Layer",
  description: "Add a full-size adjustment layer at the top of the composition",
  category: CommandCategory.Layer,
  keywords: ["adjustment", "adj", "effect", "grade", "layer"],
  icon: "adjustment",
  metadata: NEEDS_COMP,
  steps: () => [{ op: "kvfx.op.layer.create", args: { kind: "adjustment" } }],
});

export const createSolid = simpleCommand({
  id: "kvfx.layer.createsolid",
  name: "Create Solid",
  description: "Add a composition-size solid in the swatch colour",
  category: CommandCategory.Layer,
  keywords: ["solid", "background", "bg", "color", "colour", "fill", "plate"],
  icon: "solid",
  metadata: NEEDS_COMP,
  defaultParams: (ui) => ({ color: ui.solidColor }),
  steps: (ctx) => {
    const color = colorParam(ctx, "color", WHITE);
    return [
      {
        op: "kvfx.op.layer.create",
        args: { kind: "solid", color: rgbJson(color), name: `Solid ${rgbToHex(color).toUpperCase()}` },
      },
    ];
  },
});

export const createText = simpleCommand({
  id: "kvfx.layer.createtext",
  name: "Create Text",
  description: "Add a text layer at the top of the composition",
  category: CommandCategory.Text,
  keywords: ["text", "type", "title", "words", "font"],
  icon: "text",
  metadata: NEEDS_COMP,
  steps: (ctx) => [{ op: "kvfx.op.layer.create", args: { kind: "text", text: stringParam(ctx, "text", "Text") } }],
});

export const createShape = simpleCommand({
  id: "kvfx.layer.createshape",
  name: "Create Shape Layer",
  description: "Add an empty shape layer at the top of the composition",
  category: CommandCategory.Layer,
  keywords: ["shape", "vector", "path", "contents"],
  icon: "shape",
  metadata: NEEDS_COMP,
  steps: () => [{ op: "kvfx.op.layer.create", args: { kind: "shape" } }],
});

export const createCamera = simpleCommand({
  id: "kvfx.layer.createcamera",
  name: "Create Camera",
  description: "Add a camera centred on the composition",
  category: CommandCategory.Camera,
  keywords: ["camera", "3d", "view", "lens"],
  icon: "camera",
  metadata: NEEDS_COMP,
  steps: () => [{ op: "kvfx.op.layer.create", args: { kind: "camera" } }],
});

/** Create Null for when there must be a selection: the same null, the same linking. */
export const nullParent = simpleCommand({
  id: "kvfx.layer.nullparent",
  name: "Parent to New Null",
  description: "Create a null at the selected layers and parent them to it, keeping them in place",
  category: CommandCategory.Rig,
  keywords: ["null", "parent", "link", "group", "control", "controller", "rig"],
  icon: "link",
  metadata: NEEDS_LAYER,
  steps: () => [{ op: "kvfx.op.layer.addNull", args: { target: "selection" } }],
});

export const createCommands: readonly Command[] = [
  createNull,
  createAdjustment,
  createSolid,
  createText,
  createShape,
  createCamera,
  nullParent,
];

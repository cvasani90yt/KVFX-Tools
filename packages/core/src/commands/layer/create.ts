import { rgbToHex } from "../../color/index.js";
import {
  NEEDS_COMP,
  NEEDS_LAYER,
  SNAPSHOT_PROBE,
  colorParam,
  measuredCommand,
  probedLayers,
  rgbJson,
  simpleCommand,
  stringParam,
} from "../define.js";
import { type Command, CommandCategory, ref } from "../types.js";

/**
 * Layer creation.
 *
 * These need a composition but no selection, so they stay available in the
 * palette when nothing is selected — which is exactly when a user reaches for
 * "create null".
 */

const WHITE = [1, 1, 1] as const;

export const createNull = simpleCommand({
  id: "kvfx.layer.createnull",
  name: "Create Null",
  description: "Add a null object at the top of the composition",
  category: CommandCategory.Layer,
  keywords: ["null", "controller", "parent", "rig", "empty", "object"],
  icon: "null",
  metadata: NEEDS_COMP,
  steps: () => [{ op: "kvfx.op.layer.create", args: { kind: "null" } }],
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

/**
 * Measured, not selection-targeted: After Effects selects a layer it has just
 * created, so "the selection" after step one would be the new null itself.
 */
export const nullParent = measuredCommand({
  id: "kvfx.layer.nullparent",
  name: "Parent to New Null",
  description: "Create a null and parent the selected layers to it, keeping them in place",
  category: CommandCategory.Rig,
  keywords: ["null", "parent", "group", "control", "controller", "rig"],
  icon: "link",
  metadata: NEEDS_LAYER,
  probe: () => SNAPSHOT_PROBE,
  steps: (_ctx, measurement) => {
    const ids = probedLayers(measurement).map((layer) => layer.id);
    if (ids.length === 0) return [];
    return [
      { op: "kvfx.op.layer.create", args: { kind: "null", name: "KVFX Control" }, bind: "ctrl" },
      { op: "kvfx.op.layer.set", args: { ids, parent: ref("ctrl") } },
    ];
  },
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

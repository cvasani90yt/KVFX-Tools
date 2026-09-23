import { standardAvailability } from "../availability.js";
import {
  type Command,
  CommandCategory,
  type CommandContext,
  type CommandMetadata,
  type OperationPlan,
  undoGroupFor,
} from "../types.js";

/**
 * Layer creation.
 *
 * These need a composition but no selection, so they stay available in the
 * palette when nothing is selected — which is exactly when a user reaches for
 * "create null".
 */

const META: CommandMetadata = { destructive: false, minLayers: 0, requiresComp: true };

export const createNull: Command = {
  id: "kvfx.layer.createnull",
  name: "Create Null",
  description: "Add a null object at the top of the composition",
  category: CommandCategory.Layer,
  keywords: ["null", "controller", "parent", "rig", "empty", "object"],
  icon: "null",
  metadata: META,
  canExecute: (ctx: CommandContext) => standardAvailability(META, ctx),
  plan: (): OperationPlan => ({
    undoGroup: undoGroupFor("Create Null"),
    steps: [{ op: "kvfx.op.layer.create", args: { kind: "null" } }],
  }),
};

export const createAdjustment: Command = {
  id: "kvfx.layer.createadjustment",
  name: "Create Adjustment Layer",
  description: "Add a full-size adjustment layer at the top of the composition",
  category: CommandCategory.Layer,
  keywords: ["adjustment", "adj", "effect", "grade", "layer"],
  icon: "adjustment",
  metadata: META,
  canExecute: (ctx: CommandContext) => standardAvailability(META, ctx),
  plan: (): OperationPlan => ({
    undoGroup: undoGroupFor("Create Adjustment Layer"),
    steps: [{ op: "kvfx.op.layer.create", args: { kind: "adjustment" } }],
  }),
};

export const createCommands: readonly Command[] = [createNull, createAdjustment];

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
 * Layer ordering.
 *
 * As with the switch commands, the plan targets the live selection rather than
 * a list of ids from the panel's snapshot (ADR-0002). Relative order among the
 * moved layers is preserved by the host operation — moving three layers to the
 * top must not reverse them, which is what a naive loop does.
 */

const META: CommandMetadata = { destructive: false, minLayers: 1, requiresComp: true };

type OrderTarget = "top" | "bottom" | "up" | "down";

function orderCommand(
  id: string,
  name: string,
  description: string,
  to: OrderTarget,
  keywords: readonly string[],
  icon: string,
): Command {
  return {
    id,
    name,
    description,
      kind: "simple",
  category: CommandCategory.Layer,
    keywords,
    icon,
    metadata: META,
    canExecute: (ctx: CommandContext) => standardAvailability(META, ctx),
    plan: (): OperationPlan => ({
      undoGroup: undoGroupFor(name),
      steps: [{ op: "kvfx.op.layer.reorder", args: { target: "selection", to } }],
    }),
  };
}

export const moveToTop = orderCommand(
  "kvfx.layer.movetop",
  "Move to Top",
  "Move the selected layers to the top of the layer stack",
  "top",
  ["top", "front", "first", "raise", "order", "bring to front"],
  "arrow-top",
);

export const moveToBottom = orderCommand(
  "kvfx.layer.movebottom",
  "Move to Bottom",
  "Move the selected layers to the bottom of the layer stack",
  "bottom",
  ["bottom", "back", "last", "lower", "order", "send to back"],
  "arrow-bottom",
);

export const moveUp = orderCommand(
  "kvfx.layer.moveup",
  "Move Up",
  "Move the selected layers one step up the layer stack",
  "up",
  ["up", "raise", "forward", "order"],
  "arrow-up",
);

export const moveDown = orderCommand(
  "kvfx.layer.movedown",
  "Move Down",
  "Move the selected layers one step down the layer stack",
  "down",
  ["down", "lower", "backward", "order"],
  "arrow-down",
);

export const orderCommands: readonly Command[] = [moveToTop, moveToBottom, moveUp, moveDown];

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
 * Layer switch commands.
 *
 * Toggle semantics are resolved **on the host**, not here, and the plan says
 * `target: "selection"` rather than naming layer ids. That is deliberate: After
 * Effects emits no selection events (F4), so a plan built from the panel's last
 * snapshot could name layers the user has since deselected. Letting the host
 * read the live selection at the moment of execution is the only way these
 * commands can be correct (ADR-0002), and it costs one generic primitive rather
 * than per-command host logic.
 */

const SELECTION_META: CommandMetadata = {
  destructive: false,
  minLayers: 1,
  requiresComp: true,
};

type LayerFlag = "enabled" | "locked" | "shy" | "solo" | "threeD" | "guide" | "adjustment";

const ALL_LAYERS_META: CommandMetadata = {
  destructive: false,
  minLayers: 0,
  requiresComp: true,
};

interface FlagCommandSpec {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly flag: LayerFlag;
  readonly keywords: readonly string[];
  readonly icon: string;
  /** Defaults to the live selection with toggle semantics. */
  readonly target?: "selection" | "all";
  readonly value?: boolean;
}

function flagCommand(spec: FlagCommandSpec): Command {
  const target = spec.target ?? "selection";
  const metadata = target === "all" ? ALL_LAYERS_META : SELECTION_META;
  const value: boolean | "toggle" = spec.value ?? "toggle";

  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    category: CommandCategory.Layer,
    keywords: spec.keywords,
    icon: spec.icon,
    metadata,
    canExecute: (ctx: CommandContext) => standardAvailability(metadata, ctx),
    plan: (): OperationPlan => ({
      undoGroup: undoGroupFor(spec.name),
      steps: [{ op: "kvfx.op.layer.setFlag", args: { target, flag: spec.flag, value } }],
    }),
  };
}

export const toggleSolo = flagCommand({
  id: "kvfx.layer.solo",
  name: "Toggle Solo",
  description: "Solo the selected layers, or unsolo them if they are all soloed",
  flag: "solo",
  keywords: ["solo", "isolate", "only"],
  icon: "solo",
});

/**
 * Locking is one-way on purpose.
 *
 * After Effects deselects a layer the moment it is locked, and a locked layer
 * cannot be selected again — so a toggle bound to the selection could only ever
 * lock, never unlock, and would look broken the first time a user tried to undo
 * it. The pair below is the only shape that actually works: lock what is
 * selected, and unlock across the whole composition.
 */
export const lockSelected = flagCommand({
  id: "kvfx.layer.lock",
  name: "Lock Selected Layers",
  description: "Lock the selected layers so they cannot be edited",
  flag: "locked",
  value: true,
  keywords: ["lock", "protect", "freeze"],
  icon: "lock",
});

export const unlockAll = flagCommand({
  id: "kvfx.layer.unlockall",
  name: "Unlock All Layers",
  description: "Unlock every layer in the composition",
  flag: "locked",
  target: "all",
  value: false,
  keywords: ["unlock", "release", "all", "lock"],
  icon: "unlock",
});

export const toggleShy = flagCommand({
  id: "kvfx.layer.shy",
  name: "Toggle Shy",
  description: "Mark the selected layers shy so they can be hidden from the timeline",
  flag: "shy",
  keywords: ["shy", "hide", "collapse", "timeline"],
  icon: "shy",
});

export const toggleVisibility = flagCommand({
  id: "kvfx.layer.visibility",
  name: "Toggle Visibility",
  description: "Turn the video switch on or off for the selected layers",
  flag: "enabled",
  keywords: ["visible", "hide", "show", "eye", "enable", "disable"],
  icon: "eye",
});

export const toggleThreeD = flagCommand({
  id: "kvfx.layer.threed",
  name: "Toggle 3D",
  description: "Switch the selected layers between 2D and 3D",
  flag: "threeD",
  keywords: ["3d", "three", "dimension", "depth", "z"],
  icon: "cube",
});

export const toggleGuide = flagCommand({
  id: "kvfx.layer.guide",
  name: "Toggle Guide Layer",
  description: "Mark the selected layers as guides so they are excluded from renders",
  flag: "guide",
  keywords: ["guide", "reference", "render", "exclude"],
  icon: "guide",
});

export const toggleAdjustment = flagCommand({
  id: "kvfx.layer.adjustment",
  name: "Toggle Adjustment Layer",
  description: "Switch the selected layers between normal and adjustment layers",
  flag: "adjustment",
  keywords: ["adjustment", "adj", "effect", "stack"],
  icon: "adjustment",
});

export const flagCommands: readonly Command[] = [
  toggleSolo,
  lockSelected,
  unlockAll,
  toggleShy,
  toggleVisibility,
  toggleThreeD,
  toggleGuide,
  toggleAdjustment,
];

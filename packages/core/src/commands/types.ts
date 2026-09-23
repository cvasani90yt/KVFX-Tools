import type { JsonObject } from "../types/json.js";

/**
 * Command model.
 *
 * A command is what the user searches for and invokes. It is pure data plus two
 * pure functions: `canExecute` decides whether it applies to the current
 * selection, and `plan` turns it into an ordered list of primitive operations
 * for the host to run (ADR-0006).
 *
 * Commands never touch After Effects. That is the whole point — it makes them
 * unit-testable by asserting on the plan they emit, with no host present.
 */

export const CommandCategory = {
  Layer: "LAYER",
  Keyframe: "KEYFRAME",
  Text: "TEXT",
  Color: "COLOR",
  Fx: "FX",
  Rig: "RIG",
  Camera: "CAMERA",
  ThreeD: "3D",
  Asset: "ASSET",
  Project: "PROJECT",
} as const;

export type CommandCategory = (typeof CommandCategory)[keyof typeof CommandCategory];

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * One selected layer, as the host reported it.
 *
 * `id` is `Layer.id` and is the only durable handle — indices shift and names
 * are neither unique nor stable (ADR-0004). `index` is carried for display and
 * ordering decisions only, never for addressing.
 */
export interface SelectedLayer {
  readonly id: number;
  readonly name: string;
  readonly index: number;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly shy: boolean;
  /** False for camera, light and other layers without a video switch. */
  readonly isAV: boolean;
  readonly solo: boolean;
  readonly threeD: boolean;
  readonly guide: boolean;
  readonly adjustment: boolean;
}

export interface ActiveComp {
  readonly id: number;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly duration: number;
  readonly time: number;
  readonly layerCount: number;
}

/**
 * What the panel last saw.
 *
 * After Effects emits no selection events (F4), so this is always a snapshot
 * taken at a known moment rather than live state. Commands may use it to decide
 * *whether* they apply and *what* to do; they must not bake layer ids into a
 * plan for a selection-driven operation, because the user may have changed the
 * selection between the snapshot and the click (ADR-0002).
 */
export interface SelectionSnapshot {
  readonly capturedAtMs: number;
  readonly hasProject: boolean;
  readonly comp: ActiveComp | undefined;
  readonly layers: readonly SelectedLayer[];
}

export const EMPTY_SNAPSHOT: SelectionSnapshot = {
  capturedAtMs: 0,
  hasProject: false,
  comp: undefined,
  layers: [],
};

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export interface PlanStep {
  /** Host operation id, e.g. "kvfx.op.layer.setFlag". */
  readonly op: string;
  readonly args: JsonObject;
}

export interface OperationPlan {
  /** Shown in After Effects' Edit ▸ Undo menu. */
  readonly undoGroup: string;
  readonly steps: readonly PlanStep[];
}

/** Every undo entry the product creates is attributable at a glance. */
export function undoGroupFor(commandName: string): string {
  return `KVFX Tools — ${commandName}`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CommandContext {
  readonly snapshot: SelectionSnapshot;
  /** `app.version` of the running host, for version gating. */
  readonly aeVersion: string;
}

export type CommandAvailability =
  | { readonly available: true }
  /** `reason` is shown to the user, so it says what to do, not what went wrong. */
  | { readonly available: false; readonly reason: string };

export const AVAILABLE: CommandAvailability = { available: true };

export function unavailable(reason: string): CommandAvailability {
  return { available: false, reason };
}

export interface CommandMetadata {
  /** Forces an explicit confirmation naming what will be affected. */
  readonly destructive: boolean;
  /** Minimum selected layers. 0 means the command does not need a selection. */
  readonly minLayers: number;
  readonly requiresComp: boolean;
  /** Minimum After Effects version, when the command depends on a newer API. */
  readonly aeMin?: string;
}

export interface Command {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: CommandCategory;
  /** Extra search terms, including the words users actually say. */
  readonly keywords: readonly string[];
  /** Token name resolved by the UI theme, never a file path. */
  readonly icon: string;
  /**
   * Suggested keystroke. The user's own binding lives in settings and always
   * wins; this is only what the product proposes out of the box.
   */
  readonly defaultShortcut?: string;
  readonly metadata: CommandMetadata;
  canExecute(ctx: CommandContext): CommandAvailability;
  plan(ctx: CommandContext): OperationPlan;
}

import type { UiSettings } from "../storage/settings.js";
import type { JsonObject, JsonValue } from "../types/json.js";

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
export type LayerKind = "av" | "text" | "shape" | "null" | "precomp" | "camera" | "light";

export interface SelectedLayer {
  readonly id: number;
  readonly name: string;
  readonly index: number;
  readonly kind: LayerKind;
  /** After Effects label colour, 0 (none) to 16. */
  readonly label: number;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly shy: boolean;
  /** False for camera, light and other layers without a video switch. */
  readonly isAV: boolean;
  readonly solo: boolean;
  readonly threeD: boolean;
  readonly guide: boolean;
  readonly adjustment: boolean;
  /** Seconds, in composition time. */
  readonly inPoint: number;
  readonly outPoint: number;
  readonly startTime: number;
  readonly parentId: number | undefined;
}

export const SELECTED_LAYER_DEFAULTS: Omit<SelectedLayer, "id"> = {
  name: "Layer",
  index: 1,
  kind: "av",
  label: 0,
  enabled: true,
  locked: false,
  shy: false,
  isAV: true,
  solo: false,
  threeD: false,
  guide: false,
  adjustment: false,
  inPoint: 0,
  outPoint: 10,
  startTime: 0,
  parentId: undefined,
};

export interface ActiveComp {
  readonly id: number;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly frameDuration: number;
  readonly duration: number;
  readonly time: number;
  readonly workAreaStart: number;
  readonly workAreaDuration: number;
  readonly layerCount: number;
}

/* eslint-disable no-magic-numbers -- a typical HD composition */
export const ACTIVE_COMP_DEFAULTS: ActiveComp = {
  id: 1,
  name: "Comp 1",
  width: 1920,
  height: 1080,
  frameRate: 30,
  frameDuration: 1 / 30,
  duration: 10,
  time: 0,
  workAreaStart: 0,
  workAreaDuration: 10,
  layerCount: 1,
};
/* eslint-enable no-magic-numbers */

/** One transform property as the inspector shows it. */
export interface TransformChannel {
  /** A scalar for rotation and opacity; two or three numbers otherwise. */
  readonly value: readonly number[];
  readonly animated: boolean;
  /** An enabled expression drives the value; edits would be overridden. */
  readonly expression: boolean;
}

/** Transform values of the first selected layer that has a full transform. */
export interface PrimaryTransform {
  readonly id: number;
  readonly anchor: TransformChannel;
  readonly position: TransformChannel;
  readonly positionSeparated: boolean;
  readonly scale: TransformChannel;
  readonly rotation: TransformChannel;
  readonly opacity: TransformChannel;
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
  readonly primary: PrimaryTransform | undefined;
}

export const EMPTY_SNAPSHOT: SelectionSnapshot = {
  capturedAtMs: 0,
  hasProject: false,
  comp: undefined,
  layers: [],
  primary: undefined,
};

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export interface PlanStep {
  /** Host operation id, e.g. "kvfx.op.layer.setFlag". */
  readonly op: string;
  readonly args: JsonObject;
  /**
   * Names this step's result so later steps can refer to it with
   * `{ "$ref": name }` — the id of a layer it created, say. See the host
   * dispatcher for the exact binding rules.
   */
  readonly bind?: string;
}

export interface OperationPlan {
  /** Shown in After Effects' Edit ▸ Undo menu. */
  readonly undoGroup: string;
  readonly steps: readonly PlanStep[];
  /**
   * Time the host may spend, in ms, when the default is not enough.
   *
   * Only bulk generators that the user explicitly started declare one — the
   * text exploder making a layer per character, for instance. Everything else
   * keeps the default, so a slow regression stays visible.
   */
  readonly budgetMs?: number;
}

/** A plan step referring to something an earlier step bound. */
export function ref(name: string, at?: number): JsonObject {
  return at === undefined ? { $ref: name } : { $ref: name, at };
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
  /**
   * Values from the control that invoked the command — a colour swatch, the
   * easing curve, a counter's range. Absent when run from the palette, in
   * which case every command falls back to sensible defaults.
   */
  readonly params?: JsonObject;
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
  /**
   * Kept out of the palette while remaining invokable.
   *
   * Used for explicit variants a dedicated control drives — the align grid's
   * reference toggle, for instance — so the palette shows one clear entry per
   * action instead of every parameter combination.
   */
  readonly hidden?: boolean;
}

export interface CommandBase {
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
  /**
   * Parameters to use when the command runs without a control supplying
   * them — from the palette or a shortcut. Read from the user's settings, so
   * "Apply Ease" applies the curve currently in the editor.
   */
  defaultParams?(ui: UiSettings): JsonObject;
}

/** A command whose plan depends only on the snapshot it already has. */
export interface SimpleCommand extends CommandBase {
  readonly kind: "simple";
  plan(ctx: CommandContext): OperationPlan;
}

/**
 * A command that must read real values out of After Effects before it can plan.
 *
 * Alignment is the motivating case: it cannot know where to move a layer
 * without its bounds, transform and parent chain. The `probe` is a read-only
 * query; the plan built from its result addresses layers by id and carries
 * explicit values, so a selection change between the two steps cannot misplace
 * anything (ADR-0004).
 *
 * This is the deliberate exception to ADR-0006, not an escape hatch: it costs a
 * second round trip, and it exists so the transform maths can stay in `core`
 * under test rather than being duplicated into ExtendScript.
 */
export interface MeasuredCommand extends CommandBase {
  readonly kind: "measured";
  probe(ctx: CommandContext): PlanStep;
  plan(ctx: CommandContext, measurement: JsonValue): OperationPlan;
}

export type Command = SimpleCommand | MeasuredCommand;

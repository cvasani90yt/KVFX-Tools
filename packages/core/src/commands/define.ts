import type { Bezier } from "../animation/easing.js";
import { hexToRgb, type Rgb } from "../color/index.js";
import type { UiSettings } from "../storage/settings.js";
import type { JsonObject, JsonValue } from "../types/json.js";
import { standardAvailability } from "./availability.js";
import { decodeSnapshot } from "./decode.js";
import {
  type Command,
  type CommandAvailability,
  type CommandCategory,
  type CommandContext,
  type CommandMetadata,
  type OperationPlan,
  type PlanStep,
  type SelectedLayer,
  undoGroupFor,
} from "./types.js";

/**
 * Small helpers that keep the command tables declarative.
 *
 * Commands stay pure data plus pure functions; these only remove the
 * boilerplate of spelling out availability and undo-group naming for each.
 */

export const NEEDS_COMP: CommandMetadata = { destructive: false, minLayers: 0, requiresComp: true };
export const NEEDS_LAYER: CommandMetadata = { destructive: false, minLayers: 1, requiresComp: true };

export interface SimpleSpec {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: CommandCategory;
  readonly keywords: readonly string[];
  readonly icon: string;
  readonly metadata: CommandMetadata;
  readonly defaultShortcut?: string;
  /** Extra checks after the standard ones — "select a text layer", say. */
  readonly check?: (ctx: CommandContext) => CommandAvailability;
  readonly defaultParams?: (ui: UiSettings) => JsonObject;
  readonly steps: (ctx: CommandContext) => readonly PlanStep[];
  readonly budgetMs?: number | ((ctx: CommandContext) => number | undefined);
}

function availability(
  spec: { metadata: CommandMetadata; check?: SimpleSpec["check"] },
  ctx: CommandContext,
): CommandAvailability {
  const standard = standardAvailability(spec.metadata, ctx);
  if (!standard.available || spec.check === undefined) return standard;
  return spec.check(ctx);
}

export function simpleCommand(spec: SimpleSpec): Command {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    kind: "simple",
    category: spec.category,
    keywords: spec.keywords,
    icon: spec.icon,
    metadata: spec.metadata,
    ...(spec.defaultShortcut === undefined ? {} : { defaultShortcut: spec.defaultShortcut }),
    ...(spec.defaultParams === undefined ? {} : { defaultParams: spec.defaultParams }),
    canExecute: (ctx) => availability(spec, ctx),
    plan: (ctx): OperationPlan => {
      const budget = typeof spec.budgetMs === "function" ? spec.budgetMs(ctx) : spec.budgetMs;
      return {
        undoGroup: undoGroupFor(spec.name),
        steps: spec.steps(ctx),
        ...(budget === undefined ? {} : { budgetMs: budget }),
      };
    },
  };
}

export interface MeasuredSpec extends Omit<SimpleSpec, "steps"> {
  readonly probe: (ctx: CommandContext) => PlanStep;
  readonly steps: (ctx: CommandContext, measurement: JsonValue) => readonly PlanStep[];
}

export function measuredCommand(spec: MeasuredSpec): Command {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    kind: "measured",
    category: spec.category,
    keywords: spec.keywords,
    icon: spec.icon,
    metadata: spec.metadata,
    ...(spec.defaultShortcut === undefined ? {} : { defaultShortcut: spec.defaultShortcut }),
    ...(spec.defaultParams === undefined ? {} : { defaultParams: spec.defaultParams }),
    canExecute: (ctx) => availability(spec, ctx),
    probe: spec.probe,
    plan: (ctx, measurement): OperationPlan => {
      const budget = typeof spec.budgetMs === "function" ? spec.budgetMs(ctx) : spec.budgetMs;
      return {
        undoGroup: undoGroupFor(spec.name),
        steps: spec.steps(ctx, measurement),
        ...(budget === undefined ? {} : { budgetMs: budget }),
      };
    },
  };
}

/** The probe every "act on exactly these layers" command uses. */
export const SNAPSHOT_PROBE: PlanStep = { op: "kvfx.op.selection.snapshot", args: {} };

// ---------------------------------------------------------------------------
// Reading parameters defensively — they come from UI controls and settings.
// ---------------------------------------------------------------------------

export function numberParam(ctx: CommandContext, key: string, fallback: number, min = -Infinity, max = Infinity): number {
  const value = ctx.params?.[key];
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

export function stringParam(ctx: CommandContext, key: string, fallback: string): string {
  const value = ctx.params?.[key];
  return typeof value === "string" ? value : fallback;
}

export function boolParam(ctx: CommandContext, key: string, fallback: boolean): boolean {
  const value = ctx.params?.[key];
  return typeof value === "boolean" ? value : fallback;
}

const BEZIER_LENGTH = 4;

export function bezierParam(ctx: CommandContext, key: string, fallback: Bezier): Bezier {
  const value = ctx.params?.[key];
  if (!Array.isArray(value) || value.length !== BEZIER_LENGTH) return fallback;
  const numbers = value.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (numbers.length !== BEZIER_LENGTH) return fallback;
  const [x1, y1, x2, y2] = numbers as [number, number, number, number];
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return fallback;
  return [x1, y1, x2, y2];
}

/** A colour parameter given as "#rrggbb", returned as 0–1 channels. */
export function colorParam(ctx: CommandContext, key: string, fallback: Rgb): Rgb {
  const value = ctx.params?.[key];
  return (typeof value === "string" ? hexToRgb(value) : undefined) ?? fallback;
}

export function rgbJson(rgb: Rgb): JsonValue {
  return [rgb[0], rgb[1], rgb[2]];
}

/** The probed selection, in stack order (top first). */
export function probedLayers(measurement: JsonValue): SelectedLayer[] {
  return [...decodeSnapshot(measurement).layers].sort((a, b) => a.index - b.index);
}

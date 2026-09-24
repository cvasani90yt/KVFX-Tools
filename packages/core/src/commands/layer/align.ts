import {
  AlignEdge,
  AnchorSpot,
  alignLayers,
  distributeLayers,
  moveAnchorPoints,
  type AnchorChange,
  type PositionChange,
} from "../../geometry/index.js";
import type { JsonValue } from "../../types/json.js";
import { standardAvailability } from "../availability.js";
import { decodeMeasurement, selectedMeasurements } from "../decode-measurement.js";
import {
  type CommandContext,
  type CommandMetadata,
  CommandCategory,
  type MeasuredCommand,
  type OperationPlan,
  type PlanStep,
  undoGroupFor,
} from "../types.js";

/**
 * Alignment, distribution and anchor-point commands.
 *
 * All of these are `measured` commands: they read bounds, transforms and parent
 * chains out of After Effects, do the maths in `@kvfx/core` where it is under
 * test, then write explicit values back by layer id. See `MeasuredCommand` for
 * why the extra round trip is worth it.
 */

const MEASURE_STEP = (): PlanStep => ({
  op: "kvfx.op.layer.measure",
  args: { target: "selection" },
});

function positionsToPlan(name: string, changes: readonly PositionChange[]): OperationPlan {
  return {
    undoGroup: undoGroupFor(name),
    steps: [
      {
        op: "kvfx.op.layer.setTransform",
        args: {
          changes: changes.map((change) => ({
            id: change.id,
            position: { x: change.position.x, y: change.position.y },
          })),
        },
      },
    ],
  };
}

function anchorsToPlan(name: string, changes: readonly AnchorChange[]): OperationPlan {
  return {
    undoGroup: undoGroupFor(name),
    steps: [
      {
        op: "kvfx.op.layer.setTransform",
        args: {
          changes: changes.map((change) => ({
            id: change.id,
            anchorPoint: { x: change.anchorPoint.x, y: change.anchorPoint.y },
            position: { x: change.position.x, y: change.position.y },
          })),
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Align
// ---------------------------------------------------------------------------

export type AlignReference = "auto" | "composition" | "selection";

const ALIGN_META: CommandMetadata = { destructive: false, minLayers: 1, requiresComp: true };
const ALIGN_META_HIDDEN: CommandMetadata = { ...ALIGN_META, hidden: true };

interface AlignSpec {
  readonly edge: AlignEdge;
  readonly label: string;
  readonly icon: string;
  readonly keywords: readonly string[];
}

const ALIGN_SPECS: readonly AlignSpec[] = [
  { edge: AlignEdge.Left, label: "Left", icon: "align-left", keywords: ["left", "align", "edge"] },
  { edge: AlignEdge.CentreX, label: "Horizontal Centre", icon: "align-center-h", keywords: ["center", "centre", "middle", "horizontal", "align"] },
  { edge: AlignEdge.Right, label: "Right", icon: "align-right", keywords: ["right", "align", "edge"] },
  { edge: AlignEdge.Top, label: "Top", icon: "align-top", keywords: ["top", "align", "edge"] },
  { edge: AlignEdge.CentreY, label: "Vertical Centre", icon: "align-center-v", keywords: ["center", "centre", "middle", "vertical", "align"] },
  { edge: AlignEdge.Bottom, label: "Bottom", icon: "align-bottom", keywords: ["bottom", "align", "edge"] },
];

const REFERENCE_SUFFIX: Readonly<Record<AlignReference, string>> = {
  auto: "",
  composition: " to Composition",
  selection: " to Selection",
};

function alignCommandId(edge: AlignEdge, reference: AlignReference): string {
  const edgeKey = edge.toLowerCase();
  return reference === "auto" ? `kvfx.align.${edgeKey}` : `kvfx.align.${edgeKey}.${reference}`;
}

/**
 * Resolves what "auto" means for the current selection.
 *
 * One layer selected has nothing to align against but the composition; two or
 * more almost always means "line these up with each other". This is the
 * behaviour every comparable tool uses, and the explicit variants exist for
 * when the guess is wrong.
 */
function resolveReference(reference: AlignReference, selectedCount: number): "composition" | "selection" {
  if (reference !== "auto") return reference;
  return selectedCount > 1 ? "selection" : "composition";
}

function makeAlignCommand(spec: AlignSpec, reference: AlignReference): MeasuredCommand {
  const name = `Align ${spec.label}${REFERENCE_SUFFIX[reference]}`;
  const metadata = reference === "auto" ? ALIGN_META : ALIGN_META_HIDDEN;

  return {
    kind: "measured",
    id: alignCommandId(spec.edge, reference),
    name,
    description:
      reference === "auto"
        ? `Align the selected layers to the ${spec.label.toLowerCase()} — to each other, or to the composition when one layer is selected`
        : `Align the selected layers to the ${spec.label.toLowerCase()} of the ${reference}`,
    category: CommandCategory.Layer,
    keywords: spec.keywords,
    icon: spec.icon,
    metadata,
    canExecute: (ctx: CommandContext) => standardAvailability(metadata, ctx),
    probe: MEASURE_STEP,
    plan: (_ctx: CommandContext, measurement: JsonValue): OperationPlan => {
      const reply = decodeMeasurement(measurement);
      const selected = selectedMeasurements(reply);
      const result = alignLayers({
        measurements: selected,
        context: reply.layers,
        edge: spec.edge,
        reference: resolveReference(reference, selected.length),
        compWidth: reply.compWidth,
        compHeight: reply.compHeight,
      });
      return positionsToPlan(name, result.changes);
    },
  };
}

export const alignCommands: readonly MeasuredCommand[] = ALIGN_SPECS.flatMap((spec) => [
  makeAlignCommand(spec, "auto"),
  makeAlignCommand(spec, "composition"),
  makeAlignCommand(spec, "selection"),
]);

// ---------------------------------------------------------------------------
// Distribute
// ---------------------------------------------------------------------------

const DISTRIBUTE_META: CommandMetadata = { destructive: false, minLayers: 3, requiresComp: true };

function makeDistributeCommand(
  axis: "horizontal" | "vertical",
  label: string,
  icon: string,
): MeasuredCommand {
  const name = `Distribute ${label}`;
  return {
    kind: "measured",
    id: `kvfx.align.distribute.${axis}`,
    name,
    description: `Space the selected layers evenly ${label.toLowerCase()}, leaving the outermost two where they are`,
    category: CommandCategory.Layer,
    keywords: ["distribute", "space", "spread", "even", label.toLowerCase()],
    icon,
    metadata: DISTRIBUTE_META,
    canExecute: (ctx: CommandContext) => standardAvailability(DISTRIBUTE_META, ctx),
    probe: MEASURE_STEP,
    plan: (_ctx: CommandContext, measurement: JsonValue): OperationPlan => {
      const reply = decodeMeasurement(measurement);
      const result = distributeLayers({
        measurements: selectedMeasurements(reply),
        context: reply.layers,
        axis,
      });
      return positionsToPlan(name, result.changes);
    },
  };
}

export const distributeCommands: readonly MeasuredCommand[] = [
  makeDistributeCommand("horizontal", "Horizontally", "distribute-h"),
  makeDistributeCommand("vertical", "Vertically", "distribute-v"),
];

// ---------------------------------------------------------------------------
// Anchor point
// ---------------------------------------------------------------------------

const ANCHOR_META: CommandMetadata = { destructive: false, minLayers: 1, requiresComp: true };

interface AnchorSpec {
  readonly spot: AnchorSpot;
  readonly label: string;
  readonly keywords: readonly string[];
}

const ANCHOR_SPECS: readonly AnchorSpec[] = [
  { spot: AnchorSpot.TopLeft, label: "Top Left", keywords: ["top", "left", "corner"] },
  { spot: AnchorSpot.TopCentre, label: "Top Centre", keywords: ["top", "centre", "center"] },
  { spot: AnchorSpot.TopRight, label: "Top Right", keywords: ["top", "right", "corner"] },
  { spot: AnchorSpot.MiddleLeft, label: "Middle Left", keywords: ["middle", "left"] },
  { spot: AnchorSpot.Centre, label: "Centre", keywords: ["centre", "center", "middle"] },
  { spot: AnchorSpot.MiddleRight, label: "Middle Right", keywords: ["middle", "right"] },
  { spot: AnchorSpot.BottomLeft, label: "Bottom Left", keywords: ["bottom", "left", "corner"] },
  { spot: AnchorSpot.BottomCentre, label: "Bottom Centre", keywords: ["bottom", "centre", "center"] },
  { spot: AnchorSpot.BottomRight, label: "Bottom Right", keywords: ["bottom", "right", "corner"] },
];

function makeAnchorCommand(spec: AnchorSpec): MeasuredCommand {
  const name = `Anchor to ${spec.label}`;
  return {
    kind: "measured",
    id: `kvfx.anchor.${spec.spot.toLowerCase()}`,
    name,
    description: `Move the anchor point to the ${spec.label.toLowerCase()} of the layer without moving the layer`,
    category: CommandCategory.Layer,
    keywords: ["anchor", "pivot", "origin", ...spec.keywords],
    icon: `anchor-${spec.spot.toLowerCase()}`,
    metadata: ANCHOR_META,
    canExecute: (ctx: CommandContext) => standardAvailability(ANCHOR_META, ctx),
    probe: MEASURE_STEP,
    plan: (_ctx: CommandContext, measurement: JsonValue): OperationPlan => {
      const reply = decodeMeasurement(measurement);
      const result = moveAnchorPoints(selectedMeasurements(reply), spec.spot);
      return anchorsToPlan(name, result.changes);
    },
  };
}

export const anchorCommands: readonly MeasuredCommand[] = ANCHOR_SPECS.map(makeAnchorCommand);

/** Ids the align grid's reference toggle drives, keyed by edge then reference. */
export function alignCommandIdFor(edge: AlignEdge, reference: AlignReference): string {
  return alignCommandId(edge, reference);
}

export { AlignEdge, AnchorSpot };

import { LABEL_COLORS } from "../../color/index.js";
import { NEEDS_LAYER, simpleCommand } from "../define.js";
import { type Command, CommandCategory } from "../types.js";

/**
 * Label colour commands: set a label on the selection, or select every layer
 * that shares the first selected layer's label.
 */

const NONE = { index: 0, name: "None", hex: "" };

/** "Sea Foam" → "seaFoam", the id segment for a label. */
export function labelKey(name: string): string {
  const words = name.split(/\s+/).filter((w) => w.length > 0);
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
}

export const labelCommands: readonly Command[] = [NONE, ...LABEL_COLORS].map((label) =>
  simpleCommand({
    id: `kvfx.label.${labelKey(label.name)}`,
    name: `Label: ${label.name}`,
    description: label.index === 0 ? "Remove the label colour from the selected layers" : `Label the selected layers ${label.name}`,
    category: CommandCategory.Color,
    keywords: ["label", "colour", "color", "tag", "organise", label.name.toLowerCase()],
    icon: "label",
    metadata: NEEDS_LAYER,
    steps: () => [{ op: "kvfx.op.layer.set", args: { target: "selection", label: label.index } }],
  }),
);

export const selectSameLabel = simpleCommand({
  id: "kvfx.label.selectsame",
  name: "Select Same Label",
  description: "Select every layer in the composition with the first selected layer's label",
  category: CommandCategory.Color,
  keywords: ["select", "label", "same", "colour", "color", "group"],
  icon: "select",
  metadata: NEEDS_LAYER,
  steps: (ctx) => {
    const label = ctx.snapshot.layers[0]?.label;
    return label === undefined ? [] : [{ op: "kvfx.op.layer.select", args: { label } }];
  },
});

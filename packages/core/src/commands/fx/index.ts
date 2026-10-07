import { NEEDS_LAYER, simpleCommand } from "../define.js";
import { type Command, CommandCategory } from "../types.js";

/**
 * One-click effects.
 *
 * Match names, not display names: they are the same in every language of
 * After Effects. Every one of these is a stock effect present in a default
 * install.
 */

interface QuickEffect {
  readonly key: string;
  readonly name: string;
  readonly matchName: string;
  readonly keywords: readonly string[];
  readonly icon: string;
}

export const QUICK_EFFECTS: readonly QuickEffect[] = [
  { key: "blur", name: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2", keywords: ["blur", "soft", "defocus"], icon: "fx-blur" },
  { key: "glow", name: "Glow", matchName: "ADBE Glo2", keywords: ["glow", "bloom", "light", "shine"], icon: "fx-glow" },
  { key: "shadow", name: "Drop Shadow", matchName: "ADBE Drop Shadow", keywords: ["shadow", "drop", "depth"], icon: "fx-shadow" },
  { key: "tint", name: "Tint", matchName: "ADBE Tint", keywords: ["tint", "monochrome", "black and white", "colorize"], icon: "fx-tint" },
  { key: "ramp", name: "Gradient Ramp", matchName: "ADBE Ramp", keywords: ["gradient", "ramp", "fade"], icon: "gradient" },
  { key: "bevel", name: "Bevel Alpha", matchName: "ADBE Bevel Alpha", keywords: ["bevel", "emboss", "edge", "3d"], icon: "fx-bevel" },
  { key: "slider", name: "Slider Control", matchName: "ADBE Slider Control", keywords: ["slider", "control", "number", "expression"], icon: "fx-slider" },
  { key: "checkbox", name: "Checkbox Control", matchName: "ADBE Checkbox Control", keywords: ["checkbox", "toggle", "switch", "control"], icon: "fx-checkbox" },
  { key: "color", name: "Color Control", matchName: "ADBE Color Control", keywords: ["color", "colour", "control", "swatch"], icon: "fx-color" },
  { key: "point", name: "Point Control", matchName: "ADBE Point Control", keywords: ["point", "position", "control", "xy"], icon: "fx-point" },
  { key: "angle", name: "Angle Control", matchName: "ADBE Angle Control", keywords: ["angle", "rotation", "control", "dial"], icon: "fx-angle" },
];

export const quickEffectCommands: readonly Command[] = QUICK_EFFECTS.map((effect) =>
  simpleCommand({
    id: `kvfx.fx.add.${effect.key}`,
    name: `Add ${effect.name}`,
    description: `Add ${effect.name} to the selected layers`,
    category: CommandCategory.Fx,
    keywords: ["effect", "fx", "add", ...effect.keywords],
    icon: effect.icon,
    metadata: NEEDS_LAYER,
    steps: () => [{ op: "kvfx.op.effect.add", args: { target: "selection", matchName: effect.matchName } }],
  }),
);

import { createCommandRegistry, type CommandRegistry } from "./registry.js";
import { labelCommands, selectSameLabel } from "./color/labels.js";
import { quickEffectCommands } from "./fx/index.js";
import { keyframeCommands } from "./keyframe/index.js";
import { alignCommands, anchorCommands, distributeCommands } from "./layer/align.js";
import { createCommands } from "./layer/create.js";
import { flagCommands } from "./layer/flags.js";
import { orderCommands } from "./layer/order.js";
import { toolCommands } from "./layer/tools.js";
import { rigCommands } from "./rig/index.js";
import { textCommands } from "./text/index.js";

export * from "./types.js";
export * from "./registry.js";
export * from "./availability.js";
export * from "./decode.js";
export * from "./decode-measurement.js";
export * from "./define.js";
export * from "./layer/align.js";
export * from "./layer/tools.js";
export * from "./fx/index.js";
export * from "./rig/index.js";
export * from "./text/index.js";
export * from "./keyframe/index.js";
export * from "./color/labels.js";
export * from "./layer/create.js";

/**
 * The shipped command set.
 *
 * Alignment, distribution and anchor commands are `measured`: they read real
 * geometry out of After Effects before planning. 3D layers are declined with a
 * reason rather than approximated — the transform maths for them is not written
 * yet, and moving a 3D layer to the wrong place is worse than not moving it.
 */
export function createProductionCommandRegistry(): CommandRegistry {
  return createCommandRegistry([
    ...alignCommands,
    ...distributeCommands,
    ...anchorCommands,
    ...flagCommands,
    ...orderCommands,
    ...createCommands,
    ...toolCommands,
    ...keyframeCommands,
    ...textCommands,
    ...quickEffectCommands,
    ...rigCommands,
    ...labelCommands,
    selectSameLabel,
  ]);
}

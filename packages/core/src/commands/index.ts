import { createCommandRegistry, type CommandRegistry } from "./registry.js";
import { createCommands } from "./layer/create.js";
import { flagCommands } from "./layer/flags.js";
import { orderCommands } from "./layer/order.js";

export * from "./types.js";
export * from "./registry.js";
export * from "./availability.js";
export * from "./decode.js";

/**
 * The shipped command set.
 *
 * Phase 3 covers the commands with no geometric ambiguity — switches, ordering
 * and creation. Alignment and anchor-point commands need layer bounds and
 * transform maths that must be got exactly right (rotation, scale, parenting,
 * 3D), so they are built in Phase 5 with their own test suite rather than
 * approximated here.
 */
export function createProductionCommandRegistry(): CommandRegistry {
  return createCommandRegistry([...flagCommands, ...orderCommands, ...createCommands]);
}

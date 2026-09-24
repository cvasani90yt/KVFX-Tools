import { createRegistry, type OperationRegistry } from "../runtime/registry.js";
import { snapshotOperation } from "./selection.js";
import { createLayerOperation } from "./layer/create.js";
import { setFlagOperation } from "./layer/flags.js";
import { measureOperation, setTransformOperation } from "./layer/geometry.js";
import { reorderOperation } from "./layer/reorder.js";
import { systemOperations } from "./system.js";

/**
 * The production operation table.
 *
 * Registration is static: an operation is in this list or it does not exist.
 * The set of things the panel can ask After Effects to do is auditable by
 * reading one file.
 */
export function createProductionRegistry(): OperationRegistry {
  return createRegistry([
    ...systemOperations,
    snapshotOperation,
    setFlagOperation,
    reorderOperation,
    createLayerOperation,
    measureOperation,
    setTransformOperation,
  ]);
}

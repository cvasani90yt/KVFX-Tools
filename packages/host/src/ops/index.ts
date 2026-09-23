import { createRegistry, type OperationRegistry } from "../runtime/registry.js";
import { systemOperations } from "./system.js";

/**
 * The production operation table.
 *
 * Registration is static: an operation is in this list or it does not exist.
 * There is no dynamic discovery, so the set of things the panel can ask
 * After Effects to do is auditable by reading one file.
 */
export function createProductionRegistry(): OperationRegistry {
  return createRegistry([...systemOperations]);
}

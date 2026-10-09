import { createRegistry, type OperationRegistry } from "../runtime/registry.js";
import { effectOperations } from "./effect.js";
import { fontOperations } from "./fonts.js";
import { fxOperations } from "./fx.js";
import { keyframeOperations } from "./keys.js";
import { createLayerOperation } from "./layer/create.js";
import { layerEditOperations } from "./layer/edit.js";
import { setFlagOperation } from "./layer/flags.js";
import { measureOperation, setTransformOperation } from "./layer/geometry.js";
import { offsetPositionOperation } from "./layer/offset.js";
import { stackOperations } from "./layer/stack.js";
import { reorderOperation } from "./layer/reorder.js";
import { projectOperations } from "./project.js";
import { propertyOperations } from "./prop.js";
import { resizeCompsOperation } from "./comp-resize.js";
import { mediaOperations } from "./media.js";
import { shapeOperations } from "./shape.js";
import { snapshotOperation } from "./selection.js";
import { systemOperations } from "./system.js";
import { textOperations } from "./text.js";

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
    offsetPositionOperation,
    ...stackOperations,
    ...shapeOperations,
    resizeCompsOperation,
    ...mediaOperations,
    ...layerEditOperations,
    ...propertyOperations,
    ...effectOperations,
    ...keyframeOperations,
    ...textOperations,
    ...fxOperations,
    ...fontOperations,
    ...projectOperations,
  ]);
}

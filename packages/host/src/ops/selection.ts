import type { AeEnvironment } from "../ae/environment.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";

/**
 * Reads the current selection.
 *
 * This is the only way the panel learns what is selected, because After Effects
 * emits no selection events at all (F4). It is a read-only query, it opens no
 * undo group, and it is deliberately cheap: switches, timing and a little comp
 * metadata per selected layer, plus five transform values for the first one so
 * the inspector can show them. Nothing walks effects, masks or keyframes —
 * anything heavier belongs in an explicit, user-triggered scan (ADR-0002).
 */

function kindOf(env: AeEnvironment, layer: AeRawLayer): string {
  if (layer.property("ADBE Text Properties")) return "text";
  if (layer.property("ADBE Root Vectors Group")) return "shape";
  if (layer.property("ADBE Camera Options Group")) return "camera";
  if (layer.property("ADBE Light Options Group")) return "light";
  if (layer.nullLayer === true) return "null";
  if (layer.source && env.isComp(layer.source)) return "precomp";
  return "av";
}

function describeComp(comp: AeRawComp): HostJson {
  return {
    id: comp.id,
    name: comp.name,
    width: comp.width,
    height: comp.height,
    frameRate: comp.frameRate,
    frameDuration: comp.frameDuration,
    duration: comp.duration,
    time: comp.time,
    workAreaStart: comp.workAreaStart,
    workAreaDuration: comp.workAreaDuration,
    layerCount: comp.numLayers,
  };
}

function describeLayer(env: AeEnvironment, layer: AeRawLayer): HostJson {
  return {
    id: layer.id,
    name: layer.name,
    index: layer.index,
    kind: kindOf(env, layer),
    label: layer.label,
    enabled: layer.enabled === true,
    locked: layer.locked === true,
    shy: layer.shy === true,
    // A layer with no solo switch is not an AVLayer — cameras and lights.
    isAV: layer.solo !== undefined,
    solo: layer.solo === true,
    threeD: layer.threeDLayer === true,
    guide: layer.guideLayer === true,
    adjustment: layer.adjustmentLayer === true,
    inPoint: layer.inPoint,
    outPoint: layer.outPoint,
    startTime: layer.startTime,
    parentId: layer.parent ? layer.parent.id : null,
  };
}

function channel(prop: AeRawProp | null): HostJson {
  if (!prop) return null;
  return {
    value: prop.value as HostJson,
    animated: prop.numKeys > 0,
    expression: prop.expressionEnabled === true && typeof prop.expression === "string" && prop.expression.length > 0,
  };
}

/** Transform values of the first selected layer that has a full transform. */
function describePrimary(selected: AeRawLayer[]): HostJson {
  for (let i = 0; i < selected.length; i += 1) {
    const layer = selected[i] as AeRawLayer;
    // Cameras and lights have no anchor, scale or opacity to inspect.
    if (layer.solo === undefined) continue;
    const transform = layer.property("ADBE Transform Group");
    if (!transform) continue;
    const position = transform.property("ADBE Position");
    return {
      id: layer.id,
      anchor: channel(transform.property("ADBE Anchor Point")),
      position: channel(position),
      positionSeparated: position ? position.dimensionsSeparated === true : false,
      scale: channel(transform.property("ADBE Scale")),
      rotation: channel(transform.property("ADBE Rotate Z")),
      opacity: channel(transform.property("ADBE Opacity")),
    };
  }
  return null;
}

export function readSnapshot(env: AeEnvironment): HostJson {
  if (!env.hasProject()) {
    return { capturedAtMs: env.nowMs(), hasProject: false, comp: null, layers: [], primary: null };
  }

  const comp = env.rawComp();
  if (!comp) {
    return { capturedAtMs: env.nowMs(), hasProject: true, comp: null, layers: [], primary: null };
  }

  const selected = comp.selectedLayers;
  const layers: HostJson[] = [];
  for (let i = 0; i < selected.length; i += 1) {
    const layer = selected[i];
    if (layer) layers[layers.length] = describeLayer(env, layer);
  }

  return {
    capturedAtMs: env.nowMs(),
    hasProject: true,
    comp: describeComp(comp),
    layers: layers,
    primary: describePrimary(selected),
  };
}

export const snapshotOperation: Operation = {
  id: "kvfx.op.selection.snapshot",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    return readSnapshot(ctx.env);
  },
};

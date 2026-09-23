import type { AeCompHandle, AeEnvironment, LayerFlag } from "../ae/environment.js";
import type { Operation, OperationContext } from "../runtime/registry.js";
import type { HostJson } from "../runtime/serialize.js";

/**
 * Reads the current selection.
 *
 * This is the only way the panel learns what is selected, because After Effects
 * emits no selection events at all (F4). It is a read-only query, it opens no
 * undo group, and it is deliberately cheap: layer switches and a little comp
 * metadata, nothing that walks properties, effects or keyframes. Anything
 * heavier belongs in an explicit, user-triggered scan (ADR-0002).
 */

const FLAGS: LayerFlag[] = ["solo", "threeD", "guide", "adjustment"];

function describeComp(comp: AeCompHandle): HostJson {
  return {
    id: comp.id(),
    name: comp.name(),
    width: comp.width(),
    height: comp.height(),
    frameRate: comp.frameRate(),
    duration: comp.duration(),
    time: comp.time(),
    layerCount: comp.layerCount(),
  };
}

export function readSnapshot(env: AeEnvironment): HostJson {
  if (!env.hasProject()) {
    return { capturedAtMs: env.nowMs(), hasProject: false, comp: null, layers: [] };
  }

  const comp = env.activeComp();
  if (!comp) {
    return { capturedAtMs: env.nowMs(), hasProject: true, comp: null, layers: [] };
  }

  const selected = comp.selectedLayers();
  const layers: HostJson[] = [];

  for (let i = 0; i < selected.length; i += 1) {
    const layer = selected[i];
    if (!layer) continue;

    const entry: { [key: string]: HostJson } = {
      id: layer.id(),
      name: layer.name(),
      index: layer.index(),
      enabled: layer.getFlag("enabled") === true,
      locked: layer.getFlag("locked") === true,
      shy: layer.getFlag("shy") === true,
      // A layer with no solo switch is not an AVLayer — cameras and lights.
      isAV: layer.getFlag("solo") !== undefined,
    };

    for (let f = 0; f < FLAGS.length; f += 1) {
      const flag = FLAGS[f] as LayerFlag;
      entry[flag] = layer.getFlag(flag) === true;
    }

    layers[layers.length] = entry;
  }

  return {
    capturedAtMs: env.nowMs(),
    hasProject: true,
    comp: describeComp(comp),
    layers: layers,
  };
}

export const snapshotOperation: Operation = {
  id: "kvfx.op.selection.snapshot",
  mutates: false,
  run: function (ctx: OperationContext): HostJson {
    return readSnapshot(ctx.env);
  },
};

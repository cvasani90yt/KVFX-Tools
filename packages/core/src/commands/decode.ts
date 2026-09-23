import type { JsonValue } from "../types/json.js";
import { EMPTY_SNAPSHOT, type ActiveComp, type SelectedLayer, type SelectionSnapshot } from "./types.js";

/**
 * Decodes the host's selection reply.
 *
 * Defensive on purpose. The host is our own code, but the reply has crossed
 * `evalScript` as a string and a partial or older host bundle is a real
 * possibility after an interrupted update. Missing fields degrade to safe
 * defaults rather than throwing, because a panel that renders "nothing
 * selected" is recoverable and one that throws during render is not.
 */

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: JsonValue | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: JsonValue | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: JsonValue | undefined): boolean {
  return value === true;
}

function decodeComp(value: JsonValue | undefined): ActiveComp | undefined {
  if (!isRecord(value)) return undefined;
  return {
    id: num(value["id"]),
    name: str(value["name"], "Composition"),
    width: num(value["width"]),
    height: num(value["height"]),
    frameRate: num(value["frameRate"]),
    duration: num(value["duration"]),
    time: num(value["time"]),
    layerCount: num(value["layerCount"]),
  };
}

function decodeLayer(value: JsonValue): SelectedLayer | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value["id"] !== "number") return undefined;
  return {
    id: value["id"],
    name: str(value["name"], "Layer"),
    index: num(value["index"], 1),
    enabled: bool(value["enabled"]),
    locked: bool(value["locked"]),
    shy: bool(value["shy"]),
    isAV: bool(value["isAV"]),
    solo: bool(value["solo"]),
    threeD: bool(value["threeD"]),
    guide: bool(value["guide"]),
    adjustment: bool(value["adjustment"]),
  };
}

export function decodeSnapshot(value: JsonValue): SelectionSnapshot {
  if (!isRecord(value)) return EMPTY_SNAPSHOT;

  const rawLayers = value["layers"];
  const layers: SelectedLayer[] = [];
  if (Array.isArray(rawLayers)) {
    for (const entry of rawLayers) {
      const layer = decodeLayer(entry);
      if (layer !== undefined) layers.push(layer);
    }
  }

  return {
    capturedAtMs: num(value["capturedAtMs"]),
    hasProject: bool(value["hasProject"]),
    comp: decodeComp(value["comp"]),
    layers,
  };
}

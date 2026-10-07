import type { JsonValue } from "../types/json.js";
import {
  ACTIVE_COMP_DEFAULTS,
  EMPTY_SNAPSHOT,
  type ActiveComp,
  type LayerKind,
  type PrimaryTransform,
  type ProjectComp,
  type SelectedLayer,
  type SelectionSnapshot,
  type TransformChannel,
} from "./types.js";

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
  const frameRate = num(value["frameRate"], ACTIVE_COMP_DEFAULTS.frameRate);
  const duration = num(value["duration"]);
  return {
    id: num(value["id"]),
    name: str(value["name"], "Composition"),
    width: num(value["width"]),
    height: num(value["height"]),
    frameRate,
    frameDuration: num(value["frameDuration"], frameRate > 0 ? 1 / frameRate : ACTIVE_COMP_DEFAULTS.frameDuration),
    duration,
    time: num(value["time"]),
    workAreaStart: num(value["workAreaStart"]),
    workAreaDuration: num(value["workAreaDuration"], duration),
    layerCount: num(value["layerCount"]),
  };
}

const KINDS: readonly LayerKind[] = ["av", "text", "shape", "null", "precomp", "camera", "light"];

function kind(value: JsonValue | undefined): LayerKind {
  return KINDS.find((k) => k === value) ?? "av";
}

function decodeLayer(value: JsonValue): SelectedLayer | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value["id"] !== "number") return undefined;
  const parentId = value["parentId"];
  return {
    id: value["id"],
    name: str(value["name"], "Layer"),
    index: num(value["index"], 1),
    kind: kind(value["kind"]),
    label: num(value["label"]),
    enabled: bool(value["enabled"]),
    locked: bool(value["locked"]),
    shy: bool(value["shy"]),
    isAV: bool(value["isAV"]),
    solo: bool(value["solo"]),
    threeD: bool(value["threeD"]),
    guide: bool(value["guide"]),
    adjustment: bool(value["adjustment"]),
    inPoint: num(value["inPoint"]),
    outPoint: num(value["outPoint"]),
    startTime: num(value["startTime"]),
    parentId: typeof parentId === "number" ? parentId : undefined,
  };
}

function decodeChannel(value: JsonValue | undefined): TransformChannel | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value["value"];
  let numbers: number[];
  if (typeof raw === "number") numbers = [raw];
  else if (Array.isArray(raw)) numbers = raw.filter((n): n is number => typeof n === "number");
  else return undefined;
  return { value: numbers, animated: bool(value["animated"]), expression: bool(value["expression"]) };
}

function decodeProjectComps(value: JsonValue | undefined): ProjectComp[] {
  if (!Array.isArray(value)) return [];
  const out: ProjectComp[] = [];
  for (const entry of value) {
    if (isRecord(entry) && typeof entry["id"] === "number") out.push({ id: entry["id"], name: str(entry["name"], "Comp") });
  }
  return out;
}

function decodePrimary(value: JsonValue | undefined): PrimaryTransform | undefined {
  if (!isRecord(value) || typeof value["id"] !== "number") return undefined;
  const anchor = decodeChannel(value["anchor"]);
  const position = decodeChannel(value["position"]);
  const scale = decodeChannel(value["scale"]);
  const rotation = decodeChannel(value["rotation"]);
  const opacity = decodeChannel(value["opacity"]);
  if (!anchor || !position || !scale || !rotation || !opacity) return undefined;
  return {
    id: value["id"],
    anchor,
    position,
    positionSeparated: bool(value["positionSeparated"]),
    scale,
    rotation,
    opacity,
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
    primary: decodePrimary(value["primary"]),
    projectComps: decodeProjectComps(value["projectComps"]),
  };
}

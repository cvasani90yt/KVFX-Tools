import type { JsonValue } from "../types/json.js";
import type { LayerMeasurement, Rect, Vec2 } from "../geometry/index.js";

/**
 * Decodes the host's `kvfx.op.layer.measure` reply.
 *
 * Defensive for the same reason as the selection decoder: the reply has crossed
 * `evalScript` as a string, and a half-updated install is a real possibility.
 * A layer we cannot decode is dropped rather than defaulted to zeroes, because
 * a layer measured at the origin would be *moved* by alignment, which is worse
 * than leaving it alone.
 */

export interface MeasurementReply {
  readonly compWidth: number;
  readonly compHeight: number;
  /** Selected layers plus the ancestors their transforms depend on. */
  readonly layers: readonly LayerMeasurement[];
  readonly selectedIds: readonly number[];
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function vec2(value: JsonValue | undefined): Vec2 | undefined {
  if (!isRecord(value)) return undefined;
  const x = num(value["x"]);
  const y = num(value["y"]);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function rect(value: JsonValue | undefined): Rect | undefined {
  if (!isRecord(value)) return undefined;
  const left = num(value["left"]);
  const top = num(value["top"]);
  const width = num(value["width"]);
  const height = num(value["height"]);
  if (left === undefined || top === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return { left, top, width, height };
}

function decodeLayer(value: JsonValue): LayerMeasurement | undefined {
  if (!isRecord(value)) return undefined;

  const id = num(value["id"]);
  const sourceRect = rect(value["sourceRect"]);
  const anchorPoint = vec2(value["anchorPoint"]);
  const position = vec2(value["position"]);
  const scale = vec2(value["scale"]);
  const rotation = num(value["rotation"]);

  if (
    id === undefined ||
    sourceRect === undefined ||
    anchorPoint === undefined ||
    position === undefined ||
    scale === undefined ||
    rotation === undefined
  ) {
    return undefined;
  }

  const parentId = num(value["parentId"]);

  return {
    id,
    name: typeof value["name"] === "string" ? value["name"] : "Layer",
    sourceRect,
    transform: { anchorPoint, position, scale, rotation },
    parentId,
    threeD: value["threeD"] === true,
    isAV: value["isAV"] === true,
  };
}

export function decodeMeasurement(value: JsonValue): MeasurementReply {
  const empty: MeasurementReply = { compWidth: 0, compHeight: 0, layers: [], selectedIds: [] };
  if (!isRecord(value)) return empty;

  const comp = isRecord(value["comp"]) ? value["comp"] : undefined;
  const layers: LayerMeasurement[] = [];
  const rawLayers = value["layers"];
  if (Array.isArray(rawLayers)) {
    for (const entry of rawLayers) {
      const layer = decodeLayer(entry);
      if (layer !== undefined) layers.push(layer);
    }
  }

  const selectedIds: number[] = [];
  const rawSelected = value["selectedIds"];
  if (Array.isArray(rawSelected)) {
    for (const entry of rawSelected) {
      if (typeof entry === "number") selectedIds.push(entry);
    }
  }

  return {
    compWidth: num(comp?.["width"]) ?? 0,
    compHeight: num(comp?.["height"]) ?? 0,
    layers,
    selectedIds,
  };
}

/** The measured layers the user actually selected, in selection order. */
export function selectedMeasurements(reply: MeasurementReply): LayerMeasurement[] {
  const byId = new Map(reply.layers.map((layer) => [layer.id, layer]));
  const out: LayerMeasurement[] = [];
  for (const id of reply.selectedIds) {
    const layer = byId.get(id);
    if (layer !== undefined) out.push(layer);
  }
  return out;
}

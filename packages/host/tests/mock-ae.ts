import type { AeEnvironment, Vec2Value } from "../src/ae/environment.js";
import { createEnvironment } from "../src/ae/live-environment.js";
import {
  INTERP,
  type MockApp,
  MockComp,
  type MockLayer,
  type MockProject,
  PT,
  PURGE_ALL,
  PURGE_IMAGE,
  PVT,
  BLEND,
  JUSTIFY,
  TRACK_MATTE,
  createMockApp,
} from "./mock-dom.js";

/**
 * Builds the production environment over the mock After Effects DOM.
 *
 * Earlier this file was a hand-written stand-in for the environment itself,
 * which meant the environment's own wrapping code — the part that talks to
 * After Effects — was never under test. It now runs the real
 * `createEnvironment` against `mock-dom.ts`, and that change immediately caught
 * a shipped bug: rotation was read as an array, so it was always 0.
 */

export interface MockGeometrySpec {
  readonly sourceRect?: { left: number; top: number; width: number; height: number };
  readonly anchorPoint?: Vec2Value;
  readonly position?: Vec2Value;
  readonly scale?: Vec2Value;
  readonly rotation?: number;
  /** Name of the parent layer. */
  readonly parent?: string;
  /** "Position is animated" or "Position has separated dimensions". */
  readonly blockedReason?: string;
}

export interface MockLayerSpec {
  readonly name: string;
  /** Camera and light layers are not AVLayers and lack several switches. */
  readonly isAV?: boolean;
  readonly kind?: "av" | "text" | "shape" | "null" | "camera";
  readonly text?: string;
  readonly selected?: boolean;
  readonly locked?: boolean;
  readonly enabled?: boolean;
  readonly shy?: boolean;
  readonly solo?: boolean;
  readonly threeD?: boolean;
  readonly guide?: boolean;
  readonly adjustment?: boolean;
  readonly geometry?: MockGeometrySpec;
}

export interface MockCompSpec {
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  readonly duration?: number;
  readonly layers?: readonly MockLayerSpec[];
}

export interface MockAeOptions {
  readonly version?: string;
  /** Milliseconds each `nowMs()` call advances by, simulating elapsed work. */
  readonly tickMs?: number;
  readonly hasProject?: boolean;
  /** Omit for "no composition open". */
  readonly comp?: MockCompSpec;
}

/** A read-only view of a layer's switches, in the names the tests use. */
export interface LayerView {
  readonly id: number;
  readonly name: string;
  readonly flags: Record<string, boolean>;
  readonly raw: MockLayer;
}

export interface MockAe extends AeEnvironment {
  readonly app: MockApp;
  readonly project: MockProject | null;
  /** The active comp, when one was specified. */
  readonly comp: MockComp | undefined;
  readonly undoEvents: string[];
  openGroups(): number;
  setVersion(version: string): void;
  advance(ms: number): void;
  /** Layer names in stack order, top first. */
  stack(): string[];
  layerByName(name: string): LayerView | undefined;
  raw(name: string): MockLayer;
  positionOf(name: string): Vec2Value | undefined;
  anchorOf(name: string): Vec2Value | undefined;
  idOf(name: string): number;
  select(...names: string[]): void;
}

function view(layer: MockLayer): LayerView {
  return {
    id: layer.id,
    name: layer.name,
    raw: layer,
    get flags(): Record<string, boolean> {
      return {
        enabled: layer.enabled,
        locked: layer.locked,
        shy: layer.shy,
        solo: layer.solo === true,
        threeD: layer.threeDLayer === true,
        guide: layer.guideLayer === true,
        adjustment: layer.adjustmentLayer === true,
      };
    },
  };
}

function vec2(value: unknown): Vec2Value | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  return { x: value[0] as number, y: value[1] as number };
}

export function createMockAe(options: MockAeOptions = {}): MockAe {
  const app = createMockApp({
    ...(options.version === undefined ? {} : { version: options.version }),
    ...(options.hasProject === undefined ? {} : { hasProject: options.hasProject }),
  });
  let clock = 1_000_000;
  const tick = options.tickMs ?? 0;

  let comp: MockComp | undefined;
  const spec = options.comp;
  if (app.project !== null && spec !== undefined) {
    comp = app.project.addComp(spec.name ?? "Comp 1", spec.width, spec.height, spec.frameRate, spec.duration);
    app.project.activeItem = comp;

    const built: MockLayer[] = [];
    for (const layerSpec of [...(spec.layers ?? [])].reverse()) {
      const kind = layerSpec.kind ?? (layerSpec.isAV === false ? "camera" : "av");
      const layer = comp.addLayer({
        name: layerSpec.name,
        kind,
        ...(layerSpec.text === undefined ? {} : { text: layerSpec.text }),
      });
      layer.selected = layerSpec.selected ?? false;
      layer.locked = layerSpec.locked ?? false;
      layer.enabled = layerSpec.enabled ?? true;
      layer.shy = layerSpec.shy ?? false;
      if (layer.isAV) {
        layer.solo = layerSpec.solo ?? false;
        layer.threeDLayer = layerSpec.threeD ?? false;
        layer.guideLayer = layerSpec.guide ?? false;
        layer.adjustmentLayer = layerSpec.adjustment ?? false;
      }

      const g = layerSpec.geometry;
      if (g?.sourceRect !== undefined) layer.sourceRect = { ...g.sourceRect };
      if (g?.anchorPoint !== undefined) layer.transform("ADBE Anchor Point").setValue([g.anchorPoint.x, g.anchorPoint.y, 0]);
      if (g?.position !== undefined) layer.transform("ADBE Position").setValue([g.position.x, g.position.y, 0]);
      if (g?.scale !== undefined) layer.transform("ADBE Scale").setValue([g.scale.x, g.scale.y, 100]);
      if (g?.rotation !== undefined) layer.transform("ADBE Rotate Z").setValue(g.rotation);
      if (g?.blockedReason !== undefined) {
        const position = layer.transform("ADBE Position");
        if (/animated/i.test(g.blockedReason)) position.setValueAtTime(0, position.value);
        if (/separated/i.test(g.blockedReason)) position.dimensionsSeparated = true;
      }
      built.unshift(layer);
    }

    for (const [i, layerSpec] of (spec.layers ?? []).entries()) {
      const parentName = layerSpec.geometry?.parent;
      if (parentName !== undefined) built[i]!.parent = built.find((l) => l.name === parentName) ?? null;
    }
  }

  const environment = createEnvironment({
    app: app,
    os: "Mock OS 1.0",
    engineVersion: "4.2.0",
    isComp: (item) => item instanceof MockComp,
    newKeyframeEase: (speed, influence) => ({ speed, influence }),
    newFile: (path) => ({ exists: app.existingFiles.has(path), fsName: path, name: path.split(/[\\/]/).pop() ?? path }),
    newImportOptions: (file) => ({ file, importAs: 0 }),
    interpolation: INTERP,
    valueTypes: {
      noValue: PVT.NO_VALUE,
      oneD: PVT.OneD,
      twoD: PVT.TwoD,
      twoDSpatial: PVT.TwoD_SPATIAL,
      threeD: PVT.ThreeD,
      threeDSpatial: PVT.ThreeD_SPATIAL,
      color: PVT.COLOR,
      textDocument: PVT.TEXT_DOCUMENT,
    },
    leafPropertyType: PT.PROPERTY,
    purgeTargets: { all: PURGE_ALL, image: PURGE_IMAGE },
    newShape: (vertices, inTangents, outTangents, closed) => ({ vertices, inTangents, outTangents, closed }),
    trackMatteTypes: TRACK_MATTE,
    blendingModes: BLEND,
    justifications: JUSTIFY,
    nowMs: () => {
      const value = clock;
      clock += tick;
      return value;
    },
  });

  const find = (name: string): MockLayer | undefined => comp?.stack.find((l) => l.name === name);

  return {
    ...environment,
    app,
    project: app.project,
    comp,
    get undoEvents(): string[] {
      return app.undoEvents;
    },
    openGroups: () =>
      app.undoEvents.reduce((depth, event) => depth + (event === "end" ? -1 : 1), 0),
    setVersion: (next) => {
      app.version = next;
      app.buildName = `Adobe After Effects ${next}`;
    },
    advance: (ms) => {
      clock += ms;
    },
    stack: () => comp?.stack.map((l) => l.name) ?? [],
    layerByName: (name) => {
      const layer = find(name);
      return layer === undefined ? undefined : view(layer);
    },
    raw: (name) => {
      const layer = find(name);
      if (layer === undefined) throw new Error(`No layer named ${name}`);
      return layer;
    },
    positionOf: (name) => {
      const layer = find(name);
      return layer === undefined ? undefined : vec2(layer.transform("ADBE Position").value);
    },
    anchorOf: (name) => {
      const layer = find(name);
      return layer === undefined ? undefined : vec2(layer.transform("ADBE Anchor Point").value);
    },
    idOf: (name) => find(name)?.id ?? -1,
    select: (...names) => {
      for (const layer of comp?.stack ?? []) layer.selected = names.includes(layer.name);
    },
  };
}

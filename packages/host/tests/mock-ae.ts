import type {
  AeCompHandle,
  AeEnvironment,
  AeLayerHandle,
  LayerFlag,
  LayerGeometry,
  Vec2Value,
} from "../src/ae/environment.js";

/**
 * A scriptable stand-in for After Effects (DEVELOPMENT.md, tier 2).
 *
 * It models the layer stack faithfully enough to catch the bugs that actually
 * occur in ordering code — index renumbering after a move, relative order
 * across a multi-layer move, and switches that some layer types do not have —
 * and it records undo-group activity so tests can assert that every mutation is
 * wrapped in exactly one balanced group, including on the failure path.
 *
 * Its fidelity is bounded and known: it proves our logic, not Adobe's
 * behaviour. That is what the tier 3 fixture projects are for.
 */

export interface MockGeometrySpec {
  readonly sourceRect?: { left: number; top: number; width: number; height: number };
  readonly anchorPoint?: Vec2Value;
  readonly position?: Vec2Value;
  readonly scale?: Vec2Value;
  readonly rotation?: number;
  /** Name of the parent layer, resolved to an id when the comp is built. */
  readonly parent?: string;
  /** Why this layer's position cannot be written — animated, separated, etc. */
  readonly blockedReason?: string;
}

export interface MockLayerSpec {
  readonly name: string;
  /** Camera and light layers are not AVLayers and lack several switches. */
  readonly isAV?: boolean;
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

interface MockLayer {
  id: number;
  name: string;
  isAV: boolean;
  selected: boolean;
  flags: Record<string, boolean>;
  sourceRect: { left: number; top: number; width: number; height: number };
  anchorPoint: Vec2Value;
  position: Vec2Value;
  scale: Vec2Value;
  rotation: number;
  parentName: string | undefined;
  blockedReason: string | undefined;
}

const AV_ONLY: readonly LayerFlag[] = ["solo", "threeD", "guide", "adjustment"];

export interface MockCompSpec {
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  readonly duration?: number;
  readonly layers?: readonly MockLayerSpec[];
}

export interface MockAe extends AeEnvironment {
  readonly undoEvents: string[];
  openGroups(): number;
  setVersion(version: string): void;
  advance(ms: number): void;
  /** Layer names in stack order, top first — the assertion ordering tests need. */
  stack(): string[];
  layerByName(name: string): MockLayer | undefined;
  positionOf(name: string): Vec2Value | undefined;
  anchorOf(name: string): Vec2Value | undefined;
  idOf(name: string): number;
  select(...names: string[]): void;
}

export interface MockAeOptions {
  readonly version?: string;
  /** Milliseconds each `nowMs()` call advances by, simulating elapsed work. */
  readonly tickMs?: number;
  readonly hasProject?: boolean;
  /** Omit for "no composition open". */
  readonly comp?: MockCompSpec;
}

export function createMockAe(options: MockAeOptions = {}): MockAe {
  const undoEvents: string[] = [];
  let version = options.version ?? "26.0.1x45";
  let depth = 0;
  let clock = 1_000_000;
  const tick = options.tickMs ?? 0;
  const hasProject = options.hasProject ?? true;

  let nextId = 1;
  const spec = options.comp;
  const stack: MockLayer[] = (spec?.layers ?? []).map((layer) => ({
    id: nextId++,
    name: layer.name,
    isAV: layer.isAV ?? true,
    selected: layer.selected ?? false,
    flags: {
      enabled: layer.enabled ?? true,
      locked: layer.locked ?? false,
      shy: layer.shy ?? false,
      solo: layer.solo ?? false,
      threeD: layer.threeD ?? false,
      guide: layer.guide ?? false,
      adjustment: layer.adjustment ?? false,
    },
    sourceRect: layer.geometry?.sourceRect ?? { left: 0, top: 0, width: 100, height: 50 },
    anchorPoint: layer.geometry?.anchorPoint ?? { x: 0, y: 0 },
    position: layer.geometry?.position ?? { x: 0, y: 0 },
    scale: layer.geometry?.scale ?? { x: 100, y: 100 },
    rotation: layer.geometry?.rotation ?? 0,
    parentName: layer.geometry?.parent,
    blockedReason: layer.geometry?.blockedReason,
  }));

  const positionOf = (layer: MockLayer): number => stack.indexOf(layer);

  function wrap(layer: MockLayer): AeLayerHandle {
    return {
      id: () => layer.id,
      name: () => layer.name,
      index: () => positionOf(layer) + 1,
      getFlag: (flag) => {
        if (!layer.isAV && AV_ONLY.includes(flag)) return undefined;
        return layer.flags[flag] ?? false;
      },
      setFlag: (flag, value) => {
        if (!layer.isAV && AV_ONLY.includes(flag)) return;
        layer.flags[flag] = value;
      },
      moveToTop: () => {
        stack.splice(positionOf(layer), 1);
        stack.unshift(layer);
      },
      moveToBottom: () => {
        stack.splice(positionOf(layer), 1);
        stack.push(layer);
      },
      moveBeforeIndex: (index) => {
        const target = stack[index - 1];
        if (target === undefined || target === layer) return;
        stack.splice(positionOf(layer), 1);
        stack.splice(positionOf(target), 0, layer);
      },
      moveAfterIndex: (index) => {
        const target = stack[index - 1];
        if (target === undefined || target === layer) return;
        stack.splice(positionOf(layer), 1);
        stack.splice(positionOf(target) + 1, 0, layer);
      },

      geometry: (): LayerGeometry | undefined => {
        const parent = layer.parentName === undefined
          ? undefined
          : stack.find((candidate) => candidate.name === layer.parentName);
        return {
          sourceRect: layer.isAV ? layer.sourceRect : { left: 0, top: 0, width: 0, height: 0 },
          anchorPoint: layer.anchorPoint,
          position: layer.position,
          scale: layer.scale,
          rotation: layer.rotation,
          parentId: parent?.id,
          threeD: layer.flags["threeD"] === true,
          isAV: layer.isAV,
          blockedReason: layer.blockedReason,
        };
      },
      setPosition: (value) => {
        layer.position = value;
      },
      setAnchorPoint: (value) => {
        layer.anchorPoint = value;
      },
    };
  }

  function makeComp(): AeCompHandle {
    return {
      id: () => 101,
      name: () => spec?.name ?? "Comp 1",
      width: () => spec?.width ?? 1920,
      height: () => spec?.height ?? 1080,
      frameRate: () => spec?.frameRate ?? 25,
      duration: () => spec?.duration ?? 10,
      time: () => 0,
      pixelAspect: () => 1,
      layerCount: () => stack.length,
      layerAt: (index) => wrap(stack[index - 1] as MockLayer),
      allLayers: () => stack.map(wrap),
      selectedLayers: () => stack.filter((l) => l.selected).map(wrap),
      addNull: () => {
        const layer: MockLayer = {
          id: nextId++,
          name: `Null ${String(nextId)}`,
          isAV: true,
          selected: false,
          flags: { enabled: true, locked: false, shy: false, solo: false, threeD: false, guide: false, adjustment: false },
          sourceRect: { left: 0, top: 0, width: 100, height: 100 },
          anchorPoint: { x: 0, y: 0 },
          position: { x: 0, y: 0 },
          scale: { x: 100, y: 100 },
          rotation: 0,
          parentName: undefined,
          blockedReason: undefined,
        };
        stack.unshift(layer);
        return wrap(layer);
      },
      addAdjustment: (name) => {
        const layer: MockLayer = {
          id: nextId++,
          name,
          isAV: true,
          selected: false,
          flags: { enabled: true, locked: false, shy: false, solo: false, threeD: false, guide: false, adjustment: true },
          sourceRect: { left: 0, top: 0, width: 1920, height: 1080 },
          anchorPoint: { x: 0, y: 0 },
          position: { x: 0, y: 0 },
          scale: { x: 100, y: 100 },
          rotation: 0,
          parentName: undefined,
          blockedReason: undefined,
        };
        stack.unshift(layer);
        return wrap(layer);
      },
    };
  }

  return {
    undoEvents,
    openGroups: () => depth,
    setVersion: (next) => {
      version = next;
    },
    advance: (ms) => {
      clock += ms;
    },
    stack: () => stack.map((l) => l.name),
    layerByName: (name) => stack.find((l) => l.name === name),
    positionOf: (name) => stack.find((l) => l.name === name)?.position,
    anchorOf: (name) => stack.find((l) => l.name === name)?.anchorPoint,
    idOf: (name) => stack.find((l) => l.name === name)?.id ?? -1,
    select: (...names) => {
      for (const layer of stack) layer.selected = names.includes(layer.name);
    },

    version: () => version,
    buildName: () => `Adobe After Effects ${version}`,
    language: () => "en_US",
    os: () => "Mock OS 1.0",
    engineVersion: () => "4.2.0",
    hasProject: () => hasProject,
    activeComp: () => (hasProject && spec !== undefined ? makeComp() : undefined),

    beginUndoGroup: (name) => {
      depth += 1;
      undoEvents.push(`begin:${name}`);
    },
    endUndoGroup: () => {
      depth -= 1;
      undoEvents.push("end");
    },

    nowMs: () => {
      const value = clock;
      clock += tick;
      return value;
    },
  };
}

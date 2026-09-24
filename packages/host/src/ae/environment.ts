/**
 * The host's window onto After Effects.
 *
 * Every After Effects call goes through this facade, for two reasons. It keeps
 * the AE API surface we depend on in one reviewable place (so an API change in
 * AE 27 is a localised fix), and it lets the dispatcher, the plan executor and
 * every operation run against the model in `tests/mock-ae.ts` without launching
 * After Effects.
 *
 * The facade is boilerplate. That is the correct trade: this is the driver
 * layer, and the alternative is untestable operations.
 */

export type LayerFlag = "enabled" | "locked" | "shy" | "solo" | "threeD" | "guide" | "adjustment";

export interface Vec2Value {
  readonly x: number;
  readonly y: number;
}

export interface RectValue {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Everything the layout maths needs about one layer. */
export interface LayerGeometry {
  readonly sourceRect: RectValue;
  readonly anchorPoint: Vec2Value;
  readonly position: Vec2Value;
  readonly scale: Vec2Value;
  readonly rotation: number;
  readonly parentId: number | undefined;
  readonly threeD: boolean;
  readonly isAV: boolean;
  /**
   * Why the layer cannot be repositioned, when it cannot. An animated or
   * dimension-separated position cannot take a plain `setValue`, and writing a
   * keyframe instead would change the animation the user did not ask us to
   * touch.
   */
  readonly blockedReason: string | undefined;
}

export interface AeLayerHandle {
  id(): number;
  name(): string;
  /** Live index — re-read after every move, never cached. */
  index(): number;
  /** `undefined` when the layer type has no such switch (a camera has no solo). */
  getFlag(flag: LayerFlag): boolean | undefined;
  setFlag(flag: LayerFlag, value: boolean): void;
  moveToTop(): void;
  moveToBottom(): void;
  /** Moves this layer directly above the layer currently at `index`. */
  moveBeforeIndex(index: number): void;
  /** Moves this layer directly below the layer currently at `index`. */
  moveAfterIndex(index: number): void;
  /** Reads the layer's geometry at `time`, or `undefined` if unavailable. */
  geometry(time: number): LayerGeometry | undefined;
  setPosition(value: Vec2Value): void;
  setAnchorPoint(value: Vec2Value): void;
}

export interface AeCompHandle {
  id(): number;
  name(): string;
  width(): number;
  height(): number;
  frameRate(): number;
  duration(): number;
  time(): number;
  pixelAspect(): number;
  layerCount(): number;
  layerAt(index: number): AeLayerHandle;
  allLayers(): AeLayerHandle[];
  selectedLayers(): AeLayerHandle[];
  addNull(): AeLayerHandle;
  addAdjustment(name: string): AeLayerHandle;
}

export interface AeEnvironment {
  /** `app.version`, e.g. "26.0.1x45". */
  version(): string;
  /** `app.buildName`. */
  buildName(): string;
  /** `app.isoLanguage`. */
  language(): string;
  /** `$.os`. */
  os(): string;
  /** `$.version` — the ExtendScript engine version. */
  engineVersion(): string;
  hasProject(): boolean;
  /** The active composition, or `undefined` when none is open or focused. */
  activeComp(): AeCompHandle | undefined;
  beginUndoGroup(name: string): void;
  endUndoGroup(): void;
  /** Milliseconds since the epoch. Injectable so budget tests are deterministic. */
  nowMs(): number;
}

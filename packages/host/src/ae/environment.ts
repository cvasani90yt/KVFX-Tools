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

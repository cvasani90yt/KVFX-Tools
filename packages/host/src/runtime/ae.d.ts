/**
 * Minimal ambient declarations for the After Effects scripting globals this
 * package touches.
 *
 * Deliberately not exhaustive: we declare what we use, so that reaching for a
 * new After Effects API is a visible, reviewed change rather than something
 * that type-checks by accident.
 */

interface AeRawLayer {
  readonly id: number;
  readonly index: number;
  name: string;
  enabled: boolean;
  locked: boolean;
  shy: boolean;
  /** AVLayer only — absent on camera and light layers. */
  solo?: boolean;
  threeDLayer?: boolean;
  guideLayer?: boolean;
  adjustmentLayer?: boolean;
  moveToBeginning(): void;
  moveToEnd(): void;
  moveBefore(layer: AeRawLayer): void;
  moveAfter(layer: AeRawLayer): void;
}

interface AeRawLayerCollection {
  addNull(duration?: number): AeRawLayer;
  addSolid(
    color: [number, number, number],
    name: string,
    width: number,
    height: number,
    pixelAspect: number,
    duration?: number,
  ): AeRawLayer;
}

interface AeRawComp {
  readonly id: number;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly duration: number;
  readonly pixelAspect: number;
  readonly numLayers: number;
  time: number;
  readonly selectedLayers: AeRawLayer[];
  readonly layers: AeRawLayerCollection;
  layer(index: number): AeRawLayer;
}

interface AeRawProject {
  readonly numItems: number;
  readonly activeItem: unknown;
}

interface AeApplication {
  /** e.g. "26.0.1x45" */
  readonly version: string;
  /** e.g. "Adobe After Effects 26.0.1x45" */
  readonly buildName: string;
  /** ISO language of the running host, e.g. "en_US". */
  readonly isoLanguage: string;
  readonly project: AeRawProject | null;
  beginUndoGroup(name: string): void;
  endUndoGroup(): void;
}

interface AeDollar {
  /** Operating system description string. */
  readonly os: string;
  /** ExtendScript engine version. */
  readonly version: string;
  readonly global: Record<string, unknown>;
}

declare const app: AeApplication;
declare const $: AeDollar;

/** Used only for the `activeItem instanceof CompItem` narrowing. */
declare const CompItem: { new (): AeRawComp };

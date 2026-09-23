import { nowMs } from "../runtime/es3.js";
import type { AeCompHandle, AeEnvironment, AeLayerHandle, LayerFlag } from "./environment.js";

/** Maps our flag names onto the After Effects property names. */
const FLAG_PROPERTY: { [flag: string]: string } = {
  enabled: "enabled",
  locked: "locked",
  shy: "shy",
  solo: "solo",
  threeD: "threeDLayer",
  guide: "guideLayer",
  adjustment: "adjustmentLayer",
};

/** Solid colour for generated adjustment layers; invisible by definition. */
const ADJUSTMENT_COLOR: [number, number, number] = [0, 0, 0];

/**
 * `comp` is captured so that index-relative moves can resolve their target
 * without one layer handle needing to reach inside another. Keeping the raw
 * objects private to this module is what makes the facade a real boundary
 * rather than a suggestion.
 */
function wrapLayer(raw: AeRawLayer, comp: AeRawComp): AeLayerHandle {
  return {
    id: function (): number {
      return raw.id;
    },
    name: function (): string {
      return raw.name;
    },
    index: function (): number {
      return raw.index;
    },
    getFlag: function (flag: LayerFlag): boolean | undefined {
      const property = FLAG_PROPERTY[flag];
      if (!property) return undefined;
      const bag = raw as unknown as { [key: string]: unknown };
      // Feature detection rather than an instanceof check: camera and light
      // layers carry some switches and not others, and probing the property is
      // both cheaper and more accurate than classifying the layer type.
      return typeof bag[property] === "boolean" ? bag[property] : undefined;
    },
    setFlag: function (flag: LayerFlag, value: boolean): void {
      const property = FLAG_PROPERTY[flag];
      if (!property) return;
      (raw as unknown as { [key: string]: unknown })[property] = value;
    },
    moveToTop: function (): void {
      raw.moveToBeginning();
    },
    moveToBottom: function (): void {
      raw.moveToEnd();
    },
    moveBeforeIndex: function (index: number): void {
      raw.moveBefore(comp.layer(index));
    },
    moveAfterIndex: function (index: number): void {
      raw.moveAfter(comp.layer(index));
    },
  };
}

function wrapComp(raw: AeRawComp): AeCompHandle {
  return {
    id: function (): number {
      return raw.id;
    },
    name: function (): string {
      return raw.name;
    },
    width: function (): number {
      return raw.width;
    },
    height: function (): number {
      return raw.height;
    },
    frameRate: function (): number {
      return raw.frameRate;
    },
    duration: function (): number {
      return raw.duration;
    },
    time: function (): number {
      return raw.time;
    },
    pixelAspect: function (): number {
      return raw.pixelAspect;
    },
    layerCount: function (): number {
      return raw.numLayers;
    },
    layerAt: function (index: number): AeLayerHandle {
      return wrapLayer(raw.layer(index), raw);
    },
    allLayers: function (): AeLayerHandle[] {
      const out: AeLayerHandle[] = [];
      for (let i = 1; i <= raw.numLayers; i += 1) {
        out[out.length] = wrapLayer(raw.layer(i), raw);
      }
      return out;
    },
    selectedLayers: function (): AeLayerHandle[] {
      const selected = raw.selectedLayers;
      const out: AeLayerHandle[] = [];
      for (let i = 0; i < selected.length; i += 1) {
        out[out.length] = wrapLayer(selected[i] as AeRawLayer, raw);
      }
      return out;
    },
    addNull: function (): AeLayerHandle {
      return wrapLayer(raw.layers.addNull(raw.duration), raw);
    },
    addAdjustment: function (name: string): AeLayerHandle {
      const solid = raw.layers.addSolid(
        ADJUSTMENT_COLOR,
        name,
        raw.width,
        raw.height,
        raw.pixelAspect,
        raw.duration,
      );
      solid.adjustmentLayer = true;
      return wrapLayer(solid, raw);
    },
  };
}

/** The real environment, backed by After Effects' own globals. */
export function createLiveEnvironment(): AeEnvironment {
  return {
    version: function (): string {
      return app.version;
    },
    buildName: function (): string {
      return app.buildName;
    },
    language: function (): string {
      return app.isoLanguage;
    },
    os: function (): string {
      return $.os;
    },
    engineVersion: function (): string {
      return $.version;
    },
    hasProject: function (): boolean {
      return !!app.project;
    },
    activeComp: function (): AeCompHandle | undefined {
      const project = app.project;
      if (!project) return undefined;
      const active = project.activeItem;
      // `activeItem` is null with nothing open, and an ordinary footage item
      // when the user has selected one in the project panel.
      if (!active || !(active instanceof CompItem)) return undefined;
      return wrapComp(active);
    },
    beginUndoGroup: function (name: string): void {
      app.beginUndoGroup(name);
    },
    endUndoGroup: function (): void {
      app.endUndoGroup();
    },
    nowMs: nowMs,
  };
}

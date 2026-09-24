import { nowMs } from "../runtime/es3.js";
import type {
  AeCompHandle,
  AeEnvironment,
  AeLayerHandle,
  LayerFlag,
  LayerGeometry,
  Vec2Value,
} from "./environment.js";

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

/**
 * Match names rather than display names, so the code works in a localised
 * After Effects. A German or Japanese install has different display names and
 * identical match names.
 */
const TRANSFORM_GROUP = "ADBE Transform Group";
const PROPERTY_ANCHOR = "ADBE Anchor Point";
const PROPERTY_POSITION = "ADBE Position";
const PROPERTY_SCALE = "ADBE Scale";
const PROPERTY_ROTATION = "ADBE Rotate Z";

function transformGroup(raw: AeRawLayer): AeRawPropertyGroup | null {
  return raw.property(TRANSFORM_GROUP);
}

function readProperty(raw: AeRawLayer, matchName: string): AeRawProperty | null {
  const group = transformGroup(raw);
  return group ? group.property(matchName) : null;
}

/**
 * Explains why a property cannot take a plain `setValue`.
 *
 * Writing a keyframe into an animated property, or into a dimension-separated
 * one, would alter animation the user never asked us to touch — so these are
 * reported and skipped instead (ARCHITECTURE §7).
 */
function blockedReasonFor(property: AeRawProperty | null, label: string): string | undefined {
  if (!property) return `${label} is unavailable on this layer`;
  if (property.numKeys > 0) return `${label} is animated`;
  if (property.dimensionsSeparated === true) return `${label} has separated dimensions`;
  return undefined;
}

function readVec2(property: AeRawProperty | null, fallback: Vec2Value): Vec2Value {
  if (!property) return fallback;
  const value = property.value;
  if (!value || value.length < 2) return fallback;
  return { x: value[0] as number, y: value[1] as number };
}

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

    geometry: function (time: number): LayerGeometry | undefined {
      // Cameras and lights have no sourceRectAtTime, which is also how we
      // recognise them without classifying layer types.
      if (typeof raw.sourceRectAtTime !== "function") {
        return {
          sourceRect: { left: 0, top: 0, width: 0, height: 0 },
          anchorPoint: { x: 0, y: 0 },
          position: { x: 0, y: 0 },
          scale: { x: 100, y: 100 },
          rotation: 0,
          parentId: raw.parent ? raw.parent.id : undefined,
          threeD: false,
          isAV: false,
          blockedReason: undefined,
        };
      }

      // `false` excludes stroke and shadow extents, so bounds match the visible
      // artwork rather than whatever an effect happens to paint outside it.
      const rect = raw.sourceRectAtTime(time, false);
      const positionProperty = readProperty(raw, PROPERTY_POSITION);
      const anchorProperty = readProperty(raw, PROPERTY_ANCHOR);
      const rotationProperty = readProperty(raw, PROPERTY_ROTATION);

      const rotationValue = rotationProperty ? rotationProperty.value : null;
      const positionBlocked = blockedReasonFor(positionProperty, "Position");
      const anchorBlocked = blockedReasonFor(anchorProperty, "Anchor Point");

      return {
        sourceRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        anchorPoint: readVec2(anchorProperty, { x: 0, y: 0 }),
        position: readVec2(positionProperty, { x: 0, y: 0 }),
        scale: readVec2(readProperty(raw, PROPERTY_SCALE), { x: 100, y: 100 }),
        rotation:
          rotationValue && rotationValue.length > 0 ? (rotationValue[0] as number) : 0,
        parentId: raw.parent ? raw.parent.id : undefined,
        threeD: raw.threeDLayer === true,
        isAV: true,
        blockedReason: positionBlocked || anchorBlocked,
      };
    },

    setPosition: function (value: Vec2Value): void {
      const property = readProperty(raw, PROPERTY_POSITION);
      if (property) property.setValue([value.x, value.y]);
    },

    setAnchorPoint: function (value: Vec2Value): void {
      const property = readProperty(raw, PROPERTY_ANCHOR);
      if (property) property.setValue([value.x, value.y]);
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

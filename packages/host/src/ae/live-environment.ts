import { nowMs } from "../runtime/es3.js";
import type {
  AeCompHandle,
  AeEnvironment,
  AeLayerHandle,
  BlendingModes,
  InterpolationTypes,
  Justifications,
  TrackMatteTypes,
  LayerFlag,
  ValueTypes,
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
  const value = property.value as number[] | null;
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
        // Rotate Z is a one-dimensional property, so its value is a number. An
        // earlier version indexed it like an array, which read every rotation
        // as 0 and made alignment wrong for any rotated layer.
        rotation: typeof rotationValue === "number" ? rotationValue : 0,
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
/**
 * Everything the environment needs from the ExtendScript global scope.
 *
 * Gathered into one object so the environment can be built against After
 * Effects in production and against a mock DOM in tests. The mock then
 * exercises this module's own wrapping code rather than a hand-written
 * stand-in for it, which is where the integration bugs would otherwise hide.
 */
export interface HostGlobals {
  readonly app: AeApplication;
  readonly os: string;
  readonly engineVersion: string;
  readonly isComp: (item: unknown) => boolean;
  readonly newKeyframeEase: (speed: number, influence: number) => AeKeyframeEase;
  readonly newFile: (path: string) => AeFile;
  readonly newImportOptions: (file: AeFile) => AeImportOptions;
  readonly interpolation: InterpolationTypes;
  readonly valueTypes: ValueTypes;
  readonly leafPropertyType: number;
  readonly purgeTargets: { readonly all: number; readonly image: number };
  readonly nowMs: () => number;
  readonly newShape: (vertices: number[][], inTangents: number[][], outTangents: number[][], closed: boolean) => unknown;
  readonly trackMatteTypes: TrackMatteTypes;
  readonly blendingModes: BlendingModes;
  readonly justifications: Justifications;
}

export function createEnvironment(g: HostGlobals): AeEnvironment {
  const host = g.app;

  function rawComp(): AeRawComp | undefined {
    const project = host.project;
    if (!project) return undefined;
    const active = project.activeItem;
    // `activeItem` is null with nothing open, and an ordinary footage item
    // when the user has selected one in the project panel.
    if (!active || !g.isComp(active)) return undefined;
    return active as AeRawComp;
  }

  return {
    version: function (): string {
      return host.version;
    },
    buildName: function (): string {
      return host.buildName;
    },
    language: function (): string {
      return host.isoLanguage;
    },
    os: function (): string {
      return g.os;
    },
    engineVersion: function (): string {
      return g.engineVersion;
    },
    hasProject: function (): boolean {
      return !!host.project;
    },
    activeComp: function (): AeCompHandle | undefined {
      const comp = rawComp();
      return comp ? wrapComp(comp) : undefined;
    },
    beginUndoGroup: function (name: string): void {
      host.beginUndoGroup(name);
    },
    endUndoGroup: function (): void {
      host.endUndoGroup();
    },
    nowMs: g.nowMs,

    rawComp: rawComp,
    rawProject: function (): AeRawProject | undefined {
      return host.project || undefined;
    },
    memoryInUse: function (): number {
      return host.memoryInUse;
    },
    purge: function (kind: "image" | "all"): void {
      host.purge(kind === "all" ? g.purgeTargets.all : g.purgeTargets.image);
    },
    runMenuCommand: function (menuText: string): boolean {
      const id = host.findMenuCommandId(menuText);
      // findMenuCommandId returns 0 for text it does not recognise — including
      // the same command in a localised build, which is why callers must treat
      // false as "not available here", not as an error in the project.
      if (!id) return false;
      host.executeCommand(id);
      return true;
    },
    newKeyframeEase: g.newKeyframeEase,
    interpolation: function (): InterpolationTypes {
      return g.interpolation;
    },
    valueTypes: function (): ValueTypes {
      return g.valueTypes;
    },
    leafPropertyType: function (): number {
      return g.leafPropertyType;
    },
    isComp: g.isComp,
    fonts: function (): AeFontsObject | undefined {
      return host.fonts || undefined;
    },
    fileExists: function (path: string): boolean {
      return g.newFile(path).exists;
    },
    importFile: function (path: string): AeRawItem {
      const project = host.project;
      if (!project) throw new Error("No project is open.");
      return project.importFile(g.newImportOptions(g.newFile(path)));
    },
    applyPreset: function (layer: AeRawLayer, path: string): void {
      if (typeof layer.applyPreset !== "function") {
        throw new Error("This layer type cannot take an animation preset.");
      }
      layer.applyPreset(g.newFile(path));
    },
    newShape: g.newShape,
    trackMatteTypes: function (): TrackMatteTypes {
      return g.trackMatteTypes;
    },
    blendingModes: function (): BlendingModes {
      return g.blendingModes;
    },
    justifications: function (): Justifications {
      return g.justifications;
    },
  };
}

/** The real environment, backed by After Effects' own globals. */
export function createLiveEnvironment(): AeEnvironment {
  return createEnvironment({
    app: app,
    os: $.os,
    engineVersion: $.version,
    isComp: function (item: unknown): boolean {
      return item instanceof CompItem;
    },
    newKeyframeEase: function (speed: number, influence: number): AeKeyframeEase {
      return new KeyframeEase(speed, influence);
    },
    newFile: function (path: string): AeFile {
      return new File(path);
    },
    newImportOptions: function (file: AeFile): AeImportOptions {
      return new ImportOptions(file);
    },
    interpolation: {
      linear: KeyframeInterpolationType.LINEAR,
      bezier: KeyframeInterpolationType.BEZIER,
      hold: KeyframeInterpolationType.HOLD,
    },
    valueTypes: {
      noValue: PropertyValueType.NO_VALUE,
      oneD: PropertyValueType.OneD,
      twoD: PropertyValueType.TwoD,
      twoDSpatial: PropertyValueType.TwoD_SPATIAL,
      threeD: PropertyValueType.ThreeD,
      threeDSpatial: PropertyValueType.ThreeD_SPATIAL,
      color: PropertyValueType.COLOR,
      textDocument: PropertyValueType.TEXT_DOCUMENT,
    },
    leafPropertyType: PropertyType.PROPERTY,
    purgeTargets: { all: PurgeTarget.ALL_CACHES, image: PurgeTarget.IMAGE_CACHES },
    nowMs: nowMs,
    newShape: function (vertices: number[][], inTangents: number[][], outTangents: number[][], closed: boolean): unknown {
      const shape = new Shape();
      shape.vertices = vertices;
      shape.inTangents = inTangents;
      shape.outTangents = outTangents;
      shape.closed = closed;
      return shape;
    },
    trackMatteTypes: {
      none: TrackMatteType.NO_TRACK_MATTE,
      alpha: TrackMatteType.ALPHA,
      alphaInverted: TrackMatteType.ALPHA_INVERTED,
      luma: TrackMatteType.LUMA,
      lumaInverted: TrackMatteType.LUMA_INVERTED,
    },
    blendingModes: {
      normal: BlendingMode.NORMAL,
      add: BlendingMode.ADD,
      screen: BlendingMode.SCREEN,
      multiply: BlendingMode.MULTIPLY,
      overlay: BlendingMode.OVERLAY,
      softLight: BlendingMode.SOFT_LIGHT,
    },
    justifications: {
      left: ParagraphJustification.LEFT_JUSTIFY,
      center: ParagraphJustification.CENTER_JUSTIFY,
      right: ParagraphJustification.RIGHT_JUSTIFY,
    },
  });
}

/**
 * Ambient declarations for the After Effects scripting DOM this package uses.
 *
 * Declared here rather than pulled from a community typings package so that
 * every After Effects API the product depends on is visible in one reviewable
 * file. Reaching for a new API means adding it here, which is the point: an API
 * that type-checks by accident is an API nobody verified exists.
 *
 * `AeRawProp` deliberately models both Property and PropertyGroup. After
 * Effects returns either from `property()`, and code walking a property tree by
 * match name has to handle both without knowing in advance which it has.
 */

interface AeKeyframeEase {
  speed: number;
  influence: number;
}

interface AeRawProp {
  /** Writable for effects and masks, which the user can rename. */
  name: string;
  readonly matchName: string;
  readonly propertyIndex: number;
  readonly propertyDepth: number;
  /** PropertyType.PROPERTY, INDEXED_GROUP or NAMED_GROUP. */
  readonly propertyType: number;
  readonly parentProperty: AeRawProp | null;
  readonly isEffect: boolean;
  readonly canSetEnabled: boolean;
  enabled: boolean;
  selected: boolean;

  // --- groups ---
  readonly numProperties: number;
  property(nameOrIndex: string | number): AeRawProp | null;
  canAddProperty(matchName: string): boolean;
  addProperty(matchName: string): AeRawProp;

  // --- leaf properties ---
  value: unknown;
  readonly propertyValueType: number;
  readonly isSpatial: boolean;
  readonly numKeys: number;
  readonly selectedKeys: number[];
  readonly dimensionsSeparated?: boolean;
  readonly canSetExpression: boolean;
  readonly canVaryOverTime: boolean;
  expression: string;
  expressionEnabled: boolean;
  readonly expressionError: string;
  setValue(value: unknown): void;
  setValueAtTime(time: number, value: unknown): void;
  valueAtTime(time: number, preExpression: boolean): unknown;
  addKey(time: number): number;
  removeKey(keyIndex: number): void;
  keyTime(keyIndex: number): number;
  keyValue(keyIndex: number): unknown;
  setValueAtKey(keyIndex: number, value: unknown): void;
  keyInTemporalEase(keyIndex: number): AeKeyframeEase[];
  keyOutTemporalEase(keyIndex: number): AeKeyframeEase[];
  setTemporalEaseAtKey(keyIndex: number, inEase: AeKeyframeEase[], outEase?: AeKeyframeEase[]): void;
  keyInInterpolationType(keyIndex: number): number;
  keyOutInterpolationType(keyIndex: number): number;
  setInterpolationTypeAtKey(keyIndex: number, inType: number, outType?: number): void;
  keyInSpatialTangent(keyIndex: number): number[];
  keyOutSpatialTangent(keyIndex: number): number[];
  setSpatialTangentsAtKey(keyIndex: number, inTangent: number[], outTangent?: number[]): void;
  keySelected(keyIndex: number): boolean;
  setSelectedAtKey(keyIndex: number, onOff: boolean): void;

  remove(): void;
  duplicate(): AeRawProp;
  moveTo(newIndex: number): void;
}

/** Kept for the original geometry ops; a structural subset of AeRawProp. */
type AeRawProperty = AeRawProp;
type AeRawPropertyGroup = AeRawProp;

interface AeRawSourceRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

interface AeRawTextDocument {
  text: string;
  fontSize: number;
  font: string;
  fillColor: number[];
  applyFill: boolean;
  justification: number;
  tracking: number;
}

interface AeRawItem {
  readonly id: number;
  name: string;
  readonly typeName: string;
  comment: string;
  label: number;
  parentFolder: AeRawItem | null;
}

interface AeRawLayer {
  readonly id: number;
  readonly index: number;
  name: string;
  enabled: boolean;
  locked: boolean;
  shy: boolean;
  label: number;
  comment: string;
  parent: AeRawLayer | null;
  inPoint: number;
  outPoint: number;
  startTime: number;
  stretch: number;
  readonly containingComp: AeRawComp;
  readonly selected: boolean;
  /** AVLayer only — absent on camera and light layers. */
  solo?: boolean;
  threeDLayer?: boolean;
  guideLayer?: boolean;
  adjustmentLayer?: boolean;
  collapseTransformation?: boolean;
  motionBlur?: boolean;
  /** AVLayer only: true for null objects. */
  readonly nullLayer?: boolean;
  readonly source?: AeRawItem | AeRawComp | null;
  replaceSource?(newSource: AeRawItem | AeRawComp, fixExpressions: boolean): void;
  sourceRectAtTime?(time: number, includeExtents: boolean): AeRawSourceRect;
  /** Layers answer the PropertyGroup interface for their top-level groups. */
  readonly numProperties: number;
  property(nameOrMatchName: string | number): AeRawProp | null;
  moveToBeginning(): void;
  moveToEnd(): void;
  moveBefore(layer: AeRawLayer): void;
  moveAfter(layer: AeRawLayer): void;
  duplicate(): AeRawLayer;
  remove(): void;
  setParentWithJump?(newParent: AeRawLayer | null): void;
  applyPreset?(file: AeFile): void;
}

interface AeRawLayerCollection {
  readonly length: number;
  addNull(duration?: number): AeRawLayer;
  addSolid(
    color: [number, number, number],
    name: string,
    width: number,
    height: number,
    pixelAspect: number,
    duration?: number,
  ): AeRawLayer;
  addText(sourceText?: string): AeRawLayer;
  addShape(): AeRawLayer;
  addCamera(name: string, centerPoint: [number, number]): AeRawLayer;
  add(item: AeRawItem | AeRawComp, duration?: number): AeRawLayer;
  precompose(layerIndices: number[], name: string, moveAllAttributes?: boolean): AeRawComp;
}

interface AeRawComp extends AeRawItem {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly frameDuration: number;
  readonly duration: number;
  readonly pixelAspect: number;
  readonly numLayers: number;
  time: number;
  workAreaStart: number;
  workAreaDuration: number;
  readonly selectedLayers: AeRawLayer[];
  readonly selectedProperties: AeRawProp[];
  readonly layers: AeRawLayerCollection;
  layer(index: number): AeRawLayer;
  duplicate(): AeRawComp;
  openInViewer(): unknown;
}

interface AeFont {
  readonly postScriptName: string;
  readonly familyName: string;
  readonly styleName: string;
  readonly fullName: string;
}

interface AeUsedFont {
  readonly font: AeFont;
  /** One entry per place the font is used; only its length is relied on. */
  readonly usedAt?: unknown[];
}

interface AeFontsObject {
  readonly allFonts: AeFont[][];
  getFontsByPostScriptName(name: string): AeFont[];
}

interface AeRawProject {
  readonly numItems: number;
  readonly activeItem: unknown;
  readonly file: AeFile | null;
  readonly usedFonts?: AeUsedFont[];
  item(index: number): AeRawItem;
  importFile(options: AeImportOptions): AeRawItem;
  replaceFont?(fromFont: AeFont, toFont: AeFont, noFontLocking?: boolean): boolean;
}

interface AeApplication {
  /** e.g. "26.0.1x45" */
  readonly version: string;
  /** e.g. "Adobe After Effects 26.0.1x45" */
  readonly buildName: string;
  /** ISO language of the running host, e.g. "en_US". */
  readonly isoLanguage: string;
  /** Bytes of memory After Effects has in use. */
  readonly memoryInUse: number;
  readonly project: AeRawProject | null;
  readonly fonts?: AeFontsObject;
  beginUndoGroup(name: string): void;
  endUndoGroup(): void;
  purge(target: number): void;
  findMenuCommandId(command: string): number;
  executeCommand(id: number): void;
}

interface AeDollar {
  /** Operating system description string. */
  readonly os: string;
  /** ExtendScript engine version. */
  readonly version: string;
  readonly global: Record<string, unknown>;
}

interface AeFile {
  readonly exists: boolean;
  readonly fsName: string;
  readonly name: string;
}

interface AeImportOptions {
  file: AeFile;
  importAs: number;
}

declare const app: AeApplication;
declare const $: AeDollar;

/** Used only for the `instanceof` narrowing of `activeItem`. */
declare const CompItem: { new (): AeRawComp };
declare const File: { new (path: string): AeFile };
declare const ImportOptions: { new (file?: AeFile): AeImportOptions };
declare const KeyframeEase: { new (speed: number, influence: number): AeKeyframeEase };

/** Enumerations, declared as the numbers After Effects actually exposes. */
declare const PurgeTarget: { readonly ALL_CACHES: number };
declare const KeyframeInterpolationType: {
  readonly LINEAR: number;
  readonly BEZIER: number;
  readonly HOLD: number;
};
declare const PropertyValueType: {
  readonly NO_VALUE: number;
  readonly ThreeD_SPATIAL: number;
  readonly ThreeD: number;
  readonly TwoD_SPATIAL: number;
  readonly TwoD: number;
  readonly OneD: number;
  readonly COLOR: number;
  readonly CUSTOM_VALUE: number;
  readonly MARKER: number;
  readonly LAYER_INDEX: number;
  readonly MASK_INDEX: number;
  readonly SHAPE: number;
  readonly TEXT_DOCUMENT: number;
};
declare const PropertyType: {
  readonly PROPERTY: number;
  readonly INDEXED_GROUP: number;
  readonly NAMED_GROUP: number;
};

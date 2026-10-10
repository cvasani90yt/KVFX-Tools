/**
 * A mock of the After Effects scripting DOM.
 *
 * Operations that walk property trees — effects, expressions, text animators,
 * keyframes — are tested against this rather than a hand-written facade, so the
 * production environment's own wrapping code runs in the tests too.
 *
 * Fidelity is deliberately bounded. It models the structure and the rules the
 * operations depend on: match-name lookup, 1-based indices that renumber on
 * removal, addProperty only for children a group actually accepts, keyframes
 * with eases and interpolation, expressions, selection, and layer stacking. It
 * does not evaluate expressions or render anything. The tier-3 fixture
 * projects are what prove behaviour against the real application.
 */

export const PT = { PROPERTY: 6212, INDEXED_GROUP: 6213, NAMED_GROUP: 6214 } as const;

export const PVT = {
  NO_VALUE: 6412,
  ThreeD_SPATIAL: 6413,
  ThreeD: 6414,
  TwoD_SPATIAL: 6415,
  TwoD: 6416,
  OneD: 6417,
  COLOR: 6418,
  CUSTOM_VALUE: 6419,
  MARKER: 6420,
  LAYER_INDEX: 6421,
  MASK_INDEX: 6422,
  SHAPE: 6423,
  TEXT_DOCUMENT: 6424,
} as const;

export const INTERP = { linear: 6612, bezier: 6613, hold: 6614 } as const;
export const TRACK_MATTE = { none: 5012, alpha: 5013, alphaInverted: 5014, luma: 5015, lumaInverted: 5016 } as const;
export const BLEND = { normal: 5212, add: 5220, screen: 5219, multiply: 5216, overlay: 5225, softLight: 5226 } as const;
export const JUSTIFY = { left: 7413, center: 7415, right: 7414 } as const;
export const PURGE_ALL = 1;
export const PURGE_IMAGE = 4;

// ---------------------------------------------------------------------------
// Property definitions
// ---------------------------------------------------------------------------

interface LeafDef {
  readonly kind: "leaf";
  readonly matchName: string;
  readonly name: string;
  readonly valueType: number;
  readonly value: unknown;
  readonly spatial?: boolean;
}

interface GroupDef {
  readonly kind: "group";
  readonly matchName: string;
  readonly name: string;
  readonly indexed?: boolean;
  readonly isEffect?: boolean;
  readonly children?: readonly Def[];
  /** Match names this group's addProperty accepts. */
  readonly accepts?: (matchName: string) => Def | undefined;
}

type Def = LeafDef | GroupDef;

const leaf = (matchName: string, name: string, valueType: number, value: unknown, spatial = false): LeafDef => ({
  kind: "leaf",
  matchName,
  name,
  valueType,
  value,
  spatial,
});

/** Effect parameter layouts, in the order After Effects shows them. */
const EFFECT_PARAMS: Readonly<Record<string, readonly LeafDef[]>> = {
  "ADBE Fill": [
    leaf("ADBE Fill-0010", "Fill Mask", PVT.OneD, 0),
    leaf("ADBE Fill-0007", "All Masks", PVT.OneD, 0),
    leaf("ADBE Fill-0002", "Color", PVT.COLOR, [1, 0, 0, 1]),
    leaf("ADBE Fill-0006", "Invert", PVT.OneD, 0),
    leaf("ADBE Fill-0003", "Horizontal Feather", PVT.OneD, 0),
    leaf("ADBE Fill-0004", "Vertical Feather", PVT.OneD, 0),
    leaf("ADBE Fill-0005", "Opacity", PVT.OneD, 1),
  ],
  "ADBE Ramp": [
    leaf("ADBE Ramp-0001", "Start of Ramp", PVT.TwoD_SPATIAL, [0, 0], true),
    leaf("ADBE Ramp-0002", "Start Color", PVT.COLOR, [0, 0, 0, 1]),
    leaf("ADBE Ramp-0003", "End of Ramp", PVT.TwoD_SPATIAL, [0, 100], true),
    leaf("ADBE Ramp-0004", "End Color", PVT.COLOR, [1, 1, 1, 1]),
    leaf("ADBE Ramp-0005", "Ramp Shape", PVT.OneD, 1),
    leaf("ADBE Ramp-0006", "Ramp Scatter", PVT.OneD, 0),
    leaf("ADBE Ramp-0007", "Blend With Original", PVT.OneD, 0),
  ],
  "ADBE Slider Control": [leaf("ADBE Slider Control-0001", "Slider", PVT.OneD, 0)],
  "ADBE Checkbox Control": [leaf("ADBE Checkbox Control-0001", "Checkbox", PVT.OneD, 0)],
  "ADBE Angle Control": [leaf("ADBE Angle Control-0001", "Angle", PVT.OneD, 0)],
  "ADBE Point Control": [leaf("ADBE Point Control-0001", "Point", PVT.TwoD_SPATIAL, [0, 0], true)],
  "ADBE Color Control": [leaf("ADBE Color Control-0001", "Color", PVT.COLOR, [1, 1, 1, 1])],
  "ADBE Layer Control": [leaf("ADBE Layer Control-0001", "Layer", PVT.LAYER_INDEX, 0)],
  "ADBE Gaussian Blur 2": [
    leaf("ADBE Gaussian Blur 2-0001", "Blurriness", PVT.OneD, 0),
    leaf("ADBE Gaussian Blur 2-0002", "Blur Dimensions", PVT.OneD, 1),
    leaf("ADBE Gaussian Blur 2-0003", "Repeat Edge Pixels", PVT.OneD, 0),
  ],
  "ADBE Drop Shadow": [
    leaf("ADBE Drop Shadow-0001", "Shadow Color", PVT.COLOR, [0, 0, 0, 1]),
    leaf("ADBE Drop Shadow-0002", "Opacity", PVT.OneD, 127.5),
    leaf("ADBE Drop Shadow-0003", "Direction", PVT.OneD, 135),
    leaf("ADBE Drop Shadow-0004", "Distance", PVT.OneD, 5),
    leaf("ADBE Drop Shadow-0005", "Softness", PVT.OneD, 0),
    leaf("ADBE Drop Shadow-0006", "Shadow Only", PVT.OneD, 0),
  ],
  "ADBE 4ColorGradient": [
    leaf("ADBE 4ColorGradient-0001", "Point 1", PVT.TwoD_SPATIAL, [0, 0], true),
    leaf("ADBE 4ColorGradient-0002", "Color 1", PVT.COLOR, [1, 1, 0, 1]),
    leaf("ADBE 4ColorGradient-0003", "Point 2", PVT.TwoD_SPATIAL, [100, 0], true),
    leaf("ADBE 4ColorGradient-0004", "Color 2", PVT.COLOR, [0, 1, 0, 1]),
    leaf("ADBE 4ColorGradient-0005", "Point 3", PVT.TwoD_SPATIAL, [0, 100], true),
    leaf("ADBE 4ColorGradient-0006", "Color 3", PVT.COLOR, [1, 0, 1, 1]),
    leaf("ADBE 4ColorGradient-0007", "Point 4", PVT.TwoD_SPATIAL, [100, 100], true),
    leaf("ADBE 4ColorGradient-0008", "Color 4", PVT.COLOR, [0, 0, 1, 1]),
    leaf("ADBE 4ColorGradient-0009", "Blend", PVT.OneD, 100),
    leaf("ADBE 4ColorGradient-0010", "Jitter", PVT.OneD, 0),
    leaf("ADBE 4ColorGradient-0011", "Opacity", PVT.OneD, 100),
  ],
  "ADBE Geometry2": [
    leaf("ADBE Geometry2-0001", "Anchor Point", PVT.TwoD_SPATIAL, [50, 25], true),
    leaf("ADBE Geometry2-0002", "Position", PVT.TwoD_SPATIAL, [50, 25], true),
    leaf("ADBE Geometry2-0011", "Uniform Scale", PVT.OneD, 1),
    leaf("ADBE Geometry2-0003", "Scale", PVT.OneD, 100),
    leaf("ADBE Geometry2-0004", "Scale Width", PVT.OneD, 100),
    leaf("ADBE Geometry2-0005", "Skew", PVT.OneD, 0),
    leaf("ADBE Geometry2-0006", "Skew Axis", PVT.OneD, 0),
    leaf("ADBE Geometry2-0007", "Rotation", PVT.OneD, 0),
    leaf("ADBE Geometry2-0008", "Opacity", PVT.OneD, 100),
  ],
  "ADBE Noise": [
    leaf("ADBE Noise-0001", "Amount of Noise", PVT.OneD, 0),
    leaf("ADBE Noise-0002", "Noise Type", PVT.OneD, 1),
    leaf("ADBE Noise-0003", "Clipping", PVT.OneD, 1),
  ],
  "ADBE Fast Box Blur": [
    leaf("ADBE Fast Box Blur-0001", "Blur Radius", PVT.OneD, 0),
    leaf("ADBE Fast Box Blur-0002", "Iterations", PVT.OneD, 1),
  ],
  "ADBE Linear Wipe": [
    leaf("ADBE Linear Wipe-0001", "Transition Completion", PVT.OneD, 0),
    leaf("ADBE Linear Wipe-0002", "Wipe Angle", PVT.OneD, 90),
    leaf("ADBE Linear Wipe-0003", "Feather", PVT.OneD, 0),
  ],
  "ADBE Tint": [leaf("ADBE Tint-0001", "Map Black To", PVT.COLOR, [0, 0, 0, 1])],
  "ADBE Glo2": [leaf("ADBE Glo2-0001", "Glow Based On", PVT.OneD, 1)],
  "ADBE Bevel Alpha": [leaf("ADBE Bevel Alpha-0001", "Edge Thickness", PVT.OneD, 2)],
};

/** Shape layer contents: what each vector item holds, in After Effects' order. */
const SHAPE_ITEMS: Readonly<Record<string, readonly Def[]>> = {
  "ADBE Vector Shape - Rect": [
    leaf("ADBE Vector Shape Direction", "Shape Direction", PVT.OneD, 1),
    leaf("ADBE Vector Rect Size", "Size", PVT.TwoD, [100, 100]),
    leaf("ADBE Vector Rect Position", "Position", PVT.TwoD_SPATIAL, [0, 0], true),
    leaf("ADBE Vector Rect Roundness", "Roundness", PVT.OneD, 0),
  ],
  "ADBE Vector Shape - Ellipse": [
    leaf("ADBE Vector Shape Direction", "Shape Direction", PVT.OneD, 1),
    leaf("ADBE Vector Ellipse Size", "Size", PVT.TwoD, [100, 100]),
    leaf("ADBE Vector Ellipse Position", "Position", PVT.TwoD_SPATIAL, [0, 0], true),
  ],
  "ADBE Vector Shape - Group": [
    leaf("ADBE Vector Shape Direction", "Shape Direction", PVT.OneD, 1),
    leaf("ADBE Vector Shape", "Path", PVT.SHAPE, null),
  ],
  "ADBE Vector Graphic - Fill": [
    leaf("ADBE Vector Fill Color", "Color", PVT.COLOR, [1, 0, 0, 1]),
    leaf("ADBE Vector Fill Opacity", "Opacity", PVT.OneD, 100),
  ],
  "ADBE Vector Graphic - Stroke": [
    leaf("ADBE Vector Stroke Color", "Color", PVT.COLOR, [1, 1, 1, 1]),
    leaf("ADBE Vector Stroke Opacity", "Opacity", PVT.OneD, 100),
    leaf("ADBE Vector Stroke Width", "Stroke Width", PVT.OneD, 2),
  ],
  "ADBE Vector Filter - Trim": [
    leaf("ADBE Vector Trim Start", "Start", PVT.OneD, 0),
    leaf("ADBE Vector Trim End", "End", PVT.OneD, 100),
    leaf("ADBE Vector Trim Offset", "Offset", PVT.OneD, 0),
  ],
  "ADBE Vector Filter - Repeater": [
    leaf("ADBE Vector Repeater Copies", "Copies", PVT.OneD, 3),
    leaf("ADBE Vector Repeater Offset", "Offset", PVT.OneD, 0),
    {
      kind: "group",
      matchName: "ADBE Vector Repeater Transform",
      name: "Transform",
      children: [
        leaf("ADBE Vector Repeater Anchor", "Anchor Point", PVT.TwoD_SPATIAL, [0, 0], true),
        leaf("ADBE Vector Repeater Position", "Position", PVT.TwoD_SPATIAL, [100, 0], true),
        leaf("ADBE Vector Repeater Scale", "Scale", PVT.TwoD, [100, 100]),
        leaf("ADBE Vector Repeater Rotation", "Rotation", PVT.OneD, 0),
        leaf("ADBE Vector Repeater Opacity 1", "Start Opacity", PVT.OneD, 100),
        leaf("ADBE Vector Repeater Opacity 2", "End Opacity", PVT.OneD, 100),
      ],
    },
  ],
};

function shapeGroupDef(): GroupDef {
  return {
    kind: "group",
    matchName: "ADBE Vector Group",
    name: "Group 1",
    children: [
      {
        kind: "group",
        matchName: "ADBE Vectors Group",
        name: "Contents",
        indexed: true,
        accepts: (m) => {
          if (m === "ADBE Vector Group") return shapeGroupDef();
          const children = SHAPE_ITEMS[m];
          return children === undefined ? undefined : { kind: "group", matchName: m, name: m.replace(/^ADBE Vector (Shape|Graphic|Filter) - /, ""), children };
        },
      },
      {
        kind: "group",
        matchName: "ADBE Vector Transform Group",
        name: "Transform",
        children: [
          leaf("ADBE Vector Anchor", "Anchor Point", PVT.TwoD_SPATIAL, [0, 0], true),
          leaf("ADBE Vector Position", "Position", PVT.TwoD_SPATIAL, [0, 0], true),
          leaf("ADBE Vector Scale", "Scale", PVT.TwoD, [100, 100]),
          leaf("ADBE Vector Rotation", "Rotation", PVT.OneD, 0),
          leaf("ADBE Vector Group Opacity", "Opacity", PVT.OneD, 100),
        ],
      },
    ],
  };
}

function effectDef(matchName: string): GroupDef | undefined {
  const params = EFFECT_PARAMS[matchName];
  if (params === undefined) return undefined;
  const display = matchName.replace(/^ADBE /, "").replace(/ 2$/, "");
  return { kind: "group", matchName, name: display, isEffect: true, children: params };
}

function transformDef(): GroupDef {
  return {
    kind: "group",
    matchName: "ADBE Transform Group",
    name: "Transform",
    children: [
      leaf("ADBE Anchor Point", "Anchor Point", PVT.ThreeD_SPATIAL, [0, 0, 0], true),
      leaf("ADBE Position", "Position", PVT.ThreeD_SPATIAL, [0, 0, 0], true),
      // Always present; After Effects only shows them once dimensions are separated.
      leaf("ADBE Position_0", "X Position", PVT.OneD, 0),
      leaf("ADBE Position_1", "Y Position", PVT.OneD, 0),
      leaf("ADBE Position_2", "Z Position", PVT.OneD, 0),
      leaf("ADBE Scale", "Scale", PVT.ThreeD, [100, 100, 100]),
      leaf("ADBE Orientation", "Orientation", PVT.ThreeD_SPATIAL, [0, 0, 0], true),
      leaf("ADBE Rotate X", "X Rotation", PVT.OneD, 0),
      leaf("ADBE Rotate Y", "Y Rotation", PVT.OneD, 0),
      leaf("ADBE Rotate Z", "Rotation", PVT.OneD, 0),
      leaf("ADBE Opacity", "Opacity", PVT.OneD, 100),
    ],
  };
}

const TEXT_ANIMATOR_PROPS: Readonly<Record<string, LeafDef>> = {
  "ADBE Text Anchor Point 3D": leaf("ADBE Text Anchor Point 3D", "Anchor Point", PVT.ThreeD, [0, 0, 0]),
  "ADBE Text Position 3D": leaf("ADBE Text Position 3D", "Position", PVT.ThreeD, [0, 0, 0]),
  "ADBE Text Scale 3D": leaf("ADBE Text Scale 3D", "Scale", PVT.ThreeD, [100, 100, 100]),
  "ADBE Text Skew": leaf("ADBE Text Skew", "Skew", PVT.OneD, 0),
  "ADBE Text Rotation": leaf("ADBE Text Rotation", "Rotation", PVT.OneD, 0),
  "ADBE Text Opacity": leaf("ADBE Text Opacity", "Opacity", PVT.OneD, 100),
  "ADBE Text Fill Color": leaf("ADBE Text Fill Color", "Fill Color", PVT.COLOR, [1, 0, 0, 1]),
  "ADBE Text Tracking Amount": leaf("ADBE Text Tracking Amount", "Tracking Amount", PVT.OneD, 0),
  "ADBE Text Blur": leaf("ADBE Text Blur", "Blur", PVT.TwoD, [0, 0]),
  "ADBE Text Character Offset": leaf("ADBE Text Character Offset", "Character Offset", PVT.OneD, 0),
  "ADBE Text Line Spacing": leaf("ADBE Text Line Spacing", "Line Spacing", PVT.TwoD, [0, 0]),
};

function selectorDef(): GroupDef {
  return {
    kind: "group",
    matchName: "ADBE Text Selector",
    name: "Range Selector",
    children: [
      leaf("ADBE Text Percent Start", "Start", PVT.OneD, 0),
      leaf("ADBE Text Percent End", "End", PVT.OneD, 100),
      leaf("ADBE Text Percent Offset", "Offset", PVT.OneD, 0),
      leaf("ADBE Text Index Start", "Start", PVT.OneD, 0),
      leaf("ADBE Text Index End", "End", PVT.OneD, 1),
      leaf("ADBE Text Index Offset", "Offset", PVT.OneD, 0),
      {
        kind: "group",
        matchName: "ADBE Text Range Advanced",
        name: "Advanced",
        children: [
          leaf("ADBE Text Range Units", "Units", PVT.OneD, 1),
          leaf("ADBE Text Range Type2", "Based On", PVT.OneD, 1),
          leaf("ADBE Text Selector Mode", "Mode", PVT.OneD, 1),
          leaf("ADBE Text Selector Max Amount", "Amount", PVT.OneD, 100),
          leaf("ADBE Text Range Shape", "Shape", PVT.OneD, 1),
          leaf("ADBE Text Selector Smoothness", "Smoothness", PVT.OneD, 100),
          leaf("ADBE Text Levels Max Ease", "Ease High", PVT.OneD, 0),
          leaf("ADBE Text Levels Min Ease", "Ease Low", PVT.OneD, 0),
          leaf("ADBE Text Randomize Order", "Randomize Order", PVT.OneD, 0),
          leaf("ADBE Text Random Seed", "Random Seed", PVT.OneD, 0),
        ],
      },
    ],
  };
}

function expressionSelectorDef(): GroupDef {
  return {
    kind: "group",
    matchName: "ADBE Text Expressible Selector",
    name: "Expression Selector",
    children: [
      leaf("ADBE Text Selector Mode", "Mode", PVT.OneD, 2),
      leaf("ADBE Text Range Type2", "Based On", PVT.OneD, 1),
      leaf("ADBE Text Expressible Amount", "Amount", PVT.ThreeD, [100, 100, 100]),
    ],
  };
}

function animatorDef(): GroupDef {
  return {
    kind: "group",
    matchName: "ADBE Text Animator",
    name: "Animator",
    children: [
      {
        kind: "group",
        matchName: "ADBE Text Selectors",
        name: "Selectors",
        indexed: true,
        accepts: (m) =>
          m === "ADBE Text Selector" ? selectorDef() : m === "ADBE Text Expressible Selector" ? expressionSelectorDef() : undefined,
      },
      {
        kind: "group",
        matchName: "ADBE Text Animator Properties",
        name: "Properties",
        accepts: (m) => TEXT_ANIMATOR_PROPS[m],
      },
    ],
  };
}

function textDef(text: string): GroupDef {
  return {
    kind: "group",
    matchName: "ADBE Text Properties",
    name: "Text",
    children: [
      leaf("ADBE Text Document", "Source Text", PVT.TEXT_DOCUMENT, { text, fontSize: 72, font: "ArialMT" }),
      {
        kind: "group",
        matchName: "ADBE Text Animators",
        name: "Animators",
        indexed: true,
        accepts: (m) => (m === "ADBE Text Animator" ? animatorDef() : undefined),
      },
    ],
  };
}

/** Deep copy of plain values — arrays and records — as After Effects hands out copies. */
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => clone(v)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = clone(v);
    return out as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

interface MockKey {
  time: number;
  value: unknown;
  inEase: AeKeyframeEase[];
  outEase: AeKeyframeEase[];
  inType: number;
  outType: number;
  selected: boolean;
  inTangent?: number[];
  outTangent?: number[];
}

/**
 * Length of a temporal-ease array, as After Effects defines it: one entry per
 * dimension for non-spatial TwoD and ThreeD properties, one entry otherwise —
 * spatial properties, colours and scalars alike.
 */
function easeDims(valueType: number): number {
  if (valueType === PVT.TwoD) return 2;
  if (valueType === PVT.ThreeD) return 3;
  return 1;
}

function defaultEase(valueType: number): AeKeyframeEase[] {
  return Array.from({ length: easeDims(valueType) }, () => ({ speed: 0, influence: 16.666666667 }));
}

export class MockProp {
  readonly matchName: string;
  name: string;
  readonly isGroup: boolean;
  readonly indexed: boolean;
  readonly isEffect: boolean;
  readonly propertyValueType: number;
  readonly isSpatial: boolean;
  readonly canSetEnabled: boolean;
  enabled = true;
  selected = false;
  parentProperty: MockProp | null = null;
  layer: MockLayer | null = null;
  children: MockProp[] = [];
  private readonly accepts: ((matchName: string) => Def | undefined) | undefined;

  private storedValue: unknown;
  keys: MockKey[] = [];
  expression = "";
  expressionEnabled = false;
  dimensionsSeparated = false;
  removed = false;

  constructor(def: Def, parent: MockProp | null, layer: MockLayer | null) {
    this.matchName = def.matchName;
    this.name = def.name;
    this.parentProperty = parent;
    this.layer = layer;
    if (def.kind === "group") {
      this.isGroup = true;
      this.indexed = def.indexed === true;
      this.isEffect = def.isEffect === true;
      this.propertyValueType = PVT.NO_VALUE;
      this.isSpatial = false;
      this.canSetEnabled = def.isEffect === true;
      this.accepts = def.accepts;
      for (const child of def.children ?? []) this.children.push(new MockProp(child, this, layer));
    } else {
      this.isGroup = false;
      this.indexed = false;
      this.isEffect = false;
      this.propertyValueType = def.valueType;
      this.isSpatial = def.spatial === true;
      this.canSetEnabled = false;
      this.accepts = undefined;
      this.storedValue = clone(def.value);
    }
  }

  get propertyType(): number {
    if (!this.isGroup) return PT.PROPERTY;
    return this.indexed ? PT.INDEXED_GROUP : PT.NAMED_GROUP;
  }

  get propertyIndex(): number {
    return this.parentProperty === null ? 1 : this.parentProperty.children.indexOf(this) + 1;
  }

  get propertyDepth(): number {
    return this.parentProperty === null ? 1 : this.parentProperty.propertyDepth + 1;
  }

  get numProperties(): number {
    return this.children.length;
  }

  property(nameOrIndex: string | number): MockProp | null {
    if (typeof nameOrIndex === "number") return this.children[nameOrIndex - 1] ?? null;
    return this.children.find((c) => c.matchName === nameOrIndex || c.name === nameOrIndex) ?? null;
  }

  canAddProperty(matchName: string): boolean {
    return this.accepts?.(matchName) !== undefined;
  }

  addProperty(matchName: string): MockProp {
    const def = this.accepts?.(matchName);
    if (def === undefined) throw new Error(`Cannot add "${matchName}" to "${this.matchName}"`);
    // A named group holds at most one of each property, as in After Effects.
    if (!this.indexed) {
      const existing = this.property(matchName);
      if (existing !== null) return existing;
    }
    const child = new MockProp(def, this, this.layer);
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parentProperty === null) throw new Error("Cannot remove a root group");
    const siblings = this.parentProperty.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.removed = true;
  }

  duplicate(): MockProp {
    if (this.parentProperty === null) throw new Error("Cannot duplicate a root group");
    const copy = this.cloneInto(this.parentProperty, this.layer);
    this.parentProperty.children.splice(this.propertyIndex, 0, copy);
    return copy;
  }

  moveTo(newIndex: number): void {
    if (this.parentProperty === null) return;
    const siblings = this.parentProperty.children;
    siblings.splice(siblings.indexOf(this), 1);
    siblings.splice(newIndex - 1, 0, this);
  }

  cloneInto(parent: MockProp | null, layer: MockLayer | null): MockProp {
    const copy = Object.create(MockProp.prototype) as MockProp;
    Object.assign(copy, this, {
      parentProperty: parent,
      layer,
      selected: false,
      storedValue: clone(this.storedValue),
      keys: this.keys.map((k) => ({ ...k, value: clone(k.value), selected: false })),
      children: [] as MockProp[],
    });
    copy.children = this.children.map((c) => c.cloneInto(copy, layer));
    return copy;
  }

  // --- values ---

  get canSetExpression(): boolean {
    return !this.isGroup && this.propertyValueType !== PVT.NO_VALUE;
  }

  get canVaryOverTime(): boolean {
    return !this.isGroup;
  }

  get value(): unknown {
    return clone(this.storedValue);
  }

  set value(_v: unknown) {
    throw new Error("value is read-only; use setValue()");
  }

  get expressionError(): string {
    return "";
  }

  setValue(value: unknown): void {
    if (this.isGroup) throw new Error(`"${this.matchName}" is a group`);
    if (this.keys.length > 0) {
      // After Effects refuses setValue on an animated property.
      throw new Error(`Can't set value of "${this.name}": property has keyframes`);
    }
    this.storedValue = clone(value);
  }

  setValueAtTime(time: number, value: unknown): void {
    const index = this.addKey(time);
    this.keys[index - 1]!.value = clone(value);
  }

  valueAtTime(time: number): unknown {
    if (this.keys.length === 0) return this.value;
    let chosen = this.keys[0]!;
    for (const key of this.keys) if (key.time <= time) chosen = key;
    return clone(chosen.value);
  }

  // --- keyframes ---

  get numKeys(): number {
    return this.keys.length;
  }

  get selectedKeys(): number[] {
    return this.keys.flatMap((k, i) => (k.selected ? [i + 1] : []));
  }

  addKey(time: number): number {
    const existing = this.keys.findIndex((k) => Math.abs(k.time - time) < 1e-9);
    if (existing !== -1) return existing + 1;
    const value = this.valueAtTime(time);
    const key: MockKey = {
      time,
      value,
      inEase: defaultEase(this.propertyValueType),
      outEase: defaultEase(this.propertyValueType),
      inType: INTERP.linear,
      outType: INTERP.linear,
      selected: false,
    };
    this.keys.push(key);
    this.keys.sort((a, b) => a.time - b.time);
    return this.keys.indexOf(key) + 1;
  }

  private key(index: number): MockKey {
    const key = this.keys[index - 1];
    if (key === undefined) throw new Error(`Keyframe ${String(index)} out of range on "${this.name}"`);
    return key;
  }

  removeKey(index: number): void {
    this.key(index);
    this.keys.splice(index - 1, 1);
  }

  keyTime(index: number): number {
    return this.key(index).time;
  }

  keyValue(index: number): unknown {
    return clone(this.key(index).value);
  }

  setValueAtKey(index: number, value: unknown): void {
    this.key(index).value = clone(value);
  }

  keyInTemporalEase(index: number): AeKeyframeEase[] {
    return this.key(index).inEase.map((e) => ({ ...e }));
  }

  keyOutTemporalEase(index: number): AeKeyframeEase[] {
    return this.key(index).outEase.map((e) => ({ ...e }));
  }

  setTemporalEaseAtKey(index: number, inEase: AeKeyframeEase[], outEase?: AeKeyframeEase[]): void {
    const key = this.key(index);
    const expected = easeDims(this.propertyValueType);
    if (inEase.length !== expected || (outEase !== undefined && outEase.length !== expected)) {
      // The real error After Effects raises for a wrong-length ease array.
      throw new Error(`Ease array must have ${String(expected)} element(s) for "${this.name}"`);
    }
    for (const ease of [...inEase, ...(outEase ?? [])]) {
      if (ease.influence < 0.1 || ease.influence > 100) {
        throw new Error(`Influence ${String(ease.influence)} out of range 0.1–100`);
      }
    }
    key.inEase = inEase.map((e) => ({ speed: e.speed, influence: e.influence }));
    key.outEase = (outEase ?? inEase).map((e) => ({ speed: e.speed, influence: e.influence }));
  }

  keyInInterpolationType(index: number): number {
    return this.key(index).inType;
  }

  keyOutInterpolationType(index: number): number {
    return this.key(index).outType;
  }

  setInterpolationTypeAtKey(index: number, inType: number, outType?: number): void {
    const key = this.key(index);
    key.inType = inType;
    key.outType = outType ?? inType;
  }

  keyInSpatialTangent(index: number): number[] {
    return [...(this.key(index).inTangent ?? [0, 0, 0])];
  }

  keyOutSpatialTangent(index: number): number[] {
    return [...(this.key(index).outTangent ?? [0, 0, 0])];
  }

  setSpatialTangentsAtKey(index: number, inTangent: number[], outTangent?: number[]): void {
    const key = this.key(index);
    key.inTangent = [...inTangent];
    key.outTangent = [...(outTangent ?? inTangent)];
  }

  keySelected(index: number): boolean {
    return this.key(index).selected;
  }

  setSelectedAtKey(index: number, onOff: boolean): void {
    this.key(index).selected = onOff;
  }

  /** Test helper: select keyframes by 1-based index. */
  selectKeys(...indices: number[]): void {
    for (const [i, key] of this.keys.entries()) key.selected = indices.includes(i + 1);
  }
}

// ---------------------------------------------------------------------------
// Items, layers, comps
// ---------------------------------------------------------------------------

let nextId = 1000;

/** Moves the id counter, so ids from one run can never pass for another's. */
export function setNextMockId(value: number): void {
  nextId = value;
}

export class MockItem {
  readonly id = nextId++;
  name: string;
  comment = "";
  label = 0;
  parentFolder: MockItem | null = null;
  /** Selected in the Project panel. */
  selected = false;
  readonly typeName: string;
  /** Footage only. */
  footageMissing = false;
  file: AeFile | null = null;
  constructor(name: string, typeName: string) {
    this.name = name;
    this.typeName = typeName;
  }

  /** FootageItem.replace: points the item at another file. */
  replace(file: AeFile): void {
    this.file = file;
    this.footageMissing = false;
  }
}

export interface MockLayerOptions {
  readonly name: string;
  readonly kind?: "av" | "camera" | "light" | "text" | "shape" | "null" | "precomp";
  readonly text?: string;
  readonly source?: MockComp | MockItem | null;
}

type Box = [number, number, number, number];

function unionBox(a: Box | undefined, b: Box | undefined): Box | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** The untransformed bounds of shape contents: rectangles, ellipses and paths, through group transforms. */
function shapeBounds(contents: MockProp | null | undefined): Box | undefined {
  if (contents === null || contents === undefined) return undefined;
  let box: Box | undefined;
  for (const item of contents.children) {
    const value = (match: string): number[] => (item.property(match)?.value as number[] | undefined) ?? [0, 0];
    if (item.matchName === "ADBE Vector Shape - Rect" || item.matchName === "ADBE Vector Shape - Ellipse") {
      const kind = item.matchName === "ADBE Vector Shape - Rect" ? "Rect" : "Ellipse";
      const [w = 0, h = 0] = value(`ADBE Vector ${kind} Size`);
      const [x = 0, y = 0] = value(`ADBE Vector ${kind} Position`);
      box = unionBox(box, [x - w / 2, y - h / 2, x + w / 2, y + h / 2]);
    } else if (item.matchName === "ADBE Vector Shape - Group") {
      const path = item.property("ADBE Vector Shape")?.value as { vertices?: number[][] } | undefined;
      for (const [x = 0, y = 0] of path?.vertices ?? []) box = unionBox(box, [x, y, x, y]);
    } else if (item.matchName === "ADBE Vector Group") {
      const inner = shapeBounds(item.property("ADBE Vectors Group"));
      const transform = item.property("ADBE Vector Transform Group");
      if (inner === undefined || transform === null) continue;
      const read = (match: string, fallback: number[]): number[] => (transform.property(match)?.value as number[] | undefined) ?? fallback;
      const [ax = 0, ay = 0] = read("ADBE Vector Anchor", [0, 0]);
      const [px = 0, py = 0] = read("ADBE Vector Position", [0, 0]);
      const [sx = 100, sy = 100] = read("ADBE Vector Scale", [100, 100]);
      const map = (x: number, y: number): [number, number] => [px + ((x - ax) * sx) / 100, py + ((y - ay) * sy) / 100];
      const [l, t] = map(inner[0], inner[1]);
      const [r, b] = map(inner[2], inner[3]);
      box = unionBox(box, [Math.min(l, r), Math.min(t, b), Math.max(l, r), Math.max(t, b)]);
    }
  }
  return box;
}

export class MockLayer {
  readonly id = nextId++;
  name: string;
  enabled = true;
  locked = false;
  shy = false;
  label = 1;
  comment = "";
  parent: MockLayer | null = null;
  inPoint = 0;
  outPoint: number;
  private shiftOrigin = 0;
  stretch = 100;
  selected = false;
  containingComp: MockComp;
  readonly kind: NonNullable<MockLayerOptions["kind"]>;
  source: MockComp | MockItem | null;
  root: MockProp;
  /** Present only on AV layers, as in After Effects. */
  solo?: boolean;
  threeDLayer?: boolean;
  guideLayer?: boolean;
  adjustmentLayer?: boolean;
  collapseTransformation?: boolean;
  motionBlur?: boolean;
  sourceRect = { left: 0, top: 0, width: 100, height: 50 };
  appliedPresets: string[] = [];
  /** AVLayer.nullLayer — true only for nulls. */
  nullLayer?: boolean;
  trackMatteType = TRACK_MATTE.none;
  /** The matte set with setTrackMatte (AE 23+), when one was. */
  trackMatteLayer: MockLayer | null = null;
  blendingMode = BLEND.normal;
  hasAudio = false;

  constructor(comp: MockComp, options: MockLayerOptions) {
    this.containingComp = comp;
    this.name = options.name;
    this.kind = options.kind ?? "av";
    this.outPoint = comp.duration;
    this.source = options.source ?? null;
    if (this.isAV) {
      this.solo = false;
      this.threeDLayer = false;
      this.guideLayer = false;
      this.adjustmentLayer = false;
      this.collapseTransformation = false;
      this.motionBlur = false;
      this.nullLayer = this.kind === "null";
    }
    const groups: Def[] = [leaf("ADBE Marker", "Marker", PVT.MARKER, null), transformDef()];
    if (this.kind === "camera") groups.push({ kind: "group", matchName: "ADBE Camera Options Group", name: "Camera Options" });
    if (this.kind === "light") groups.push({ kind: "group", matchName: "ADBE Light Options Group", name: "Light Options" });
    if (this.isAV) {
      groups.push({
        kind: "group",
        matchName: "ADBE Effect Parade",
        name: "Effects",
        indexed: true,
        accepts: effectDef,
      });
    }
    if (this.kind === "text") groups.push(textDef(options.text ?? "Text"));
    if (this.kind === "shape") {
      groups.push({
        kind: "group",
        matchName: "ADBE Root Vectors Group",
        name: "Contents",
        indexed: true,
        accepts: (m) => (m === "ADBE Vector Group" ? shapeGroupDef() : undefined),
      });
    }
    this.root = new MockProp({ kind: "group", matchName: "ADBE AV Layer", name: this.name, children: groups }, null, this);
  }

  get isAV(): boolean {
    return this.kind !== "camera" && this.kind !== "light";
  }

  /** As in After Effects, moving a layer's start moves its in and out points with it. */
  get startTime(): number {
    return this.shiftOrigin;
  }

  set startTime(value: number) {
    const delta = value - this.shiftOrigin;
    this.shiftOrigin = value;
    this.inPoint += delta;
    this.outPoint += delta;
  }

  get index(): number {
    return this.containingComp.stack.indexOf(this) + 1;
  }

  get numProperties(): number {
    return this.root.numProperties;
  }

  property(nameOrIndex: string | number): MockProp | null {
    if (nameOrIndex === "Effects") return this.root.property("ADBE Effect Parade");
    return this.root.property(nameOrIndex);
  }

  /**
   * Off by default: every layer measures `sourceRect`. The walkthrough recipes
   * turn it on so shape, text and precomp layers measure roughly as After
   * Effects would, which is what cursor targets and alignment are planned from.
   */
  static realisticBounds = false;

  /** Exposed only for AV layers; cameras and lights have no bounds. */
  get sourceRectAtTime(): ((time: number, extents: boolean) => typeof this.sourceRect) | undefined {
    if (!this.isAV) return undefined;
    return () => (MockLayer.realisticBounds ? this.measuredRect() : undefined) ?? { ...this.sourceRect };
  }

  private measuredRect(): typeof this.sourceRect | undefined {
    if (this.kind === "precomp" && this.source instanceof MockComp) {
      return { left: 0, top: 0, width: this.source.width, height: this.source.height };
    }
    if (this.kind === "text") {
      const document = this.root.property("ADBE Text Properties")?.property("ADBE Text Document")?.value as
        | { text?: string; fontSize?: number; justification?: number }
        | undefined;
      const lines = String(document?.text ?? "").split(/\r|\n/);
      const size = document?.fontSize ?? 72;
      // A sans-serif averages a little over half an em per character.
      const width = Math.max(...lines.map((line) => line.length)) * size * 0.56;
      const height = size * (0.72 + 1.2 * (lines.length - 1));
      const left = document?.justification === JUSTIFY.center ? -width / 2 : document?.justification === JUSTIFY.right ? -width : 0;
      return { left, top: -size * 0.72, width, height };
    }
    if (this.kind === "shape") {
      const box = shapeBounds(this.root.property("ADBE Root Vectors Group"));
      return box === undefined ? undefined : { left: box[0], top: box[1], width: box[2] - box[0], height: box[3] - box[1] };
    }
    return undefined;
  }

  get applyPreset(): ((file: AeFile) => void) | undefined {
    if (!this.isAV) return undefined;
    return (file: AeFile) => {
      this.appliedPresets.push(file.fsName);
    };
  }

  setTrackMatte(matte: MockLayer, type: number): void {
    this.trackMatteLayer = matte;
    this.trackMatteType = type;
  }

  replaceSource(newSource: MockComp | MockItem): void {
    this.source = newSource;
  }

  moveToBeginning(): void {
    const stack = this.containingComp.stack;
    stack.splice(stack.indexOf(this), 1);
    stack.unshift(this);
  }

  moveToEnd(): void {
    const stack = this.containingComp.stack;
    stack.splice(stack.indexOf(this), 1);
    stack.push(this);
  }

  moveBefore(other: MockLayer): void {
    const stack = this.containingComp.stack;
    stack.splice(stack.indexOf(this), 1);
    stack.splice(stack.indexOf(other), 0, this);
  }

  moveAfter(other: MockLayer): void {
    const stack = this.containingComp.stack;
    stack.splice(stack.indexOf(this), 1);
    stack.splice(stack.indexOf(other) + 1, 0, this);
  }

  duplicate(): MockLayer {
    const copy = Object.create(MockLayer.prototype) as MockLayer;
    Object.assign(copy, this, { selected: false, appliedPresets: [] });
    (copy as { id: number }).id = nextId++;
    copy.root = this.root.cloneInto(null, copy);
    const stack = this.containingComp.stack;
    // After Effects places the duplicate directly above the original.
    stack.splice(stack.indexOf(this), 0, copy);
    return copy;
  }

  remove(): void {
    const stack = this.containingComp.stack;
    stack.splice(stack.indexOf(this), 1);
    for (const layer of stack) if (layer.parent === this) layer.parent = null;
  }

  setParentWithJump(newParent: MockLayer | null): void {
    this.parent = newParent;
  }

  /** Test helper: the transform property with the given match name. */
  transform(matchName: string): MockProp {
    const prop = this.root.property("ADBE Transform Group")?.property(matchName);
    if (prop === null || prop === undefined) throw new Error(`No transform property ${matchName}`);
    return prop;
  }

  /** Test helper: the effects group. */
  get effects(): MockProp {
    const fx = this.root.property("ADBE Effect Parade");
    if (fx === null) throw new Error(`${this.name} has no effects group`);
    return fx;
  }
}

export class MockComp extends MockItem {
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  pixelAspect = 1;
  time = 0;
  workAreaStart = 0;
  workAreaDuration: number;
  stack: MockLayer[] = [];
  readonly project: MockProject;

  constructor(project: MockProject, name: string, width = 1920, height = 1080, frameRate = 25, duration = 10) {
    super(name, "Composition");
    this.project = project;
    this.width = width;
    this.height = height;
    this.frameRate = frameRate;
    this.duration = duration;
    this.workAreaDuration = duration;
  }

  get frameDuration(): number {
    return 1 / this.frameRate;
  }

  get numLayers(): number {
    return this.stack.length;
  }

  layer(index: number): MockLayer {
    const layer = this.stack[index - 1];
    if (layer === undefined) throw new Error(`Layer ${String(index)} out of range`);
    return layer;
  }

  get selectedLayers(): MockLayer[] {
    return this.stack.filter((l) => l.selected);
  }

  get selectedProperties(): MockProp[] {
    const out: MockProp[] = [];
    const walk = (p: MockProp): void => {
      if (p.selected) out.push(p);
      for (const c of p.children) walk(c);
    };
    for (const layer of this.stack) walk(layer.root);
    return out;
  }

  /** Test helper: add a layer at the top of the stack. */
  addLayer(options: MockLayerOptions): MockLayer {
    const layer = new MockLayer(this, options);
    this.stack.unshift(layer);
    return layer;
  }

  get layers(): AeRawLayerCollection {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the collection's getters need the comp, not themselves
    const comp = this;
    return {
      get length() {
        return comp.stack.length;
      },
      addNull: () => comp.addLayer({ name: "Null 1", kind: "null" }) as unknown as AeRawLayer,
      addSolid: (color, name, width, height) => {
        const item = new MockItem(name, "Solid");
        comp.project.items.push(item);
        const layer = comp.addLayer({ name, kind: "av", source: item });
        layer.sourceRect = { left: 0, top: 0, width, height };
        (layer as unknown as { solidColor: number[] }).solidColor = [...color];
        return layer as unknown as AeRawLayer;
      },
      addText: (text) => comp.addLayer({ name: text ?? "Text", kind: "text", text: text ?? "" }) as unknown as AeRawLayer,
      addShape: () => comp.addLayer({ name: "Shape Layer 1", kind: "shape" }) as unknown as AeRawLayer,
      addCamera: (name) => comp.addLayer({ name, kind: "camera" }) as unknown as AeRawLayer,
      add: (item) => comp.addLayer({ name: item.name, kind: "precomp", source: item as unknown as MockItem }) as unknown as AeRawLayer,
      precompose: (indices, name) => {
        const moved = indices.map((i) => comp.layer(i));
        const top = Math.min(...indices);
        const inner = new MockComp(comp.project, name, comp.width, comp.height, comp.frameRate, comp.duration);
        comp.project.items.push(inner);
        for (const layer of moved) {
          comp.stack.splice(comp.stack.indexOf(layer), 1);
          layer.containingComp = inner;
          layer.selected = false;
          inner.stack.push(layer);
        }
        const replacement = new MockLayer(comp, { name, kind: "precomp", source: inner });
        comp.stack.splice(top - 1, 0, replacement);
        return inner as unknown as AeRawComp;
      },
    };
  }

  duplicate(): MockComp {
    const copy = new MockComp(this.project, `${this.name} 2`, this.width, this.height, this.frameRate, this.duration);
    for (const layer of this.stack) {
      const clone = Object.create(MockLayer.prototype) as MockLayer;
      Object.assign(clone, layer, { selected: false, containingComp: copy, appliedPresets: [] });
      (clone as { id: number }).id = nextId++;
      clone.root = layer.root.cloneInto(null, clone);
      copy.stack.push(clone);
    }
    // Parenting is remapped to the copies, as After Effects does on duplicate.
    for (const [i, layer] of this.stack.entries()) {
      if (layer.parent !== null) copy.stack[i]!.parent = copy.stack[this.stack.indexOf(layer.parent)] ?? null;
    }
    this.project.items.push(copy);
    return copy;
  }

  openInViewer(): void {
    this.project.activeItem = this;
  }
}

export class MockProject {
  readonly items: MockItem[] & {
    addComp?: (name: string, width: number, height: number, pixelAspect: number, duration: number, frameRate: number) => MockComp;
  } = [];

  constructor() {
    // ItemCollection.addComp, on the same array the mock keeps its items in.
    this.items.addComp = (name, width, height, _pixelAspect, duration, frameRate) => this.addComp(name, width, height, frameRate, duration);
  }

  activeItem: unknown = null;
  file: AeFile | null = null;
  usedFonts: AeUsedFont[] = [];
  fontReplacements: { from: string; to: string }[] = [];
  imported: string[] = [];

  saveCount = 0;

  get numItems(): number {
    return this.items.length;
  }

  save(): void {
    if (this.file === null) throw new Error("The project has no file");
    this.saveCount += 1;
  }

  get selection(): MockItem[] {
    return this.items.filter((item) => item.selected);
  }

  item(index: number): MockItem {
    const item = this.items[index - 1];
    if (item === undefined) throw new Error(`Item ${String(index)} out of range`);
    return item;
  }

  importFile(options: AeImportOptions): MockItem {
    const name = options.file.fsName.split(/[\\/]/).pop() ?? "Imported";
    const item = new MockItem(name, "Footage");
    this.items.push(item);
    this.imported.push(options.file.fsName);
    return item;
  }

  replaceFont(from: AeFont, to: AeFont): boolean {
    const used = this.usedFonts.find((u) => u.font.postScriptName === from.postScriptName);
    if (used === undefined) return false;
    this.fontReplacements.push({ from: from.postScriptName, to: to.postScriptName });
    return true;
  }

  addComp(name = "Comp 1", width = 1920, height = 1080, frameRate = 25, duration = 10): MockComp {
    const comp = new MockComp(this, name, width, height, frameRate, duration);
    this.items.push(comp);
    return comp;
  }
}

export interface MockApp {
  version: string;
  buildName: string;
  isoLanguage: string;
  memoryInUse: number;
  project: MockProject | null;
  fonts: AeFontsObject;
  undoEvents: string[];
  purges: number[];
  executedCommands: string[];
  menuCommands: Record<string, number>;
  /** Loudness per frame that Convert Audio to Keyframes reports, from the work area start. */
  audioSamples: number[];
  existingFiles: Set<string>;
  beginUndoGroup(name: string): void;
  endUndoGroup(): void;
  purge(target: number): void;
  findMenuCommandId(text: string): number;
  executeCommand(id: number): void;
}

export function font(postScriptName: string, family = postScriptName, style = "Regular"): AeFont {
  return { postScriptName, familyName: family, styleName: style, fullName: `${family} ${style}` };
}

export function createMockApp(options: { version?: string; hasProject?: boolean } = {}): MockApp {
  const version = options.version ?? "26.0.1x45";
  const menuCommands: Record<string, number> = { "Split Layer": 2158, "Convert Audio to Keyframes": 2219 };
  const app: MockApp = {
    version,
    buildName: `Adobe After Effects ${version}`,
    isoLanguage: "en_US",
    memoryInUse: 15.8 * 1024 ** 3,
    project: options.hasProject === false ? null : new MockProject(),
    fonts: {
      allFonts: [[font("ArialMT", "Arial")], [font("Inter-Bold", "Inter", "Bold")]],
      getFontsByPostScriptName: (name) =>
        [font("ArialMT", "Arial"), font("Inter-Bold", "Inter", "Bold")].filter((f) => f.postScriptName === name),
    },
    undoEvents: [],
    purges: [],
    executedCommands: [],
    menuCommands,
    audioSamples: [],
    existingFiles: new Set<string>(),
    beginUndoGroup(name) {
      this.undoEvents.push(`begin:${name}`);
    },
    endUndoGroup() {
      this.undoEvents.push("end");
    },
    purge(target) {
      this.purges.push(target);
    },
    findMenuCommandId(text) {
      return this.menuCommands[text] ?? 0;
    },
    executeCommand(id) {
      const name = Object.keys(this.menuCommands).find((k) => this.menuCommands[k] === id) ?? String(id);
      this.executedCommands.push(name);
      if (name === "Split Layer") splitSelected(this);
      if (name === "Convert Audio to Keyframes") convertAudio(this);
    },
  };
  return app;
}

/** Models Layer ▸ Split Layer on the active comp's selection. */
function splitSelected(app: MockApp): void {
  const comp = app.project?.activeItem;
  if (!(comp instanceof MockComp)) return;
  for (const layer of comp.selectedLayers) {
    if (comp.time <= layer.inPoint || comp.time >= layer.outPoint) continue;
    const upper = layer.duplicate();
    upper.inPoint = comp.time;
    layer.outPoint = comp.time;
  }
}

/** Models Convert Audio to Keyframes: an Audio Amplitude null keyed over the work area. */
function convertAudio(app: MockApp): void {
  const comp = app.project?.activeItem;
  if (!(comp instanceof MockComp)) return;
  const layer = comp.addLayer({ name: "Audio Amplitude", kind: "null" });
  for (const channel of ["Left Channel", "Right Channel", "Both Channels"]) {
    const effect = layer.effects.addProperty("ADBE Slider Control");
    effect.name = channel;
    const slider = effect.property(1)!;
    const frames = Math.floor(comp.workAreaDuration * comp.frameRate);
    for (let f = 0; f < frames && f < app.audioSamples.length; f += 1) {
      slider.setValueAtTime(comp.workAreaStart + f / comp.frameRate, app.audioSamples[f]);
    }
  }
}

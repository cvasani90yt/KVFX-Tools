/**
 * The Quick tab: the everyday tools from every tab, one click each.
 *
 * Each tool is a tile. Most run a command with that command's last-used
 * settings — the same ones its own tab would use — and two are widgets: the
 * panel's colour, and the From Comp eyedropper. The user picks which tiles show and
 * in what order; the list lives in settings (`quickTools`).
 */

export type QuickGroup = "colour" | "comp" | "organize" | "switches" | "keys" | "text" | "fx" | "generate" | "create";

export const QUICK_GROUPS: readonly { readonly id: QuickGroup; readonly label: string }[] = [
  { id: "colour", label: "Colour" },
  { id: "comp", label: "Comp & layers" },
  { id: "organize", label: "Organize" },
  { id: "switches", label: "Switches" },
  { id: "keys", label: "Keyframes" },
  { id: "text", label: "Text" },
  { id: "fx", label: "Effects" },
  { id: "generate", label: "Generate" },
  { id: "create", label: "Create" },
];

export type QuickWidget = "colour" | "pickComp";

/** Where a feature's own screen is: its tab, its section, and the tab's filter chip when it has them. */
export interface QuickScreen {
  readonly tab: string;
  readonly section: string;
  readonly filter?: string;
}

export interface QuickTool {
  /** Stable id stored in settings: the command id, or the widget's name. */
  readonly id: string;
  /** Short, for a small tile. */
  readonly label: string;
  readonly icon: string;
  readonly group: QuickGroup;
  /** The command a tile runs; absent for the widgets. */
  readonly command?: string;
  readonly widget?: QuickWidget;
  /**
   * For a feature with choices of its own — presets, a preview, a length —
   * the tile is a shortcut to that screen instead of running blind.
   * Alt-click still runs it with its last settings.
   */
  readonly screen?: QuickScreen;
}

const cmd = (command: string, label: string, icon: string, group: QuickGroup, screen?: QuickScreen): QuickTool => ({
  id: command,
  label,
  icon,
  group,
  command,
  ...(screen === undefined ? {} : { screen }),
});
const widget = (id: QuickWidget, label: string, icon: string): QuickTool => ({ id, label, icon, group: "colour", widget: id });

export const QUICK_TOOLS: readonly QuickTool[] = [
  // Colour
  widget("colour", "Colour", "eyedropper"),
  widget("pickComp", "From Comp", "pick-comp"),
  cmd("kvfx.fx.fill", "Fill", "fill", "colour"),
  cmd("kvfx.text.color", "Text Colour", "text", "colour"),
  cmd("kvfx.fx.gradientlock", "Grad Lock", "gradient", "colour", { tab: "tools", section: "tools.colour" }),

  // Comp & layers
  cmd("kvfx.comp.deepduplicatecomp", "Dup Comp", "duplicate", "comp"),
  cmd("kvfx.comp.deepduplicate", "Dup Precomp", "duplicate", "comp"),
  cmd("kvfx.layer.precomposeeach", "Precomp", "precompose", "comp"),
  cmd("kvfx.layer.unprecompose", "Unprecomp", "unprecompose", "comp"),
  cmd("kvfx.layer.nullparent", "Null Parent", "link", "comp"),
  cmd("kvfx.layer.split", "Split", "split", "comp"),
  cmd("kvfx.layer.trimworkarea", "Trim to WA", "trim", "comp"),

  // Organize
  cmd("kvfx.layer.sequence", "Sequence", "sequence", "organize", { tab: "tools", section: "tools.sequence" }),
  cmd("kvfx.label.selectsame", "Same Label", "select", "organize"),
  cmd("kvfx.align.gaps.horizontal", "Gaps ↔", "gaps-h", "organize"),
  cmd("kvfx.align.gaps.vertical", "Gaps ↕", "gaps-v", "organize"),
  cmd("kvfx.align.distribute.horizontal", "Spread ↔", "distribute-h", "organize"),
  cmd("kvfx.align.distribute.vertical", "Spread ↕", "distribute-v", "organize"),
  cmd("kvfx.layer.movetop", "To Top", "move-top", "organize"),
  cmd("kvfx.layer.moveup", "Up", "move-up", "organize"),
  cmd("kvfx.layer.movedown", "Down", "move-down", "organize"),
  cmd("kvfx.layer.movebottom", "To Bottom", "move-bottom", "organize"),
  cmd("kvfx.layer.follow", "Follow", "follow", "organize", { tab: "tools", section: "tools.follow" }),

  // Switches
  cmd("kvfx.layer.solo", "Solo", "solo", "switches"),
  cmd("kvfx.layer.visibility", "Visibility", "eye", "switches"),
  cmd("kvfx.layer.lock", "Lock", "lock", "switches"),
  cmd("kvfx.layer.unlockall", "Unlock All", "unlock", "switches"),
  cmd("kvfx.layer.shy", "Shy", "shy", "switches"),
  cmd("kvfx.layer.threed", "3D", "cube", "switches"),
  cmd("kvfx.layer.guide", "Guide", "guide", "switches"),
  cmd("kvfx.layer.adjustment", "Adjustment", "adjustment", "switches"),

  // Keyframes
  cmd("kvfx.keys.ease", "Apply Ease", "ease", "keys"),
  cmd("kvfx.keys.linear", "Linear", "key-linear", "keys"),
  cmd("kvfx.keys.hold", "Hold", "key-hold", "keys"),
  cmd("kvfx.keys.bezier", "Bezier", "key-bezier", "keys"),
  cmd("kvfx.keys.reverse", "Reverse", "reverse", "keys"),
  cmd("kvfx.keys.elastic", "Elastic", "elastic", "keys"),
  cmd("kvfx.keys.bounce", "Bounce", "bounce", "keys"),
  cmd("kvfx.keys.loopcycle", "Loop", "loop", "keys"),
  cmd("kvfx.keys.looppingpong", "Ping-Pong", "loop", "keys"),
  cmd("kvfx.keys.wiggle", "Wiggle", "wiggle", "keys", { tab: "ease", section: "ease.motion" }),
  cmd("kvfx.keys.clearexpressions", "Clear Expr", "clear", "keys"),

  // Text
  cmd("kvfx.text.animate", "Animate", "text-animate", "text", { tab: "text", section: "text.animate" }),
  cmd("kvfx.text.explode", "Explode", "explode", "text", { tab: "text", section: "text.explode" }),
  cmd("kvfx.text.style", "Style Text", "text-style", "text", { tab: "text", section: "text.style" }),
  cmd("kvfx.rig.kinetic", "Kinetic", "kinetic", "text", { tab: "text", section: "text.kinetic" }),

  // Effects
  cmd("kvfx.fx.add.blur", "Blur", "fx-blur", "fx"),
  cmd("kvfx.fx.add.glow", "Glow", "fx-glow", "fx"),
  cmd("kvfx.fx.add.shadow", "Shadow", "fx-shadow", "fx"),
  cmd("kvfx.fx.add.tint", "Tint", "fx-tint", "fx"),
  cmd("kvfx.fx.add.ramp", "Ramp", "gradient", "fx"),
  cmd("kvfx.fx.add.bevel", "Bevel", "fx-bevel", "fx"),
  cmd("kvfx.fx.add.slider", "Slider", "fx-slider", "fx"),
  cmd("kvfx.fx.add.checkbox", "Checkbox", "fx-checkbox", "fx"),
  cmd("kvfx.fx.add.color", "Colour Ctrl", "fx-color", "fx"),
  cmd("kvfx.fx.add.point", "Point Ctrl", "fx-point", "fx"),
  cmd("kvfx.fx.add.angle", "Angle Ctrl", "fx-angle", "fx"),

  // Generate
  cmd("kvfx.rig.transition", "Transition", "transition", "generate", { tab: "generate", section: "gen.transitions", filter: "trans" }),
  cmd("kvfx.rig.speedRamp", "Speed Ramp", "speed", "generate", { tab: "generate", section: "gen.speedramp", filter: "speed" }),
  cmd("kvfx.rig.counter", "Counter", "counter", "generate", { tab: "generate", section: "gen.counter", filter: "build" }),
  cmd("kvfx.rig.carousel", "Carousel", "carousel", "generate", { tab: "generate", section: "gen.carousel", filter: "build" }),
  cmd("kvfx.rig.extrude", "Extrude", "extrude", "generate", { tab: "generate", section: "gen.extrude", filter: "build" }),

  // Create
  cmd("kvfx.layer.createnull", "Null", "null", "create"),
  cmd("kvfx.layer.createadjustment", "Adjust", "adjustment", "create"),
  cmd("kvfx.layer.createsolid", "Solid", "solid", "create"),
  cmd("kvfx.layer.createtext", "New Text", "text", "create"),
  cmd("kvfx.layer.createshape", "Shape", "shape", "create"),
  cmd("kvfx.layer.createcamera", "Camera", "camera", "create"),
];

export function quickToolById(id: string): QuickTool | undefined {
  return QUICK_TOOLS.find((t) => t.id === id);
}

/** The tools a saved list names, in its order, skipping any this build doesn't have. */
export function quickToolsOf(ids: readonly string[]): QuickTool[] {
  const seen = new Set<string>();
  const out: QuickTool[] = [];
  for (const id of ids) {
    const tool = quickToolById(id);
    if (tool === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push(tool);
  }
  return out;
}

/** Adds a tool at the end, once. */
export function addQuickTool(ids: readonly string[], id: string): string[] {
  return quickToolById(id) === undefined || ids.includes(id) ? [...ids] : [...ids, id];
}

export function removeQuickTool(ids: readonly string[], id: string): string[] {
  return ids.filter((x) => x !== id);
}

/** Moves a tool to `index` (clamped), the others closing up around it. */
export function moveQuickTool(ids: readonly string[], id: string, index: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return [...ids];
  const rest = ids.filter((x) => x !== id);
  const to = Math.max(0, Math.min(rest.length, Math.round(index)));
  rest.splice(to, 0, id);
  return rest;
}

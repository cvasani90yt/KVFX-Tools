import { AlignEdge, AnchorSpot, alignCommandIdFor, type AlignReference } from "@kvfx/core";
import { createIcon } from "../components/icons.js";

/**
 * The LAYERS tab.
 *
 * Grids rather than a list, because alignment and anchor placement are
 * *spatial* choices: a 3×3 anchor grid shows what it does, while "Anchor to
 * Middle Right" in a list has to be read. The palette still reaches every one
 * of these by name — this view exists so the common ones are one click and no
 * reading at all.
 */

export interface LayersViewModel {
  readonly reference: AlignReference;
  readonly busy: boolean;
  /** Ids the current selection allows, so buttons disable honestly. */
  readonly availableIds: ReadonlySet<string>;
  readonly reasons: ReadonlyMap<string, string>;
}

export interface LayersViewHandlers {
  readonly onRun: (commandId: string) => void;
  readonly onReferenceChange: (reference: AlignReference) => void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(title: string, hint?: string): HTMLElement {
  const wrapper = element("section", "kvfx-section");
  const heading = element("div", "kvfx-section__head");
  heading.append(element("h2", "kvfx-section__title", title));
  if (hint !== undefined) heading.append(element("span", "kvfx-section__hint", hint));
  wrapper.append(heading);
  return wrapper;
}

interface ToolButtonSpec {
  readonly commandId: string;
  readonly icon: string;
  readonly label: string;
}

function toolButton(
  spec: ToolButtonSpec,
  model: LayersViewModel,
  handlers: LayersViewHandlers,
): HTMLButtonElement {
  const button = element("button", "kvfx-tool");
  button.type = "button";

  const available = model.availableIds.has(spec.commandId);
  button.disabled = !available || model.busy;
  // The reason a control is unavailable belongs on the control itself; making
  // the user hunt for an explanation elsewhere is what makes disabled UI
  // frustrating.
  button.title = available ? spec.label : (model.reasons.get(spec.commandId) ?? spec.label);
  button.setAttribute("aria-label", spec.label);

  button.append(createIcon(spec.icon));
  button.addEventListener("click", () => handlers.onRun(spec.commandId));
  return button;
}

const REFERENCE_OPTIONS: ReadonlyArray<{ value: AlignReference; label: string; hint: string }> = [
  { value: "auto", label: "Auto", hint: "One layer aligns to the composition; two or more align to each other" },
  { value: "composition", label: "Comp", hint: "Always align to the composition" },
  { value: "selection", label: "Selection", hint: "Always align to the selection's bounding box" },
];

function referenceToggle(model: LayersViewModel, handlers: LayersViewHandlers): HTMLElement {
  const group = element("div", "kvfx-segmented");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Align relative to");

  for (const option of REFERENCE_OPTIONS) {
    const button = element("button", "kvfx-segmented__option", option.label);
    button.type = "button";
    button.title = option.hint;
    button.setAttribute("role", "radio");
    const selected = model.reference === option.value;
    button.setAttribute("aria-checked", selected ? "true" : "false");
    if (selected) button.classList.add("kvfx-segmented__option--on");
    button.addEventListener("click", () => handlers.onReferenceChange(option.value));
    group.append(button);
  }

  return group;
}

const ALIGN_ROW_H: ReadonlyArray<{ edge: AlignEdge; icon: string; label: string }> = [
  { edge: AlignEdge.Left, icon: "align-left", label: "Align left" },
  { edge: AlignEdge.CentreX, icon: "align-center-h", label: "Align horizontal centres" },
  { edge: AlignEdge.Right, icon: "align-right", label: "Align right" },
];

const ALIGN_ROW_V: ReadonlyArray<{ edge: AlignEdge; icon: string; label: string }> = [
  { edge: AlignEdge.Top, icon: "align-top", label: "Align top" },
  { edge: AlignEdge.CentreY, icon: "align-center-v", label: "Align vertical centres" },
  { edge: AlignEdge.Bottom, icon: "align-bottom", label: "Align bottom" },
];

function alignSection(model: LayersViewModel, handlers: LayersViewHandlers): HTMLElement {
  const wrapper = section("Align");
  wrapper.append(referenceToggle(model, handlers));

  const grid = element("div", "kvfx-grid kvfx-grid--four");
  for (const spec of [...ALIGN_ROW_H, ...ALIGN_ROW_V]) {
    grid.append(
      toolButton(
        { commandId: alignCommandIdFor(spec.edge, model.reference), icon: spec.icon, label: spec.label },
        model,
        handlers,
      ),
    );
  }

  grid.append(
    toolButton(
      { commandId: "kvfx.align.distribute.horizontal", icon: "distribute-h", label: "Distribute horizontally" },
      model,
      handlers,
    ),
    toolButton(
      { commandId: "kvfx.align.distribute.vertical", icon: "distribute-v", label: "Distribute vertically" },
      model,
      handlers,
    ),
  );

  wrapper.append(grid);
  return wrapper;
}

/** Row-major, matching the 3×3 arrangement on screen. */
const ANCHOR_GRID: readonly AnchorSpot[] = [
  AnchorSpot.TopLeft,
  AnchorSpot.TopCentre,
  AnchorSpot.TopRight,
  AnchorSpot.MiddleLeft,
  AnchorSpot.Centre,
  AnchorSpot.MiddleRight,
  AnchorSpot.BottomLeft,
  AnchorSpot.BottomCentre,
  AnchorSpot.BottomRight,
];

const ANCHOR_LABELS: Readonly<Record<AnchorSpot, string>> = {
  topLeft: "Anchor to top left",
  topCentre: "Anchor to top centre",
  topRight: "Anchor to top right",
  middleLeft: "Anchor to middle left",
  centre: "Anchor to centre",
  middleRight: "Anchor to middle right",
  bottomLeft: "Anchor to bottom left",
  bottomCentre: "Anchor to bottom centre",
  bottomRight: "Anchor to bottom right",
};

function anchorSection(model: LayersViewModel, handlers: LayersViewHandlers): HTMLElement {
  const wrapper = section("Anchor point", "the layer does not move");
  const grid = element("div", "kvfx-anchor");

  for (const spot of ANCHOR_GRID) {
    const commandId = `kvfx.anchor.${spot.toLowerCase()}`;
    const button = element("button", "kvfx-anchor__cell");
    button.type = "button";

    const available = model.availableIds.has(commandId);
    button.disabled = !available || model.busy;
    button.title = available ? ANCHOR_LABELS[spot] : (model.reasons.get(commandId) ?? ANCHOR_LABELS[spot]);
    button.setAttribute("aria-label", ANCHOR_LABELS[spot]);
    // The dot's position within the cell is the whole affordance — together the
    // nine cells read as one anchor selector.
    button.append(element("span", "kvfx-anchor__dot"));

    button.addEventListener("click", () => handlers.onRun(commandId));
    grid.append(button);
  }

  wrapper.append(grid);
  return wrapper;
}

const ORDER_TOOLS: readonly ToolButtonSpec[] = [
  { commandId: "kvfx.layer.movetop", icon: "move-top", label: "Move to top" },
  { commandId: "kvfx.layer.moveup", icon: "move-up", label: "Move up" },
  { commandId: "kvfx.layer.movedown", icon: "move-down", label: "Move down" },
  { commandId: "kvfx.layer.movebottom", icon: "move-bottom", label: "Move to bottom" },
];

const SWITCH_TOOLS: readonly ToolButtonSpec[] = [
  { commandId: "kvfx.layer.solo", icon: "solo", label: "Toggle solo" },
  { commandId: "kvfx.layer.visibility", icon: "eye", label: "Toggle visibility" },
  { commandId: "kvfx.layer.shy", icon: "shy", label: "Toggle shy" },
  { commandId: "kvfx.layer.threed", icon: "cube", label: "Toggle 3D" },
  { commandId: "kvfx.layer.guide", icon: "guide", label: "Toggle guide layer" },
  { commandId: "kvfx.layer.lock", icon: "lock", label: "Lock selected layers" },
  { commandId: "kvfx.layer.unlockall", icon: "unlock", label: "Unlock all layers" },
];

const CREATE_TOOLS: readonly ToolButtonSpec[] = [
  { commandId: "kvfx.layer.createnull", icon: "null", label: "Create null" },
  { commandId: "kvfx.layer.createadjustment", icon: "adjustment", label: "Create adjustment layer" },
];

function toolSection(
  title: string,
  tools: readonly ToolButtonSpec[],
  model: LayersViewModel,
  handlers: LayersViewHandlers,
): HTMLElement {
  const wrapper = section(title);
  const grid = element("div", "kvfx-grid kvfx-grid--four");
  for (const spec of tools) grid.append(toolButton(spec, model, handlers));
  wrapper.append(grid);
  return wrapper;
}

export function renderLayersView(
  model: LayersViewModel,
  handlers: LayersViewHandlers,
): HTMLElement {
  const root = element("div", "kvfx-view");
  root.append(
    alignSection(model, handlers),
    anchorSection(model, handlers),
    toolSection("Order", ORDER_TOOLS, model, handlers),
    toolSection("Switches", SWITCH_TOOLS, model, handlers),
    toolSection("Create", CREATE_TOOLS, model, handlers),
  );
  return root;
}

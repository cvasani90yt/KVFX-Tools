import {
  DEFAULT_QUICK_PINS,
  DEFAULT_QUICK_TOOLS,
  QUICK_COLOUR_SCHEMES,
  QUICK_GROUPS,
  QUICK_TOOLS,
  type QuickColours,
  type QuickScreen,
  type QuickTiles,
  type QuickTool,
  SPEED_RAMPS,
  type SpeedPoint,
  TRANSITIONS,
  addQuickTool,
  moveQuickTool,
  quickColours,
  quickHint,
  quickToolsOf,
  removeQuickTool,
  rgbaOf,
  speedAt,
  speedRampById,
  spotlightZones,
  togglePin,
  transitionById,
} from "@kvfx/core";
import type { Availability, Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { IconSize, createIcon } from "../components/icons.js";
import { type ColorInput, colorInput } from "../ui/color-picker.js";
import { CommandButtons, segmented } from "../ui/controls.js";
import { clear, h, setText, toggleClass } from "../ui/dom.js";
import { type DragPoint, followDrag, onPress } from "../ui/drag.js";
import { Eyedroppers } from "../ui/eyedroppers.js";

/**
 * QUICK: the everyday tools from every tab, in the Spotlight layout.
 *
 * Every tool is one click; the layout only decides how much room each gets.
 * The panel colour leads as a strip that glows in it, with the colour tools
 * beside it; up to four pinned tools get large tiles; Transition and Speed
 * Ramp are cards that show the preset they'll use; everything else is a
 * compact grid. Icons take their section's colour in the chosen scheme.
 *
 * An action is run with the tool's last-used settings from its own tab. A
 * tool with choices of its own (Speed Ramp, Transition, Animate…) opens its
 * screen instead, and Alt-click runs it. Customize arranges everything: drag
 * a tile onto another (or focus it and use the arrow keys), the star pins
 * it, × or Delete removes it, and the catalog adds the others.
 */

/** How far the pointer moves before a press becomes a drag. */
const DRAG_START_PX = 4;
/** How close to the view's top or bottom a dragged tile starts it scrolling, and how fast. */
const EDGE_PX = 36;
const SCROLL_STEP = 8;

const SVG_NS = "http://www.w3.org/2000/svg";

/* eslint-disable no-magic-numbers -- the speed card's drawing */
/** A speed curve as a path in a 120 × 34 box: speed on a log scale, so slow-motion reads as clearly as fast. */
function speedPath(points: readonly SpeedPoint[]): { path: string; baseline: number } {
  const steps = 48;
  const scale = (v: number): number => Math.sign(v) * Math.log2(1 + Math.abs(v));
  const values = Array.from({ length: steps + 1 }, (_, i) => scale(speedAt(points, i / steps)));
  const base = scale(1);
  const lo = Math.min(base, ...values);
  const hi = Math.max(base, ...values);
  const y = (v: number): number => 31 - ((v - lo) / (hi - lo || 1)) * 28;
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${((i / steps) * 120).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return { path, baseline: y(base) };
}
/* eslint-enable no-magic-numbers */

/** Each section colour's tints, by the percentage the CSS variable is named after. */
// eslint-disable-next-line no-magic-numbers -- the tints themselves, matched by name in base.css
const TINTS: readonly number[] = [8, 16, 22, 32];
/** The colour strip's glow and edge, in percent of the panel colour. */
const GLOW = 20;
const EDGE = 34;
const PERCENT = 100;

/** The CSS colour variables for a scheme: each section's colour and its tints, and the panel colour's glow. */
function colourVars(scheme: QuickColours, panelColour: string): [string, string][] {
  const out: [string, string][] = [];
  const colours = quickColours(scheme, panelColour);
  for (const group of QUICK_GROUPS) {
    const c = colours[group.id];
    out.push([`--kq-${group.id}`, c]);
    for (const tint of TINTS) out.push([`--kq-${group.id}-${String(tint)}`, rgbaOf(c, tint / PERCENT)]);
  }
  out.push(["--kq-pc", panelColour], [`--kq-pc-${String(GLOW)}`, rgbaOf(panelColour, GLOW / PERCENT)], [`--kq-pc-${String(EDGE)}`, rgbaOf(panelColour, EDGE / PERCENT)]);
  return out;
}

const TILE_STYLES: readonly { value: QuickTiles; label: string; title: string }[] = [
  { value: "well", label: "Icon well", title: "The section colour in a small square behind each icon" },
  { value: "icon", label: "Icon", title: "The section colour on the icon only" },
  { value: "soft", label: "Soft fill", title: "A soft tint of the section colour on each tile" },
];

export class QuickView implements View {
  readonly id = "quick";
  readonly label = "Quick";
  readonly icon = "tab-quick";
  readonly root: HTMLElement;
  readonly #panel: Panel;
  readonly #hint: HTMLElement;
  /** The Spotlight layout, when not customizing. */
  readonly #spot: HTMLElement;
  /** Every tool in order, while customizing. */
  readonly #grid: HTMLElement;
  readonly #editor: HTMLElement;
  readonly #catalog: HTMLElement;
  readonly #labels: HTMLInputElement;
  readonly #scheme: { root: HTMLElement; set: (value: QuickColours) => void };
  readonly #tiles: { root: HTMLElement; set: (value: QuickTiles) => void };
  readonly #customize: HTMLButtonElement;
  #buttons: CommandButtons;
  #eyedroppers: Eyedroppers;
  #colour: ColorInput | undefined;
  #hex: HTMLElement | undefined;
  #editing = false;
  #key = "";
  #painted = "";
  #last: { state: SessionState; availability: Availability } | undefined;
  /** A tile to focus once the grid is redrawn, after a keyboard move. */
  #focusAfter: string | undefined;

  constructor(panel: Panel) {
    this.#panel = panel;
    this.#buttons = new CommandButtons(panel);
    this.#eyedroppers = new Eyedroppers(panel);
    const session = panel.session;
    const ui = session.state.settings.ui;

    this.#hint = h("p", { class: "kvfx-hint kvfx-qhint", text: "Drag a tile onto another to move it there, or focus it and use the arrow keys. The star pins a tool as a large tile; × or Delete removes it." });
    this.#spot = h("div", { class: "kvfx-qspot" });
    this.#grid = h("div", { class: "kvfx-qgrid", attrs: { role: "group", "aria-label": "Quick tools" } });
    this.#catalog = h("div", { class: "kvfx-qcatalog" });
    this.#labels = h("input", { type: "checkbox", on: { change: () => session.setUi("quickLabels", this.#labels.checked) } });
    this.#scheme = segmented(
      QUICK_COLOUR_SCHEMES.map((s) => ({ value: s.id, label: s.label, title: s.about })),
      ui.quickColours,
      (value) => session.setUi("quickColours", value),
    );
    this.#tiles = segmented(TILE_STYLES, ui.quickTiles, (value) => session.setUi("quickTiles", value));
    const reset = h("button", {
      class: "kvfx-ghost",
      type: "button",
      text: "Reset",
      title: "Put back the tools and pins the Quick tab ships with",
      on: { click: () => void this.#reset() },
    });
    const done = h("button", { class: "kvfx-pill kvfx-primary", type: "button", text: "Done", on: { click: () => this.#toggleEditing() } });
    this.#editor = h(
      "div",
      { class: "kvfx-qeditor" },
      h("div", { class: "kvfx-presets__group", text: "Look" }),
      h("div", { class: "kvfx-qlook" }, h("span", { class: "kvfx-field__label", text: "Colours" }), this.#scheme.root, h("span", { class: "kvfx-field__label", text: "Tiles" }), this.#tiles.root),
      h("div", { class: "kvfx-presets__group", text: "Add or remove tools" }),
      this.#catalog,
      h("div", { class: "kvfx-qoptions" }, h("label", { class: "kvfx-check" }, this.#labels, h("span", { text: "Labels under icons" })), reset, done),
    );
    this.#customize = h(
      "button",
      { class: "kvfx-ghost kvfx-qcustomize", type: "button", title: "Choose, pin and arrange the Quick tab's tools", on: { click: () => this.#toggleEditing() } },
      createIcon("edit", IconSize.small),
      h("span", { text: "Customize" }),
    );
    this.root = h("div", { class: "kvfx-tab kvfx-quicktab" }, this.#hint, this.#spot, this.#grid, h("div", { class: "kvfx-qfoot" }, this.#customize), this.#editor);
  }

  update(state: SessionState, availability: Availability): void {
    this.#last = { state, availability };
    const ui = state.settings.ui;
    const presets = JSON.stringify([ui.toolParams["transition"]?.["preset"] ?? null, ui.toolParams["speedRamp"]?.["preset"] ?? null]);
    const key = `${ui.quickTools.join(",")}|${String(ui.quickLabels)}|${String(this.#editing)}|${ui.quickPins.join(",")}|${presets}`;
    if (key !== this.#key) {
      this.#key = key;
      this.#render(state);
    }
    this.#paint(ui.quickColours, ui.quickTiles, ui.solidColor);
    this.#scheme.set(ui.quickColours);
    this.#tiles.set(ui.quickTiles);
    this.#buttons.update(state, availability);
    this.#eyedroppers.update(state);
    // The panel's colour can change elsewhere: the header's Solid swatch, Tools ▸ Colour.
    if (this.#colour !== undefined && this.#colour.input.value !== ui.solidColor && !this.#colour.isOpen()) this.#colour.set(ui.solidColor);
    if (this.#hex !== undefined) setText(this.#hex, ui.solidColor.toUpperCase());
  }

  /** Section colours as CSS variables, tints made here: the panel's engine can't mix colours in CSS. */
  #paint(scheme: QuickColours, tiles: QuickTiles, panelColour: string): void {
    this.root.dataset["tiles"] = tiles;
    const key = `${scheme}|${panelColour}`;
    if (key === this.#painted) return;
    this.#painted = key;
    for (const [name, value] of colourVars(scheme, panelColour)) this.root.style.setProperty(name, value);
  }

  #ids(): string[] {
    return quickToolsOf(this.#panel.session.state.settings.ui.quickTools).map((t) => t.id);
  }

  #set(ids: readonly string[]): void {
    this.#panel.session.setUi("quickTools", [...ids]);
  }

  #toggleEditing(): void {
    this.#editing = !this.#editing;
    this.#key = "";
    if (this.#last !== undefined) this.update(this.#last.state, this.#last.availability);
  }

  #render(state: SessionState): void {
    const ui = state.settings.ui;
    const tools = quickToolsOf(ui.quickTools);
    // Fresh buttons for the fresh tiles; the old ones go with the old tiles.
    this.#buttons = new CommandButtons(this.#panel);
    this.#eyedroppers = new Eyedroppers(this.#panel);
    this.#colour = undefined;
    this.#hex = undefined;
    clear(this.#spot);
    clear(this.#grid);
    toggleClass(this.root, "kvfx-quicktab--nolabels", !ui.quickLabels);
    toggleClass(this.root, "kvfx-quicktab--editing", this.#editing);
    this.#hint.hidden = !this.#editing;
    this.#editor.hidden = !this.#editing;
    this.#customize.hidden = this.#editing;
    this.#spot.hidden = this.#editing;
    this.#grid.hidden = !this.#editing;
    this.#labels.checked = ui.quickLabels;
    if (tools.length === 0) {
      (this.#editing ? this.#grid : this.#spot).append(h("p", { class: "kvfx-empty kvfx-qempty", text: "No tools yet. Pick the ones you use most in Customize." }));
    }
    if (this.#editing) {
      for (const tool of tools) this.#grid.append(this.#editTile(tool, ui.quickPins));
      this.#renderCatalog(tools.map((t) => t.id));
      if (this.#focusAfter !== undefined) {
        const id = this.#focusAfter;
        this.#focusAfter = undefined;
        Array.from(this.#grid.querySelectorAll<HTMLElement>("[data-tool]"))
          .find((t) => t.dataset["tool"] === id)
          ?.focus();
      }
      return;
    }

    const zones = spotlightZones(ui.quickTools, ui.quickPins);
    if (zones.hero) this.#spot.append(this.#hero(zones.heroTools, ui.solidColor));
    if (zones.pinned.length > 0) {
      this.#spot.append(h("div", { class: `kvfx-qpins${zones.pinned.length % 2 === 1 ? " kvfx-qpins--odd" : ""}` }, ...zones.pinned.map((t) => this.#big(t))));
    }
    if (zones.cards.length > 0) {
      this.#spot.append(h("div", { class: `kvfx-qcards${zones.cards.length % 2 === 1 ? " kvfx-qcards--odd" : ""}` }, ...zones.cards.map((t) => this.#card(t, state))));
    }
    if (zones.grid.length > 0) {
      this.#spot.append(h("div", { class: "kvfx-qgrid", attrs: { role: "group", "aria-label": "More quick tools" } }, ...zones.grid.map((t) => this.#tile(t))));
    }
  }

  /** The panel colour, glowing, with the colour tools beside it. */
  #hero(tools: readonly QuickTool[], colour: string): HTMLElement {
    const session = this.#panel.session;
    this.#colour = colorInput("Colour picker", colour, (hex) => session.setUi("solidColor", hex), "kvfx-qhero__swatch");
    const badge = createIcon("eyedropper", IconSize.tiny);
    badge.classList.add("kvfx-qhero__badge");
    // The hidden input travels inside the swatch, so the strip sees one item.
    this.#colour.swatch.append(this.#colour.input, badge);
    this.#hex = h("b", { text: colour.toUpperCase() });
    return h(
      "div",
      { class: "kvfx-qhero kvfx-g-colour" },
      this.#colour.swatch,
      h("div", { class: "kvfx-qhero__text" }, this.#hex, h("small", { text: "Panel colour" })),
      h("div", { class: "kvfx-qhero__tools" }, ...tools.map((t) => this.#mini(t))),
    );
  }

  /** A small icon button in the hero strip. */
  #mini(tool: QuickTool): HTMLButtonElement {
    const className = `kvfx-qmini kvfx-g-${tool.group}`;
    if (tool.widget === "pickComp") {
      return this.#eyedroppers.comp(h("button", { class: className, type: "button", attrs: { "aria-label": tool.label } }, createIcon(tool.icon)));
    }
    if (tool.screen !== undefined) {
      const screen = tool.screen;
      const button = h("button", { class: className, type: "button", title: `${tool.label} — opens its options. Alt-click runs it with your last settings.`, attrs: { "aria-label": `${tool.label}: opens its options` } }, createIcon(tool.icon));
      button.addEventListener("click", (event) => this.#open(event, tool, screen));
      return button;
    }
    return this.#buttons.button(tool.command ?? tool.id, { label: tool.label, icon: tool.icon, variant: "tool", className, flash: true });
  }

  /** A pinned tool: a large tile with one line on what it does. */
  #big(tool: QuickTool): HTMLElement {
    const hint = h("small", { class: "kvfx-qbig__hint", text: quickHint(tool) });
    let tile: HTMLButtonElement;
    if (tool.widget === "pickComp") tile = this.#eyedroppers.comp(this.#plainTile(tool, "Pick a colour from the comp's frame at the playhead"));
    else if (tool.screen !== undefined) tile = this.#screenTile(tool, tool.screen);
    else tile = this.#buttons.button(tool.command ?? tool.id, { label: tool.label, icon: tool.icon, variant: "qtile", flash: true });
    tile.classList.add("kvfx-qbig", `kvfx-g-${tool.group}`);
    tile.querySelector(":scope > span")?.after(hint);
    return tile;
  }

  /** Transition or Speed Ramp: a card that shows the preset a click will use. */
  #card(tool: QuickTool, state: SessionState): HTMLElement {
    const params = state.settings.ui.toolParams;
    const ramp = tool.id === "kvfx.rig.speedRamp";
    const rampPreset = speedRampById(params["speedRamp"]?.["preset"]) ?? speedRampById("velocity") ?? SPEED_RAMPS[0];
    const transition = transitionById(params["transition"]?.["preset"]) ?? transitionById("whipLeft") ?? TRANSITIONS[0];
    const name = (ramp ? rampPreset?.name : transition?.name) ?? "";
    const preview = ramp && rampPreset !== undefined ? this.#speedPreview(rampPreset.points) : h("span", { class: "kvfx-qpv kvfx-qpv--wipe", attrs: { "aria-hidden": "true" } }, h("i"), h("i"));
    const mark = createIcon("chevron-right", IconSize.tiny);
    mark.classList.add("kvfx-qtile__opens");
    const card = h(
      "button",
      {
        class: `kvfx-qcard kvfx-g-${tool.group}`,
        type: "button",
        title: `${tool.label}: ${name} — opens its options. Alt-click adds it with your last settings.`,
        attrs: { "aria-label": `${tool.label}, ${name}: opens its options` },
      },
      preview,
      h("span", { class: "kvfx-qcard__text" }, h("b", { text: tool.label }), h("small", { text: name })),
      mark,
    );
    const screen = tool.screen;
    if (screen !== undefined) card.addEventListener("click", (event) => this.#open(event, tool, screen));
    return card;
  }

  #speedPreview(points: readonly SpeedPoint[]): HTMLElement {
    const { path, baseline } = speedPath(points);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 120 34");
    svg.setAttribute("preserveAspectRatio", "none");
    const base = document.createElementNS(SVG_NS, "line");
    for (const [k, v] of [["x1", "0"], ["x2", "120"], ["y1", baseline.toFixed(1)], ["y2", baseline.toFixed(1)], ["class", "kvfx-qpv__base"]]) base.setAttribute(k as string, v as string);
    const curve = document.createElementNS(SVG_NS, "path");
    curve.setAttribute("d", path);
    curve.setAttribute("class", "kvfx-qpv__curve");
    svg.append(base, curve);
    return h("span", { class: "kvfx-qpv", attrs: { "aria-hidden": "true" } }, svg, h("i", { class: "kvfx-qpv__scan" }));
  }

  /** Click opens a feature's screen; Alt-click runs it with its last settings. */
  #open(event: MouseEvent, tool: QuickTool, screen: QuickScreen): void {
    if (event.altKey && tool.command !== undefined) void this.#panel.session.run(tool.command);
    else this.#panel.openFeature(screen);
  }

  /** A compact tile: an eyedropper, a shortcut or a command. */
  #tile(tool: QuickTool): HTMLElement {
    let tile: HTMLElement;
    if (tool.widget === "colour") tile = this.#hero([], this.#panel.session.state.settings.ui.solidColor);
    else if (tool.widget === "pickComp") tile = this.#eyedroppers.comp(this.#plainTile(tool, "Pick a colour from the comp's frame at the playhead"));
    else if (tool.screen !== undefined) tile = this.#screenTile(tool, tool.screen);
    else tile = this.#buttons.button(tool.command ?? tool.id, { label: tool.label, icon: tool.icon, variant: "qtile", flash: true });
    tile.classList.add(`kvfx-g-${tool.group}`);
    return tile;
  }

  /** A shortcut to a feature's own screen, marked with a corner arrow. Alt-click runs it with its last settings instead. */
  #screenTile(tool: QuickTool, screen: QuickScreen): HTMLButtonElement {
    const mark = createIcon("chevron-right", IconSize.tiny);
    mark.classList.add("kvfx-qtile__opens");
    const tile = h(
      "button",
      {
        class: "kvfx-qtile kvfx-qtile--opens",
        type: "button",
        title: `${tool.label} — opens its options. Alt-click runs it with your last settings.`,
        attrs: { "aria-label": `${tool.label}: opens its options` },
      },
      createIcon(tool.icon),
      h("span", { text: tool.label }),
      mark,
    );
    tile.addEventListener("click", (event) => this.#open(event, tool, screen));
    return tile;
  }

  #plainTile(tool: QuickTool, title: string): HTMLButtonElement {
    return h("button", { class: "kvfx-qtile", type: "button", title, attrs: { "aria-label": tool.label } }, createIcon(tool.icon), h("span", { text: tool.label }));
  }

  /** A tile being arranged: drag it, arrow-key it, pin it or remove it. It runs nothing. */
  #editTile(tool: QuickTool, pins: readonly string[]): HTMLElement {
    const face =
      tool.widget === "colour"
        ? h("span", { class: "kvfx-swatch__chip", style: { "background-color": this.#panel.session.state.settings.ui.solidColor } })
        : createIcon(tool.icon);
    const remove = h(
      "button",
      {
        class: "kvfx-qtile__remove",
        type: "button",
        title: `Remove ${tool.label}`,
        attrs: { "aria-label": `Remove ${tool.label}` },
        on: {
          click: (event) => {
            event.stopPropagation();
            this.#set(removeQuickTool(this.#ids(), tool.id));
          },
        },
      },
      createIcon("close", IconSize.tiny),
    );
    const pinned = pins.includes(tool.id);
    const pin =
      tool.widget === "colour"
        ? null
        : h(
            "button",
            {
              class: `kvfx-qtile__pin${pinned ? " kvfx-qtile__pin--on" : ""}`,
              type: "button",
              title: pinned ? `Unpin ${tool.label}` : `Pin ${tool.label} as a large tile`,
              attrs: { "aria-label": pinned ? `Unpin ${tool.label}` : `Pin ${tool.label}`, "aria-pressed": pinned ? "true" : "false" },
              on: {
                click: (event) => {
                  event.stopPropagation();
                  const session = this.#panel.session;
                  session.setUi("quickPins", togglePin(session.state.settings.ui.quickPins, tool.id));
                },
              },
            },
            createIcon("star", IconSize.tiny),
          );
    const tile = h(
      "div",
      {
        class: `kvfx-qtile kvfx-qtile--edit kvfx-g-${tool.group}${tool.widget === "colour" ? " kvfx-qtile--colour" : ""}${pinned ? " kvfx-qtile--pinned" : ""}`,
        attrs: { tabindex: "0", role: "button", "data-tool": tool.id, "aria-label": `${tool.label}: drag or use the arrow keys to move it, Delete to remove it` },
      },
      face,
      h("span", { text: tool.label }),
      pin,
      remove,
    );
    onPress(tile, (event) => this.#drag(event, tile, tool.id));
    tile.addEventListener("keydown", (event) => this.#keyMove(event, tool.id));
    return tile;
  }

  /**
   * Drag a tile onto another: it takes that tile's place, the ones between
   * shift over. Near the top or bottom of the panel the view scrolls, so a
   * tile can travel the whole grid.
   */
  #drag(event: PointerEvent | MouseEvent, tile: HTMLElement, id: string): void {
    if ((event.target as HTMLElement).closest(".kvfx-qtile__remove, .kvfx-qtile__pin") !== null) return;
    event.preventDefault();
    tile.focus({ preventScroll: true });
    const scroller = tile.closest<HTMLElement>(".kvfx-view");
    const startX = event.clientX;
    const startY = event.clientY;
    const startScroll = scroller?.scrollTop ?? 0;
    const pointer = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let target: HTMLElement | undefined;
    let frame = 0;
    const others = Array.from(this.#grid.querySelectorAll<HTMLElement>(".kvfx-qtile--edit")).filter((t) => t !== tile);
    const place = (): void => {
      const scrolled = (scroller?.scrollTop ?? 0) - startScroll;
      tile.style.transform = `translate(${String(pointer.x - startX)}px, ${String(pointer.y - startY + scrolled)}px)`;
      const over = others.find((t) => {
        const r = t.getBoundingClientRect();
        return pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom;
      });
      if (over !== target) {
        target?.classList.remove("kvfx-qtile--target");
        over?.classList.add("kvfx-qtile--target");
        target = over;
      }
    };
    // While dragging, scroll when the pointer rests near an edge of the view.
    const autoscroll = (): void => {
      frame = 0;
      if (!dragging || scroller === null) return;
      const box = scroller.getBoundingClientRect();
      const step = pointer.y < box.top + EDGE_PX ? -SCROLL_STEP : pointer.y > box.bottom - EDGE_PX ? SCROLL_STEP : 0;
      if (step !== 0) {
        scroller.scrollTop += step;
        place();
      }
      frame = requestAnimationFrame(autoscroll);
    };
    const move = (e: DragPoint): void => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      if (!dragging && Math.hypot(pointer.x - startX, pointer.y - startY) < DRAG_START_PX) return;
      if (!dragging) {
        dragging = true;
        tile.classList.add("kvfx-qtile--dragging");
        frame = requestAnimationFrame(autoscroll);
      }
      place();
    };
    const end = (): void => {
      if (frame !== 0) cancelAnimationFrame(frame);
      dragging = dragging && target !== undefined;
      tile.style.transform = "";
      tile.classList.remove("kvfx-qtile--dragging");
      target?.classList.remove("kvfx-qtile--target");
      const into = target?.dataset["tool"];
      if (dragging && into !== undefined) {
        const ids = this.#ids();
        this.#focusAfter = id;
        this.#set(moveQuickTool(ids, id, ids.indexOf(into)));
      }
    };
    // Heard on the whole window: After Effects on macOS doesn't reliably honour pointer capture.
    followDrag(event, tile, move, end);
  }

  /** Arrow keys move the focused tile — up and down by a row — Delete removes it. */
  #keyMove(event: KeyboardEvent, id: string): void {
    const ids = this.#ids();
    const at = ids.indexOf(id);
    if (at === -1) return;
    const columns = this.#columns();
    const steps: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
    let next: string[] | undefined;
    if (steps[event.key] !== undefined) next = moveQuickTool(ids, id, at + (steps[event.key] ?? 0));
    else if (event.key === "Home") next = moveQuickTool(ids, id, 0);
    else if (event.key === "End") next = moveQuickTool(ids, id, ids.length - 1);
    else if (event.key === "Delete" || event.key === "Backspace") {
      next = removeQuickTool(ids, id);
      this.#focusAfter = ids[at + 1] ?? ids[at - 1];
      event.preventDefault();
      event.stopPropagation();
      this.#set(next);
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    this.#focusAfter = id;
    this.#set(next);
  }

  /** Tiles in the grid's first row. */
  #columns(): number {
    const tiles = Array.from(this.#grid.querySelectorAll<HTMLElement>(".kvfx-qtile"));
    const top = tiles[0]?.offsetTop;
    return Math.max(1, tiles.filter((t) => t.offsetTop === top).length);
  }

  /** Every tool, by group: on is in the grid, a click adds or removes it. */
  #renderCatalog(ids: readonly string[]): void {
    clear(this.#catalog);
    const added = new Set(ids);
    for (const group of QUICK_GROUPS) {
      const chips = QUICK_TOOLS.filter((t) => t.group === group.id).map((tool) => {
        const on = added.has(tool.id);
        return h(
          "button",
          {
            class: `kvfx-qchip${on ? " kvfx-qchip--on" : ""}`,
            type: "button",
            title: on ? `Remove ${tool.label} from the Quick tab` : `Add ${tool.label} to the Quick tab`,
            attrs: { "aria-pressed": on ? "true" : "false", "aria-label": tool.label },
            on: { click: () => this.#set(on ? removeQuickTool(this.#ids(), tool.id) : addQuickTool(this.#ids(), tool.id)) },
          },
          createIcon(on ? "check" : "plus", IconSize.tiny),
          createIcon(tool.icon, IconSize.small),
          h("span", { text: tool.label }),
        );
      });
      this.#catalog.append(h("div", { class: "kvfx-qgroup" }, h("span", { class: "kvfx-field__label", text: group.label }), h("div", { class: "kvfx-qchips" }, ...chips)));
    }
  }

  async #reset(): Promise<void> {
    const ok = await this.#panel.confirm({
      title: "Reset the Quick tab?",
      body: "Its tools and pins go back to the ones it ships with, in their original order.",
      confirmLabel: "Reset tools",
    });
    if (!ok) return;
    this.#set(DEFAULT_QUICK_TOOLS);
    this.#panel.session.setUi("quickPins", [...DEFAULT_QUICK_PINS]);
  }
}

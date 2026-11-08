import { DEFAULT_QUICK_TOOLS, QUICK_GROUPS, QUICK_TOOLS, type QuickTool, addQuickTool, moveQuickTool, quickToolsOf, removeQuickTool } from "@kvfx/core";
import type { Availability, Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { IconSize, createIcon } from "../components/icons.js";
import { type ColorInput, colorInput } from "../ui/color-picker.js";
import { CommandButtons } from "../ui/controls.js";
import { clear, h, toggleClass } from "../ui/dom.js";
import { Eyedroppers } from "../ui/eyedroppers.js";

/**
 * QUICK: the everyday tools from every tab, as one grid of tiles.
 *
 * Minimal on purpose — no sections, no settings in the way: a tile is one
 * click, run with the tool's last-used settings from its own tab. Customize
 * arranges the grid: drag a tile onto another to move it there (or focus it
 * and use the arrow keys), × or Delete removes it, and the catalog under the
 * grid adds any of the others. The panel opens on this tab unless Settings ▸
 * Layout says to return to the last one.
 */

/** How far the pointer moves before a press becomes a drag. */
const DRAG_START_PX = 4;
/** How close to the view's top or bottom a dragged tile starts it scrolling, and how fast. */
const EDGE_PX = 36;
const SCROLL_STEP = 8;

export class QuickView implements View {
  readonly id = "quick";
  readonly label = "Quick";
  readonly icon = "tab-quick";
  readonly root: HTMLElement;
  readonly #panel: Panel;
  readonly #hint: HTMLElement;
  readonly #grid: HTMLElement;
  readonly #editor: HTMLElement;
  readonly #catalog: HTMLElement;
  readonly #labels: HTMLInputElement;
  readonly #customize: HTMLButtonElement;
  #buttons: CommandButtons;
  #eyedroppers: Eyedroppers;
  #colour: ColorInput | undefined;
  #editing = false;
  #key = "";
  #last: { state: SessionState; availability: Availability } | undefined;
  /** A tile to focus once the grid is redrawn, after a keyboard move. */
  #focusAfter: string | undefined;

  constructor(panel: Panel) {
    this.#panel = panel;
    this.#buttons = new CommandButtons(panel);
    this.#eyedroppers = new Eyedroppers(panel);
    const session = panel.session;

    this.#hint = h("p", { class: "kvfx-hint kvfx-qhint", text: "Drag a tile onto another to move it there, or focus it and use the arrow keys. × or Delete removes it." });
    this.#grid = h("div", { class: "kvfx-qgrid", attrs: { role: "group", "aria-label": "Quick tools" } });
    this.#catalog = h("div", { class: "kvfx-qcatalog" });
    this.#labels = h("input", { type: "checkbox", on: { change: () => session.setUi("quickLabels", this.#labels.checked) } });
    const reset = h("button", {
      class: "kvfx-ghost",
      type: "button",
      text: "Reset",
      title: "Put back the tools the Quick tab ships with",
      on: { click: () => void this.#reset() },
    });
    const done = h("button", { class: "kvfx-pill kvfx-primary", type: "button", text: "Done", on: { click: () => this.#toggleEditing() } });
    this.#editor = h(
      "div",
      { class: "kvfx-qeditor" },
      h("div", { class: "kvfx-presets__group", text: "Add or remove tools" }),
      this.#catalog,
      h("div", { class: "kvfx-qoptions" }, h("label", { class: "kvfx-check" }, this.#labels, h("span", { text: "Labels under icons" })), reset, done),
    );
    this.#customize = h(
      "button",
      { class: "kvfx-ghost kvfx-qcustomize", type: "button", title: "Choose and arrange the Quick tab's tools", on: { click: () => this.#toggleEditing() } },
      createIcon("edit", IconSize.small),
      h("span", { text: "Customize" }),
    );
    this.root = h("div", { class: "kvfx-tab kvfx-quicktab" }, this.#hint, this.#grid, h("div", { class: "kvfx-qfoot" }, this.#customize), this.#editor);
  }

  update(state: SessionState, availability: Availability): void {
    this.#last = { state, availability };
    const ui = state.settings.ui;
    const key = `${ui.quickTools.join(",")}|${String(ui.quickLabels)}|${String(this.#editing)}`;
    if (key !== this.#key) {
      this.#key = key;
      this.#render(state);
    }
    this.#buttons.update(state, availability);
    this.#eyedroppers.update(state);
    // The panel's colour can change elsewhere: the header's Solid swatch, Tools ▸ Colour.
    if (this.#colour !== undefined && this.#colour.input.value !== ui.solidColor && !this.#colour.isOpen()) this.#colour.set(ui.solidColor);
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
    clear(this.#grid);
    toggleClass(this.root, "kvfx-quicktab--nolabels", !ui.quickLabels);
    toggleClass(this.root, "kvfx-quicktab--editing", this.#editing);
    this.#hint.hidden = !this.#editing;
    this.#editor.hidden = !this.#editing;
    this.#customize.hidden = this.#editing;
    this.#labels.checked = ui.quickLabels;
    if (tools.length === 0) {
      this.#grid.append(h("p", { class: "kvfx-empty kvfx-qempty", text: "No tools yet. Pick the ones you use most below." }));
    }
    for (const tool of tools) this.#grid.append(this.#editing ? this.#editTile(tool) : this.#tile(tool));
    if (this.#editing) this.#renderCatalog(tools.map((t) => t.id));
    if (this.#focusAfter !== undefined) {
      const id = this.#focusAfter;
      this.#focusAfter = undefined;
      Array.from(this.#grid.querySelectorAll<HTMLElement>("[data-tool]"))
        .find((t) => t.dataset["tool"] === id)
        ?.focus();
    }
  }

  /** A working tile: the colour, an eyedropper, or a command. */
  #tile(tool: QuickTool): HTMLElement {
    if (tool.widget === "colour") {
      const session = this.#panel.session;
      this.#colour = colorInput("Colour", session.state.settings.ui.solidColor, (hex) => session.setUi("solidColor", hex), "kvfx-qtile kvfx-qtile--colour", { showHex: true });
      // The hidden input travels inside the tile, so the grid sees one item.
      this.#colour.swatch.append(this.#colour.input);
      return this.#colour.swatch;
    }
    if (tool.widget === "pickComp") return this.#eyedroppers.comp(this.#plainTile(tool, "Pick a colour from the comp's frame at the playhead"));
    if (tool.widget === "pickScreen") return this.#eyedroppers.screen(this.#plainTile(tool, "Pick a colour from anywhere on your screen"), tool.label);
    return this.#buttons.button(tool.command ?? tool.id, { label: tool.label, icon: tool.icon, variant: "qtile" });
  }

  #plainTile(tool: QuickTool, title: string): HTMLButtonElement {
    return h("button", { class: "kvfx-qtile", type: "button", title, attrs: { "aria-label": tool.label } }, createIcon(tool.icon), h("span", { text: tool.label }));
  }

  /** A tile being arranged: drag it, arrow-key it, or remove it. It runs nothing. */
  #editTile(tool: QuickTool): HTMLElement {
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
    const tile = h(
      "div",
      {
        class: `kvfx-qtile kvfx-qtile--edit${tool.widget === "colour" ? " kvfx-qtile--colour" : ""}`,
        attrs: { tabindex: "0", role: "button", "data-tool": tool.id, "aria-label": `${tool.label}: drag or use the arrow keys to move it, Delete to remove it` },
      },
      face,
      h("span", { text: tool.label }),
      remove,
    );
    tile.addEventListener("pointerdown", (event) => this.#drag(event, tile, tool.id));
    tile.addEventListener("keydown", (event) => this.#keyMove(event, tool.id));
    return tile;
  }

  /**
   * Drag a tile onto another: it takes that tile's place, the ones between
   * shift over. Near the top or bottom of the panel the view scrolls, so a
   * tile can travel the whole grid.
   */
  #drag(event: PointerEvent, tile: HTMLElement, id: string): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".kvfx-qtile__remove") !== null) return;
    event.preventDefault();
    tile.focus({ preventScroll: true });
    tile.setPointerCapture(event.pointerId);
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
    const move = (e: PointerEvent): void => {
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
      tile.removeEventListener("pointermove", move);
      tile.removeEventListener("pointerup", end);
      tile.removeEventListener("pointercancel", end);
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
    tile.addEventListener("pointermove", move);
    tile.addEventListener("pointerup", end);
    tile.addEventListener("pointercancel", end);
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
      body: "Its tools go back to the ones it ships with, in their original order.",
      confirmLabel: "Reset tools",
    });
    if (ok) this.#set(DEFAULT_QUICK_TOOLS);
  }
}

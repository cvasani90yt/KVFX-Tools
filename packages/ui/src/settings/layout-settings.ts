import {
  PANEL_LAYOUTS,
  type PanelLayout,
  type SavedLayout,
  type TabPosition,
  type TabStyle,
  MAX_LAYOUT_NAME,
  currentLayout,
  orderTabs,
  sameLayout,
} from "@kvfx/core";
import type { Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { IconSize, createIcon } from "../components/icons.js";
import { segmented } from "../ui/controls.js";
import { clear, h, setText, toggleClass } from "../ui/dom.js";
import { LayoutStage, type TabInfo, drawLayout } from "./layout-preview.js";

/**
 * Settings ▸ Layout: presets for how the panel is arranged, each shown as a
 * picture of the panel, plus the controls to arrange it by hand and save the
 * result as a preset of your own.
 *
 * Hovering a preset plays it on the large picture — the panel's parts glide
 * from the current layout to the preset's — and clicking applies it. All of
 * it is reversible by picking another layout; deleting a saved one asks.
 */

interface Card {
  readonly root: HTMLButtonElement;
  readonly canvas: HTMLCanvasElement;
  readonly layout: PanelLayout;
}

export class LayoutSettings {
  readonly root: HTMLElement;
  readonly #panel: Panel;
  readonly #tabs: () => readonly View[];
  readonly #stage: LayoutStage;
  readonly #stageName: HTMLElement;
  readonly #stageAbout: HTMLElement;
  readonly #presetCards: Card[] = [];
  readonly #customGrid: HTMLElement;
  readonly #customHead: HTMLElement;
  #customCards: Card[] = [];
  #customKey = "";
  readonly #name: HTMLInputElement;
  readonly #tabStyle: { root: HTMLElement; set: (value: TabStyle) => void };
  readonly #tabPosition: { root: HTMLElement; set: (value: TabPosition) => void };
  readonly #quick: HTMLInputElement;
  readonly #align: HTMLInputElement;
  readonly #compact: HTMLInputElement;
  readonly #tabList: HTMLElement;
  #hover: { layout: PanelLayout; name: string; about: string } | undefined;
  #tabsKey = "";
  #current: PanelLayout | undefined;
  #currentKey = "";

  constructor(panel: Panel, tabs: () => readonly View[]) {
    this.#panel = panel;
    this.#tabs = tabs;
    const session = panel.session;

    const stageCanvas = h("canvas", { class: "kvfx-layoutstage__canvas", attrs: { "aria-hidden": "true" } });
    this.#stage = new LayoutStage(stageCanvas, () => this.#tabInfo());
    this.#stageName = h("strong", { class: "kvfx-layoutstage__name" });
    this.#stageAbout = h("p", { class: "kvfx-hint kvfx-layoutstage__about", attrs: { "aria-live": "polite" } });
    const stage = h("div", { class: "kvfx-layoutstage" }, stageCanvas, h("div", { class: "kvfx-layoutstage__text" }, this.#stageName, this.#stageAbout));

    const presetGrid = h("div", { class: "kvfx-layoutgrid", attrs: { role: "list", "aria-label": "Layout presets" } });
    for (const preset of PANEL_LAYOUTS) {
      const card = this.#card(preset.name, preset.about, preset.layout);
      this.#presetCards.push(card);
      presetGrid.append(card.root);
    }

    this.#customHead = h("h4", { class: "kvfx-layoutlabel", text: "Your layouts" });
    this.#customGrid = h("div", { class: "kvfx-layoutgrid", attrs: { role: "list", "aria-label": "Your layouts" } });
    this.#name = h("input", {
      class: "kvfx-input",
      type: "text",
      attrs: { placeholder: "Name this layout", maxlength: String(MAX_LAYOUT_NAME), "aria-label": "Layout name" },
      on: {
        keydown: (event) => {
          event.stopPropagation();
          if (event.key === "Enter") void this.#save();
        },
      },
    });
    const saveButton = h("button", { class: "kvfx-pill", type: "button", text: "Save current", title: "Save the panel's layout as it is now", on: { click: () => void this.#save() } });

    this.#tabStyle = segmented<TabStyle>(
      [
        { value: "both", label: "Icons + labels" },
        { value: "icons", label: "Icons" },
        { value: "labels", label: "Labels" },
      ],
      "both",
      (value) => session.setUi("tabStyle", value),
    );
    this.#tabPosition = segmented<TabPosition>(
      [
        { value: "top", label: "Top" },
        { value: "bottom", label: "Bottom" },
      ],
      "top",
      (value) => session.setUi("tabPosition", value),
    );
    this.#quick = h("input", { type: "checkbox", on: { change: () => session.setUi("quickBar", this.#quick.checked) } });
    this.#align = h("input", { type: "checkbox", on: { change: () => session.setUi("alignBar", this.#align.checked) } });
    this.#compact = h("input", { type: "checkbox", on: { change: () => session.setUi("compact", this.#compact.checked) } });
    this.#tabList = h("div", { class: "kvfx-sectionlist kvfx-tablist" });

    const line = (label: string, control: HTMLElement): HTMLElement =>
      h("div", { class: "kvfx-layoutline" }, h("span", { class: "kvfx-field__label", text: label }), control);

    this.root = h(
      "div",
      { class: "kvfx-layout" },
      h("p", { class: "kvfx-hint", text: "Hover a layout to see the panel change, click to use it. Pick another any time — nothing inside your tabs is lost." }),
      stage,
      h("h4", { class: "kvfx-layoutlabel", text: "Presets" }),
      presetGrid,
      this.#customHead,
      this.#customGrid,
      h("div", { class: "kvfx-row kvfx-layoutsave" }, this.#name, saveButton),
      h("h4", { class: "kvfx-layoutlabel", text: "Arrange" }),
      line("Tabs show", this.#tabStyle.root),
      line("Tab bar", this.#tabPosition.root),
      h(
        "div",
        { class: "kvfx-checklist" },
        h("label", { class: "kvfx-check" }, this.#quick, h("span", { text: "Anchor grid and creators" })),
        h("label", { class: "kvfx-check" }, this.#align, h("span", { text: "Align bar" })),
        h("label", { class: "kvfx-check" }, this.#compact, h("span", { text: "Compact spacing" })),
      ),
      h("h4", { class: "kvfx-layoutlabel", text: "Tabs" }),
      h("p", { class: "kvfx-hint", text: "Show, hide and reorder the tabs. Hidden tabs' commands stay in search." }),
      this.#tabList,
    );
  }

  /** Called once Settings is on screen: the pictures need their real size. */
  opened(): void {
    requestAnimationFrame(() => {
      for (const card of [...this.#presetCards, ...this.#customCards]) drawLayout(card.canvas, card.layout, this.#tabInfo());
      this.#stage.wake();
    });
  }

  update(state: SessionState): void {
    const ui = state.settings.ui;
    const ids = this.#tabIds();
    const current = currentLayout(ui);
    const key = JSON.stringify(current);
    if (key !== this.#currentKey || this.#current === undefined) {
      this.#currentKey = key;
      this.#current = current;
    }
    this.#renderCustom(ui.customLayouts);
    for (const card of [...this.#presetCards, ...this.#customCards]) {
      const on = sameLayout(card.layout, current, ids);
      toggleClass(card.root, "kvfx-layoutcard--on", on);
      card.root.setAttribute("aria-current", on ? "true" : "false");
    }
    this.#showStage();

    this.#tabStyle.set(ui.tabStyle);
    this.#tabPosition.set(ui.tabPosition);
    this.#quick.checked = ui.quickBar;
    this.#align.checked = ui.alignBar;
    this.#compact.checked = ui.compact;
    this.#renderTabs(state);
  }

  #tabIds(): string[] {
    return this.#tabs().map((t) => t.id);
  }

  #tabInfo(): TabInfo[] {
    return this.#tabs().map((t) => ({ id: t.id, icon: t.icon, label: t.label }));
  }

  /** The large picture: the hovered layout, or the current one. */
  #showStage(): void {
    const current = this.#current;
    if (current === undefined) return;
    if (this.#hover !== undefined) {
      this.#stage.show(this.#hover.layout);
      setText(this.#stageName, this.#hover.name);
      setText(this.#stageAbout, this.#hover.about);
      return;
    }
    this.#stage.show(current);
    const ids = this.#tabIds();
    const match =
      PANEL_LAYOUTS.find((p) => sameLayout(p.layout, current, ids))?.name ??
      this.#panel.session.state.settings.ui.customLayouts.find((l) => sameLayout(l.layout, current, ids))?.name;
    setText(this.#stageName, match === undefined ? "Your current layout" : `Current: ${match}`);
    setText(this.#stageAbout, "Hover a preset to preview it here.");
  }

  #card(name: string, about: string, layout: PanelLayout, onDelete?: () => void): Card {
    const canvas = h("canvas", { class: "kvfx-layoutcard__thumb", attrs: { "aria-hidden": "true" } });
    const root = h(
      "button",
      {
        class: "kvfx-layoutcard",
        type: "button",
        title: about,
        attrs: { role: "listitem", "aria-label": `${name} layout` },
        on: {
          click: () => this.#apply(name, layout),
          mouseenter: () => this.#preview({ layout, name, about }),
          mouseleave: () => this.#preview(undefined),
          focus: () => this.#preview({ layout, name, about }),
          blur: () => this.#preview(undefined),
        },
      },
      canvas,
      h("span", { class: "kvfx-layoutcard__name", text: name }),
    );
    if (onDelete !== undefined) {
      const remove = h(
        "span",
        {
          class: "kvfx-layoutcard__delete",
          title: `Delete “${name}”`,
          attrs: { role: "button", "aria-label": `Delete ${name}`, tabindex: "0" },
          on: {
            click: (event) => {
              event.stopPropagation();
              onDelete();
            },
            keydown: (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onDelete();
            },
          },
        },
        createIcon("close", IconSize.tiny),
      );
      root.append(remove);
    }
    return { root, canvas, layout };
  }

  #preview(hover: { layout: PanelLayout; name: string; about: string } | undefined): void {
    this.#hover = hover;
    this.#showStage();
  }

  #apply(name: string, layout: PanelLayout): void {
    this.#hover = undefined;
    this.#panel.session.applyPanelLayout(layout, this.#tabIds());
    this.#panel.session.report("Layout", true, `${name} layout`);
  }

  #renderCustom(saved: readonly SavedLayout[]): void {
    const key = JSON.stringify(saved);
    if (key === this.#customKey) return;
    this.#customKey = key;
    clear(this.#customGrid);
    this.#customCards = saved.map((entry) => {
      const card = this.#card(entry.name, "A layout you saved", entry.layout, () => void this.#delete(entry.name));
      this.#customGrid.append(card.root);
      return card;
    });
    this.#customHead.hidden = saved.length === 0;
    this.#customGrid.hidden = saved.length === 0;
    if (this.root.isConnected) this.opened();
  }

  async #save(): Promise<void> {
    const name = this.#name.value.trim();
    if (name.length === 0) {
      this.#name.focus();
      return;
    }
    const session = this.#panel.session;
    if (session.state.settings.ui.customLayouts.some((l) => l.name === name)) {
      const ok = await this.#panel.confirm({
        title: `Replace “${name}”?`,
        body: "A saved layout already has this name. It will be replaced with the panel's layout as it is now.",
        confirmLabel: "Replace",
      });
      if (!ok) return;
    }
    session.savePanelLayout(name, this.#tabIds());
    this.#name.value = "";
    session.report("Layout", true, `Saved “${name}”`);
  }

  async #delete(name: string): Promise<void> {
    const ok = await this.#panel.confirm({
      title: `Delete “${name}”?`,
      body: "The saved layout is removed. The panel keeps its current arrangement.",
      confirmLabel: "Delete layout",
      danger: true,
    });
    if (ok) this.#panel.session.deletePanelLayout(name);
  }

  #renderTabs(state: SessionState): void {
    const ui = state.settings.ui;
    const views = this.#tabs();
    const ordered = orderTabs(
      views.map((v) => v.id),
      ui.tabOrder,
    );
    const hidden = new Set(ui.hiddenTabs);
    // Redrawn only when the tabs change, so a click is never lost to a redraw
    // between press and release; the pressed arrow keeps the focus.
    const key = `${ordered.join(",")}#${ui.hiddenTabs.join(",")}`;
    if (key === this.#tabsKey) return;
    this.#tabsKey = key;
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && this.#tabList.contains(active) ? active.getAttribute("aria-label") : null;
    const visibleCount = ordered.filter((id) => !hidden.has(id)).length;
    clear(this.#tabList);
    ordered.forEach((id, i) => {
      const view = views.find((v) => v.id === id);
      if (view === undefined) return;
      const box = h("input", { type: "checkbox", attrs: { "aria-label": `Show ${view.label}` }, on: { change: () => this.#panel.session.toggleHiddenTab(id) } });
      box.checked = !hidden.has(id);
      // Never let the last visible tab be switched off: the panel would be empty.
      box.disabled = box.checked && visibleCount === 1;
      const up = h(
        "button",
        { class: "kvfx-iconbtn kvfx-iconbtn--small", type: "button", title: "Move earlier", attrs: { "aria-label": `Move ${view.label} earlier` }, on: { click: () => this.#panel.session.moveTab(ordered, id, -1) } },
        createIcon("move-up", IconSize.small),
      );
      const down = h(
        "button",
        { class: "kvfx-iconbtn kvfx-iconbtn--small", type: "button", title: "Move later", attrs: { "aria-label": `Move ${view.label} later` }, on: { click: () => this.#panel.session.moveTab(ordered, id, 1) } },
        createIcon("move-down", IconSize.small),
      );
      up.disabled = i === 0;
      down.disabled = i === ordered.length - 1;
      this.#tabList.append(
        h("div", { class: "kvfx-sectionrow" }, h("label", { class: "kvfx-check" }, box, createIcon(view.icon, IconSize.medium), h("span", { text: view.label })), up, down),
      );
    });
    if (focused !== null) {
      const again = Array.from(this.#tabList.querySelectorAll<HTMLElement>("[aria-label]")).find((el) => el.getAttribute("aria-label") === focused);
      if (again !== undefined && !(again instanceof HTMLButtonElement && again.disabled)) again.focus();
    }
  }
}

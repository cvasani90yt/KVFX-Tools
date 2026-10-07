import { AlignEdge, type AlignReference, type Platform, alignCommandIdFor } from "@kvfx/core";
import { IconSize, createIcon } from "../components/icons.js";
import { PaletteOverlay } from "../palette/palette-view.js";
import { SettingsDialog } from "../settings/settings-dialog.js";
import { CommandButtons } from "../ui/controls.js";
import { clear, h, setText, toggleClass } from "../ui/dom.js";
import type { Availability, ConfirmOptions, Panel, View } from "./panel.js";
import type { Session, SessionState } from "./session.js";

/**
 * The panel's frame, built once and updated in place.
 *
 *   header       brand · active comp and selection · RAM meter · search · settings
 *   quick block  anchor-point grid · create Null / Adjustment / Solid ▪ / Text / Shape / Camera
 *   tab bar      one icon per tool tab
 *   view         the active tab
 *   align bar    align, distribute, and what to align against
 *
 * The quick block and align bar stay put whichever tab is open: they are the
 * actions people reach for between every other action.
 */

const GIB = 1_073_741_824;
/** The RAM bar's full scale; see #updateHeader. */
const NOMINAL_GB = 32;
const PERCENT = 100;
/** Above this share the bar turns to the warning colour. */
const HIGH_SHARE = 0.75;
const TOAST_MS = 3200;
const TOAST_ERROR_MS = 6000;

const ANCHORS: readonly { id: string; icon: string; label: string }[] = [
  { id: "kvfx.anchor.topleft", icon: "arrow-nw", label: "Anchor top left" },
  { id: "kvfx.anchor.topcentre", icon: "arrow-n", label: "Anchor top centre" },
  { id: "kvfx.anchor.topright", icon: "arrow-ne", label: "Anchor top right" },
  { id: "kvfx.anchor.middleleft", icon: "arrow-w", label: "Anchor middle left" },
  { id: "kvfx.anchor.centre", icon: "arrow-c", label: "Anchor centre" },
  { id: "kvfx.anchor.middleright", icon: "arrow-e", label: "Anchor middle right" },
  { id: "kvfx.anchor.bottomleft", icon: "arrow-sw", label: "Anchor bottom left" },
  { id: "kvfx.anchor.bottomcentre", icon: "arrow-s", label: "Anchor bottom centre" },
  { id: "kvfx.anchor.bottomright", icon: "arrow-se", label: "Anchor bottom right" },
];

const ALIGN: readonly { edge: AlignEdge; icon: string; label: string }[] = [
  { edge: AlignEdge.Left, icon: "align-left", label: "Align left" },
  { edge: AlignEdge.CentreX, icon: "align-center-h", label: "Align horizontal centre" },
  { edge: AlignEdge.Right, icon: "align-right", label: "Align right" },
  { edge: AlignEdge.Top, icon: "align-top", label: "Align top" },
  { edge: AlignEdge.CentreY, icon: "align-center-v", label: "Align vertical centre" },
  { edge: AlignEdge.Bottom, icon: "align-bottom", label: "Align bottom" },
];

const REFERENCE_LABEL: Record<AlignReference, { short: string; long: string }> = {
  auto: { short: "Auto", long: "the composition for one layer, the selection for several" },
  composition: { short: "Comp", long: "the composition" },
  selection: { short: "Sel", long: "the selection's bounds" },
};

export class Shell implements Panel {
  readonly session: Session;
  readonly root: HTMLElement;
  readonly #views: readonly View[];
  readonly #buttons: CommandButtons;
  readonly #palette: PaletteOverlay;
  readonly #settings: SettingsDialog;
  readonly #viewHost: HTMLElement;
  readonly #tabBar: HTMLElement;
  readonly #tabButtons = new Map<string, HTMLButtonElement>();
  readonly #context: HTMLButtonElement;
  readonly #ram: HTMLButtonElement;
  readonly #ramMenu: HTMLElement;
  readonly #banner: HTMLElement;
  readonly #toast: HTMLElement;
  readonly #modal: HTMLElement;
  readonly #solidSwatch: HTMLInputElement;
  readonly #reference: HTMLButtonElement;
  #activeView: View | undefined;
  #toastTimer: ReturnType<typeof setTimeout> | undefined;
  #lastToast = 0;

  constructor(session: Session, platform: Platform, makeViews: (panel: Panel) => readonly View[]) {
    this.session = session;
    this.#buttons = new CommandButtons(this);
    this.#palette = new PaletteOverlay(this, platform);
    this.#settings = new SettingsDialog(this);

    // --- header ------------------------------------------------------------
    this.#context = h("button", {
      class: "kvfx-context",
      type: "button",
      title: "Refresh — the panel re-reads the selection whenever it gains focus",
      on: { click: () => void session.refreshSelection() },
    });
    this.#ram = h(
      "button",
      {
        class: "kvfx-ram",
        type: "button",
        title: "Memory After Effects is using — click to purge",
        on: { click: () => this.#toggleRamMenu() },
      },
      createIcon("memory", IconSize.medium),
      h("span", { class: "kvfx-ram__value", text: "—" }),
      h("span", { class: "kvfx-ram__bar" }, h("span", { class: "kvfx-ram__fill" })),
    );
    this.#ramMenu = h(
      "div",
      { class: "kvfx-menu", attrs: { role: "menu" } },
      h("button", {
        class: "kvfx-menu__item",
        type: "button",
        text: "Purge image caches",
        title: "Frees rendered frames. Undo history is kept.",
        on: { click: () => {
          this.#closeRamMenu();
          void session.purge("image");
        } },
      }),
      h("button", {
        class: "kvfx-menu__item kvfx-danger",
        type: "button",
        text: "Purge everything…",
        title: "Also clears After Effects' undo history",
        on: { click: () => void this.#purgeAll() },
      }),
    );
    this.#ramMenu.hidden = true;

    const header = h(
      "header",
      { class: "kvfx-header" },
      h("div", { class: "kvfx-brand", title: "KVFX Tools" }, h("span", { class: "kvfx-brand__mark" }), h("span", { class: "kvfx-brand__name", text: "KVFX" })),
      this.#context,
      h("div", { class: "kvfx-ram-wrap" }, this.#ram, this.#ramMenu),
      h("button", { class: "kvfx-iconbtn", type: "button", title: "Search every command (Ctrl/⌘ + Space)", attrs: { "aria-label": "Search commands" }, on: { click: () => this.openPalette() } }, createIcon("search")),
      h("button", { class: "kvfx-iconbtn", type: "button", title: "Settings", attrs: { "aria-label": "Settings" }, on: { click: () => this.openSettings() } }, createIcon("gear")),
    );

    // --- quick block -----------------------------------------------------
    const anchorGrid = h(
      "div",
      { class: "kvfx-anchors", attrs: { "aria-label": "Move anchor point" } },
      ...ANCHORS.map((a) => this.#buttons.button(a.id, { label: a.label, icon: a.icon, variant: "tool", className: "kvfx-anchor" })),
    );
    this.#solidSwatch = h("input", {
      class: "kvfx-swatch kvfx-swatch--inline",
      type: "color",
      title: "Solid colour",
      attrs: { value: session.state.settings.ui.solidColor, "aria-label": "Solid colour" },
      on: { input: () => session.setUi("solidColor", this.#solidSwatch.value.toLowerCase()) },
    });
    // No icon: the swatch beside it already says "solid, this colour".
    const solid = this.#buttons.button("kvfx.layer.createsolid", {
      label: "Solid",
      params: () => ({ color: this.#solidSwatch.value }),
    });
    const creators = h(
      "div",
      { class: "kvfx-creators" },
      this.#buttons.button("kvfx.layer.createnull", { label: "Null", icon: "null" }),
      this.#buttons.button("kvfx.layer.createadjustment", { label: "Adjust", icon: "adjustment" }),
      h("div", { class: "kvfx-solid" }, solid, this.#solidSwatch),
      this.#buttons.button("kvfx.layer.createtext", { label: "Text", icon: "text" }),
      this.#buttons.button("kvfx.layer.createshape", { label: "Shape", icon: "shape" }),
      this.#buttons.button("kvfx.layer.createcamera", { label: "Camera", icon: "camera" }),
    );
    const quick = h("section", { class: "kvfx-quick" }, anchorGrid, creators);

    // --- tabs and views --------------------------------------------------
    this.#views = makeViews(this);
    this.#settings.setTabs(this.#views);
    this.#tabBar = h("nav", { class: "kvfx-tabbar", attrs: { role: "tablist" } });
    for (const view of this.#views) {
      const button = h(
        "button",
        {
          class: "kvfx-tabbtn",
          type: "button",
          title: view.label,
          attrs: { role: "tab", "aria-label": view.label },
          on: { click: () => session.setActiveTab(view.id) },
        },
        createIcon(view.icon, IconSize.regular),
        h("span", { class: "kvfx-tabbtn__label", text: view.label }),
      );
      this.#tabButtons.set(view.id, button);
      this.#tabBar.append(button);
    }
    this.#banner = h("div", { class: "kvfx-banner" });
    this.#viewHost = h("main", { class: "kvfx-view" });

    // --- align bar -------------------------------------------------------
    const alignTools = h("div", { class: "kvfx-alignbar__tools" });
    for (const spec of ALIGN) {
      const id = (): string =>
        alignCommandIdFor(spec.edge, this.session.state.settings.ui.alignReference as AlignReference);
      alignTools.append(this.#buttons.button(id, { label: spec.label, icon: spec.icon, variant: "tool" }));
    }
    alignTools.append(
      h("span", { class: "kvfx-divider" }),
      this.#buttons.button("kvfx.align.distribute.horizontal", { label: "Distribute horizontally", icon: "distribute-h", variant: "tool" }),
      this.#buttons.button("kvfx.align.distribute.vertical", { label: "Distribute vertically", icon: "distribute-v", variant: "tool" }),
    );
    // One compact button that cycles, so the whole bar fits on one row at 260px.
    this.#reference = h("button", {
      class: "kvfx-cycle",
      type: "button",
      on: {
        click: () => {
          const order: readonly AlignReference[] = ["auto", "composition", "selection"];
          const current = order.indexOf(session.state.settings.ui.alignReference as AlignReference);
          session.setAlignReference(order[(current + 1) % order.length] ?? "auto");
        },
      },
    });
    const alignBar = h("footer", { class: "kvfx-alignbar" }, alignTools, this.#reference);

    this.#toast = h("div", { class: "kvfx-toast", attrs: { role: "status", "aria-live": "polite" } });
    this.#toast.hidden = true;
    // Confirmations can be raised from inside Settings, so they sit above it.
    this.#modal = h("div", { class: "kvfx-overlay kvfx-overlay--confirm" });
    this.#modal.hidden = true;

    this.root = h(
      "div",
      { class: "kvfx-app" },
      header,
      quick,
      this.#tabBar,
      this.#banner,
      this.#viewHost,
      alignBar,
      this.#toast,
      this.#modal,
      this.#palette.root,
      this.#settings.root,
    );

    document.addEventListener("mousedown", (event) => {
      if (!this.#ramMenu.hidden && !this.#ram.parentElement?.contains(event.target as Node)) this.#closeRamMenu();
    });
  }

  // -------------------------------------------------------------------------
  // Panel
  // -------------------------------------------------------------------------

  openPalette(): void {
    this.#palette.open();
  }

  get paletteOpen(): boolean {
    return this.#palette.isOpen;
  }

  closeOverlays(): boolean {
    if (this.#palette.isOpen) {
      this.#palette.close();
      return true;
    }
    if (this.#settings.isOpen) {
      this.#settings.close();
      return true;
    }
    if (!this.#ramMenu.hidden) {
      this.#closeRamMenu();
      return true;
    }
    return false;
  }

  openSettings(): void {
    this.#settings.open();
  }

  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const finish = (answer: boolean): void => {
        this.#modal.hidden = true;
        clear(this.#modal);
        document.removeEventListener("keydown", onKey, true);
        resolve(answer);
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      };
      const confirmButton = h("button", {
        class: `kvfx-wide${options.danger === true ? " kvfx-danger" : " kvfx-primary"}`,
        type: "button",
        text: options.confirmLabel,
        on: { click: () => finish(true) },
      });
      clear(this.#modal);
      this.#modal.append(
        h(
          "div",
          { class: "kvfx-dialog", attrs: { role: "alertdialog", "aria-label": options.title } },
          h("h2", { class: "kvfx-dialog__title", text: options.title }),
          h("p", { class: "kvfx-dialog__body", text: options.body }),
          h(
            "div",
            { class: "kvfx-dialog__actions" },
            h("button", { class: "kvfx-wide", type: "button", text: "Cancel", on: { click: () => finish(false) } }),
            confirmButton,
          ),
        ),
      );
      this.#modal.hidden = false;
      document.addEventListener("keydown", onKey, true);
      // Cancel is the safe default, but the user asked for this action.
      confirmButton.focus();
    });
  }

  // -------------------------------------------------------------------------
  // RAM meter
  // -------------------------------------------------------------------------

  #toggleRamMenu(): void {
    if (this.#ramMenu.hidden) {
      this.#ramMenu.hidden = false;
      void this.session.refreshMemory();
    } else this.#closeRamMenu();
  }

  #closeRamMenu(): void {
    this.#ramMenu.hidden = true;
  }

  async #purgeAll(): Promise<void> {
    this.#closeRamMenu();
    const ok = await this.confirm({
      title: "Purge everything?",
      body: "This frees all of After Effects' memory caches — and its undo history. You will not be able to undo anything you did before the purge.",
      confirmLabel: "Purge everything",
      danger: true,
    });
    if (ok) await this.session.purge("all");
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(state: SessionState): void {
    const availability: Availability = this.session.availability();
    this.#buttons.update(state, availability);
    this.#updateHeader(state);
    this.#updateTabs(state);
    this.#updateAlign(state);
    this.#updateToast(state);

    const solidHex = state.settings.ui.solidColor;
    if (this.#solidSwatch.value.toLowerCase() !== solidHex && document.activeElement !== this.#solidSwatch) {
      this.#solidSwatch.value = solidHex;
    }

    this.#activeView?.update(state, availability);
    this.#palette.refresh();
    this.#settings.update(state);
  }

  #updateHeader(state: SessionState): void {
    const { snapshot, connection } = state;
    let label: string;
    if (connection.status === "checking") label = "Connecting…";
    else if (connection.status !== "connected") label = "Not connected";
    else if (!snapshot.hasProject) label = "No project";
    else if (snapshot.comp === undefined) label = "No composition";
    else {
      const count = snapshot.layers.length;
      label = `${snapshot.comp.name} · ${count === 0 ? "no selection" : count === 1 ? "1 layer" : `${String(count)} layers`}`;
    }
    setText(this.#context, label);

    const value = this.#ram.querySelector(".kvfx-ram__value");
    const fill = this.#ram.querySelector<HTMLElement>(".kvfx-ram__fill");
    if (value !== null) setText(value, state.memoryBytes === undefined ? "—" : `${(state.memoryBytes / GIB).toFixed(1)} GB`);
    if (fill !== null) {
      // After Effects reports what it uses, not what the machine has, so the
      // bar is scaled to a nominal 32 GB rather than pretending to be a total.
      const share = state.memoryBytes === undefined ? 0 : Math.min(1, state.memoryBytes / (NOMINAL_GB * GIB));
      fill.style.width = `${(share * PERCENT).toFixed(1)}%`;
      toggleClass(this.#ram, "kvfx-ram--high", share > HIGH_SHARE);
    }
  }

  #updateTabs(state: SessionState): void {
    const hidden = new Set(state.settings.ui.hiddenTabs);
    const visible = this.#views.filter((view) => !hidden.has(view.id));
    const fallback = visible[0] ?? this.#views[0];
    const active = visible.find((view) => view.id === state.settings.ui.activeTab) ?? fallback;

    for (const view of this.#views) {
      const button = this.#tabButtons.get(view.id);
      if (button === undefined) continue;
      button.hidden = hidden.has(view.id);
      const on = view === active;
      toggleClass(button, "kvfx-tabbtn--on", on);
      button.setAttribute("aria-selected", on ? "true" : "false");
    }

    if (active !== undefined && active !== this.#activeView) {
      this.#activeView = active;
      clear(this.#viewHost);
      this.#viewHost.append(active.root);
      this.#viewHost.scrollTop = 0;
      active.shown?.();
    }

    // Disconnected: say so once, above the tools, instead of on every button.
    let message = "";
    if (state.connection.status === "no-host") message = state.connection.message;
    else if (state.connection.status === "failed") {
      message = "KVFX Tools couldn't reach After Effects. Reopen the panel from Window ▸ Extensions.";
    }
    setText(this.#banner, message);
    this.#banner.hidden = message.length === 0;
  }

  #updateAlign(state: SessionState): void {
    const reference = state.settings.ui.alignReference as AlignReference;
    setText(this.#reference, REFERENCE_LABEL[reference].short);
    this.#reference.title = `Align to: ${REFERENCE_LABEL[reference].long} — click to change`;
  }

  #updateToast(state: SessionState): void {
    const outcome = state.lastOutcome;
    if (outcome === undefined || outcome.serial === this.#lastToast) return;
    this.#lastToast = outcome.serial;
    clear(this.#toast);
    this.#toast.append(
      createIcon(outcome.ok ? "check" : "warning", IconSize.medium),
      h("span", { class: "kvfx-toast__title", text: outcome.title }),
      h("span", { class: "kvfx-toast__msg", text: outcome.message }),
    );
    toggleClass(this.#toast, "kvfx-toast--error", !outcome.ok);
    this.#toast.hidden = false;
    if (this.#toastTimer !== undefined) clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => {
      this.#toast.hidden = true;
    }, outcome.ok ? TOAST_MS : TOAST_ERROR_MS);
  }
}

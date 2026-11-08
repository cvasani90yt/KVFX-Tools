import { PRODUCT_VERSION, SAVE_REMINDER_MINUTES } from "@kvfx/core";
import type { Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { IconSize, createIcon } from "../components/icons.js";
import { clear, h, setText } from "../ui/dom.js";
import { LayoutSettings } from "./layout-settings.js";

type SectionsProvider = () => { view: View; sections: { id: string; title: string }[] }[];

/**
 * Settings: the panel's layout (presets, tab order and visibility, the bars),
 * which sections show and in what order, display options, the save reminder,
 * where pasted media goes, diagnostics, reset.
 *
 * Everything here is a preference the user can change back; the one
 * irreversible action, resetting, asks first.
 */

export class SettingsDialog {
  readonly root: HTMLElement;
  readonly #panel: Panel;
  readonly #layout: LayoutSettings;
  readonly #mediaProject: HTMLInputElement;
  readonly #mediaAppData: HTMLInputElement;
  readonly #diagnostics: HTMLElement;
  #tabs: readonly View[] = [];
  #open = false;
  readonly #sections: SectionsProvider;
  readonly #sectionList: HTMLElement;
  readonly #tooltips: HTMLInputElement;
  readonly #reminder: HTMLSelectElement;
  #sectionsKey = "";
  /** Tabs whose section list is unfolded, kept across redraws. */
  readonly #openGroups = new Set<string>();

  constructor(panel: Panel, sections: SectionsProvider = () => []) {
    this.#panel = panel;
    this.#sections = sections;
    const session = panel.session;
    this.#layout = new LayoutSettings(panel, () => this.#tabs);
    this.#sectionList = h("div", { class: "kvfx-sectionlist" });
    this.#tooltips = h("input", { type: "checkbox", on: { change: () => session.setUi("tooltips", this.#tooltips.checked) } });
    this.#reminder = h("select", {
      class: "kvfx-input kvfx-select",
      attrs: { "aria-label": "Save reminder" },
      on: { change: () => session.setUi("saveReminder", Number(this.#reminder.value) || 0) },
    });
    for (const minutes of SAVE_REMINDER_MINUTES) {
      this.#reminder.append(h("option", { text: minutes === 0 ? "Off" : `After ${String(minutes)} min without saving`, attrs: { value: String(minutes) } }));
    }

    const radio = (value: "project" | "appData", label: string, detail: string): HTMLInputElement => {
      const input = h("input", {
        type: "radio",
        attrs: { name: "kvfx-media-target", value },
        on: { change: () => session.setUi("mediaTarget", value) },
      });
      this.#mediaChoices.append(
        h("label", { class: "kvfx-choice" }, input, h("span", {}, h("strong", { text: label }), h("small", { text: detail }))),
      );
      return input;
    };
    this.#mediaProject = radio("project", "Beside the project", "A “KVFX Media” folder next to the saved .aep, so the project stays portable.");
    this.#mediaAppData = radio("appData", "KVFX app data", "Your user application-data folder. Used anyway while the project is unsaved.");

    this.#diagnostics = h("pre", { class: "kvfx-diagnostics" });

    const dialog = h(
      "div",
      { class: "kvfx-dialog kvfx-dialog--wide", attrs: { role: "dialog", "aria-label": "Settings" } },
      h(
        "div",
        { class: "kvfx-dialog__head" },
        h("h2", { class: "kvfx-dialog__title", text: "Settings" }),
        h("button", { class: "kvfx-iconbtn", type: "button", title: "Close", attrs: { "aria-label": "Close" }, on: { click: () => this.close() } }, createIcon("close")),
      ),
      h("h3", { class: "kvfx-dialog__sub", text: "Layout" }),
      this.#layout.root,
      h("h3", { class: "kvfx-dialog__sub", text: "Sections" }),
      h("p", { class: "kvfx-hint", text: "Show, hide and reorder the sections inside each tab." }),
      this.#sectionList,
      h("h3", { class: "kvfx-dialog__sub", text: "Display" }),
      h(
        "div",
        { class: "kvfx-checklist" },
        h("label", { class: "kvfx-check" }, this.#tooltips, h("span", { text: "Tooltips on hover" })),
      ),
      h("h3", { class: "kvfx-dialog__sub", text: "Save reminder" }),
      h("p", { class: "kvfx-hint", text: "A Save button appears in the header when the project hasn't been saved for a while." }),
      this.#reminder,
      h("h3", { class: "kvfx-dialog__sub", text: "Pasted and dropped media" }),
      this.#mediaChoices,
      h("h3", { class: "kvfx-dialog__sub", text: "Diagnostics" }),
      this.#diagnostics,
      h(
        "div",
        { class: "kvfx-dialog__actions" },
        h("button", {
          class: "kvfx-wide kvfx-danger",
          type: "button",
          text: "Reset all…",
          title: "Restore every preference to its default",
          on: { click: () => void this.#reset() },
        }),
        h("button", { class: "kvfx-wide kvfx-primary", type: "button", text: "Done", on: { click: () => this.close() } }),
      ),
    );
    this.root = h("div", { class: "kvfx-overlay", on: { mousedown: (e) => {
      if (e.target === this.root) this.close();
    } } }, dialog);
    this.root.hidden = true;
  }

  readonly #mediaChoices: HTMLElement = h("div", { class: "kvfx-choices" });

  get isOpen(): boolean {
    return this.#open;
  }

  setTabs(tabs: readonly View[]): void {
    this.#tabs = tabs;
  }

  open(): void {
    this.#open = true;
    this.root.hidden = false;
    this.update(this.#panel.session.state);
    this.#layout.opened();
  }

  close(): void {
    this.#open = false;
    this.root.hidden = true;
  }

  update(state: SessionState): void {
    if (!this.#open) return;
    this.#layout.update(state);
    this.#tooltips.checked = state.settings.ui.tooltips;
    this.#reminder.value = String(state.settings.ui.saveReminder);
    this.#renderSections(state);

    this.#mediaProject.checked = state.settings.ui.mediaTarget === "project";
    this.#mediaAppData.checked = state.settings.ui.mediaTarget === "appData";

    const c = state.connection;
    const lines = [
      `KVFX Tools ${PRODUCT_VERSION}`,
      c.status === "connected"
        ? `After Effects ${c.facts.aeVersion} (${c.facts.aeLanguage}) · host ${c.facts.hostBundleVersion} · ${String(c.roundTripMs)} ms`
        : `Host: ${c.status}`,
      c.status === "connected" ? `${c.facts.os} · ExtendScript ${c.facts.engineVersion}` : "",
      `Settings file: ${this.#panel.session.settingsLocation}`,
      ...state.notices.map((n) => `Note: ${n}`),
    ].filter((line) => line.length > 0);
    setText(this.#diagnostics, lines.join("\n"));
  }

  #renderSections(state: SessionState): void {
    const ui = state.settings.ui;
    const groups = this.#sections();
    const key = `${groups.map((g) => g.sections.map((x) => x.id).join(",")).join("|")}#${ui.hiddenSections.join(",")}#${ui.sectionOrder.join(",")}`;
    if (key === this.#sectionsKey) return;
    this.#sectionsKey = key;
    // The list is rebuilt after every move: keep unfolded tabs unfolded and the
    // pressed arrow focused, so moving a section several places is several clicks.
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && this.#sectionList.contains(active) ? active.getAttribute("aria-label") : null;
    clear(this.#sectionList);
    const hidden = new Set(ui.hiddenSections);
    const placed = new Set(ui.sectionOrder);
    for (const { view, sections } of groups) {
      if (sections.length === 0) continue;
      // The order as the panel shows it at the moment of the click, never the order this list was drawn with.
      const siblings = (): string[] => this.#sections().find((g) => g.view.id === view.id)?.sections.map((x) => x.id) ?? sections.map((x) => x.id);
      const rows = sections.map((section, i) => {
        const box = h("input", { type: "checkbox", attrs: { "aria-label": `Show ${section.title}` }, on: { change: () => this.#panel.session.toggleSection(section.id) } });
        box.checked = !hidden.has(section.id);
        const up = h("button", { class: "kvfx-iconbtn kvfx-iconbtn--small", type: "button", title: "Move up", attrs: { "aria-label": `Move ${section.title} up` }, on: { click: () => this.#panel.session.moveSection(siblings(), section.id, -1) } }, createIcon("move-up", IconSize.small));
        const down = h("button", { class: "kvfx-iconbtn kvfx-iconbtn--small", type: "button", title: "Move down", attrs: { "aria-label": `Move ${section.title} down` }, on: { click: () => this.#panel.session.moveSection(siblings(), section.id, 1) } }, createIcon("move-down", IconSize.small));
        up.disabled = i === 0;
        down.disabled = i === sections.length - 1;
        return h("div", { class: "kvfx-sectionrow" }, h("label", { class: "kvfx-check" }, box, h("span", { text: section.title })), up, down);
      });
      const reset = h("button", {
        class: "kvfx-ghost kvfx-sectiongroup__reset",
        type: "button",
        text: "Default order",
        title: `Put ${view.label}'s sections back in their original order`,
        attrs: { "aria-label": `Default order for ${view.label}` },
        on: { click: () => this.#panel.session.resetSectionOrder(sections.map((x) => x.id)) },
      });
      reset.disabled = !sections.some((x) => placed.has(x.id));
      const group = h("details", { class: "kvfx-sectiongroup" }, h("summary", { text: view.label }), ...rows, reset);
      group.open = this.#openGroups.has(view.id);
      group.addEventListener("toggle", () => {
        if (group.open) this.#openGroups.add(view.id);
        else this.#openGroups.delete(view.id);
      });
      this.#sectionList.append(group);
    }
    if (focused !== null) {
      const again = Array.from(this.#sectionList.querySelectorAll<HTMLButtonElement>("button[aria-label]")).find((el) => el.getAttribute("aria-label") === focused);
      if (again !== undefined && !again.disabled) again.focus();
    }
  }

  async #reset(): Promise<void> {
    const ok = await this.#panel.confirm({
      title: "Reset all settings?",
      body: "Favourites, usage history, saved curves, library folders and every tool's last values go back to their defaults. Your projects are not touched.",
      confirmLabel: "Reset settings",
      danger: true,
    });
    if (ok) {
      this.#panel.session.resetSettings();
      this.#panel.session.report("Settings", true, "Restored defaults");
    }
  }
}

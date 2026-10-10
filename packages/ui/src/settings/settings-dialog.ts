import { PRODUCT_VERSION, SAVE_REMINDER_MINUTES } from "@kvfx/core";
import type { Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { IconSize, createIcon } from "../components/icons.js";
import { clear, h, setText } from "../ui/dom.js";

type SectionsProvider = () => { view: View; sections: { id: string; title: string }[] }[];

/**
 * Settings: which tabs and sections show and in what order, display options,
 * the save reminder, where pasted media goes, diagnostics, reset.
 *
 * Everything here is a preference the user can change back; the one
 * irreversible action, resetting, asks first.
 */

export class SettingsDialog {
  readonly root: HTMLElement;
  readonly #panel: Panel;
  readonly #tabList: HTMLElement;
  readonly #mediaProject: HTMLInputElement;
  readonly #mediaAppData: HTMLInputElement;
  readonly #diagnostics: HTMLElement;
  #tabs: readonly View[] = [];
  #open = false;
  readonly #sections: SectionsProvider;
  readonly #sectionList: HTMLElement;
  readonly #tooltips: HTMLInputElement;
  readonly #compact: HTMLInputElement;
  readonly #reminder: HTMLSelectElement;
  #sectionsKey = "";

  constructor(panel: Panel, sections: SectionsProvider = () => []) {
    this.#panel = panel;
    this.#sections = sections;
    const session = panel.session;
    this.#tabList = h("div", { class: "kvfx-checklist" });
    this.#sectionList = h("div", { class: "kvfx-sectionlist" });
    this.#tooltips = h("input", { type: "checkbox", on: { change: () => session.setUi("tooltips", this.#tooltips.checked) } });
    this.#compact = h("input", { type: "checkbox", on: { change: () => session.setUi("compact", this.#compact.checked) } });
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
      h("h3", { class: "kvfx-dialog__sub", text: "Tabs" }),
      h("p", { class: "kvfx-hint", text: "Hide the tabs you don't use. Their commands stay in search." }),
      this.#tabList,
      h("h3", { class: "kvfx-dialog__sub", text: "Sections" }),
      h("p", { class: "kvfx-hint", text: "Show, hide and reorder the sections inside each tab." }),
      this.#sectionList,
      h("h3", { class: "kvfx-dialog__sub", text: "Display" }),
      h(
        "div",
        { class: "kvfx-checklist" },
        h("label", { class: "kvfx-check" }, this.#tooltips, h("span", { text: "Tooltips on hover" })),
        h("label", { class: "kvfx-check" }, this.#compact, h("span", { text: "Compact spacing" })),
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
  }

  close(): void {
    this.#open = false;
    this.root.hidden = true;
  }

  update(state: SessionState): void {
    if (!this.#open) return;
    const hidden = new Set(state.settings.ui.hiddenTabs);
    clear(this.#tabList);
    for (const tab of this.#tabs) {
      const box = h("input", {
        type: "checkbox",
        on: { change: () => this.#panel.session.toggleHiddenTab(tab.id) },
      });
      box.checked = !hidden.has(tab.id);
      // Never let the last visible tab be switched off: the panel would be empty.
      box.disabled = box.checked && this.#tabs.filter((t) => !hidden.has(t.id)).length === 1;
      this.#tabList.append(h("label", { class: "kvfx-check" }, box, createIcon(tab.icon, IconSize.medium), h("span", { text: tab.label })));
    }

    this.#tooltips.checked = state.settings.ui.tooltips;
    this.#compact.checked = state.settings.ui.compact;
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
    const key = `${groups.map((g) => g.sections.map((x) => x.id).join(",")).join("|")}#${ui.hiddenSections.join(",")}`;
    if (key === this.#sectionsKey) return;
    this.#sectionsKey = key;
    clear(this.#sectionList);
    const hidden = new Set(ui.hiddenSections);
    for (const { view, sections } of groups) {
      if (sections.length === 0) continue;
      const ids = sections.map((x) => x.id);
      const rows = sections.map((section, i) => {
        const box = h("input", { type: "checkbox", attrs: { "aria-label": `Show ${section.title}` }, on: { change: () => this.#panel.session.toggleSection(section.id) } });
        box.checked = !hidden.has(section.id);
        const up = h("button", { class: "kvfx-iconbtn kvfx-iconbtn--small", type: "button", title: "Move up", attrs: { "aria-label": `Move ${section.title} up` }, on: { click: () => this.#panel.session.moveSection(ids, section.id, -1) } }, createIcon("move-up", IconSize.small));
        const down = h("button", { class: "kvfx-iconbtn kvfx-iconbtn--small", type: "button", title: "Move down", attrs: { "aria-label": `Move ${section.title} down` }, on: { click: () => this.#panel.session.moveSection(ids, section.id, 1) } }, createIcon("move-down", IconSize.small));
        up.disabled = i === 0;
        down.disabled = i === sections.length - 1;
        return h("div", { class: "kvfx-sectionrow" }, h("label", { class: "kvfx-check" }, box, h("span", { text: section.title })), up, down);
      });
      this.#sectionList.append(h("details", { class: "kvfx-sectiongroup" }, h("summary", { text: view.label }), ...rows));
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

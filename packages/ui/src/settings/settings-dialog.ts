import { PRODUCT_VERSION } from "@kvfx/core";
import type { Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { IconSize, createIcon } from "../components/icons.js";
import { clear, h, setText } from "../ui/dom.js";

/**
 * Settings: which tabs show, where pasted media goes, diagnostics, reset.
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

  constructor(panel: Panel) {
    this.#panel = panel;
    const session = panel.session;
    this.#tabList = h("div", { class: "kvfx-checklist" });

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

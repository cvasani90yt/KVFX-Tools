import { LABEL_COLORS, labelKey } from "@kvfx/core";
import type { Availability, Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { CommandButtons, Section, hint } from "../ui/controls.js";
import { h, setText } from "../ui/dom.js";

/**
 * LABELS: colour the selected layers, or select every layer sharing a label.
 */

export class LabelsView implements View {
  readonly id = "labels";
  readonly label = "Labels";
  readonly icon = "tab-labels";
  readonly root: HTMLElement;
  readonly #buttons: CommandButtons;
  readonly #section: Section;
  readonly #current: HTMLElement;

  constructor(panel: Panel) {
    this.#buttons = new CommandButtons(panel);

    const swatches = h("div", { class: "kvfx-labels" });
    for (const label of LABEL_COLORS) {
      const button = this.#buttons.button(`kvfx.label.${labelKey(label.name)}`, { label: label.name, className: "kvfx-label" });
      button.style.setProperty("--kvfx-label", label.hex);
      swatches.append(button);
    }
    this.#current = h("p", { class: "kvfx-hint" });

    this.#section = new Section(panel, "labels.colour", "Label Colour");
    this.#section.body.append(
      swatches,
      h(
        "div",
        { class: "kvfx-actions" },
        this.#buttons.button("kvfx.label.none", { label: "No Label", variant: "wide" }),
        this.#buttons.button("kvfx.label.selectsame", { label: "Select Same", icon: "select", variant: "wide" }),
      ),
      this.#current,
      hint("Colours shown are After Effects' defaults; yours may differ if you changed them in Preferences ▸ Labels."),
    );
    this.root = h("div", { class: "kvfx-tab" }, this.#section.root);
  }

  update(state: SessionState, availability: Availability): void {
    this.#section.update(state);
    this.#buttons.update(state, availability);
    const labels = [...new Set(state.snapshot.layers.map((l) => l.label))];
    const names = labels.map((n) => (n === 0 ? "None" : (LABEL_COLORS.find((l) => l.index === n)?.name ?? String(n))));
    setText(this.#current, state.snapshot.layers.length === 0 ? "" : `Selected: ${names.join(", ")}`);
  }
}

import { QUICK_EFFECTS, type JsonObject } from "@kvfx/core";
import type { Availability, Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { IconSize, createIcon } from "../components/icons.js";
import { CommandButtons, Section, actionButton, hint, pillGrid } from "../ui/controls.js";
import { clear, h, setEnabled } from "../ui/dom.js";

/**
 * FX: add common effects in one click, and manage what is already on the
 * selected layers — switch effects on and off, or remove them.
 *
 * The list is an explicit scan, not a live mirror: reading every effect on
 * every refresh would slow After Effects down in proportion to the project
 * (ADR-0002). Each change re-scans, and the host refuses an edit if a stack
 * changed since it was read rather than touching the wrong effect.
 */

interface EffectInfo {
  readonly index: number;
  readonly name: string;
  readonly matchName: string;
  readonly enabled: boolean;
}

interface LayerEffects {
  readonly id: number;
  readonly name: string;
  readonly locked: boolean;
  readonly effects: readonly EffectInfo[];
}

/** How many effect names a confirmation lists before "…". */
const NAMES_SHOWN = 6;

function ref(layer: LayerEffects, effect: EffectInfo): JsonObject {
  return { id: layer.id, index: effect.index, matchName: effect.matchName };
}

export class FxView implements View {
  readonly id = "fx";
  readonly label = "FX";
  readonly icon = "tab-fx";
  readonly root: HTMLElement;
  readonly #panel: Panel;
  readonly #buttons: CommandButtons;
  readonly #sections: Section[] = [];
  readonly #list: HTMLElement;
  readonly #scanButton: HTMLButtonElement;
  #layers: LayerEffects[] = [];
  #scanned = false;

  constructor(panel: Panel) {
    this.#panel = panel;
    this.#buttons = new CommandButtons(panel);

    const quick = new Section(panel, "fx.quick", "Add Effect", "to the selection");
    this.#sections.push(quick);
    quick.body.append(
      pillGrid(
        ...QUICK_EFFECTS.map((effect) =>
          this.#buttons.button(`kvfx.fx.add.${effect.key}`, { label: effect.name.replace(/ Control$/, ""), icon: effect.icon }),
        ),
      ),
    );

    this.#list = h("div", { class: "kvfx-list" });
    this.#scanButton = actionButton("Scan Selected Layers", () => void this.scan(), { icon: "search", variant: "wide" });
    const manager = new Section(panel, "fx.manager", "Effects Manager");
    this.#sections.push(manager);
    manager.body.append(this.#scanButton, this.#list);

    this.root = h("div", { class: "kvfx-tab" }, ...this.#sections.map((s) => s.root));
    this.#render();
  }

  async scan(): Promise<void> {
    const result = await this.#panel.session.query("kvfx.op.fx.list");
    this.#scanned = true;
    if (!result.ok) {
      this.#layers = [];
      this.#render(result.message);
      return;
    }
    this.#layers = ((result.value as { layers?: unknown } | null)?.layers ?? []) as LayerEffects[];
    this.#render();
  }

  #render(error?: string): void {
    clear(this.#list);
    if (error !== undefined) {
      this.#list.append(h("p", { class: "kvfx-hint", text: error }));
      return;
    }
    if (!this.#scanned) {
      this.#list.append(hint("Lists every effect on the selected layers, to switch off or remove."));
      return;
    }
    if (this.#layers.length === 0) {
      this.#list.append(hint("Nothing selected."));
      return;
    }

    for (const layer of this.#layers) {
      const all = layer.effects;
      const head = h(
        "div",
        { class: "kvfx-fxlayer__head" },
        h("span", { class: "kvfx-fxlayer__name", text: layer.name }),
        h("span", { class: "kvfx-fxlayer__count", text: all.length === 0 ? "no effects" : `${String(all.length)}` }),
      );
      if (all.length > 0 && !layer.locked) {
        const anyOn = all.some((e) => e.enabled);
        head.append(
          actionButton(anyOn ? "All off" : "All on", () => void this.#setEnabled(all.map((e) => ref(layer, e)), !anyOn), { variant: "ghost" }),
          actionButton("Remove all", () => void this.#remove(layer, all), { icon: "trash", variant: "tool", danger: true }),
        );
      }
      const rows = all.map((effect) => {
        const toggle = h("input", {
          type: "checkbox",
          title: effect.enabled ? "Switch off" : "Switch on",
          attrs: { "aria-label": `${effect.name} on` },
          on: { change: () => void this.#setEnabled([ref(layer, effect)], toggle.checked) },
        });
        toggle.checked = effect.enabled;
        toggle.disabled = layer.locked;
        const remove = h(
          "button",
          {
            class: "kvfx-tool kvfx-danger",
            type: "button",
            title: `Remove ${effect.name}`,
            attrs: { "aria-label": `Remove ${effect.name}` },
            on: { click: () => void this.#remove(layer, [effect]) },
          },
          createIcon("trash", IconSize.medium),
        );
        remove.disabled = layer.locked;
        return h(
          "div",
          { class: `kvfx-fxrow${effect.enabled ? "" : " kvfx-fxrow--off"}` },
          toggle,
          h("span", { class: "kvfx-fxrow__name", text: effect.name, title: effect.matchName }),
          remove,
        );
      });
      this.#list.append(h("div", { class: "kvfx-fxlayer" }, head, ...rows, layer.locked ? hint("Locked — unlock it to change effects.") : null));
    }
  }

  async #setEnabled(effects: JsonObject[], enabled: boolean): Promise<void> {
    await this.#panel.session.runPlan(enabled ? "Effects On" : "Effects Off", [
      { op: "kvfx.op.fx.setEnabled", args: { effects, enabled } },
    ]);
    await this.scan();
  }

  async #remove(layer: LayerEffects, effects: readonly EffectInfo[]): Promise<void> {
    const names = effects.map((e) => e.name);
    const ok = await this.#panel.confirm({
      title: effects.length === 1 ? `Remove ${names[0] ?? "effect"}?` : `Remove ${String(effects.length)} effects?`,
      body: `From ${layer.name}: ${names.slice(0, NAMES_SHOWN).join(", ")}${names.length > NAMES_SHOWN ? "…" : ""}. Edit ▸ Undo brings them back.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await this.#panel.session.runPlan("Remove Effects", [
      { op: "kvfx.op.fx.remove", args: { effects: effects.map((e) => ref(layer, e)) } },
    ]);
    await this.scan();
  }

  update(state: SessionState, availability: Availability): void {
    for (const section of this.#sections) section.update(state);
    this.#buttons.update(state, availability);
    setEnabled(this.#scanButton, this.#panel.session.connected && state.snapshot.comp !== undefined && !state.busy, "Open a composition first.");
  }
}

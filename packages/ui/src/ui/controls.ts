import type { JsonObject } from "@kvfx/core";
import type { Availability, Panel } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { IconSize, createIcon } from "../components/icons.js";
import { h, setEnabled, toggleClass } from "./dom.js";

/**
 * Reusable controls. Every button that runs something is bound to a command
 * id, so it enables and disables from the same availability rules the palette
 * uses, and shows the reason it is disabled as its tooltip.
 */

interface BoundButton {
  readonly node: HTMLButtonElement;
  /** Resolved on every click and update — the align bar's id follows its reference toggle. */
  readonly commandId: () => string;
  readonly label: string;
  readonly variant: string;
}

export interface ButtonOptions {
  /** Visible text. Pills show it; icon tools use it as the tooltip. */
  readonly label: string;
  readonly icon?: string;
  /** "pill" — uppercase text button; "tool" — square icon button. */
  readonly variant?: "pill" | "tool" | "wide";
  readonly params?: () => JsonObject | undefined;
  /** Extra class names. */
  readonly className?: string;
}

export class CommandButtons {
  readonly #panel: Panel;
  readonly #buttons: BoundButton[] = [];

  constructor(panel: Panel) {
    this.#panel = panel;
  }

  button(commandId: string | (() => string), options: ButtonOptions): HTMLButtonElement {
    const variant = options.variant ?? "pill";
    const resolve = typeof commandId === "string" ? (): string => commandId : commandId;
    const node = h("button", {
      class: `kvfx-${variant}${options.className === undefined ? "" : ` ${options.className}`}`,
      type: "button",
      attrs: { "aria-label": options.label },
    });
    if (options.icon !== undefined) node.append(createIcon(options.icon));
    if (variant !== "tool") node.append(h("span", { text: options.label }));
    node.addEventListener("click", () => {
      void this.#invoke(resolve(), options.params?.());
    });
    this.#buttons.push({ node, commandId: resolve, label: options.label, variant });
    return node;
  }

  async #invoke(commandId: string, params: JsonObject | undefined): Promise<void> {
    const command = this.#panel.session.command(commandId);
    if (command === undefined) return;
    if (command.metadata.destructive) {
      const confirmed = await this.#panel.confirm({
        title: command.name,
        body: command.description,
        confirmLabel: command.name,
        danger: true,
      });
      if (!confirmed) return;
    }
    await this.#panel.session.run(command, params);
  }

  update(state: SessionState, availability: Availability): void {
    for (const bound of this.#buttons) {
      const id = bound.commandId();
      const description = this.#panel.session.command(id)?.description ?? bound.label;
      const title = bound.variant === "tool" ? `${bound.label} — ${description}` : description;
      const available = availability.ids.has(id) && !state.busy;
      setEnabled(bound.node, available, availability.reasons.get(id), title);
    }
  }
}

/**
 * A titled, collapsible section. The collapsed set is persisted, so the tab
 * reopens in the shape the user left it.
 */
export class Section {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly #id: string;
  readonly #head: HTMLButtonElement;

  constructor(panel: Panel, id: string, title: string, hint?: string) {
    this.#id = id;
    this.body = h("div", { class: "kvfx-section__body" });
    this.#head = h(
      "button",
      { class: "kvfx-section__head", type: "button", on: { click: () => panel.session.toggleGroup(id) } },
      createIcon("chevron-down", IconSize.tiny),
      h("span", { class: "kvfx-section__title", text: title }),
      hint === undefined ? null : h("span", { class: "kvfx-section__hint", text: hint }),
    );
    this.root = h("section", { class: "kvfx-section" }, this.#head, this.body);
  }

  update(state: SessionState): void {
    const collapsed = state.settings.ui.collapsedGroups.includes(this.#id);
    toggleClass(this.root, "kvfx-section--collapsed", collapsed);
    this.#head.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
}

/** A grid of pills, two or three to a row depending on the panel's width. */
export function pillGrid(...children: HTMLElement[]): HTMLElement {
  return h("div", { class: "kvfx-pills" }, ...children);
}

export function row(...children: (HTMLElement | null)[]): HTMLElement {
  return h("div", { class: "kvfx-row" }, ...children);
}

/** A labelled number field. */
export function numberField(
  label: string,
  value: number,
  options: { min?: number; max?: number; step?: number; unit?: string; onChange?: (value: number) => void } = {},
): { root: HTMLElement; input: HTMLInputElement } {
  const input = h("input", {
    class: "kvfx-input kvfx-input--number",
    type: "number",
    attrs: {
      value: String(value),
      ...(options.min === undefined ? {} : { min: String(options.min) }),
      ...(options.max === undefined ? {} : { max: String(options.max) }),
      step: String(options.step ?? 1),
      "aria-label": label,
    },
  });
  if (options.onChange !== undefined) {
    const onChange = options.onChange;
    input.addEventListener("change", () => {
      const n = Number.parseFloat(input.value);
      if (Number.isFinite(n)) onChange(n);
    });
  }
  const root = h(
    "label",
    { class: "kvfx-field" },
    h("span", { class: "kvfx-field__label", text: label }),
    input,
    options.unit === undefined ? null : h("span", { class: "kvfx-field__unit", text: options.unit }),
  );
  return { root, input };
}

export function textField(
  label: string,
  value: string,
  onChange?: (value: string) => void,
  placeholder?: string,
): { root: HTMLElement; input: HTMLInputElement } {
  const input = h("input", {
    class: "kvfx-input",
    type: "text",
    attrs: { value, "aria-label": label, spellcheck: "false", ...(placeholder === undefined ? {} : { placeholder }) },
  });
  if (onChange !== undefined) input.addEventListener("change", () => onChange(input.value));
  const root = h("label", { class: "kvfx-field" }, h("span", { class: "kvfx-field__label", text: label }), input);
  return { root, input };
}

export function selectField(
  label: string,
  options: readonly { value: string; label: string }[],
  value: string,
  onChange?: (value: string) => void,
): { root: HTMLElement; select: HTMLSelectElement } {
  const select = h("select", { class: "kvfx-input kvfx-select", attrs: { "aria-label": label } });
  for (const option of options) {
    const node = h("option", { text: option.label, attrs: { value: option.value } });
    if (option.value === value) node.selected = true;
    select.append(node);
  }
  if (onChange !== undefined) select.addEventListener("change", () => onChange(select.value));
  const root = h("label", { class: "kvfx-field" }, h("span", { class: "kvfx-field__label", text: label }), select);
  return { root, select };
}

/** A colour swatch backed by the platform colour picker. */
export function colorField(
  label: string,
  value: string,
  onChange?: (hex: string) => void,
): { root: HTMLElement; input: HTMLInputElement } {
  const input = h("input", { class: "kvfx-swatch", type: "color", attrs: { value, "aria-label": label, title: label } });
  if (onChange !== undefined) input.addEventListener("input", () => onChange(input.value));
  const root = h("label", { class: "kvfx-field kvfx-field--color" }, h("span", { class: "kvfx-field__label", text: label }), input);
  return { root, input };
}

/** A segmented choice — a handful of mutually exclusive options. */
export function segmented<T extends string>(
  options: readonly { value: T; label: string; title?: string }[],
  value: T,
  onChange: (value: T) => void,
): { root: HTMLElement; set: (value: T) => void } {
  const buttons = options.map((option) =>
    h("button", {
      class: "kvfx-seg__btn",
      type: "button",
      text: option.label,
      ...(option.title === undefined ? {} : { title: option.title }),
      on: { click: () => onChange(option.value) },
    }),
  );
  const root = h("div", { class: "kvfx-seg", attrs: { role: "radiogroup" } }, ...buttons);
  const set = (next: T): void => {
    options.forEach((option, i) => {
      const button = buttons[i];
      if (button === undefined) return;
      toggleClass(button, "kvfx-seg__btn--on", option.value === next);
      button.setAttribute("aria-checked", option.value === next ? "true" : "false");
    });
  };
  set(value);
  return { root, set };
}

/** A plain button for view-local actions that are not commands. */
export function actionButton(label: string, onClick: () => void, options: { icon?: string; variant?: "pill" | "tool" | "wide" | "ghost"; danger?: boolean; title?: string } = {}): HTMLButtonElement {
  const variant = options.variant ?? "pill";
  const node = h("button", {
    class: `kvfx-${variant}${options.danger === true ? " kvfx-danger" : ""}`,
    type: "button",
    title: options.title ?? label,
    attrs: { "aria-label": label },
    on: { click: onClick },
  });
  if (options.icon !== undefined) node.append(createIcon(options.icon));
  if (variant !== "tool") node.append(h("span", { text: label }));
  return node;
}

export function hint(text: string): HTMLElement {
  return h("p", { class: "kvfx-hint", text });
}

/**
 * Independent on/off switches drawn like a segmented control, so a row of
 * options ("Rotation · Scale · Opacity") matches the choices around it.
 */
export function toggles<K extends string>(
  options: readonly { key: K; label: string; title?: string }[],
  values: Readonly<Partial<Record<K, boolean>>>,
  onChange: (key: K, on: boolean) => void,
): { root: HTMLElement; get: (key: K) => boolean } {
  const state = new Map<K, boolean>(options.map((o) => [o.key, values[o.key] === true]));
  const buttons = options.map((option) => {
    const button = h("button", {
      class: "kvfx-seg__btn",
      type: "button",
      text: option.label,
      ...(option.title === undefined ? {} : { title: option.title }),
      attrs: { "aria-pressed": "false" },
    });
    const paint = (): void => {
      const on = state.get(option.key) === true;
      toggleClass(button, "kvfx-seg__btn--on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    };
    button.addEventListener("click", () => {
      const next = !(state.get(option.key) === true);
      state.set(option.key, next);
      paint();
      onChange(option.key, next);
    });
    paint();
    return button;
  });
  return { root: h("div", { class: "kvfx-seg kvfx-seg--multi" }, ...buttons), get: (key) => state.get(key) === true };
}

/** A number field that may be left empty, meaning "automatic". */
export function optionalNumber(input: HTMLInputElement): number | undefined {
  if (input.value.trim().length === 0) return undefined;
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) ? value : undefined;
}

import { type PaletteEntry, type Platform, formatHotkey, parseHotkey } from "@kvfx/core";
import type { Panel } from "../app/panel.js";
import { createIcon } from "../components/icons.js";
import { clear, h, toggleClass } from "../ui/dom.js";

/**
 * The command palette: every command by name, over the panel.
 *
 * An overlay now rather than a permanent list: the tabs carry the visual
 * tools, and the palette is the keyboard route to all of them — including the
 * ones a tab shows as an icon. It keeps its own query and highlight, so typing
 * never re-renders the panel underneath.
 *
 * Matched characters are highlighted from the positions the ranker reports,
 * so the user can see *why* a result matched — which is what makes fuzzy
 * search feel trustworthy rather than arbitrary.
 */

const MAX_ROWS = 60;

function highlightedName(name: string, positions: readonly number[]): HTMLElement {
  const wrapper = h("span", { class: "kvfx-command__name" });
  if (positions.length === 0) {
    wrapper.textContent = name;
    return wrapper;
  }
  const marked = new Set(positions);
  let run = "";
  let runMarked = false;
  const flush = (): void => {
    if (run.length === 0) return;
    wrapper.append(runMarked ? h("mark", { class: "kvfx-hit", text: run }) : document.createTextNode(run));
    run = "";
  };
  for (let i = 0; i < name.length; i += 1) {
    const isMarked = marked.has(i);
    if (isMarked !== runMarked) {
      flush();
      runMarked = isMarked;
    }
    run += name.charAt(i);
  }
  flush();
  return wrapper;
}

function shortcutLabel(entry: PaletteEntry, platform: Platform): string | undefined {
  if (entry.shortcut === undefined) return undefined;
  const parsed = parseHotkey(entry.shortcut);
  return parsed === undefined ? entry.shortcut : formatHotkey(parsed, platform);
}

export class PaletteOverlay {
  readonly root: HTMLElement;
  readonly #panel: Panel;
  readonly #platform: Platform;
  readonly #input: HTMLInputElement;
  readonly #list: HTMLElement;
  #entries: readonly PaletteEntry[] = [];
  #index = 0;
  #open = false;

  constructor(panel: Panel, platform: Platform) {
    this.#panel = panel;
    this.#platform = platform;
    this.#input = h("input", {
      class: "kvfx-palette__input",
      type: "text",
      attrs: { placeholder: "Search every command…", spellcheck: "false", autocomplete: "off", "aria-label": "Search commands" },
      on: {
        input: () => {
          this.#index = 0;
          this.refresh();
        },
        keydown: (event) => this.#onKey(event),
      },
    });
    this.#list = h("div", { class: "kvfx-palette__list", attrs: { role: "listbox" } });
    const box = h(
      "div",
      { class: "kvfx-palette", attrs: { role: "dialog", "aria-label": "Command palette" } },
      h("div", { class: "kvfx-palette__search" }, createIcon("search"), this.#input),
      this.#list,
      h("div", { class: "kvfx-palette__foot", text: "↑↓ choose · Enter run · Esc close · ☆ pin to the top" }),
    );
    this.root = h("div", { class: "kvfx-overlay kvfx-overlay--top", on: { mousedown: (e) => {
      if (e.target === this.root) this.close();
    } } }, box);
    this.root.hidden = true;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  open(): void {
    this.#open = true;
    this.root.hidden = false;
    this.#input.value = "";
    this.#index = 0;
    this.refresh();
    this.#input.focus();
  }

  close(): void {
    this.#open = false;
    this.root.hidden = true;
  }

  /** Re-ranks against the current query, selection and settings. */
  refresh(): void {
    if (!this.#open) return;
    this.#entries = this.#panel.session.entries(this.#input.value).slice(0, MAX_ROWS);
    if (this.#index >= this.#entries.length) this.#index = Math.max(0, this.#entries.length - 1);
    this.#render();
  }

  #render(): void {
    clear(this.#list);
    if (this.#entries.length === 0) {
      this.#list.append(h("div", { class: "kvfx-empty", text: `No command matches “${this.#input.value}”` }));
      return;
    }
    const busy = this.#panel.session.state.busy;
    this.#entries.forEach((entry, index) => {
      const star = h("button", {
        class: `kvfx-star${entry.isFavourite ? " kvfx-star--on" : ""}`,
        type: "button",
        text: entry.isFavourite ? "★" : "☆",
        title: entry.isFavourite ? "Unpin" : "Pin to the top",
        on: {
          click: (event) => {
            event.stopPropagation();
            this.#panel.session.toggleFavourite(entry.command.id);
            this.refresh();
          },
        },
      });
      const action = h(
        "button",
        {
          class: "kvfx-command__action",
          type: "button",
          title: entry.available ? entry.command.description : (entry.reason ?? ""),
          on: {
            click: () => void this.#run(entry),
            mouseenter: () => this.#highlight(index),
          },
        },
        createIcon(entry.command.icon),
        highlightedName(entry.command.name, entry.positions),
        entry.matchedOn === "keyword" && entry.matchedKeyword !== undefined
          ? h("span", { class: "kvfx-command__via", text: entry.matchedKeyword })
          : null,
        !entry.available && entry.reason !== undefined ? h("span", { class: "kvfx-command__hint", text: entry.reason }) : null,
      );
      action.disabled = !entry.available || busy;
      const key = shortcutLabel(entry, this.#platform);
      if (key !== undefined) action.append(h("span", { class: "kvfx-command__key", text: key }));
      const row = h("div", { class: "kvfx-command", attrs: { role: "option" } }, star, action);
      toggleClass(row, "kvfx-command--selected", index === this.#index);
      toggleClass(row, "kvfx-command--unavailable", !entry.available);
      this.#list.append(row);
    });
  }

  #highlight(index: number): void {
    if (index === this.#index) return;
    this.#index = index;
    const rows = this.#list.querySelectorAll(".kvfx-command");
    rows.forEach((row, i) => toggleClass(row, "kvfx-command--selected", i === index));
  }

  async #run(entry: PaletteEntry): Promise<void> {
    if (!entry.available) return;
    this.close();
    await this.#panel.session.run(entry.command);
  }

  #onKey(event: KeyboardEvent): void {
    const count = this.#entries.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (count > 0) this.#highlight((this.#index + 1) % count);
        this.#scrollIntoView();
        return;
      case "ArrowUp":
        event.preventDefault();
        if (count > 0) this.#highlight((this.#index - 1 + count) % count);
        this.#scrollIntoView();
        return;
      case "Enter": {
        event.preventDefault();
        const entry = this.#entries[this.#index];
        if (entry !== undefined) void this.#run(entry);
        return;
      }
      case "Escape":
        event.preventDefault();
        this.close();
        return;
      default:
    }
  }

  #scrollIntoView(): void {
    const row = this.#list.children[this.#index];
    if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" });
  }
}

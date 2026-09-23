import { type PaletteEntry, type Platform, formatHotkey, parseHotkey } from "@kvfx/core";

/**
 * The palette: a search field with a ranked command list beneath it.
 *
 * Not an overlay. In a docked After Effects panel an overlay would hide the
 * panel's own contents to show a list that is already the panel's main
 * contents — so the search field is simply always present, and the palette
 * shortcut focuses and selects it. That keeps one list implementation instead
 * of two and makes the panel useful with the mouse as well as the keyboard.
 *
 * Matched characters in a command name are highlighted from the positions the
 * ranker reports, so the user can see *why* a result matched — which is what
 * makes fuzzy search feel trustworthy rather than arbitrary.
 */

export interface PaletteHandlers {
  readonly onQueryChange: (query: string) => void;
  readonly onRun: (commandId: string) => void;
  readonly onToggleFavourite: (commandId: string) => void;
  readonly onSelect: (index: number) => void;
}

export interface PaletteViewModel {
  readonly entries: readonly PaletteEntry[];
  readonly query: string;
  readonly selectedIndex: number;
  readonly busy: boolean;
  readonly platform: Platform;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Renders the name with the matched characters wrapped for highlighting. */
function highlightedName(name: string, positions: readonly number[]): HTMLElement {
  const wrapper = element("span", "kvfx-command__name");
  if (positions.length === 0) {
    wrapper.textContent = name;
    return wrapper;
  }

  const marked = new Set(positions);
  let run = "";
  let runMarked = false;

  const flush = (): void => {
    if (run.length === 0) return;
    wrapper.append(runMarked ? element("mark", "kvfx-hit", run) : document.createTextNode(run));
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

function commandRow(
  entry: PaletteEntry,
  index: number,
  model: PaletteViewModel,
  handlers: PaletteHandlers,
): HTMLElement {
  const row = element("div", "kvfx-command");
  if (index === model.selectedIndex) row.classList.add("kvfx-command--selected");
  if (!entry.available) row.classList.add("kvfx-command--unavailable");

  const star = element("button", "kvfx-star", entry.isFavourite ? "★" : "☆");
  star.type = "button";
  star.title = entry.isFavourite ? "Remove from favourites" : "Add to favourites";
  star.setAttribute("aria-pressed", entry.isFavourite ? "true" : "false");
  if (entry.isFavourite) star.classList.add("kvfx-star--on");
  star.addEventListener("click", (domEvent) => {
    domEvent.stopPropagation();
    handlers.onToggleFavourite(entry.command.id);
  });

  const action = element("button", "kvfx-command__action");
  action.type = "button";
  action.disabled = !entry.available || model.busy;
  action.title = entry.available ? entry.command.description : (entry.reason ?? "");
  action.append(highlightedName(entry.command.name, entry.positions));

  // Show why a result matched when it was not the name — otherwise a keyword
  // hit looks like a bug.
  if (entry.matchedOn === "keyword" && entry.matchedKeyword !== undefined) {
    action.append(element("span", "kvfx-command__via", entry.matchedKeyword));
  }
  if (!entry.available && entry.reason !== undefined) {
    action.append(element("span", "kvfx-command__hint", entry.reason));
  }

  const shortcut = shortcutLabel(entry, model.platform);
  if (shortcut !== undefined) {
    action.append(element("span", "kvfx-command__key", shortcut));
  }

  action.addEventListener("click", () => handlers.onRun(entry.command.id));
  action.addEventListener("mouseenter", () => handlers.onSelect(index));

  row.append(star, action);
  return row;
}

export interface PaletteElements {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
}

export function renderPalette(
  model: PaletteViewModel,
  handlers: PaletteHandlers,
): PaletteElements {
  const root = element("div", "kvfx-palette");

  const search = element("div", "kvfx-search");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "kvfx-search__input";
  input.placeholder = "Search commands…";
  input.value = model.query;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Search commands");
  input.addEventListener("input", () => handlers.onQueryChange(input.value));
  search.append(input);

  const list = element("div", "kvfx-commands");
  list.setAttribute("role", "listbox");

  if (model.entries.length === 0) {
    list.append(element("div", "kvfx-empty", `No command matches “${model.query}”`));
  } else {
    model.entries.forEach((entry, index) => {
      list.append(commandRow(entry, index, model, handlers));
    });
  }

  root.append(search, list);
  return { root, input };
}

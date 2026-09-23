import {
  DEFAULT_PALETTE_HOTKEY,
  type Platform,
  formatHotkey,
  matchesHotkey,
  parseHotkey,
} from "@kvfx/core";
import { Session, type SessionState } from "./session.js";
import { render } from "./render.js";

const root = document.getElementById("kvfx-root");
if (root === null) {
  throw new Error("KVFX Tools: panel root element is missing from index.html");
}

const panel = root;

/**
 * Platform detection for shortcut display and matching.
 *
 * `navigator.platform` is deprecated but still the most reliable signal in
 * Chromium 99 — `userAgentData` is not available there (F3).
 */
const platform: Platform = /mac/i.test(navigator.platform) ? "mac" : "other";

const paletteHotkey = parseHotkey(DEFAULT_PALETTE_HOTKEY);
const paletteHotkeyLabel =
  paletteHotkey === undefined ? DEFAULT_PALETTE_HOTKEY : formatHotkey(paletteHotkey, platform);

let searchInput: HTMLInputElement | undefined;
let restoreFocus = false;

const session = new Session((state: SessionState) => {
  const hadFocus = restoreFocus || document.activeElement === searchInput;
  const caret = searchInput?.selectionStart ?? null;

  const result = render(panel, state, {
    entries: session.entries(),
    platform,
    paletteHotkeyLabel,
    onRefresh: () => void session.refreshSelection(),
    onQueryChange: (query) => session.setQuery(query),
    onSelect: (index) => {
      // Re-rendering on hover would fight the mouse, so selection is stored
      // without a full redraw; the next real change picks it up.
      selectWithoutRedraw(index);
    },
    onToggleFavourite: (commandId) => session.toggleFavourite(commandId),
    onRun: (commandId) => {
      const command = session.registryGet(commandId);
      if (command !== undefined) void session.run(command);
    },
  });

  searchInput = result.input;
  restoreFocus = false;

  // Rebuilding the DOM drops focus, which would make typing in the search field
  // impossible. Restore it, caret included.
  if (hadFocus && searchInput !== undefined) {
    searchInput.focus();
    if (caret !== null) searchInput.setSelectionRange(caret, caret);
  }
});

let pendingIndex: number | undefined;
function selectWithoutRedraw(index: number): void {
  pendingIndex = index;
}

function commitPendingSelection(): void {
  if (pendingIndex === undefined) return;
  const target = pendingIndex;
  pendingIndex = undefined;
  session.setSelectedIndex(target);
}

document.addEventListener("keydown", (domEvent: KeyboardEvent) => {
  if (paletteHotkey !== undefined && matchesHotkey(paletteHotkey, domEvent, platform)) {
    domEvent.preventDefault();
    restoreFocus = true;
    searchInput?.focus();
    searchInput?.select();
    return;
  }

  switch (domEvent.key) {
    case "ArrowDown":
      domEvent.preventDefault();
      restoreFocus = document.activeElement === searchInput;
      session.moveSelection(1);
      return;
    case "ArrowUp":
      domEvent.preventDefault();
      restoreFocus = document.activeElement === searchInput;
      session.moveSelection(-1);
      return;
    case "Enter":
      domEvent.preventDefault();
      commitPendingSelection();
      restoreFocus = document.activeElement === searchInput;
      void session.runSelected();
      return;
    case "Escape":
      domEvent.preventDefault();
      restoreFocus = document.activeElement === searchInput;
      session.setQuery("");
      return;
    default:
  }
});

void session.connect();

// Adobe's own guidance for After Effects is to refresh on focus rather than to
// poll, because AE emits no events at all (F4, ADR-0002).
window.addEventListener("focus", () => {
  void session.refreshSelection();
});

// Settings writes are debounced, so flush whenever the panel might stop running.
window.addEventListener("blur", () => session.flushSettings());
window.addEventListener("pagehide", () => session.flushSettings());
window.cep?.util?.registerExtensionUnloadCallback(() => session.flushSettings());

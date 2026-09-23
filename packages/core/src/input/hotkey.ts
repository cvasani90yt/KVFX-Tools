/**
 * Keyboard shortcut parsing and matching.
 *
 * Pure, and free of any DOM dependency, so the whole of shortcut handling is
 * unit-testable — including the platform differences, which are otherwise only
 * discoverable on the machine you do not have.
 *
 * `Mod` is the portable modifier: Command on macOS, Control everywhere else.
 * Writing shortcuts as `Mod+Space` means one stored binding is correct on both
 * platforms and the user never sees a Windows shortcut on a Mac.
 *
 * Scope note: these only fire while the KVFX panel has keyboard focus. After
 * Effects does not let a script or a CEP panel register a global shortcut (F6,
 * ADR-0003), and this module cannot change that.
 */

export interface Hotkey {
  /** Normalised `KeyboardEvent.key`, lowercased for single characters. */
  readonly key: string;
  readonly mod: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

export type Platform = "mac" | "other";

/** Names accepted for keys whose `event.key` is not the literal token. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  space: " ",
  esc: "escape",
  escape: "escape",
  enter: "enter",
  return: "enter",
  tab: "tab",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  backspace: "backspace",
  delete: "delete",
  del: "delete",
};

function normaliseKey(token: string): string {
  const lower = token.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

/**
 * Parses a shortcut such as `Mod+Shift+P`.
 *
 * Returns `undefined` for anything malformed — an empty string, modifiers with
 * no key, or two keys — so a corrupt stored binding is dropped rather than
 * silently matching something unexpected.
 */
export function parseHotkey(text: string): Hotkey | undefined {
  const parts = text
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) return undefined;

  let mod = false;
  let ctrl = false;
  let alt = false;
  let shift = false;
  let key: string | undefined;

  for (const part of parts) {
    switch (part.toLowerCase()) {
      case "mod":
      case "cmdorctrl":
        mod = true;
        break;
      case "cmd":
      case "command":
      case "meta":
      case "super":
        mod = true;
        break;
      case "ctrl":
      case "control":
        ctrl = true;
        break;
      case "alt":
      case "option":
      case "opt":
        alt = true;
        break;
      case "shift":
        shift = true;
        break;
      default:
        // A second non-modifier token means the binding is ambiguous.
        if (key !== undefined) return undefined;
        key = normaliseKey(part);
    }
  }

  if (key === undefined) return undefined;
  return { key, mod, ctrl, alt, shift };
}

export function matchesHotkey(hotkey: Hotkey, event: KeyEventLike, platform: Platform): boolean {
  const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  if (eventKey !== hotkey.key) return false;

  const modPressed = platform === "mac" ? event.metaKey : event.ctrlKey;
  if (hotkey.mod !== modPressed) return false;

  // On macOS a `Mod` binding uses Command, so Control must be free; on other
  // platforms Mod *is* Control and asserting it again would double-count.
  const ctrlExpected = hotkey.ctrl || (hotkey.mod && platform !== "mac");
  if (ctrlExpected !== event.ctrlKey) return false;

  if (hotkey.alt !== event.altKey) return false;
  return hotkey.shift === event.shiftKey;
}

const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  " ": "Space",
  escape: "Esc",
  enter: "Enter",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
};

/** Renders a shortcut the way the platform writes it. */
export function formatHotkey(hotkey: Hotkey, platform: Platform): string {
  const parts: string[] = [];
  if (hotkey.mod) parts.push(platform === "mac" ? "⌘" : "Ctrl");
  if (hotkey.ctrl && !(hotkey.mod && platform !== "mac")) parts.push("Ctrl");
  if (hotkey.alt) parts.push(platform === "mac" ? "⌥" : "Alt");
  if (hotkey.shift) parts.push(platform === "mac" ? "⇧" : "Shift");

  const key = DISPLAY_NAMES[hotkey.key] ?? (hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key);
  parts.push(key);

  return platform === "mac" ? parts.join("") : parts.join("+");
}

/**
 * The palette's default binding.
 *
 * Only active while the panel has focus — see the scope note above.
 */
export const DEFAULT_PALETTE_HOTKEY = "Mod+Space";

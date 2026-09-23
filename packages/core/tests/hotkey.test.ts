import { describe, expect, it } from "vitest";
import {
  DEFAULT_PALETTE_HOTKEY,
  formatHotkey,
  matchesHotkey,
  parseHotkey,
  type KeyEventLike,
} from "../src/input/hotkey.js";

function event(key: string, mods: Partial<Omit<KeyEventLike, "key">> = {}): KeyEventLike {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods };
}

function hotkey(text: string) {
  const parsed = parseHotkey(text);
  if (parsed === undefined) throw new Error(`Could not parse: ${text}`);
  return parsed;
}

describe("parseHotkey", () => {
  it("parses the portable modifier", () => {
    expect(parseHotkey("Mod+Space")).toEqual({ key: " ", mod: true, ctrl: false, alt: false, shift: false });
  });

  it("accepts platform-specific modifier spellings", () => {
    for (const text of ["Cmd+K", "Command+K", "Meta+K"]) {
      expect(parseHotkey(text)?.mod).toBe(true);
    }
    expect(parseHotkey("Control+K")?.ctrl).toBe(true);
    for (const text of ["Alt+K", "Option+K", "Opt+K"]) {
      expect(parseHotkey(text)?.alt).toBe(true);
    }
  });

  it("parses named keys", () => {
    expect(parseHotkey("Esc")?.key).toBe("escape");
    expect(parseHotkey("Return")?.key).toBe("enter");
    expect(parseHotkey("Up")?.key).toBe("arrowup");
  });

  it("is insensitive to case and spacing", () => {
    expect(parseHotkey("  mod + shift + p  ")).toEqual(parseHotkey("Mod+Shift+P"));
  });

  it("rejects malformed bindings rather than guessing", () => {
    // A corrupt stored binding must be dropped, not silently matched.
    expect(parseHotkey("")).toBeUndefined();
    expect(parseHotkey("Mod+")).toBeUndefined();
    expect(parseHotkey("Ctrl+Shift")).toBeUndefined();
    expect(parseHotkey("A+B")).toBeUndefined();
  });
});

describe("matchesHotkey — the portable modifier on each platform", () => {
  const palette = hotkey(DEFAULT_PALETTE_HOTKEY);

  it("matches Command+Space on macOS", () => {
    expect(matchesHotkey(palette, event(" ", { metaKey: true }), "mac")).toBe(true);
  });

  it("matches Ctrl+Space elsewhere", () => {
    expect(matchesHotkey(palette, event(" ", { ctrlKey: true }), "other")).toBe(true);
  });

  it("does not match Ctrl+Space on macOS", () => {
    // Ctrl+Space is a different, meaningful shortcut on macOS.
    expect(matchesHotkey(palette, event(" ", { ctrlKey: true }), "mac")).toBe(false);
  });

  it("does not match Command+Space elsewhere", () => {
    expect(matchesHotkey(palette, event(" ", { metaKey: true }), "other")).toBe(false);
  });

  it("does not match the key with no modifier", () => {
    expect(matchesHotkey(palette, event(" "), "mac")).toBe(false);
    expect(matchesHotkey(palette, event(" "), "other")).toBe(false);
  });
});

describe("matchesHotkey — exactness", () => {
  it("requires every declared modifier", () => {
    const key = hotkey("Mod+Shift+P");
    expect(matchesHotkey(key, event("P", { metaKey: true, shiftKey: true }), "mac")).toBe(true);
    expect(matchesHotkey(key, event("P", { metaKey: true }), "mac")).toBe(false);
  });

  it("rejects extra modifiers that were not declared", () => {
    const key = hotkey("Mod+P");
    expect(matchesHotkey(key, event("p", { metaKey: true, altKey: true }), "mac")).toBe(false);
    expect(matchesHotkey(key, event("p", { metaKey: true, shiftKey: true }), "mac")).toBe(false);
  });

  it("is case-insensitive about the key itself", () => {
    const key = hotkey("Mod+P");
    expect(matchesHotkey(key, event("P", { metaKey: true }), "mac")).toBe(true);
    expect(matchesHotkey(key, event("p", { metaKey: true }), "mac")).toBe(true);
  });

  it("matches an unmodified key", () => {
    expect(matchesHotkey(hotkey("Escape"), event("Escape"), "mac")).toBe(true);
    expect(matchesHotkey(hotkey("Escape"), event("Escape", { metaKey: true }), "mac")).toBe(false);
  });

  it("distinguishes an explicit Ctrl binding from Mod on macOS", () => {
    const explicit = hotkey("Ctrl+P");
    expect(matchesHotkey(explicit, event("p", { ctrlKey: true }), "mac")).toBe(true);
    expect(matchesHotkey(explicit, event("p", { metaKey: true }), "mac")).toBe(false);
  });
});

describe("formatHotkey", () => {
  it("writes shortcuts the way each platform does", () => {
    expect(formatHotkey(hotkey("Mod+Space"), "mac")).toBe("⌘Space");
    expect(formatHotkey(hotkey("Mod+Space"), "other")).toBe("Ctrl+Space");
    expect(formatHotkey(hotkey("Mod+Shift+P"), "mac")).toBe("⌘⇧P");
    expect(formatHotkey(hotkey("Mod+Shift+P"), "other")).toBe("Ctrl+Shift+P");
    expect(formatHotkey(hotkey("Alt+Up"), "mac")).toBe("⌥↑");
    expect(formatHotkey(hotkey("Alt+Up"), "other")).toBe("Alt+↑");
  });

  it("does not print Ctrl twice for a Mod binding off macOS", () => {
    expect(formatHotkey(hotkey("Mod+K"), "other")).toBe("Ctrl+K");
  });
});

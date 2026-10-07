import { DEFAULT_PALETTE_HOTKEY, type Platform, matchesHotkey, parseHotkey } from "@kvfx/core";
import { EaseView } from "../views/ease-view.js";
import { FxView } from "../views/fx-view.js";
import { GenerateView } from "../views/generate-view.js";
import { LabelsView } from "../views/labels-view.js";
import { LibraryView } from "../views/library-view.js";
import { MediaView } from "../views/media-view.js";
import { TextView } from "../views/text-view.js";
import { ToolsView } from "../views/tools-view.js";
import { Session } from "./session.js";
import { Shell } from "./shell.js";

const root = document.getElementById("kvfx-root");
if (root === null) {
  throw new Error("KVFX Tools: panel root element is missing from index.html");
}

/**
 * Platform detection for shortcut display and matching.
 *
 * `navigator.platform` is deprecated but still the most reliable signal in
 * Chromium 99 — `userAgentData` is not available there (F3).
 */
const platform: Platform = /mac/i.test(navigator.platform) ? "mac" : "other";
const paletteHotkey = parseHotkey(DEFAULT_PALETTE_HOTKEY);

/**
 * How often the RAM meter refreshes while the panel is visible.
 *
 * Reading `app.memoryInUse` is one property read whose cost does not grow with
 * the project, which is what makes a timer acceptable here when ADR-0002 rules
 * out polling the selection.
 */
const MEMORY_REFRESH_MS = 15_000;

// The session reports changes before the shell exists; those are simply
// rendered by the shell's first update below.
const holder: { shell?: Shell } = {};
const session = new Session((state) => holder.shell?.update(state));
const shell = new Shell(session, platform, (panel) => [
  new ToolsView(panel),
  new EaseView(panel),
  new TextView(panel),
  new FxView(panel),
  new GenerateView(panel),
  new LabelsView(panel),
  new LibraryView(panel),
  new MediaView(panel),
]);
holder.shell = shell;
root.append(shell.root);
shell.update(session.state);

document.addEventListener("keydown", (event: KeyboardEvent) => {
  if (paletteHotkey !== undefined && matchesHotkey(paletteHotkey, event, platform)) {
    event.preventDefault();
    if (shell.paletteOpen) shell.closeOverlays();
    else shell.openPalette();
    return;
  }
  if (event.key === "Escape" && shell.closeOverlays()) event.preventDefault();
});

void session.connect();

// Adobe's own guidance for After Effects is to refresh on focus rather than to
// poll, because AE emits no events at all (F4, ADR-0002).
window.addEventListener("focus", () => {
  void session.refreshSelection();
  void session.refreshMemory();
});

setInterval(() => {
  if (!document.hidden) void session.refreshMemory();
}, MEMORY_REFRESH_MS);

// Settings writes are debounced, so flush whenever the panel might stop running.
window.addEventListener("blur", () => session.flushSettings());
window.addEventListener("pagehide", () => session.flushSettings());
window.cep?.util?.registerExtensionUnloadCallback(() => session.flushSettings());

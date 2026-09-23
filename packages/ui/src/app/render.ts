import { PRODUCT_NAME, PRODUCT_VERSION, type PaletteEntry, type Platform } from "@kvfx/core";
import { type PaletteHandlers, renderPalette } from "../palette/palette-view.js";
import type { ConnectionState, SessionState } from "./session.js";

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

function statusLine(state: ConnectionState): HTMLElement {
  const row = element("div", "kvfx-status");
  const dot = element("span", "kvfx-dot");
  let label: string;

  switch (state.status) {
    case "checking":
      label = "Connecting to After Effects…";
      break;
    case "connected":
      dot.classList.add("kvfx-dot--ok");
      label = `After Effects ${state.facts.aeVersion} · ${String(state.roundTripMs)} ms`;
      break;
    case "no-host":
      dot.classList.add("kvfx-dot--warn");
      label = "No After Effects host";
      break;
    case "failed":
      dot.classList.add("kvfx-dot--error");
      label = "KVFX Tools couldn't reach After Effects.";
      break;
  }

  row.append(dot, element("span", undefined, label));
  return row;
}

function selectionLine(state: SessionState): HTMLElement {
  const { snapshot } = state;
  let text: string;

  if (!snapshot.hasProject) text = "No project open";
  else if (snapshot.comp === undefined) text = "No composition open";
  else {
    const count = snapshot.layers.length;
    const layers =
      count === 0
        ? "nothing selected"
        : count === 1
          ? "1 layer selected"
          : `${String(count)} layers selected`;
    text = `${snapshot.comp.name} — ${layers}`;
  }

  return element("div", "kvfx-selection", text);
}

function detailBlock(title: string, body: string): HTMLDetailsElement {
  const details = element("details", "kvfx-detail");
  const summary = document.createElement("summary");
  summary.textContent = title;
  const pre = document.createElement("pre");
  pre.textContent = body;
  details.append(summary, pre);
  return details;
}

export interface RenderOptions extends PaletteHandlers {
  readonly entries: readonly PaletteEntry[];
  readonly platform: Platform;
  readonly paletteHotkeyLabel: string;
  readonly onRefresh: () => void;
}

export interface RenderResult {
  /** The search field, so the caller can focus it for the palette shortcut. */
  readonly input: HTMLInputElement | undefined;
}

export function render(
  root: HTMLElement,
  state: SessionState,
  options: RenderOptions,
): RenderResult {
  root.replaceChildren();

  const titlebar = element("header", "kvfx-titlebar");
  titlebar.append(
    element("span", "kvfx-wordmark", PRODUCT_NAME),
    element("span", "kvfx-version", PRODUCT_VERSION),
  );

  const body = element("main", "kvfx-body");
  let input: HTMLInputElement | undefined;

  if (state.connection.status === "connected") {
    body.append(selectionLine(state));

    const palette = renderPalette(
      {
        entries: options.entries,
        query: state.query,
        selectedIndex: state.selectedIndex,
        busy: state.busy,
        platform: options.platform,
      },
      options,
    );
    input = palette.input;
    body.append(palette.root);

    if (state.lastOutcome !== undefined) {
      body.append(
        element(
          "div",
          `kvfx-outcome ${state.lastOutcome.ok ? "kvfx-outcome--ok" : "kvfx-outcome--error"}`,
          `${state.lastOutcome.commandName}: ${state.lastOutcome.message}`,
        ),
      );
    }
  } else {
    body.append(statusLine(state.connection));
  }

  if (state.connection.status === "no-host") {
    body.append(element("p", "kvfx-note", state.connection.message));
  }

  if (state.connection.status === "failed") {
    body.append(
      element(
        "p",
        "kvfx-note",
        "The panel loaded, but After Effects did not answer. Reopening the panel usually reloads the host script.",
      ),
      detailBlock("Show details", `${state.connection.error.code}\n${state.connection.error.message}`),
    );
  }

  if (state.notices.length > 0) {
    body.append(detailBlock("Settings notices", state.notices.join("\n\n")));
  }

  const footer = element("footer", "kvfx-footer");
  footer.append(
    element("span", "kvfx-hintbar", `${options.paletteHotkeyLabel} to search · ↑↓ to move · ↵ to run`),
  );
  const refresh = element("button", "kvfx-button", "Refresh");
  refresh.type = "button";
  refresh.disabled = state.busy;
  refresh.addEventListener("click", options.onRefresh);
  footer.append(refresh);

  root.append(titlebar, body, footer);
  return { input };
}

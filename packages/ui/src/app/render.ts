import { PRODUCT_NAME, PRODUCT_VERSION, type AvailableCommand } from "@kvfx/core";
import type { ConnectionState, SessionState } from "./session.js";

/**
 * Renders the panel.
 *
 * Deliberately framework-free. This is the ancestor of the command palette
 * (Phase 4) — a flat, keyboard-reachable list of every command with its
 * availability resolved — and it is small enough that a rendering library would
 * be the largest thing in the bundle.
 *
 * Unavailable commands are shown, disabled, with the reason. A list that makes
 * entries vanish teaches the user nothing; one that says "Select a layer first"
 * teaches the rule once.
 */

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
      count === 0 ? "nothing selected" : count === 1 ? "1 layer selected" : `${String(count)} layers selected`;
    text = `${snapshot.comp.name} — ${layers}`;
  }

  return element("div", "kvfx-selection", text);
}

function commandRow(entry: AvailableCommand, onRun: () => void, busy: boolean): HTMLElement {
  const row = element("button", "kvfx-command");
  row.type = "button";
  row.disabled = !entry.available || busy;
  row.title = entry.available ? entry.command.description : (entry.reason ?? "");

  row.append(element("span", "kvfx-command__name", entry.command.name));
  if (!entry.available && entry.reason !== undefined) {
    row.append(element("span", "kvfx-command__hint", entry.reason));
  }

  row.addEventListener("click", onRun);
  return row;
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

export interface RenderOptions {
  readonly onRefresh: () => void;
  readonly onRun: (commandId: string) => void;
  readonly commands: readonly AvailableCommand[];
}

export function render(root: HTMLElement, state: SessionState, options: RenderOptions): void {
  root.replaceChildren();

  const titlebar = element("header", "kvfx-titlebar");
  titlebar.append(
    element("span", "kvfx-wordmark", PRODUCT_NAME),
    element("span", "kvfx-version", PRODUCT_VERSION),
  );

  const body = element("main", "kvfx-body");
  body.append(statusLine(state.connection));

  if (state.connection.status === "connected") {
    body.append(selectionLine(state));

    const list = element("div", "kvfx-commands");
    for (const entry of options.commands) {
      list.append(commandRow(entry, () => options.onRun(entry.command.id), state.busy));
    }
    body.append(list);

    if (state.lastOutcome !== undefined) {
      const outcome = element(
        "div",
        `kvfx-outcome ${state.lastOutcome.ok ? "kvfx-outcome--ok" : "kvfx-outcome--error"}`,
        `${state.lastOutcome.commandName}: ${state.lastOutcome.message}`,
      );
      body.append(outcome);
    }
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
      detailBlock(
        "Show details",
        `${state.connection.error.code}\n${state.connection.error.message}`,
      ),
    );
  }

  const footer = element("footer", "kvfx-footer");
  const refresh = element("button", "kvfx-button", "Refresh");
  refresh.type = "button";
  refresh.disabled = state.busy;
  refresh.addEventListener("click", options.onRefresh);
  footer.append(refresh);

  root.append(titlebar, body, footer);
}

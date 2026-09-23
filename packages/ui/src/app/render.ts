import { PRODUCT_NAME, PRODUCT_VERSION } from "@kvfx/core";
import type { ConnectionState } from "./connection.js";

/**
 * Renders the panel shell.
 *
 * Deliberately framework-free: the Phase 2 shell exists to prove the bridge, and
 * introducing a rendering library before there is a UI to render would be a
 * decision made on no evidence. The component layer arrives in Phase 4.
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

function fact(list: HTMLDListElement, label: string, value: string): void {
  list.append(element("dt", undefined, label), element("dd", undefined, value));
}

function statusLine(state: ConnectionState): HTMLElement {
  const row = element("div", "kvfx-status");
  const dot = element("span", "kvfx-dot");
  let label: string;

  switch (state.status) {
    case "checking":
      label = "Checking connection to After Effects…";
      break;
    case "connected":
      dot.classList.add("kvfx-dot--ok");
      label = `Connected — round trip ${String(state.roundTripMs)} ms`;
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
  readonly onRecheck: () => void;
}

export function render(root: HTMLElement, state: ConnectionState, options: RenderOptions): void {
  root.replaceChildren();

  const titlebar = element("header", "kvfx-titlebar");
  titlebar.append(
    element("span", "kvfx-wordmark", PRODUCT_NAME),
    element("span", "kvfx-version", PRODUCT_VERSION),
  );

  const body = element("main", "kvfx-body");
  body.append(statusLine(state));

  if (state.status === "connected") {
    const list = element("dl", "kvfx-facts");
    fact(list, "After Effects", state.facts.aeVersion);
    fact(list, "Build", state.facts.aeBuild);
    fact(list, "Host bundle", state.facts.hostBundleVersion);
    fact(list, "ExtendScript", state.facts.engineVersion);
    fact(list, "Language", state.facts.aeLanguage);
    fact(list, "OS", state.facts.os);
    body.append(list);
  }

  if (state.status === "no-host") {
    body.append(element("p", "kvfx-note", state.message));
  }

  if (state.status === "failed") {
    body.append(
      element(
        "p",
        "kvfx-note",
        "The panel loaded, but After Effects did not answer. Reopening the panel usually reloads the host script.",
      ),
      detailBlock(
        "Show details",
        `${state.error.code}\n${state.error.message}${
          state.error.diagnosticId === undefined ? "" : `\nDiagnostic ${state.error.diagnosticId}`
        }`,
      ),
    );
  }

  const button = element("button", "kvfx-button", "Re-check");
  button.type = "button";
  button.disabled = state.status === "checking";
  button.addEventListener("click", options.onRecheck);
  body.append(button);

  root.append(titlebar, body);
}

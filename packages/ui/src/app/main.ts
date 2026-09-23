import { type ConnectionState, checkConnection } from "./connection.js";
import { render } from "./render.js";

const root = document.getElementById("kvfx-root");
if (root === null) {
  throw new Error("KVFX Tools: panel root element is missing from index.html");
}

let inFlight = false;

async function refresh(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  render(root as HTMLElement, { status: "checking" }, { onRecheck: () => void refresh() });

  let next: ConnectionState;
  try {
    next = await checkConnection();
  } catch (cause) {
    // Nothing should reach here — `checkConnection` returns failures as state —
    // but a panel that renders nothing is worse than one that says why.
    next = {
      status: "failed",
      error: {
        code: "transport_failure",
        message: cause instanceof Error ? cause.message : String(cause),
      },
    };
  } finally {
    inFlight = false;
  }

  render(root as HTMLElement, next, { onRecheck: () => void refresh() });
}

void refresh();

// Adobe's own guidance for After Effects is to refresh on focus rather than to
// poll, because AE emits no events at all (F4, ADR-0002). The panel adopts that
// from the first line of UI code so the habit is structural.
window.addEventListener("focus", () => {
  void refresh();
});

import { Session, type SessionState } from "./session.js";
import { render } from "./render.js";

const root = document.getElementById("kvfx-root");
if (root === null) {
  throw new Error("KVFX Tools: panel root element is missing from index.html");
}

const panel = root;

const session = new Session((state: SessionState) => {
  render(panel, state, {
    commands: session.registry.resolve(session.context()),
    onRefresh: () => void session.refreshSelection(),
    onRun: (commandId: string) => {
      const command = session.registry.get(commandId);
      if (command !== undefined) void session.run(command);
    },
  });
});

void session.connect();

// Adobe's own guidance for After Effects is to refresh on focus rather than to
// poll, because AE emits no events at all (F4, ADR-0002).
window.addEventListener("focus", () => {
  void session.refreshSelection();
});

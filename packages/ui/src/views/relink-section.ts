import type { Panel } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { baseName, filesAvailable, listFolder, pickFolder } from "../app/cep/files.js";
import { Section, actionButton, hint } from "../ui/controls.js";
import { clear, h, setEnabled, setText } from "../ui/dom.js";

/**
 * Missing footage: list what After Effects cannot find, look for those files
 * in a folder the user picks, and relink the matches they confirm.
 *
 * The search only reads folder listings; nothing on disk is written, moved
 * or renamed, and nothing is relinked until the user says so.
 */

/** How deep and how wide a search may go before it stops, so the panel never hangs. */
const MAX_DEPTH = 8;
const MAX_VISITED = 25_000;
const MAX_SHOWN = 200;

interface Missing {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly file: string;
}

interface Match {
  readonly item: Missing;
  readonly path: string;
  chosen: boolean;
}

/** Breadth-first: files nearest the chosen folder win when names repeat. */
function search(root: string, wanted: ReadonlySet<string>): { found: Map<string, string>; truncated: boolean } {
  const found = new Map<string, string>();
  const queue: { path: string; depth: number }[] = [{ path: root, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && found.size < wanted.size) {
    const next = queue.shift();
    if (next === undefined) break;
    const entries = listFolder(next.path) ?? [];
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_VISITED) return { found, truncated: true };
      if (entry.isDirectory) {
        if (next.depth < MAX_DEPTH) queue.push({ path: entry.path, depth: next.depth + 1 });
        continue;
      }
      const key = entry.name.toLowerCase();
      if (wanted.has(key) && !found.has(key)) found.set(key, entry.path);
    }
  }
  return { found, truncated: false };
}

export class RelinkSection {
  readonly section: Section;
  readonly #panel: Panel;
  readonly #list: HTMLElement;
  readonly #status: HTMLElement;
  readonly #find: HTMLButtonElement;
  readonly #searchButton: HTMLButtonElement;
  readonly #relink: HTMLButtonElement;
  #missing: Missing[] = [];
  #matches: Match[] = [];

  constructor(panel: Panel) {
    this.#panel = panel;
    this.#list = h("div", { class: "kvfx-list" });
    this.#status = h("p", { class: "kvfx-hint" }, "Find what this project can't locate, then search a folder for it.");
    this.#find = actionButton("Find Missing", () => void this.#findMissing(), { icon: "search", variant: "wide" });
    this.#searchButton = actionButton("Search…", () => this.#searchFolder(), { icon: "folder", variant: "wide", title: "Choose a folder to search for the missing files" });
    this.#relink = actionButton("Relink", () => void this.#apply(), { icon: "link", variant: "wide" });
    this.#relink.classList.add("kvfx-primary");
    this.section = new Section(panel, "library.relink", "Missing Footage", "relink");
    this.section.body.append(
      h("div", { class: "kvfx-actions" }, this.#find, this.#searchButton),
      this.#status,
      this.#list,
      this.#relink,
      hint("Matches by file name. Only the files you tick are relinked; nothing on disk changes."),
    );
  }

  async #findMissing(): Promise<void> {
    const result = await this.#panel.session.query("kvfx.op.project.missing");
    this.#matches = [];
    if (!result.ok) {
      setText(this.#status, result.message);
      this.#render();
      return;
    }
    this.#missing = ((result.value as { items?: Missing[] } | null)?.items ?? []).slice();
    setText(
      this.#status,
      this.#missing.length === 0 ? "Nothing is missing." : `${String(this.#missing.length)} missing. Search a folder to find them.`,
    );
    this.#render();
  }

  #searchFolder(): void {
    if (this.#missing.length === 0) {
      setText(this.#status, "Find missing footage first.");
      return;
    }
    const folder = pickFolder("Where should KVFX look for the missing files?");
    if (folder === undefined) return;
    const wanted = new Set(this.#missing.map((m) => m.file.toLowerCase()));
    const { found, truncated } = search(folder, wanted);
    this.#matches = this.#missing.flatMap((item) => {
      const path = found.get(item.file.toLowerCase());
      return path === undefined ? [] : [{ item, path, chosen: true }];
    });
    const more = truncated ? " The folder is very large, so the search stopped early." : "";
    setText(this.#status, `Found ${String(this.#matches.length)} of ${String(this.#missing.length)} in ${baseName(folder)}.${more}`);
    this.#render();
  }

  async #apply(): Promise<void> {
    const chosen = this.#matches.filter((m) => m.chosen);
    if (chosen.length === 0) return;
    const ok = await this.#panel.confirm({
      title: `Relink ${String(chosen.length)} item${chosen.length === 1 ? "" : "s"}?`,
      body: "Each ticked item will use the file found for it. Edit ▸ Undo reverts it; no files are moved or changed.",
      confirmLabel: "Relink",
    });
    if (!ok) return;
    const value = await this.#panel.session.runPlan("Relink Footage", [
      { op: "kvfx.op.project.relink", args: { items: chosen.map((m) => ({ id: m.item.id, path: m.path })) } },
    ]);
    if (value !== undefined) await this.#findMissing();
  }

  #render(): void {
    clear(this.#list);
    const matched = new Map(this.#matches.map((m) => [m.item.id, m]));
    for (const item of this.#missing.slice(0, MAX_SHOWN)) {
      const match = matched.get(item.id);
      const box = h("input", { type: "checkbox", attrs: { "aria-label": `Relink ${item.name}` } });
      box.checked = match?.chosen === true;
      box.disabled = match === undefined;
      box.addEventListener("change", () => {
        if (match !== undefined) match.chosen = box.checked;
        this.#updateButton();
        this.#refreshButtons(this.#panel.session.state);
      });
      this.#list.append(
        h(
          "label",
          { class: "kvfx-fontrow kvfx-missing" },
          box,
          h(
            "div",
            { class: "kvfx-fontrow__name" },
            h("strong", { text: item.name }),
            h("small", { text: match === undefined ? `Not found · ${item.path || item.file}` : `→ ${match.path}` }),
          ),
        ),
      );
    }
    this.#updateButton();
    // Finding or matching files changes what can be done next, without any
    // change to the session that would refresh the buttons on its own.
    this.#refreshButtons(this.#panel.session.state);
  }

  #updateButton(): void {
    const count = this.#matches.filter((m) => m.chosen).length;
    setText(this.#relink.querySelector("span") ?? this.#relink, count === 0 ? "Relink" : `Relink ${String(count)}`);
  }

  update(state: SessionState): void {
    this.section.update(state);
    this.#refreshButtons(state);
  }

  #refreshButtons(state: SessionState): void {
    const files = filesAvailable();
    setEnabled(this.#find, !state.busy && state.snapshot.hasProject, "Open a project first.");
    setEnabled(this.#searchButton, files && !state.busy && this.#missing.length > 0, files ? "Find missing footage first." : "File access is not available here.");
    setEnabled(this.#relink, !state.busy && this.#matches.some((m) => m.chosen), "Search a folder first.");
  }
}

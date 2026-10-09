import type { Availability, Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { type FileEntry, baseName, fileUrl, filesAvailable, listFolder, pickFolder } from "../app/cep/files.js";
import { IconSize, createIcon } from "../components/icons.js";
import { Section, actionButton, hint } from "../ui/controls.js";
import { clear, h, setEnabled, toggleClass } from "../ui/dom.js";
import { RelinkSection } from "./relink-section.js";

/**
 * LIBRARY: your own folders of footage, templates and presets, one click from
 * the comp.
 *
 *   images, video, audio  → imported and placed at the top of the comp
 *   .aep / .aepx          → imported as a project (into its own folder)
 *   .ffx                  → applied to the selected layers
 *
 * Folders are read on demand, one level at a time, and nothing is ever
 * written to them.
 */

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "tif", "tiff", "psd", "bmp", "tga", "exr", "webp", "svg", "ai", "eps", "pdf", "heic"]);
const VIDEO = new Set(["mov", "mp4", "m4v", "avi", "mxf", "mkv", "webm"]);
const AUDIO = new Set(["mp3", "wav", "aif", "aiff", "m4a"]);
const PROJECT = new Set(["aep", "aepx"]);
const PRESET = new Set(["ffx"]);
/** Formats a browser can draw as a thumbnail. */
const THUMBNAIL = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"]);

type Kind = "image" | "video" | "audio" | "project" | "preset";

function kindOf(entry: FileEntry): Kind | undefined {
  if (IMAGE.has(entry.extension)) return "image";
  if (VIDEO.has(entry.extension)) return "video";
  if (AUDIO.has(entry.extension)) return "audio";
  if (PROJECT.has(entry.extension)) return "project";
  if (PRESET.has(entry.extension)) return "preset";
  return undefined;
}

const KIND_ICON: Record<Kind, string> = { image: "tab-media", video: "film", audio: "audio", project: "precompose", preset: "star" };

export class LibraryView implements View {
  readonly id = "library";
  readonly label = "Library";
  readonly icon = "tab-library";
  readonly root: HTMLElement;
  readonly #panel: Panel;
  readonly #section: Section;
  readonly #folders: HTMLElement;
  readonly #crumbs: HTMLElement;
  readonly #filter: HTMLInputElement;
  readonly #grid: HTMLElement;
  readonly #addButton: HTMLButtonElement;
  readonly #relink: RelinkSection;
  #root: string | undefined;
  #path: string | undefined;
  #entries: FileEntry[] = [];
  #foldersKey = "";

  constructor(panel: Panel) {
    this.#panel = panel;
    this.#folders = h("div", { class: "kvfx-chips" });
    this.#crumbs = h("div", { class: "kvfx-crumbs" });
    this.#filter = h("input", {
      class: "kvfx-input",
      type: "search",
      attrs: { placeholder: "Filter this folder", "aria-label": "Filter files", spellcheck: "false" },
      on: { input: () => this.#renderGrid() },
    });
    this.#grid = h("div", { class: "kvfx-files" });
    this.#addButton = actionButton("Add Folder", () => this.#addFolder(), { icon: "folder", variant: "wide" });

    this.#section = new Section(panel, "library.browse", "Library");
    this.#section.body.append(this.#addButton, this.#folders, this.#crumbs, this.#filter, this.#grid);
    if (!filesAvailable()) {
      this.#section.body.append(hint("The Library needs After Effects' file access, which is not available here."));
    }
    this.#relink = new RelinkSection(panel);
    this.root = h("div", { class: "kvfx-tab" }, this.#section.root, this.#relink.section.root);
  }

  #addFolder(): void {
    const folder = pickFolder("Choose a library folder");
    if (folder === undefined) return;
    const current = this.#panel.session.state.settings.ui.libraryFolders;
    if (!current.includes(folder)) this.#panel.session.setUi("libraryFolders", [...current, folder]);
    this.#open(folder, folder);
  }

  #removeFolder(folder: string): void {
    const next = this.#panel.session.state.settings.ui.libraryFolders.filter((f) => f !== folder);
    this.#panel.session.setUi("libraryFolders", next);
    if (this.#root === folder) {
      this.#root = undefined;
      this.#path = undefined;
      this.#entries = [];
      this.#renderGrid();
    }
  }

  #open(root: string, path: string): void {
    this.#root = root;
    this.#path = path;
    const entries = listFolder(path);
    if (entries === undefined) {
      this.#entries = [];
      this.#panel.session.report("Library", false, "That folder can't be read. It may have moved.");
    } else {
      this.#entries = entries;
    }
    this.#filter.value = "";
    this.#renderFolders(true);
    this.#renderGrid();
  }

  #renderFolders(force = false): void {
    const folders = this.#panel.session.state.settings.ui.libraryFolders;
    const key = `${folders.join("|")}#${this.#root ?? ""}`;
    if (!force && key === this.#foldersKey) return;
    this.#foldersKey = key;
    clear(this.#folders);
    for (const folder of folders) {
      const chip = h(
        "div",
        { class: "kvfx-chip" },
        h("button", { class: "kvfx-chip__main", type: "button", title: folder, on: { click: () => this.#open(folder, folder) } }, createIcon("folder", IconSize.small), h("span", { text: baseName(folder) })),
        h("button", { class: "kvfx-chip__remove", type: "button", title: "Remove from the Library (the folder itself is not touched)", attrs: { "aria-label": `Remove ${baseName(folder)}` }, on: { click: () => this.#removeFolder(folder) } }, createIcon("close", IconSize.tiny)),
      );
      toggleClass(chip, "kvfx-chip--on", folder === this.#root);
      this.#folders.append(chip);
    }
  }

  #renderGrid(): void {
    clear(this.#crumbs);
    clear(this.#grid);
    const root = this.#root;
    const path = this.#path;
    if (root === undefined || path === undefined) {
      if (this.#panel.session.state.settings.ui.libraryFolders.length === 0) {
        this.#grid.append(hint("Add a folder of footage, templates (.aep) or presets (.ffx)."));
      }
      return;
    }

    // Breadcrumbs from the library root down to here.
    const relative = path.slice(root.length).split(/[\\/]/).filter((p) => p.length > 0);
    let walk = root;
    this.#crumbs.append(h("button", { class: "kvfx-crumb", type: "button", text: baseName(root), on: { click: () => this.#open(root, root) } }));
    for (const part of relative) {
      walk = `${walk}/${part}`;
      const target = walk;
      this.#crumbs.append(h("span", { text: "›" }), h("button", { class: "kvfx-crumb", type: "button", text: part, on: { click: () => this.#open(root, target) } }));
    }

    const query = this.#filter.value.trim().toLowerCase();
    const shown = this.#entries.filter((e) => (e.isDirectory || kindOf(e) !== undefined) && (query.length === 0 || e.name.toLowerCase().includes(query)));
    if (shown.length === 0) {
      this.#grid.append(hint(query.length > 0 ? "Nothing matches." : "No usable files here."));
      return;
    }
    for (const entry of shown) this.#grid.append(this.#tile(entry));
  }

  #tile(entry: FileEntry): HTMLElement {
    if (entry.isDirectory) {
      const root = this.#root ?? entry.path;
      return h("button", { class: "kvfx-file kvfx-file--dir", type: "button", title: entry.name, on: { click: () => this.#open(root, entry.path) } }, h("span", { class: "kvfx-file__thumb" }, createIcon("folder", IconSize.large)), h("span", { class: "kvfx-file__name", text: entry.name }));
    }
    const kind = kindOf(entry) ?? "image";
    const thumb = h("span", { class: "kvfx-file__thumb" });
    if (THUMBNAIL.has(entry.extension)) {
      thumb.append(h("img", { attrs: { src: fileUrl(entry.path), alt: "", loading: "lazy", decoding: "async" } }));
    } else {
      thumb.append(createIcon(KIND_ICON[kind], IconSize.large));
    }
    const action = kind === "preset" ? "Apply to selected layers" : kind === "project" ? "Import project" : "Import and add to comp";
    return h(
      "button",
      { class: "kvfx-file", type: "button", title: `${entry.name}\n${action}`, on: { click: () => void this.#use(entry, kind) } },
      thumb,
      h("span", { class: "kvfx-file__name", text: entry.name }),
      h("span", { class: "kvfx-file__ext", text: entry.extension }),
    );
  }

  async #use(entry: FileEntry, kind: Kind): Promise<void> {
    const session = this.#panel.session;
    if (kind === "preset") {
      await session.runPlan(`Apply ${entry.name}`, [{ op: "kvfx.op.layer.applyPreset", args: { target: "selection", path: entry.path } }]);
      return;
    }
    await session.runPlan(`Import ${entry.name}`, [
      { op: "kvfx.op.project.import", args: { path: entry.path, addToComp: kind !== "project" } },
    ]);
  }

  shown(): void {
    this.#renderFolders(true);
    this.#renderGrid();
  }

  update(state: SessionState, availability: Availability): void {
    void availability;
    this.#section.update(state);
    this.#relink.update(state);
    setEnabled(this.#addButton, filesAvailable() && !state.busy, "File access is not available here.");
    this.#renderFolders();
  }
}

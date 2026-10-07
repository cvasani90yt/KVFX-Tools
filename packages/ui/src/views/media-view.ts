import type { Availability, Panel, View } from "../app/panel.js";
import type { SessionState } from "../app/session.js";
import { appDataFolder, baseName, extensionOf, filesAvailable, freePath, join, makeDirs, writeBase64 } from "../app/cep/files.js";
import { IconSize, createIcon } from "../components/icons.js";
import { Section, hint } from "../ui/controls.js";
import { clear, h, setText, toggleClass } from "../ui/dom.js";

/**
 * MEDIA: paste or drop images and clips straight into the composition.
 *
 * A pasted screenshot has no file, and After Effects can only import files —
 * so the panel saves it first, then imports it. Where it is saved is the
 * user's choice in Settings: beside the saved project (so the project stays
 * portable) or in KVFX's application-data folder. Names never collide with an
 * existing file; nothing is overwritten.
 */

/** 512 MB: larger files are better imported by After Effects directly. */
const MAX_BYTES = 536_870_912;
const MAX_NAME_LENGTH = 120;
const RECENT_SHOWN = 20;
const FIRST_PRINTABLE = 32;
const MEDIA_FOLDER = "KVFX Media";
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};
const ACCEPTED = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff", "psd", "mp4", "mov", "webm", "m4v", "mp3", "wav", "aif", "aiff", "m4a"]);

interface Saved {
  readonly name: string;
  readonly path: string;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** A file name safe on Windows and macOS: no separators, reserved or control characters. */
function safeName(name: string): string {
  let out = "";
  for (const ch of name) out += ch.charCodeAt(0) < FIRST_PRINTABLE || '\\/:*?"<>|'.includes(ch) ? "-" : ch;
  return out.replace(/^\.+/, "").slice(0, MAX_NAME_LENGTH) || "media";
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = (): void => reject(new Error("read failed"));
    reader.onload = (): void => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma === -1 ? "" : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export class MediaView implements View {
  readonly id = "media";
  readonly label = "Media";
  readonly icon = "tab-media";
  readonly root: HTMLElement;
  readonly #panel: Panel;
  readonly #section: Section;
  readonly #zone: HTMLElement;
  readonly #status: HTMLElement;
  readonly #recent: HTMLElement;
  readonly #saved: Saved[] = [];
  #working = false;

  constructor(panel: Panel) {
    this.#panel = panel;
    this.#status = h("span", { class: "kvfx-drop__status" });
    this.#zone = h(
      "div",
      {
        class: "kvfx-drop",
        attrs: { tabindex: "0", role: "button", "aria-label": "Paste or drop media here" },
        on: {
          dragover: (event) => {
            event.preventDefault();
            toggleClass(this.#zone, "kvfx-drop--over", true);
          },
          dragleave: () => toggleClass(this.#zone, "kvfx-drop--over", false),
          drop: (event) => {
            event.preventDefault();
            toggleClass(this.#zone, "kvfx-drop--over", false);
            void this.#accept(Array.from(event.dataTransfer?.files ?? []));
          },
        },
      },
      createIcon("tab-media", IconSize.huge),
      h("strong", { text: "Paste or drop media" }),
      h("span", { text: "Ctrl/⌘ + V with the panel focused, or drag files here" }),
      this.#status,
    );
    this.#recent = h("div", { class: "kvfx-list" });

    document.addEventListener("paste", (event) => {
      if (!this.root.isConnected) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void this.#accept(files);
    });

    this.#section = new Section(panel, "media.paste", "Paste & Drop");
    this.#section.body.append(this.#zone, h("div", { class: "kvfx-subhead", text: "This session" }), this.#recent);
    if (!filesAvailable()) this.#section.body.append(hint("Saving media needs After Effects' file access, which is not available here."));
    this.root = h("div", { class: "kvfx-tab" }, this.#section.root);
    this.#renderRecent();
  }

  async #targetFolder(): Promise<string | undefined> {
    const session = this.#panel.session;
    if (session.state.settings.ui.mediaTarget === "project") {
      const info = await session.query("kvfx.op.project.info");
      const folder = info.ok ? (info.value as { folder?: unknown } | null)?.folder : undefined;
      if (typeof folder === "string" && folder.length > 0) return join(folder, MEDIA_FOLDER);
    }
    return appDataFolder("media");
  }

  async #accept(files: File[]): Promise<void> {
    if (this.#working || files.length === 0) return;
    const session = this.#panel.session;
    if (!filesAvailable() || !session.connected) {
      session.report("Media", false, "Open the panel inside After Effects to import media.");
      return;
    }
    this.#working = true;
    try {
      const folder = await this.#targetFolder();
      if (folder === undefined || !makeDirs(folder)) {
        session.report("Media", false, "Couldn't create the media folder.");
        return;
      }
      for (const file of files) await this.#saveAndImport(file, folder);
    } finally {
      this.#working = false;
      setText(this.#status, "");
    }
  }

  async #saveAndImport(file: File, folder: string): Promise<void> {
    const session = this.#panel.session;
    const fromName = extensionOf(file.name);
    const ext = ACCEPTED.has(fromName) ? fromName : (MIME_EXT[file.type] ?? "");
    if (!ACCEPTED.has(ext)) {
      session.report("Media", false, `${file.name || "That"} isn't an image, video or audio file After Effects can import.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      session.report("Media", false, `${file.name} is over 512 MB — import it with File ▸ Import instead.`);
      return;
    }
    // Clipboard images arrive as "image.png"; give them a name worth keeping.
    const pasted = file.name.length === 0 || /^image\.\w+$/i.test(file.name);
    const name = pasted ? `Paste ${stamp()}.${ext}` : safeName(file.name);
    const path = freePath(folder, name);

    setText(this.#status, `Saving ${baseName(path)}…`);
    let data: string;
    try {
      data = await readBase64(file);
    } catch {
      session.report("Media", false, `Couldn't read ${file.name}.`);
      return;
    }
    if (!writeBase64(path, data)) {
      session.report("Media", false, `Couldn't save ${baseName(path)}.`);
      return;
    }
    const result = await session.runPlan(`Import ${baseName(path)}`, [{ op: "kvfx.op.project.import", args: { path, addToComp: true } }]);
    if (result !== undefined) {
      this.#saved.unshift({ name: baseName(path), path });
      this.#renderRecent();
    }
  }

  #renderRecent(): void {
    clear(this.#recent);
    if (this.#saved.length === 0) {
      this.#recent.append(hint("Imported media will be listed here, with where it was saved."));
      return;
    }
    for (const item of this.#saved.slice(0, RECENT_SHOWN)) {
      this.#recent.append(h("div", { class: "kvfx-recent", title: item.path }, createIcon("check", IconSize.small), h("span", { text: item.name })));
    }
  }

  update(state: SessionState, availability: Availability): void {
    void availability;
    this.#section.update(state);
  }
}

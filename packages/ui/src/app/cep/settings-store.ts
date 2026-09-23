import { USER_DATA_DIRNAME } from "@kvfx/core";
import { CEP_FS_NO_ERROR, SYSTEM_PATH_USER_DATA, type AdobeCepFs } from "./types.js";

/**
 * Settings persistence, via CEP's built-in filesystem bridge.
 *
 * `cep.fs` is available without Node being enabled, and it runs in the panel's
 * process — so writing settings does not freeze After Effects, which a host
 * round-trip through ExtendScript would. That is the whole reason this does not
 * go through the bridge.
 *
 * Two deliberate choices:
 *
 * **Any read error means "no settings yet".** A missing file is the common case
 * on first run, and every other read failure should also fall back to defaults
 * rather than leave the user with a broken panel. So we depend only on
 * `err === 0` and never on specific error codes, which are not part of any
 * contract we can rely on.
 *
 * **Writes are confined to our own directory.** `cep.fs` can write anywhere the
 * user can; every path this module produces is built from the platform
 * application-data root plus our own folder name, and nothing here accepts a
 * caller-supplied path.
 */

export interface SettingsStore {
  read(): unknown;
  write(value: unknown): { ok: true } | { ok: false; reason: string };
  /** Absolute path, for the diagnostics view. */
  location(): string;
}

/**
 * Converts CEP's `file://` URL to a native path.
 *
 * Windows yields `file:///C:/Users/...` and macOS `file:///Users/...`, so
 * stripping a fixed prefix breaks one of the two. Removing `file://` and then
 * dropping a leading slash only when a drive letter follows handles both.
 */
export function systemPathToNative(url: string): string {
  const decoded = decodeURI(url);
  const withoutScheme = decoded.startsWith("file://") ? decoded.slice("file://".length) : decoded;
  return /^\/[A-Za-z]:/.test(withoutScheme) ? withoutScheme.slice(1) : withoutScheme;
}

/**
 * Joins path segments with forward slashes.
 *
 * Windows accepts forward slashes throughout, and CEP already hands us a path
 * that uses them, so one separator keeps this free of platform branching.
 */
function join(...segments: readonly string[]): string {
  return segments.join("/");
}

export class CepSettingsStore implements SettingsStore {
  readonly #fs: AdobeCepFs;
  readonly #dir: string;
  readonly #file: string;
  #directoryReady = false;

  constructor(fs: AdobeCepFs, userDataRoot: string) {
    this.#dir = join(userDataRoot, USER_DATA_DIRNAME, "config");
    this.#file = join(this.#dir, "settings.json");
    this.#fs = fs;
  }

  location(): string {
    return this.#file;
  }

  read(): unknown {
    const result = this.#fs.readFile(this.#file);
    if (result.err !== CEP_FS_NO_ERROR || typeof result.data !== "string") return undefined;
    try {
      return JSON.parse(result.data) as unknown;
    } catch {
      // A truncated or hand-edited file: fall back to defaults rather than
      // refusing to start. `migrateSettings` reports this to the user.
      return undefined;
    }
  }

  write(value: unknown): { ok: true } | { ok: false; reason: string } {
    if (!this.#ensureDirectory()) {
      return { ok: false, reason: `Could not create ${this.#dir}` };
    }

    const result = this.#fs.writeFile(this.#file, JSON.stringify(value, null, 2));
    if (result.err !== CEP_FS_NO_ERROR) {
      return { ok: false, reason: `Could not write ${this.#file} (error ${String(result.err)})` };
    }
    return { ok: true };
  }

  /**
   * `makedir` is not recursive, so each level is created in turn. An error is
   * ignored here because "already exists" and "cannot create" are not reliably
   * distinguishable; the subsequent write is what actually decides.
   */
  #ensureDirectory(): boolean {
    if (this.#directoryReady) return true;
    const parent = this.#dir.slice(0, this.#dir.lastIndexOf("/"));
    this.#fs.makedir(parent);
    this.#fs.makedir(this.#dir);
    this.#directoryReady = true;
    return true;
  }
}

/** Returns a store, or `undefined` when CEP's filesystem bridge is absent. */
export function createSettingsStore(): SettingsStore | undefined {
  const fs = window.cep?.fs;
  const host = window.__adobe_cep__;
  if (fs === undefined || host === undefined) return undefined;

  return new CepSettingsStore(fs, systemPathToNative(host.getSystemPath(SYSTEM_PATH_USER_DATA)));
}

/**
 * An in-memory store, used when CEP's filesystem bridge is unavailable.
 *
 * The panel stays fully usable; favourites and recents simply do not survive a
 * restart. Refusing to run would be a worse trade for the user than losing
 * preferences they can re-set in seconds.
 */
export function createMemoryStore(): SettingsStore {
  let held: unknown;
  return {
    read: () => held,
    write: (value): { ok: true } => {
      held = value;
      return { ok: true };
    },
    location: () => "(not saved — CEP filesystem unavailable)",
  };
}

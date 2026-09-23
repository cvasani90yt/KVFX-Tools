import { homedir, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Platform-safe path resolution.
 *
 * Every location the tooling touches is derived here. Nothing in the codebase
 * may embed a literal `C:\`, `/Users/` or `%APPDATA%` — enforced by
 * `tools/check-hardcoded-paths.mjs`, which is why this file is its own
 * documented exception.
 */

export const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export const EXTENSION_BUNDLE_ID = "com.kvfx.tools";
export const USER_DATA_DIRNAME = "KVFXTools";

/** Where `npm run build:cep` assembles the loadable extension. */
export const stagedExtensionDir = join(repoRoot, "build", "extension", EXTENSION_BUNDLE_ID);

export class UnsupportedPlatformError extends Error {
  constructor(what) {
    super(
      `${what} is only available on Windows and macOS. ` +
        `This machine reports "${platform()}", and After Effects does not run on it. ` +
        `Building and testing still work here; installing into After Effects does not.`,
    );
    this.name = "UnsupportedPlatformError";
  }
}

/**
 * The per-user CEP extensions directory.
 *
 * Per-user rather than system-wide: it needs no elevation, and a developer's
 * dev build must never overwrite an installed release.
 */
export function cepExtensionsDir() {
  switch (platform()) {
    case "win32": {
      const appData = process.env["APPDATA"];
      if (!appData) {
        throw new Error("APPDATA is not set; cannot locate the CEP extensions directory.");
      }
      return join(appData, "Adobe", "CEP", "extensions");
    }
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Adobe", "CEP", "extensions");
    default:
      throw new UnsupportedPlatformError("The CEP extensions directory");
  }
}

/**
 * The product's user-data root (ARCHITECTURE §10).
 *
 * Never the install directory: an uninstall or update must not be able to take
 * a user's presets with it.
 */
export function userDataDir() {
  switch (platform()) {
    case "win32": {
      const appData = process.env["APPDATA"];
      if (!appData) throw new Error("APPDATA is not set; cannot locate the user data directory.");
      return join(appData, USER_DATA_DIRNAME);
    }
    case "darwin":
      return join(homedir(), "Library", "Application Support", USER_DATA_DIRNAME);
    default:
      throw new UnsupportedPlatformError("The user data directory");
  }
}
